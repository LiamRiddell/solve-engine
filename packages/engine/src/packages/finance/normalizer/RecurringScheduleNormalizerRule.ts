import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Structured error codes this rule can raise. Co-located per the catalog's
 * convention (see `errors/ErrorCode.ts`): a package owns its own codes and
 * unions them in as it migrates, so a free-string throw here still carries a
 * catalogued, typo-checkable name.
 */
export const RecurringScheduleErrorCodes = {
  /** `every 0 weeks` and the like: the interval a payment repeats on has to be a positive count, or the number of payments is undefined. */
  RECURRING_INTERVAL_NOT_POSITIVE: "RECURRING_INTERVAL_NOT_POSITIVE",
} as const;

/**
 * How many times a named period falls in a year, for counting payments. This
 * is a scheduling model, not a calendar conversion: a monthly payment happens
 * 12 times a year and a weekly one 52, which is how pay periods are counted,
 * even though 12 thirty-day months and 52 seven-day weeks do not both add up
 * to 365 days. Keeping it independent of the second-based UNIT_TABLE is what
 * makes `every 2 weeks for 6 months` a clean 13 (26 a year, half a year).
 */
const PERIODS_PER_YEAR: Record<string, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  yearly: 1,
  // "annually" reads better than "yearly" before a duration and means the
  // same, so it is accepted as a spelling rather than a separate period.
  annually: 1,
};

/**
 * The same per-year counts keyed by the time UNIT spellings, used by the
 * `every N <unit>` head and by the `for N <unit>` duration. Plurals share a
 * value: a unit token keeps its written spelling, so both forms appear.
 */
const UNIT_PER_YEAR: Record<string, number> = {
  day: 365,
  days: 365,
  week: 52,
  weeks: 52,
  month: 12,
  months: 12,
  year: 1,
  years: 1,
};

/** Articles standing in for "one" on the duration, so `for a year` is `for 1 year`. */
const ARTICLES = new Set(["a", "an"]);

/**
 * Token types that can end a value, and so can be the amount a schedule
 * multiplies. A NUMBER (`450`, and the amount of a currency literal like
 * `£450`, which lexes as POUND then NUMBER), a closing bracket (`(20 + 5)`),
 * a bare variable, or a percentage all qualify. The amount may be several
 * tokens; only its last one sits at the match position, and the rest are
 * before it and left untouched.
 */
const VALUE_ENDERS = new Set([
  "NUMBER",
  "FLOAT",
  "HEX",
  "BIGINT",
  "RPAREN",
  "RBRACKET",
  "IDENT",
  "PERCENT",
  "STRING",
]);

/** The lowercased written form of a token, tolerant of `text` vs `value`. */
function wordOf(token: Token | undefined): string {
  if (token === undefined) return "";
  return (token.text ?? token.value ?? "").toLowerCase();
}

/** Whether a token is a time UNIT this rule recognises, and its per-year count. */
function unitPerYear(token: Token | undefined): number | undefined {
  if (token === undefined || token.type !== "UNIT") return undefined;
  return UNIT_PER_YEAR[wordOf(token)];
}

/** A period head parsed off the stream: its per-year rate and how many tokens it spans. */
interface PeriodHead {
  perYear: number;
  consumed: number;
}

/**
 * Reads the period that sits between the amount and `for`: either a single
 * word (`monthly`), or `every N <unit>` (`every 2 weeks`). Returns null when
 * the tokens at `i` are not a period, which is how a plain finance `for`
 * (`$1,000 for 3 years at 7%`, no period word) declines this rule.
 */
function readPeriod(tokens: Token[], i: number): PeriodHead | null {
  const head = tokens[i];
  if (head === undefined) return null;

  if (head.type === "IDENT") {
    const simple = PERIODS_PER_YEAR[wordOf(head)];
    if (simple !== undefined) return { perYear: simple, consumed: 1 };

    if (wordOf(head) === "every") {
      const countToken = tokens[i + 1];
      if (countToken?.type !== "NUMBER") return null;
      const per = unitPerYear(tokens[i + 2]);
      if (per === undefined) return null;
      const n = Number((countToken.value ?? "").replace(/,/g, ""));
      // A zero or negative interval has no number of payments to give, so it
      // is reported rather than divided by. Guarded here, at the one place
      // the divisor is known, so the message names the actual mistake.
      if (!(n > 0)) {
        throw ErrorFactory.parsing({
          code: RecurringScheduleErrorCodes.RECURRING_INTERVAL_NOT_POSITIVE,
          message: `A recurring interval must be a positive number, not "${countToken.value}".`,
          expected: "a positive interval, e.g. every 2 weeks",
          found: `every ${countToken.value} ${wordOf(tokens[i + 2])}`,
        });
      }
      return { perYear: per / n, consumed: 3 };
    }
  }
  return null;
}

/** A duration parsed off the stream: its length in years and how many tokens it spans. */
interface Duration {
  years: number;
  consumed: number;
}

/**
 * Reads the `N <unit>` (or `a <unit>`) that follows `for`. Returns null when
 * it is not a recognised time quantity, leaving other `for` grammar alone.
 */
function readDuration(tokens: Token[], i: number): Duration | null {
  const first = tokens[i];
  if (first === undefined) return null;

  let count: number;
  let unitIndex: number;
  if (first.type === "NUMBER") {
    count = Number((first.value ?? "").replace(/,/g, ""));
    unitIndex = i + 1;
  } else if (first.type === "IDENT" && ARTICLES.has(wordOf(first))) {
    count = 1;
    unitIndex = i + 1;
  } else {
    return null;
  }

  const per = unitPerYear(tokens[unitIndex]);
  if (per === undefined) return null;
  if (!Number.isFinite(count) || count < 0) return null;
  return { years: count / per, consumed: unitIndex - i + 1 };
}

/**
 * The number of whole payments a schedule makes over a span. Payments are
 * counted one per completed period, so a final part-period, which has not
 * come due, is not counted: `every 2 weeks for 5 weeks` is 2, not 3. A count
 * that lands on a whole number through floating point (`52/2 * 6/12` is 13)
 * is snapped to it before the floor, so the clean cases stay clean.
 */
function wholePayments(perYear: number, durationYears: number): number {
  const raw = perYear * durationYears;
  const nearest = Math.round(raw);
  return Math.abs(raw - nearest) < 1e-9 ? nearest : Math.floor(raw);
}

/**
 * `<amount> <period> for <duration>` as a running total: `450 monthly for 18
 * months` is 8,100, `£12.99 monthly for 2 years` is `£311.76`, `2000 every 2
 * weeks for 6 months` is 26,000. The total is the primary result, the payment
 * count is the secondary detail that produced it (total = amount times count).
 *
 * Implemented as a rewrite to a plain multiplication, `amount * count`, rather
 * than a new value kind or builtin. The count is a whole number known from the
 * literal tokens, so the engine's own arithmetic carries everything after:
 * a currency amount stays currency and, when it is exact (`£12.99`), the total
 * stays exact through the same money-multiply path that makes `£12.99 * 24`
 * exactly `£311.76`. A bare decimal stays an ordinary float, as it does
 * everywhere else in the engine.
 *
 * Matched at the amount, the token before the period word, so this rule fires
 * ahead of implicit multiplication at that position (priority 78, above it)
 * and inserts its own `*`. That sidesteps the fact that implicit multiply is
 * suppressed before some of these words and not others (`monthly` can start
 * the fused phrase `monthly repayment on`, `weekly` cannot), which would
 * otherwise give one word a doubled operator and another none.
 *
 * The period word is only ever claimed when the whole `<amount> <period> for
 * <N> <unit>` shape is present, so a bare `monthly`/`weekly`/`:every` stays an
 * ordinary variable everywhere else, the same contextual-claim discipline as
 * `AtRateNormalizerRule` and `ForDurationNormalizerRule`.
 */
export function recurringScheduleNormalizerRule(priority = 78): NormalizerRule {
  return {
    name: "finance:recurring-schedule",
    priority,
    unshapedReason:
    	"Scans forward through a period and a duration sub-grammar of unbounded length, so no fixed leading shape describes it.",
    match(tokens, pos): NormalizerMatch | null {
      const amount = tokens[pos];
      if (amount === undefined || !VALUE_ENDERS.has(amount.type)) return null;

      const period = readPeriod(tokens, pos + 1);
      if (period === null) return null;

      const forIndex = pos + 1 + period.consumed;
      if (tokens[forIndex]?.type !== "FOR_DURATION") return null;

      const duration = readDuration(tokens, forIndex + 1);
      if (duration === null) return null;

      const count = wholePayments(period.perYear, duration.years);
      const consumed = forIndex + 1 + duration.consumed - pos;
      const source = tokens.slice(pos, pos + consumed);

      return {
        // The amount is re-emitted unchanged, then `* <count>`. The amount may
        // be the tail of a longer expression, whose earlier tokens are before
        // `pos` and pass through on their own.
        replacement: [
          amount,
          createFusedToken("STAR", "*", source),
          createFusedToken("NUMBER", String(count), source),
        ],
        consumed,
        ruleName: "finance:recurring-schedule",
      };
    },
  };
}
