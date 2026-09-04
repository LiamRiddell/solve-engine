import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { parseIso8601 } from "@solve-js/packages/datetime/Iso8601";
import {
  readNumericDate,
  type DatetimeErrorCode,
  type NumericDateSeparator,
  type ResolvedDateOrder,
} from "../DateReading";
import type { DateAmbiguity } from "@solve-js/constants/Configuration";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

/**
 * Token type a fused date literal is rewritten to.
 *
 * One type covers every supported ordering, so the parselet handles the shape
 * rather than the locale.
 */
export const DATETIME_LITERAL_TYPE = "DATETIME_LITERAL";
const DATETIME_LITERAL_TYPE_ID = tokenTypeId(DATETIME_LITERAL_TYPE);

/**
 * Token type a date-shaped run that no configured order can read is rewritten
 * to, carrying the code and the message rather than a value.
 *
 * A separate type rather than a flag on the literal above, so the parselet for
 * each is the shape of what it does: one pushes a date, the other reports a
 * fault. `UnreadableDateParselet` compiles it to a plugin call returning an
 * Error VALUE, which is what keeps a refusal off the throwing path and out of
 * the bytecode format: no new opcode, no operand change, and
 * `SNAPSHOT_VERSION` untouched.
 */
export const DATETIME_LITERAL_UNREADABLE_TYPE = "DATETIME_LITERAL_UNREADABLE";
const DATETIME_LITERAL_UNREADABLE_TYPE_ID = tokenTypeId(DATETIME_LITERAL_UNREADABLE_TYPE);

/** A pure digit string, guards against fusing hex/scientific/bigint-suffixed NUMBER tokens. */
const PLAIN_INTEGER = /^\d+$/;

/** First NUMBER token of a dot-separated literal: the lexer's decimal scanner
 * merges "DD.MM" into one float-shaped token (see module doc below). */
const DOT_DAY_MONTH = /^\d{1,2}\.\d{1,2}$/;

/** Second NUMBER token of a dot-separated literal: the lexer re-enters
 * tokenizeNumber() AT the second dot, so the year keeps its leading dot. */
const DOT_LEADING_YEAR = /^\.(\d{2}|\d{4})$/;

/**
 * Whether every token in a run touches the next one in the source text, with
 * no whitespace anywhere between the first character and the last.
 *
 * This is the whole basis for telling a date literal apart from the
 * arithmetic it is spelled identically to. A date is written as one
 * uninterrupted run ("2024-5-3"); a subtraction chain is written with spaces
 * around its operators ("2024 - 5 - 3"). The lexer records that difference in
 * the token offsets and nowhere else, since the tokens themselves are the same
 * five either way:
 *
 *   2024-5-3        NUMBER@0 MINUS@4 NUMBER@5 MINUS@6 NUMBER@7
 *   2024 - 5 - 3    NUMBER@0 MINUS@5 NUMBER@7 MINUS@9 NUMBER@11
 *
 * The same technique, for the same reason, is what tells "5k" from "5 k" in
 * `arithmetic/normalizer/LargeNumberSuffixNormalizerRule.ts`.
 *
 * ## Why this replaced a zero-padding requirement on the ISO branch
 * The ISO branch briefly required its month and day groups to be padded to two
 * digits, which did stop "2024 - 5 - 3" being answered as "Friday, May 3,
 * 2024" but also stopped "2024-5-3" being a date at all. Padding was never the
 * real distinction, and the rule's own US branch is the proof: it has always
 * accepted unpadded groups, so "1-1-2020" and "12-25-2023" are both dates
 * today. Requiring padding on one branch of the two was therefore an
 * inconsistency between two spellings of one rule rather than a policy.
 *
 * The US branch's own guard is a 2-or-4-digit trailing year plus the calendar
 * check, and it is NOT safe against spaced arithmetic on its own: before this
 * check existed, "12 - 25 - 2023" answered Christmas 2023 instead of -2036,
 * and "1 - 1 - 2020" answered New Year's Day instead of -2020. Applying
 * adjacency to the whole run rather than to one branch fixes that at the same
 * time and leaves both branches resting on the same reason.
 *
 * ## Padded but spaced
 * "2024 - 05 - 03" is subtraction under this check, and that is the intended
 * reading. Nobody types the spaces when they mean the date, so the spacing is
 * the clearest signal available about which was meant, and the padding is not:
 * a person subtracting may well write "05" for the same reason they write
 * "05" anywhere else. Choosing the date there would mean no spelling of that
 * subtraction existed.
 *
 * `sourceEnd` is preferred over `text.length` where it is set, because a token
 * an earlier rule fused carries replacement text rather than source text and
 * only `sourceEnd` still describes the span it covers (see
 * `normalizer/TokenNormalizer.ts`'s `createFusedToken`).
 */
function writtenAsOneRun(tokens: Token[]): boolean {
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const end = token.sourceEnd ?? token.offset + token.text.length;
    if (end !== tokens[i + 1].offset) return false;
  }
  return true;
}

/**
 * Converts a validated day/month/year triple into a fused DATETIME_LITERAL
 * token, or null if the triple isn't a real calendar date (e.g. "30" for
 * February), letting the caller fall back to treating the source tokens
 * as ordinary arithmetic instead of a date.
 *
 * `calendar` is the backend the literal's local midnight is built with.
 */
export function buildDateToken(
  day: number,
  month: number,
  year: number,
  sourceTokens: Token[],
  ruleName: string,
  calendar: CalendarBackend,
): NormalizerMatch | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Local midnight, consistent with formatDatetime()'s display and the
  // DATE_NOW epoch, both of which are local-time.
  const epochMs = calendar.localMidnight(year, month - 1, day);
  // Reject calendar rollover (e.g. day=30 in February) rather than silently
  // normalizing to March 2, a rollover almost always means the tokens were
  // never a date to begin with (e.g. "2-30-5" as chained subtraction).
  const built = calendar.fields(epochMs);
  if (built.year !== year || built.month0 !== month - 1 || built.day !== day) {
    return null;
  }

  const first = sourceTokens[0];
  const text = sourceTokens.map((t) => t.value).join("");
  const fusedToken = new LexerToken(
    DATETIME_LITERAL_TYPE,
    DATETIME_LITERAL_TYPE_ID,
    String(epochMs),
    text,
    first.offset,
    0,
    first.line,
    first.col,
  );

  return { consumed: sourceTokens.length, replacement: [fusedToken], ruleName };
}

/**
 * The source text a run of tokens covers, with one space wherever the tokens
 * were not written touching.
 *
 * Reconstructed from the token offsets because a normaliser rule is handed
 * tokens rather than the line they came from, and a refusal has to quote what
 * the reader typed: `"29 February 2026"` and `"March 9, 2024"` read back the
 * way they were written, while an adjacent run like `"03/04/2026"` reads back
 * with nothing added.
 *
 * @param tokens - The run.
 * @returns The reconstructed text.
 */
export function runText(tokens: Token[]): string {
  let out = "";
  let previousEnd = -1;
  for (const token of tokens) {
    const text = token.text ?? token.value;
    if (previousEnd >= 0 && token.offset > previousEnd) out += " ";
    out += text;
    previousEnd = token.sourceEnd ?? token.offset + text.length;
  }
  return out;
}

/**
 * Fuses a run that names no readable date into one
 * {@link DATETIME_LITERAL_UNREADABLE_TYPE} token carrying the refusal.
 *
 * The code and message travel as JSON in the token's `value`, which is the
 * only field a fused token has to carry a payload in, and `text` keeps the
 * run exactly as typed so an editor still underlines what the reader wrote.
 *
 * Consuming the run rather than declining it is the whole point: declining
 * would hand the same five tokens back to the parser, which reads them as the
 * division they are spelled like, and answering 0.0004 for a date is the
 * behaviour being fixed.
 *
 * @param code - The refusal's error code.
 * @param message - The sentence the reader sees.
 * @param sourceTokens - The run being replaced.
 * @param ruleName - The rule name, for normaliser bookkeeping.
 * @returns The match.
 */
export function faultMatch(
  code: DatetimeErrorCode,
  message: string,
  sourceTokens: Token[],
  ruleName: string,
): NormalizerMatch {
  const first = sourceTokens[0];
  const fusedToken = new LexerToken(
    DATETIME_LITERAL_UNREADABLE_TYPE,
    DATETIME_LITERAL_UNREADABLE_TYPE_ID,
    JSON.stringify({ code, message }),
    runText(sourceTokens),
    first.offset,
    0,
    first.line,
    first.col,
  );
  return { consumed: sourceTokens.length, replacement: [fusedToken], ruleName };
}

/**
 * A full ISO 8601 timestamp: an ISO date with a time of day, optionally
 * carrying a UTC offset or the `Z` that means one of zero.
 *
 * Anchored at the start and deliberately greedy about the offset, so
 * `...T15:30:00+11:00` matches through the offset rather than stopping at the
 * seconds and leaving `+11:00` behind as an addition. That is what the bare
 * form used to do: `2019-04-01T15:30:00+11:00` read the offset as a clock time
 * being ADDED to the date on its left, and answered today at 11:00. Both
 * halves of that were wrong and neither was visible, which is worse than the
 * bare form simply not being supported.
 *
 * The time of day is required. Without it this would match what the date-only
 * branches below already handle, and they carry the ambiguity rules
 * (adjacency, group shapes) that keep a subtraction chain a subtraction.
 *
 * Matched against reconstructed source text rather than token by token. The
 * lexer has no idea this is one literal, so it emits nine to fourteen tokens
 * for it with the shape depending on the spelling (`T15` arrives as an
 * identifier, `Z` as another, an offset as a PLUS or MINUS with two more
 * numbers), and enumerating those permutations in token patterns is how a
 * spelling gets missed.
 *
 * `T` and `Z` are uppercase only, matching `Iso8601.ts`'s own pattern, which is
 * what actually parses the match. Accepting a spelling here that the parser
 * then refuses would mean the bare form supported more shapes than the quoted
 * one, for no reason a reader could infer.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/;

/**
 * Token types a run of ISO 8601 timestamp text can lex into. Anything else
 * ends the run, so the reconstruction below can never reach across an operator
 * or a word that is not part of the literal.
 */
const ISO_TOKEN_TYPES = new Set(["NUMBER", "MINUS", "PLUS", "COLON", "IDENT"]);

/**
 * How many tokens the longest supported spelling occupies. `2019-04-01T15:30:00.123+11:00`
 * is fourteen; the cap only bounds the walk, since the match itself decides
 * where the literal ends.
 */
const ISO_MAX_TOKENS = 16;

/**
 * Fuses a bare (unquoted) ISO 8601 timestamp into one DATETIME_LITERAL.
 *
 * `Iso8601.ts` could always parse this shape, and still does the parsing here;
 * what it said could not be done without "a much larger, dedicated lexer
 * change" was recognising the bare form, on the grounds that it is ambiguous
 * with arithmetic. The date half of that ambiguity was settled by the rule this
 * helper sits inside (a date is written as one uninterrupted run, so
 * `2024 - 5 - 3` stays arithmetic), and the time half is not ambiguous at all:
 * no chain of subtractions contains a `T15:30`.
 *
 * Contiguity in the SOURCE is what makes that true, the same test
 * {@link writtenAsOneRun} applies to the date-only orderings. Every token has
 * to begin exactly where the previous one ended, so `2019-04-01 T15:30` with a
 * space in it, or `2019-04-01 + 11:00` with the offset written as an addition,
 * are left alone: the user who typed a space typed two things.
 *
 * A token an earlier normalizer rule already fused ends the run rather than
 * joining it. Its `text` is replacement text rather than source text (see
 * `normalizer/TokenNormalizer.ts`'s `createFusedToken`), so concatenating it
 * would reconstruct something the user never typed, and nothing that has
 * already been fused into a phrase is part of a timestamp anyway.
 *
 * @returns The fused match, or null when the tokens at `pos` are not a
 * timestamp, when the match would end mid-token, or when the shape is
 * ISO-like but names no real instant (`2019-04-01T25:00:00`).
 */
function fuseIsoTimestamp(tokens: Token[], pos: number, ruleName: string, calendar: CalendarBackend): NormalizerMatch | null {
  const first = tokens[pos];
  if (first.sourceEnd !== undefined) return null;
  let text = first.text;
  let runEnd = first.offset + first.text.length;
  const window: Token[] = [first];
  for (let i = pos + 1; i < tokens.length && window.length < ISO_MAX_TOKENS; i++) {
    const next = tokens[i];
    if (next.sourceEnd !== undefined) break;
    if (next.offset !== runEnd || !ISO_TOKEN_TYPES.has(next.type)) break;
    text += next.text;
    runEnd = next.offset + next.text.length;
    window.push(next);
  }

  const matched = ISO_TIMESTAMP.exec(text);
  if (matched === null) return null;

  // The literal has to end where a token ends. A match that stopped halfway
  // through one would leave the parser holding a token whose text has already
  // been consumed, so decline and let the ordinary rules have it.
  let consumed = 0;
  let covered = 0;
  for (const token of window) {
    covered += token.text.length;
    consumed++;
    if (covered >= matched[0].length) break;
  }
  if (covered !== matched[0].length) return null;

  // The instant comes from the same parser the quoted form uses, so the two
  // spellings cannot drift apart: an offset means what it means there, and a
  // timestamp with no offset is local time, exactly as a bare date literal is
  // local midnight.
  const epochMs = parseIso8601(matched[0], calendar);
  if (epochMs === null) return null;

  const fusedToken = new LexerToken(
    DATETIME_LITERAL_TYPE,
    DATETIME_LITERAL_TYPE_ID,
    String(epochMs),
    matched[0],
    first.offset,
    0,
    first.line,
    first.col,
    first.offset + matched[0].length,
  );
  return { consumed, replacement: [fusedToken], ruleName };
}

/**
 * NormalizerRule that fuses numeric date literals into a single
 * DATETIME_LITERAL token, per the documented "Datetime Formats":
 * - European: DD/MM/YYYY  (5 tokens: NUMBER SLASH NUMBER SLASH NUMBER)
 * - US:       MM-DD-YYYY  (5 tokens: NUMBER MINUS NUMBER MINUS NUMBER)
 * - ISO 8601: YYYY-MM-DD  (same 5-token shape as US, disambiguated by the
 *             first group being exactly 4 digits)
 * - Dot:      DD.MM.YYYY  (2 tokens. See below)
 *
 * ## Why the dot format is a 2-token window, not 5
 * ExpressionLexer's tokenizeNumber() treats "." adjacent to digits on both
 * sides as a decimal point, not a separator. For "25.12.2023" the lexer
 * itself emits only two NUMBER tokens: "25.12" (day+month merged into one
 * float-shaped literal) and ".2023" (the lexer re-enters number scanning
 * AT the second dot, so the year keeps a leading dot). There is no 5-token
 * NUMBER-DOT-NUMBER-DOT-NUMBER shape to match against, the fusion has to
 * happen post-hoc from that 2-token shape instead. This only works for the
 * literal typed with no internal whitespace (e.g. "25.12.2023"); a spaced
 * variant ("25 .12 .2023") produces three separate leading-dot tokens and
 * is intentionally not supported, out of scope for the documented format.
 *
 * ## Ambiguity with existing arithmetic
 * A date-shaped SLASH or MINUS chain (e.g. "25/12/2023" or "12-25-2023")
 * previously parsed as chained division/subtraction. This rule
 * deliberately reinterprets any such chain that resolves to a real
 * calendar date as a date literal instead, matching the documented
 * behavior. Chains that aren't valid dates (out-of-range day/month, a
 * February 30, a non-2/4-digit year) fall through unchanged.
 *
 * That reinterpretation only ever claims a chain written as one
 * uninterrupted run of characters. "25/12/2023" and "12-25-2023" are dates;
 * "25 / 12 / 2023" and "12 - 25 - 2023", written with the spaces an operator
 * normally gets, stay division and subtraction. {@link writtenAsOneRun}
 * carries the full reasoning, including why this is checked instead of
 * requiring an ISO date's zero-padding.
 *
 * ## Relationship to Iso8601.ts / DatePhrase.ts
 * This is the general-purpose "bare numeric date literal" implementation
 * those two files' doc comments referenced as landing on a sibling branch
 * (`feat/safety-limits-datetime-literals`), now ported here. It's
 * intentionally independent of both: `Iso8601.ts` only parses QUOTED
 * STRING literals (`"2019-04-01..." to date`), and the Stocks package's
 * `DatePhrase.ts` is a narrower, deliberately-diverging grammar (US-style
 * bare SLASH dates, 4-digit-year-only) scoped to stock-history queries
 * neither of those needed to change for this to land.
 *
 * ## What a run no order can read does
 * A date-shaped run the resolved order cannot read is REFUSED rather than
 * handed back to the parser as division: `12/25/2026` on a day-first engine
 * reports that there is no month 25 instead of answering 0.00, and
 * `31/02/2026 + 1 day` reports that February 2026 has 28 days instead of
 * answering "1.01 day". Which runs refuse and which still fall through to
 * arithmetic is decided by shape, in `DateReading.ts`'s `classifyRun`, and the
 * boundary is measured rather than aesthetic: a four-digit DENOMINATOR ends
 * nothing anybody writes, while a four-digit NUMERATOR is ordinary division
 * (`1000/10/5` is 20, `1024/8/2` is 64), so the two are treated differently on
 * purpose. `date.onAmbiguous: 'arithmetic'` restores every previous value.
 *
 * `getCalendar` supplies the calendar backend the literal is built with, read
 * per match so it follows the engine that registered the rule; the default
 * is the built-in `Date` backend, for a rule registered outside an engine.
 * `getOnAmbiguous` supplies that engine's refusal policy the same way.
 */
export function dateLiteralNormalizerRule(
  getInputOrder: () => ResolvedDateOrder = () => "auto",
  getCalendar: () => CalendarBackend = () => DATE_CALENDAR,
  getOnAmbiguous: () => DateAmbiguity = () => "refuse",
): NormalizerRule {
  return {
    name: "datetime:date-literal",
    priority: 70,
    // Derived from this rule's own opening guards; see RuleSlot on why an
    // over-broad slot is safe and an over-narrow one is not.
    shape: [{ types: ["NUMBER"] }],
    match(tokens: Token[], pos: number): NormalizerMatch | null {
      const t0 = tokens[pos];
      if (t0.type !== "NUMBER") return null;
      const calendar = getCalendar();

      // ── Dot format: 2-token window (see module doc) ──────────────────
      // The lexer merged the day and month into one float-shaped token, but
      // the boundary is still there in the text, so the same reading, the same
      // shapes and the same refusals apply here as to the separator forms. It
      // used to ignore `date.inputOrder` outright: `03.04.2026` on a
      // month-first engine answered 3 April, silently reading it the other
      // way round, and `12.25.2026` answered nothing at all.
      if (DOT_DAY_MONTH.test(t0.value)) {
        const t1 = tokens[pos + 1];
        if (t1 && t1.type === "NUMBER" && DOT_LEADING_YEAR.test(t1.value)) {
          const [first, second] = t0.value.split(".");
          const dotRun = {
            text: `${t0.value}${t1.value}`,
            groups: [first, second, t1.value.slice(1)] as const,
            separator: "dot" as NumericDateSeparator,
          };
          const dotReading = readNumericDate(dotRun, getInputOrder(), getOnAmbiguous(), calendar);
          if (dotReading.kind === "date") {
            return buildDateToken(
              dotReading.day, dotReading.month, dotReading.year,
              [t0, t1], "datetime:date-literal:dot", calendar,
            );
          }
          if (dotReading.kind === "refuse") {
            return faultMatch(dotReading.code, dotReading.message, [t0, t1], "datetime:date-literal:dot:unreadable");
          }
        }
        return null;
      }

      // ── ISO 8601 timestamp: as many tokens as the spelling takes ─────
      // Tried before the date-only windows below, which would otherwise fuse
      // the date half of a timestamp and leave the time half to be read as
      // arithmetic. See fuseIsoTimestamp().
      if (t0.value.length === 4 && PLAIN_INTEGER.test(t0.value)) {
        const timestamp = fuseIsoTimestamp(tokens, pos, "datetime:date-literal:iso-timestamp", calendar);
        if (timestamp) return timestamp;
      }

      // ── Slash / minus format: 5-token window ─────────────────────────
      if (!PLAIN_INTEGER.test(t0.value)) return null;
      const sep1 = tokens[pos + 1];
      if (!sep1 || (sep1.type !== "SLASH" && sep1.type !== "MINUS")) return null;
      const t1 = tokens[pos + 2];
      const sep2 = tokens[pos + 3];
      const t2 = tokens[pos + 4];
      if (!t1 || t1.type !== "NUMBER" || !PLAIN_INTEGER.test(t1.value)) return null;
      if (!sep2 || sep2.type !== sep1.type) return null;
      if (!t2 || t2.type !== "NUMBER" || !PLAIN_INTEGER.test(t2.value)) return null;

      const sourceTokens = [t0, sep1, t1, sep2, t2];
      // The one check that separates every reading below from the arithmetic
      // it is spelled identically to, and the only one that applies to all of
      // them equally. Adjacency still decides date-versus-arithmetic before
      // any shape or order is considered, so `2024 - 5 - 3` is 2,016 and no
      // setting makes it a date. See writtenAsOneRun.
      if (!writtenAsOneRun(sourceTokens)) return null;

      // The reading, the refusal and the decision to leave the run alone all
      // come from one function, so this rule and the surfaces that explain a
      // literal cannot word or decide the same fact differently. See
      // `DateReading.ts`, which carries the four shapes and why two of them
      // refuse while the other two fall through.
      const run = {
        text: sourceTokens.map((token) => token.value).join(""),
        groups: [t0.value, t1.value, t2.value] as const,
        separator: (sep1.type === "MINUS" ? "hyphen" : "slash") as NumericDateSeparator,
      };
      const reading = readNumericDate(run, getInputOrder(), getOnAmbiguous(), calendar);
      if (reading.kind === "arithmetic") return null;
      if (reading.kind === "refuse") {
        return faultMatch(reading.code, reading.message, sourceTokens, "datetime:date-literal:unreadable");
      }
      return buildDateToken(
        reading.day, reading.month, reading.year, sourceTokens,
        `datetime:date-literal:${reading.order.toLowerCase()}`, calendar,
      );
    },
  };
}
