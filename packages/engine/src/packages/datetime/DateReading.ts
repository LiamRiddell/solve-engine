/**
 * How this engine reads a numeric date literal, decided once and reported.
 *
 * `03/04/2026` names one of two days, and the engine has to pick one. Which it
 * picks has always been settled by `date.inputOrder`, but nothing said so: the
 * answer came back as a date with no account of how it was read, and a host
 * had no way to show the reader "day first" or to discover that its own
 * setting was the reason a document looked wrong.
 *
 * This module is the one place that decision is made, so the normaliser that
 * fuses a literal and the surfaces that explain one cannot disagree about it.
 * Two halves:
 *
 * - The engine-wide one, {@link resolveDateOrderPolicy}, run once per engine
 *   and reported through `ExpressionEngine.getDateReading()`. It names the
 *   order AND where the order came from.
 * - The per-literal one, {@link classifyRun} and {@link readNumericDate},
 *   which decide what one run of digits means under that order, and, where it
 *   means nothing, whether saying so is better than answering the arithmetic
 *   the run is spelled like.
 *
 * @module DateReading
 */

import type { DateAmbiguity, DateConfig } from "@solve-js/constants/Configuration";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { hostLocale, orderFromLocale, type DateFieldOrder } from "@solve-js/calendar/HostLocale";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { daysInMonth } from "@solve-js/calendar/Gregorian";

/** Scoped error codes the datetime package owns (see `errors/ErrorCode.ts` convention). */
export const DatetimeErrorCodes = {
  /**
   * `date.inputLocale` is not a BCP-47 locale tag (`"en_US"` with an
   * underscore is the usual mistake). Raised at engine construction, because a
   * locale that is silently ignored is a date order that is silently wrong.
   */
  DATE_INPUT_LOCALE_INVALID: "DATE_INPUT_LOCALE_INVALID",
  /**
   * A date-shaped run the resolved order cannot read, which another supported
   * order can (`12/25/2026` on a day-first engine), or a year-last run on a
   * year-first engine, which has no day and month roles to apply to it. The
   * message names the order actually used, the group that broke, the reading
   * that would work, and the two ways out. A recoverable Error VALUE, never a
   * throw, and suppressed by `date.onAmbiguous: 'arithmetic'`.
   */
  DATE_ORDER_MISMATCH: "DATE_ORDER_MISMATCH",
  /**
   * A run whose shape is unmistakably a date attempt and which names no real
   * day under any reading: `31/04/2026`, `29/02/2026`, `13/13/2026`,
   * `2026-02-29`, `2026-13-01`. Separate from {@link DATE_ORDER_MISMATCH}
   * because no change of order fixes it, so the message must not suggest one.
   */
  DATE_NOT_A_CALENDAR_DAY: "DATE_NOT_A_CALENDAR_DAY",
} as const;

/** Every error code the datetime package's date-reading rules can produce. */
export type DatetimeErrorCode = (typeof DatetimeErrorCodes)[keyof typeof DatetimeErrorCodes];

/**
 * An order a literal can actually be read under: the three concrete field
 * orders, plus `'auto'` for the historic per-separator reading.
 *
 * Narrower than `DateInputOrder` on purpose. `'locale'` is a request for an
 * inference, not an order, and it is resolved away by
 * {@link resolveDateOrderPolicy} before anything that reads a literal sees it,
 * so the word cannot reach the normaliser, a worker or a snapshot.
 */
export type ResolvedDateOrder = "auto" | DateFieldOrder;

/**
 * Where a resolved order came from, which is the part a reader needs and a
 * bug report should carry.
 *
 * - `'config'`: the host named `'DMY'`, `'MDY'` or `'YMD'` outright. No
 *   inference ran and `date.inputLocale` was not consulted.
 * - `'locale'`: inferred from the tag the host gave in `date.inputLocale`.
 * - `'host-locale'`: inferred from the tag this machine resolves to.
 * - `'separator'`: `'auto'`, the historic reading, where a slash date is
 *   day-first and a hyphen date month-first unless it is ISO-shaped.
 * - `'fallback'`: an inference was asked for and could not be made, so the
 *   engine reads dates exactly as an `'auto'` engine does. Visible on purpose:
 *   this is the case where a host should offer the reader a manual choice.
 */
export type DateOrderSource = "config" | "locale" | "host-locale" | "separator" | "fallback";

/**
 * The reading policy one engine applies to every numeric date literal in every
 * line it evaluates.
 *
 * Resolved once, in the `ExpressionEngine` constructor, and then carried
 * rather than re-derived: the normaliser rule runs on every keystroke, so an
 * `Intl` call per literal would be a per-keystroke cost for an answer that
 * cannot change, and a per-expression bytecode cache keyed on text would go
 * stale against an order that could.
 */
export interface DateReadingPolicy {
  /** The order every ambiguous numeric literal is read under. Never `'locale'`. */
  readonly order: ResolvedDateOrder;
  /** Where {@link order} came from. See {@link DateOrderSource}. */
  readonly orderSource: DateOrderSource;
  /** The BCP-47 tag the order was inferred from, when it was inferred from one. */
  readonly locale?: string;
}

/**
 * Whether a string is a locale tag `Intl` will accept.
 *
 * Checked through `Intl.getCanonicalLocales`, which throws a `RangeError` for
 * a malformed tag (`"en_US"`) and accepts one it merely has no data for.
 * That is the right line to draw here: a tag with no data is a reader whose
 * locale this runtime cannot describe, which the inference already handles by
 * falling back, whereas a malformed tag is a typo in the host's own code.
 *
 * A runtime with no `Intl.getCanonicalLocales` at all accepts everything,
 * because refusing a host's configuration on the grounds that the engine
 * cannot check it would fail in the one environment least able to react.
 */
function isLocaleTag(tag: string): boolean {
  if (typeof Intl !== "object" || Intl === null || typeof Intl.getCanonicalLocales !== "function") return true;
  try {
    Intl.getCanonicalLocales(tag);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a host's `date` configuration into the concrete reading policy this
 * engine applies.
 *
 * The precedence is strict, and each step decides on its own: there is no
 * merge and no "infer, then adjust". An override beats an inference because
 * the inference is reached only through the one value that asks for it.
 *
 * 1. `'DMY'`, `'MDY'` or `'YMD'`: that order, outright, `'config'`. No `Intl`
 *    call happens and `inputLocale` is not read at all.
 * 2. `'locale'` with `inputLocale` set: the order that tag writes, `'locale'`.
 * 3. `'locale'` with `inputLocale` unset: the order this machine's tag writes,
 *    `'host-locale'`.
 * 4. `'locale'` where no inference could be made: `'auto'`, `'fallback'`. This
 *    is today's behaviour, which is the only safe thing to fail to.
 * 5. `'auto'`: the historic per-separator reading, `'separator'`.
 *
 * `inputLocale` is inert unless `inputOrder` is `'locale'`. Setting it beside
 * `'auto'` changes no result, because a field that quietly switched inference
 * on would turn the predictable host mistake into a wrong reading rather than
 * no change. Its SHAPE is still checked wherever it is set, since a malformed
 * tag is a typo either way and the reader is better served by hearing about it
 * at construction than by never hearing about it.
 *
 * @param date - The engine's merged `date` configuration.
 * @returns The policy, frozen.
 * @throws {EngineError} `DATE_INPUT_LOCALE_INVALID` when `inputLocale` is set
 * and is not a tag `Intl` accepts.
 */
export function resolveDateOrderPolicy(date: DateConfig): DateReadingPolicy {
  const requestedLocale = date.inputLocale;
  if (requestedLocale !== undefined && !isLocaleTag(requestedLocale)) {
    throw ErrorFactory.config(
      DatetimeErrorCodes.DATE_INPUT_LOCALE_INVALID,
      `date.inputLocale "${requestedLocale}" is not a BCP-47 locale tag. Use a tag Intl accepts, for example "en-US".`,
      { inputLocale: requestedLocale },
    );
  }

  const order = date.inputOrder;
  if (order === "DMY" || order === "MDY" || order === "YMD") {
    return Object.freeze({ order, orderSource: "config" as const });
  }

  if (order === "locale") {
    const tag = requestedLocale ?? hostLocale();
    if (tag !== null && tag !== undefined) {
      const inferred = orderFromLocale(tag);
      if (inferred !== null) {
        return Object.freeze({
          order: inferred,
          orderSource: requestedLocale !== undefined ? ("locale" as const) : ("host-locale" as const),
          locale: tag,
        });
      }
    }
    // No Intl, an Intl that answers for a locale that is not the host's, or a
    // tag it cannot describe. Fall back to what the engine already does rather
    // than to a guess, and say so, so a host can tell a decision from a guess.
    return Object.freeze({ order: "auto" as const, orderSource: "fallback" as const });
  }

  return Object.freeze({ order: "auto" as const, orderSource: "separator" as const });
}

/**
 * Month names, in English, used to say what is wrong with a date that names no
 * real day ("February 2026 has 28 days").
 *
 * English-only for the same reason `DatetimeTimestampPluginFunctions.ts`'s
 * weekday names are: every `explainLine` description and every structured
 * error message in the engine is English, and localising one sentence in the
 * middle of that would be less coherent than localising none.
 */
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The separator a numeric date run was written with. */
export type NumericDateSeparator = "slash" | "hyphen" | "dot";

/**
 * The shape of a three-group numeric run, decided by the digit counts alone
 * before any order is consulted.
 *
 * The shape is what decides whether an unreadable run refuses or falls through
 * to arithmetic, and the asymmetry between the two four-digit shapes is
 * deliberate and measured:
 *
 * - `'iso'`: a hyphen run with a four-digit LEADING group, `2026-04-03`. One
 *   reading, whatever the order, and nothing configurable applies.
 * - `'year-last-4'`: `03/04/2026`, `12-25-2026`. Refuses when no reading
 *   works, because nobody writes a two-step division ending in a four-digit
 *   denominator: `03/04/2026` as arithmetic is 0.0004.
 * - `'year-first-4'`: `2026/04/03`, `1000/10/5`. A date under `'YMD'` alone
 *   and ordinary arithmetic under every other order, exactly as today. This is
 *   where division is protected: `1000/10/5` is 20, `1024/8/2` is 64,
 *   `1000/12/4` is 20.83 and `2000/12/25` is 6.67, and a rule that claimed
 *   them would be a worse bug than the one being fixed.
 * - `'short'`: every group one or two digits, `1/2/3`, `12/13/14`,
 *   `25/12/23`. Today's reading exactly, falling through to arithmetic when it
 *   does not resolve, because a two-digit year is too weak a signal to hang a
 *   refusal on.
 * - `'none'`: `100/25/2`, `1000-500-200`. Never a date.
 */
export type NumericDateShape = "iso" | "year-last-4" | "year-first-4" | "short" | "none";

/** One or two digits: a day or a month group. */
const DAY_OR_MONTH_GROUP = /^\d{1,2}$/;
/** Exactly four digits: a written-out year. */
const FULL_YEAR_GROUP = /^\d{4}$/;

/**
 * Classifies a three-group numeric run by its digit counts and separator.
 *
 * Decided before any order is consulted, so the same run has the same shape on
 * every engine and only what the shape MEANS depends on configuration.
 *
 * @param g0 - The first group, as typed.
 * @param g1 - The second group.
 * @param g2 - The third group.
 * @param separator - The separator between them.
 * @returns The shape. See {@link NumericDateShape}.
 */
export function classifyRun(
  g0: string,
  g1: string,
  g2: string,
  separator: NumericDateSeparator,
): NumericDateShape {
  const shortFirst = DAY_OR_MONTH_GROUP.test(g0);
  const shortMiddle = DAY_OR_MONTH_GROUP.test(g1);
  const shortLast = DAY_OR_MONTH_GROUP.test(g2);
  if (separator === "hyphen" && FULL_YEAR_GROUP.test(g0) && shortMiddle && shortLast) return "iso";
  if (shortFirst && shortMiddle && FULL_YEAR_GROUP.test(g2)) return "year-last-4";
  if (separator === "slash" && FULL_YEAR_GROUP.test(g0) && shortMiddle && shortLast) return "year-first-4";
  if (shortFirst && shortMiddle && shortLast) return "short";
  return "none";
}

/** The three groups of a numeric run, with the text they were typed as. */
export interface NumericDateRun {
  /** The run exactly as typed, `"03/04/2026"`, for the message. */
  readonly text: string;
  /** The three groups, left to right, as typed. */
  readonly groups: readonly [string, string, string];
  readonly separator: NumericDateSeparator;
}

/**
 * What reading a numeric run came to: a real day, a refusal to report, or a
 * decision to leave the run to ordinary arithmetic.
 */
export type NumericDateRead =
  | {
      readonly kind: "date";
      readonly day: number;
      readonly month: number;
      readonly year: number;
      /** The order actually applied: one of the three, or `'ISO'` for a run that settled itself. */
      readonly order: DateFieldOrder | "ISO";
      /** Whether a two-digit year was windowed to a century. */
      readonly shortYear: boolean;
      /** The ISO of the reading NOT taken, when the other order also names a real day. */
      readonly alternative?: string;
    }
  | { readonly kind: "refuse"; readonly code: DatetimeErrorCode; readonly message: string }
  | { readonly kind: "arithmetic" };

/**
 * A two-digit year, windowed to a century by the common glibc
 * `strptime("%y")` convention: 00-68 is 2000-2068, 69-99 is 1969-1999. Four
 * digits are taken as written; any other count is not a year shape at all.
 */
function resolveYearGroup(digits: string): number | null {
  if (digits.length === 4) return Number(digits);
  if (digits.length === 2) {
    const yy = Number(digits);
    return yy <= 68 ? 2000 + yy : 1900 + yy;
  }
  return null;
}

/**
 * Whether a day/month/year triple names a day the calendar actually has.
 *
 * Checked through the backend rather than by arithmetic here, so a run is
 * judged by the same calendar the literal would be built with. February 30
 * rolls over to March 2 in every implementation, and a rollover is how a
 * triple that is not a date announces itself.
 *
 * @param day - Day of the month, from 1.
 * @param month - Month, from 1.
 * @param year - The full year.
 * @param calendar - The backend the literal would be built with.
 * @returns `true` when the triple reads back unchanged.
 */
export function isRealCalendarDay(day: number, month: number, year: number, calendar: CalendarBackend): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const built = calendar.fields(calendar.localMidnight(year, month - 1, day));
  return built.year === year && built.month0 === month - 1 && built.day === day;
}

/**
 * Why a day/month/year triple names no real day, as the clause a message ends
 * with: "there is no month 25", "February 2026 has 28 days".
 *
 * @param day - Day of the month.
 * @param month - Month, from 1.
 * @param year - The full year.
 * @returns The clause. Callers check {@link isRealCalendarDay} first; a triple
 * that IS a real day is described by its month's true length, which says
 * nothing wrong but says nothing useful either.
 */
export function describeUnrealDay(day: number, month: number, year: number): string {
  if (month < 1 || month > 12) return `there is no month ${month}`;
  if (day < 1) return `there is no day ${day}`;
  return `${MONTH_NAMES[month - 1]} ${year} has ${daysInMonth(year, month - 1)} days`;
}

/** A day/month/year triple written out for a reader: "3 April 2026". */
function spellDay(day: number, month: number, year: number): string {
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * A day/month/year triple as an ISO date, `"2026-04-03"`: the one spelling
 * every order reads the same way, which is what a refusal points at.
 *
 * @param day - Day of the month.
 * @param month - Month, from 1.
 * @param year - The full year.
 * @returns The ISO date.
 */
export function isoOf(day: number, month: number, year: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

/** The day and month a two-role order assigns to the first two groups. */
function rolesFor(order: DateFieldOrder, g0: string, g1: string): { day: number; month: number } {
  return order === "DMY"
    ? { day: Number(g0), month: Number(g1) }
    : { day: Number(g1), month: Number(g0) };
}

/** "day first" / "month first" / "year first", the way a message names an order. */
function orderInWords(order: DateFieldOrder): string {
  if (order === "DMY") return "day first";
  if (order === "MDY") return "month first";
  return "year first";
}

/**
 * The order `'auto'` reads a two-role run in, which is the historic
 * per-separator behaviour: a slash date is day-first (`25/12/2023`), a hyphen
 * date is month-first (`12-25-2023`), and a dot date is day-first
 * (`25.12.2023`), which is what each of those spellings meant before an order
 * could be configured at all.
 */
function separatorOrder(separator: NumericDateSeparator): DateFieldOrder {
  return separator === "hyphen" ? "MDY" : "DMY";
}

/**
 * Reads a three-group numeric run under one engine's resolved order.
 *
 * The one place the decision is made, so the normaliser that fuses a literal
 * and the surfaces that explain one cannot disagree about it.
 *
 * A run that no reading resolves is either refused or left to arithmetic, and
 * which of the two is a question about the SHAPE rather than about which guard
 * declined it. See {@link NumericDateShape} for the four shapes and the
 * measurements behind the asymmetry.
 *
 * @param run - The run, its groups and its separator.
 * @param order - This engine's resolved order. Never `'locale'`.
 * @param onAmbiguous - Whether a refusal is reported or suppressed. A dot run
 * ignores `'arithmetic'`, because its fall-through is a parse error rather
 * than a number, and an error is not an answer.
 * @param calendar - The backend the literal would be built with.
 * @returns The reading, a refusal, or a decision to leave the run alone.
 */
export function readNumericDate(
  run: NumericDateRun,
  order: ResolvedDateOrder,
  onAmbiguous: DateAmbiguity,
  calendar: CalendarBackend,
): NumericDateRead {
  const [g0, g1, g2] = run.groups;
  const shape = classifyRun(g0, g1, g2, run.separator);
  // A dot run's only alternative to a refusal is a parse error, so it refuses
  // whatever the setting says. Every other shape honours the opt-out.
  const refusing = onAmbiguous === "refuse" || run.separator === "dot";

  if (shape === "none") return { kind: "arithmetic" };

  if (shape === "iso") {
    const year = Number(g0);
    const month = Number(g1);
    const day = Number(g2);
    if (isRealCalendarDay(day, month, year, calendar)) {
      return { kind: "date", day, month, year, order: "ISO", shortYear: false };
    }
    // The shape has one reading and no other to fall to, so a rollover here is
    // a date attempt that failed rather than arithmetic that looked like one.
    return refusing ? notACalendarDay(run.text, day, month, year) : { kind: "arithmetic" };
  }

  if (shape === "year-first-4") {
    if (order !== "YMD") return { kind: "arithmetic" };
    const year = Number(g0);
    const month = Number(g1);
    const day = Number(g2);
    // Still arithmetic when it is not a real day: a four-digit numerator is
    // ordinary division, and this shape is where that is protected.
    return isRealCalendarDay(day, month, year, calendar)
      ? { kind: "date", day, month, year, order: "YMD", shortYear: false }
      : { kind: "arithmetic" };
  }

  // 'year-last-4' and 'short' share their readings and differ only in what
  // happens when none of them works.
  const year = resolveYearGroup(g2);
  if (year === null) return { kind: "arithmetic" };
  const shortYear = g2.length === 2;

  if (order === "YMD") {
    // A year-last run has no year-first reading at all, so there are no roles
    // that failed, there are no roles to apply.
    if (shape === "short" || !refusing) return { kind: "arithmetic" };
    return orderMismatchUnderYearFirst(run.text, g0, g1, year, calendar);
  }

  const chosen = order === "auto" ? separatorOrder(run.separator) : order;
  const other: DateFieldOrder = chosen === "DMY" ? "MDY" : "DMY";
  const chosenRoles = rolesFor(chosen, g0, g1);
  const otherRoles = rolesFor(other, g0, g1);

  if (isRealCalendarDay(chosenRoles.day, chosenRoles.month, year, calendar)) {
    const alternative = isRealCalendarDay(otherRoles.day, otherRoles.month, year, calendar)
      ? isoOf(otherRoles.day, otherRoles.month, year)
      : undefined;
    return { kind: "date", day: chosenRoles.day, month: chosenRoles.month, year, order: chosen, shortYear, alternative };
  }

  if (shape === "short" || !refusing) return { kind: "arithmetic" };

  if (isRealCalendarDay(otherRoles.day, otherRoles.month, year, calendar)) {
    return {
      kind: "refuse",
      code: DatetimeErrorCodes.DATE_ORDER_MISMATCH,
      message:
        `"${run.text}" is not a date read ${orderInWords(chosen)}: ` +
        `${describeUnrealDay(chosenRoles.day, chosenRoles.month, year)}. ` +
        `Read ${orderInWords(other)} it is ${spellDay(otherRoles.day, otherRoles.month, year)}. ` +
        `Set date.inputOrder to "${other}" to read numeric dates ${orderInWords(other)}.`,
    };
  }

  // Neither order names a real day, so no change of order fixes it and the
  // message must not suggest one.
  return notACalendarDay(run.text, chosenRoles.day, chosenRoles.month, year);
}

/** The DATE_NOT_A_CALENDAR_DAY refusal, worded from the reading that was attempted. */
function notACalendarDay(text: string, day: number, month: number, year: number): NumericDateRead {
  return {
    kind: "refuse",
    code: DatetimeErrorCodes.DATE_NOT_A_CALENDAR_DAY,
    message: `"${text}" is not a real date: ${describeUnrealDay(day, month, year)}.`,
  };
}

/**
 * The refusal for a year-last run on a year-first engine, which has no roles
 * to apply to it. Names whichever of the two readings are real days, and the
 * ISO spelling that reads the same way on every engine.
 */
function orderMismatchUnderYearFirst(
  text: string,
  g0: string,
  g1: string,
  year: number,
  calendar: CalendarBackend,
): NumericDateRead {
  const dayFirst = rolesFor("DMY", g0, g1);
  const monthFirst = rolesFor("MDY", g0, g1);
  const dayFirstReal = isRealCalendarDay(dayFirst.day, dayFirst.month, year, calendar);
  const monthFirstReal = isRealCalendarDay(monthFirst.day, monthFirst.month, year, calendar);

  if (!dayFirstReal && !monthFirstReal) {
    return notACalendarDay(text, dayFirst.day, dayFirst.month, year);
  }

  const opening = `"${text}" is not a date read year first.`;
  if (dayFirstReal && monthFirstReal) {
    return {
      kind: "refuse",
      code: DatetimeErrorCodes.DATE_ORDER_MISMATCH,
      message:
        `${opening} Read day first it is ${spellDay(dayFirst.day, dayFirst.month, year)} ` +
        `and month first ${spellDay(monthFirst.day, monthFirst.month, year)}. ` +
        `Write it as ${isoOf(dayFirst.day, dayFirst.month, year)}, ` +
        `or set date.inputOrder to "DMY" or "MDY".`,
    };
  }

  const roles = dayFirstReal ? dayFirst : monthFirst;
  const which: DateFieldOrder = dayFirstReal ? "DMY" : "MDY";
  return {
    kind: "refuse",
    code: DatetimeErrorCodes.DATE_ORDER_MISMATCH,
    message:
      `${opening} Read ${orderInWords(which)} it is ${spellDay(roles.day, roles.month, year)}. ` +
      `Write it as ${isoOf(roles.day, roles.month, year)}, or set date.inputOrder to "${which}".`,
  };
}
