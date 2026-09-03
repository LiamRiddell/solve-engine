import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { parseIso8601 } from "@solve-js/packages/datetime/Iso8601";
import type { DateInputOrder } from "@solve-js/constants/Configuration";

/**
 * Token type a fused date literal is rewritten to.
 *
 * One type covers every supported ordering, so the parselet handles the shape
 * rather than the locale.
 */
export const DATETIME_LITERAL_TYPE = "DATETIME_LITERAL";
const DATETIME_LITERAL_TYPE_ID = tokenTypeId(DATETIME_LITERAL_TYPE);

/** A pure digit string, guards against fusing hex/scientific/bigint-suffixed NUMBER tokens. */
const PLAIN_INTEGER = /^\d+$/;

/** First NUMBER token of a dot-separated literal: the lexer's decimal scanner
 * merges "DD.MM" into one float-shaped token (see module doc below). */
const DOT_DAY_MONTH = /^\d{1,2}\.\d{1,2}$/;

/** Second NUMBER token of a dot-separated literal: the lexer re-enters
 * tokenizeNumber() AT the second dot, so the year keeps its leading dot. */
const DOT_LEADING_YEAR = /^\.(\d{2}|\d{4})$/;

/**
 * Day and month groups of a separator-separated literal, in any of the three
 * orderings below: one or two digits, padded or not.
 *
 * Deliberately NOT two digits exactly. Zero-padding is what ISO 8601 requires
 * of a serialized date, but it is not what people type: "2024-5-3" is an
 * ordinary way to write a date and has to keep working. The digit count is
 * still bounded because a group of three or more digits is not a date group at
 * all, and the calendar check in {@link buildDateToken} would not catch it on
 * its own ("030" reads back as day 30).
 *
 * What actually separates a date from the arithmetic it is spelled like is
 * adjacency, not padding. See {@link writtenAsOneRun}.
 */
const DAY_OR_MONTH = /^\d{1,2}$/;

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
 * Resolves a year token's raw digit text to a 4-digit year.
 *
 * Accepts exactly 2 or 4 digits (matching the wiki's documented formats).
 * A 2-digit year is windowed using the common glibc `strptime("%y")`
 * convention: 00-68 -> 2000-2068, 69-99 -> 1969-1999. Any other digit
 * count (1 or 3 digits) is not a valid year shape and returns null so the
 * caller can decline the match and fall back to ordinary arithmetic.
 */
function resolveYear(digits: string): number | null {
  if (digits.length === 4) return Number(digits);
  if (digits.length === 2) {
    const yy = Number(digits);
    return yy <= 68 ? 2000 + yy : 1900 + yy;
  }
  return null;
}

/**
 * Converts a validated day/month/year triple into a fused DATETIME_LITERAL
 * token, or null if the triple isn't a real calendar date (e.g. "30" for
 * February), letting the caller fall back to treating the source tokens
 * as ordinary arithmetic instead of a date.
 */
export function buildDateToken(
  day: number,
  month: number,
  year: number,
  sourceTokens: Token[],
  ruleName: string,
): NormalizerMatch | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Local midnight, consistent with formatDatetime()'s toLocaleString()
  // display and DATE_NOW's Date.now() epoch, both of which are local-time.
  const date = new Date(year, month - 1, day);
  // Reject calendar rollover (e.g. day=30 in February) rather than silently
  // normalizing to March 2, a rollover almost always means the tokens were
  // never a date to begin with (e.g. "2-30-5" as chained subtraction).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  const first = sourceTokens[0];
  const text = sourceTokens.map((t) => t.value).join("");
  const fusedToken = new LexerToken(
    DATETIME_LITERAL_TYPE,
    DATETIME_LITERAL_TYPE_ID,
    String(date.getTime()),
    text,
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
function fuseIsoTimestamp(tokens: Token[], pos: number, ruleName: string): NormalizerMatch | null {
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
  const epochMs = parseIso8601(matched[0]);
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
 * Maps the three numeric groups of a slash- or hyphen-separated literal to a
 * (day, month, year) triple under an explicit {@link DateInputOrder}, or null
 * when a group is the wrong shape for its role (a non-4-digit year in `YMD`, a
 * year group that is neither two nor four digits in `DMY`/`MDY`).
 *
 * Only reached when the host has fixed an order, and only for a literal that
 * is not already an unambiguous ISO date: the rule reads a hyphen literal with
 * a four-digit leading group as ISO before it consults the order at all.
 * `'auto'` keeps the historic per-separator reading in the rule below and
 * never calls this.
 */
function resolveOrderedGroups(
  g0: string, g1: string, g2: string, order: Exclude<DateInputOrder, "auto">,
): { day: number; month: number; year: number } | null {
  if (order === "YMD") {
    if (g0.length !== 4) return null;
    if (!DAY_OR_MONTH.test(g1) || !DAY_OR_MONTH.test(g2)) return null;
    return { year: Number(g0), month: Number(g1), day: Number(g2) };
  }
  // DMY and MDY: two 1-2 digit groups and a trailing 2- or 4-digit year.
  if (!DAY_OR_MONTH.test(g0) || !DAY_OR_MONTH.test(g1)) return null;
  const year = resolveYear(g2);
  if (year === null) return null;
  return order === "DMY"
    ? { day: Number(g0), month: Number(g1), year }
    : { day: Number(g1), month: Number(g0), year };
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
 */
export function dateLiteralNormalizerRule(
  getInputOrder: () => DateInputOrder = () => "auto",
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

      // ── Dot format: 2-token window (see module doc) ──────────────────
      if (DOT_DAY_MONTH.test(t0.value)) {
        const t1 = tokens[pos + 1];
        if (t1 && t1.type === "NUMBER" && DOT_LEADING_YEAR.test(t1.value)) {
          const [dayText, monthText] = t0.value.split(".");
          const year = resolveYear(t1.value.slice(1));
          if (year !== null) {
            const match = buildDateToken(
              Number(dayText), Number(monthText), year,
              [t0, t1], "datetime:date-literal:dot",
            );
            if (match) return match;
          }
        }
        return null;
      }

      // ── ISO 8601 timestamp: as many tokens as the spelling takes ─────
      // Tried before the date-only windows below, which would otherwise fuse
      // the date half of a timestamp and leave the time half to be read as
      // arithmetic. See fuseIsoTimestamp().
      if (t0.value.length === 4 && PLAIN_INTEGER.test(t0.value)) {
        const timestamp = fuseIsoTimestamp(tokens, pos, "datetime:date-literal:iso-timestamp");
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
      // The one check that separates every ordering below from the arithmetic
      // it is spelled identically to, and the only one that applies to all
      // three equally. See writtenAsOneRun.
      if (!writtenAsOneRun(sourceTokens)) return null;

      // ── An ISO date is read as ISO whatever the order ────────────────
      // `2026-04-03` has a four-digit leading group, which is neither a day
      // nor a month, so there is nothing here for an input order to resolve
      // and no reading but year-month-day. Tried ahead of the order because
      // DMY and MDY require a one- or two-digit leading group: they declined
      // this shape, the rule fell through, and a host that set MDY for its US
      // readers turned every bare ISO date in every document into arithmetic
      // (`2026-04-03` became 2,019, and `2026-04-03 + 1 day` became
      // "2,020 day"). Hyphen only: a slash date starting with four digits is
      // claimed by YMD alone, which is what the input-order table documents.
      if (sep1.type === "MINUS" && t0.value.length === 4) {
        if (!DAY_OR_MONTH.test(t1.value) || !DAY_OR_MONTH.test(t2.value)) return null;
        // buildDateToken takes (day, month, year).
        return buildDateToken(Number(t2.value), Number(t1.value), Number(t0.value), sourceTokens, "datetime:date-literal:iso");
      }

      // A host-fixed order (DMY/MDY/YMD) reads slash and hyphen dates the same
      // way, so a US reader's `12/25/2023` and an ISO `2023/12/25` both parse.
      // `'auto'` falls through to the historic per-separator reading below.
      const order = getInputOrder();
      if (order !== "auto") {
        const resolved = resolveOrderedGroups(t0.value, t1.value, t2.value, order);
        if (resolved === null) return null;
        return buildDateToken(
          resolved.day, resolved.month, resolved.year, sourceTokens,
          `datetime:date-literal:${order.toLowerCase()}`,
        );
      }

      if (sep1.type === "SLASH") {
        // European: DD/MM/YYYY (always, no ISO-slash variant is documented)
        if (!DAY_OR_MONTH.test(t0.value) || !DAY_OR_MONTH.test(t1.value)) return null;
        const year = resolveYear(t2.value);
        if (year === null) return null;
        return buildDateToken(Number(t0.value), Number(t1.value), year, sourceTokens, "datetime:date-literal:european");
      }

      // MINUS: US (MM-DD-YYYY). The ISO reading (YYYY-MM-DD) was taken above,
      // for every order including this one.
      if (!DAY_OR_MONTH.test(t0.value) || !DAY_OR_MONTH.test(t1.value)) return null;
      const year = resolveYear(t2.value);
      if (year === null) return null;
      // month=t0, day=t1, year=t2, buildDateToken takes (day, month, year)
      return buildDateToken(Number(t1.value), Number(t0.value), year, sourceTokens, "datetime:date-literal:us");
    },
  };
}
