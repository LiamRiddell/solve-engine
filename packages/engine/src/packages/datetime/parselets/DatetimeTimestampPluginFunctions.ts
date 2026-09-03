import { Value, ValueType, numberValue, stringValue, boolValue, uomValue, datetimeValue, errorValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import { isoWeekNumber } from "@solve-js/calendar/Gregorian";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { parseIso8601, unixTimestampToEpochMs } from "../Iso8601";

/**
 * `CALL_PLUGIN` handlers backing the datetime package's workdays/weekday/
 * timestamp features (see `DatetimePackage.ts`). Grouped in one file since
 * they're all small, single-purpose Value -> Value functions with no
 * shared state, mirrors `time/parselets/TimezonePluginFunctions.ts`'s
 * organization for the same kind of grouping.
 *
 * Every handler that reads a date field does so through the calendar backend
 * on its execution context (`calendarOf(context)`), so the weekday it names
 * is the one the VM's own date opcodes would land on for the same engine.
 */

/**
 * `workdays in <duration>` -> the number of Mon-Fri workdays in that span,
 * as a plain Number.
 *
 * SCOPE DECISION (documented here and in `WorkdaysInParselet.ts`): no
 * anchor date is specified by this phrase's grammar at all, "workdays in
 * 3 weeks" doesn't say "starting when", so this is computed via a pure
 * deterministic ratio (5 workdays per full 7-day week, plus the remainder
 * capped at 5) rather than walking an actual calendar from "now". That
 * would make the result depend on which day of the week "now" happens to
 * be when evaluated, a non-deterministic, hard-to-test result for the
 * exact same input expression. This IS anchor-independent and exact for
 * any whole-week span (3 weeks = 21 days = exactly 15 workdays, regardless
 * of start day); for a partial-week remainder it's a reasonable capped
 * approximation, not a real calendar walk. Weekends-only by nature: with no
 * anchor date there is no calendar day to test against a holiday calendar, so
 * unlike the offset/`between` forms this consults none. See
 * `DatetimePackage.ts`'s holiday scope note.
 */
function workdaysInDurationHandler(args: Value[]): Value {
  const v = args[0];
  let totalDays: number;

  if (v.type === ValueType.Uom && v.unit) {
    const measure = getMeasure(v.unit);
    if (measure !== "time") {
      return errorValue(
        "WORKDAYS_IN_EXPECTED_DURATION",
        `"workdays in" expects a time duration, got unit "${v.unit}"`
      );
    }
    totalDays = convertUnit(v.toNumber(), v.unit, "day");
  } else {
    // A bare Number is treated as already being a count of days.
    totalDays = v.toNumber();
  }

  // Counted on the magnitude, with the sign put back afterwards. Running
  // the ratio directly on a negative day count borrowed a whole week from
  // Math.floor() and then handed the borrowed days back through the
  // remainder, so "workdays in -3 days" answered -1 instead of -3 and
  // "workdays in -10 days" answered -6 instead of -8. A negative span
  // reaches here whenever the duration came from a variable or a
  // subtraction rather than a typed literal.
  const sign = totalDays < 0 ? -1 : 1;
  const magnitudeDays = Math.abs(totalDays);
  const fullWeeks = Math.floor(magnitudeDays / 7);
  const remainderDays = magnitudeDays - fullWeeks * 7;
  const workdays = sign * (fullWeeks * 5 + Math.min(remainderDays, 5));
  return numberValue(workdays);
}

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * Guards the date-field extractors below (weekday/month/week/is-a-weekend).
 *
 * The grammar-driven call sites always build a Datetime by construction,
 * but the `as` converter forms don't: `<anything> as week` reaches the same
 * handler, so `90 days as week` would otherwise read a duration's raw ms as
 * if it were an epoch and answer "week 1" with a straight face. Returning
 * an error instead is the difference between a wrong answer and a
 * diagnosable one.
 */
function asEpochMs(value: Value, fieldName: string): number | Value {
  if (value.type === ValueType.Datetime) return value.toNumber();
  return errorValue(
    "DATE_FIELD_EXPECTED_DATE",
    `"${fieldName}" expects a date, got ${ValueType[value.type] ?? "an unsupported value"}`
  );
}

/**
 * `day of the week on <date>` / `what day is it in <duration>` /
 * `<date> as weekday` -> the weekday name (e.g. "Tuesday") as a String.
 */
function weekdayOnDateHandler(args: Value[], context?: LineExecutionContext): Value {
  const epochMs = asEpochMs(args[0], "weekday");
  if (typeof epochMs !== "number") return epochMs;
  return stringValue(WEEKDAY_NAMES[calendarOf(context).weekday(epochMs)]);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * `what month is it on <date>` / `<date> as month` -> the month name
 * (e.g. "December") as a String value.
 *
 * English-only, exactly like {@link WEEKDAY_NAMES} directly above, the
 * locale-aware path is `format/FormatEngine.ts`, which is what renders a
 * whole Datetime; this returns a bare String field extracted from one, and
 * matching the established weekday behaviour beats having the two
 * neighbouring fields disagree about localization.
 */
function monthOnDateHandler(args: Value[], context?: LineExecutionContext): Value {
  const epochMs = asEpochMs(args[0], "month");
  if (typeof epochMs !== "number") return epochMs;
  return stringValue(MONTH_NAMES[calendarOf(context).fields(epochMs).month0]);
}

/**
 * `what week is it on <date>` / `<date> as week` -> the ISO-8601 week
 * number (1-53) as a plain Number.
 *
 * The local calendar date is read through the backend; the week it falls in
 * is then zone-free arithmetic (`calendar/Gregorian.ts`'s `isoWeekNumber`),
 * which is where the Monday-start, first-Thursday rule lives.
 */
function weekOnDateHandler(args: Value[], context?: LineExecutionContext): Value {
  const epochMs = asEpochMs(args[0], "week");
  if (typeof epochMs !== "number") return epochMs;
  const d = calendarOf(context).fields(epochMs);
  return numberValue(isoWeekNumber(d.year, d.month0, d.day));
}

/** True for Saturday/Sunday. */
function isWeekendDate(epochMs: number, calendar: CalendarBackend): boolean {
  const day = calendar.weekday(epochMs);
  return day === 0 || day === 6;
}

/** `<date> is a weekend` -> Boolean. */
function isWeekendOnDateHandler(args: Value[], context?: LineExecutionContext): Value {
  const epochMs = asEpochMs(args[0], "is a weekend");
  if (typeof epochMs !== "number") return epochMs;
  return boolValue(isWeekendDate(epochMs, calendarOf(context)));
}

/**
 * `<date> is a workday` / `is a weekday` -> Boolean.
 *
 * Mon-Fri only, and deliberately blind to the holiday calendar: this answers
 * "is this a weekday", a question about the week's shape, not "is this a
 * working day in my region". Keeping it weekend-based means the predicate is a
 * pure function of the date, decidable without any host configuration, and
 * `is a workday` stays the exact complement of `is a weekend`. The working-day
 * ARITHMETIC (offsets and `between`) is what consults the calendar. See
 * `DatetimePackage.ts`'s holiday scope note.
 */
function isWorkdayOnDateHandler(args: Value[], context?: LineExecutionContext): Value {
  const epochMs = asEpochMs(args[0], "is a workday");
  if (typeof epochMs !== "number") return epochMs;
  return boolValue(!isWeekendDate(epochMs, calendarOf(context)));
}

/**
 * `<unit> between <date> and <date>` -> the UNSIGNED span between the two
 * endpoints as a `Uom("ms")`, which the caller then converts into the
 * requested unit via `UOM_CONVERT_IN` (identical to how
 * `UntilSinceParselet` feeds that opcode).
 *
 * A plugin function rather than a `SUB`: "between" has no direction in
 * English, so `days between A and B` must equal `days between B and A`,
 * and there is no ABS opcode to apply after a signed subtraction.
 * Arguments arrive in push order, so `args[0]` is the first endpoint as
 * written, though by construction the result doesn't depend on that.
 */
function spanBetweenDatesHandler(args: Value[]): Value {
  return uomValue(Math.abs(args[0].toNumber() - args[1].toNumber()), "ms");
}

/**
 * `<ISO8601 string> to date` / `<unix timestamp> to date` -> a Datetime
 * value. Dispatches on the RUNTIME value type (a `CALL_PLUGIN` handler
 * runs at VM-execution time, after the left-hand expression has already
 * been evaluated to a concrete Value) rather than at parse time, since the
 * left-hand expression could be a string literal, a bare number literal,
 * or an arbitrary variable/expression of either type.
 *
 * Real ambiguity resolved here: a bare Number could be a SECONDS or a
 * MILLISECONDS Unix timestamp for the same real-world date. See
 * `Iso8601.ts`'s `unixTimestampToEpochMs()`/`MS_TIMESTAMP_THRESHOLD` doc
 * comment for the exact magnitude threshold and reasoning.
 */
function toDateFromAnyHandler(args: Value[], context?: LineExecutionContext): Value {
  const v = args[0];

  if (v.type === ValueType.Datetime) {
    return v; // already a date — "date to date" is a harmless no-op
  }

  if (v.type === ValueType.String) {
    const ms = parseIso8601(v.value as string, calendarOf(context));
    if (ms === null) {
      return errorValue(
        "INVALID_ISO8601_STRING",
        `"${v.value}" is not a recognizable ISO8601 date/time string`
      );
    }
    return datetimeValue(ms);
  }

  return datetimeValue(unixTimestampToEpochMs(v.toNumber()));
}

/**
 * `<date/time> to timestamp` / `current timestamp` -> a Unix timestamp in
 * SECONDS (rounded down), as a plain Number.
 *
 * Also accepts a String (parsed as ISO8601 first) for robustness, though
 * the primary grammar this backs (`ToTimestampParselet.ts`) always feeds
 * it an already-Datetime-typed left-hand expression; `CurrentTimestampParselet.ts`
 * feeds it a fresh `DATE_NOW` result via the same opcode, reusing this one
 * handler for both call sites.
 */
function toTimestampFromAnyHandler(args: Value[], context?: LineExecutionContext): Value {
  const v = args[0];

  if (v.type === ValueType.String) {
    const ms = parseIso8601(v.value as string, calendarOf(context));
    if (ms === null) {
      return errorValue(
        "INVALID_ISO8601_STRING",
        `"${v.value}" is not a recognizable ISO8601 date/time string`
      );
    }
    return numberValue(Math.floor(ms / 1000));
  }

  // Datetime (epoch ms) or a plain Number already representing epoch ms.
  return numberValue(Math.floor(v.toNumber() / 1000));
}

/**
 * Count the Mon-Fri workdays in a duration.
 *
 * Uses a deterministic ratio rather than walking a calendar, because the
 * phrase carries no anchor date. See the handler for the full reasoning.
 */
export const workdaysInDuration = workdaysInDurationHandler;
/**
 * Day-of-week name for a date, as a String value.
 */
export const weekdayOnDate = weekdayOnDateHandler;
/**
 * Month name for a date, as a String value.
 */
export const monthOnDate = monthOnDateHandler;
/**
 * ISO week number for a date, as a Number value.
 */
export const weekOnDate = weekOnDateHandler;
/**
 * Whether a date falls on a Saturday or Sunday.
 */
export const isWeekendOnDate = isWeekendOnDateHandler;
/**
 * Whether a date falls Monday to Friday. The complement of
 * {@link isWeekendOnDate}, with no holiday calendar involved.
 */
export const isWorkdayOnDate = isWorkdayOnDateHandler;
/**
 * Elapsed time between two dates, as a duration value.
 */
export const spanBetweenDates = spanBetweenDatesHandler;
/**
 * Coerce a Unix timestamp, ISO 8601 string or epoch number to a
 * Datetime.
 */
export const toDateFromAny = toDateFromAnyHandler;
/**
 * Coerce a date to whole Unix seconds. The inverse of
 * {@link toDateFromAny}.
 */
export const toTimestampFromAny = toTimestampFromAnyHandler;
