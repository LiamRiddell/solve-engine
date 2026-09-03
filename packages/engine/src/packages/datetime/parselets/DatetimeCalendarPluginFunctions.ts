import { Value, ValueType, stringValue, uomValue, datetimeValue, errorValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import {
	nthWeekdayOfMonth as nthWeekdayOfMonthCalc,
	lastWeekdayOfMonth,
	wholeYearsBetween,
	calendarBreakdown,
	monthAnchor,
} from "../DateArithmetic";

/**
 * `CALL_PLUGIN` handlers backing the datetime package's calendar-aware forms:
 * the nth weekday of a month (`2nd Tuesday of March 2026`), the relative month
 * anchors (`next month`), and age (`age of 15/06/1990`). Kept apart from
 * `DatetimeTimestampPluginFunctions.ts` because these walk the calendar
 * (`DateArithmetic.ts`) rather than convert a millisecond span, a distinction
 * that page's doc comment draws out. The walk runs through the calendar
 * backend on the execution context, so it lands where the VM's own date
 * arithmetic would for the same engine.
 */

/** Reads a Datetime operand as epoch ms, or an error value naming the form. */
function asEpochMs(value: Value, form: string): number | Value {
	if (value.type === ValueType.Datetime) return value.toNumber();
	return errorValue(
		"DATE_EXPECTED",
		`"${form}" expects a date, got ${ValueType[value.type] ?? "an unsupported value"}`
	);
}

/**
 * `<ordinal> <weekday> of <month>` -> the concrete date, as a Datetime.
 *
 * `args[0]` is the month anchor (any date; only its year and month are read),
 * `args[1]` the ordinal spec the normalizer minted: `"<n>:<dow>"` (n 1-based,
 * dow 0=Sunday..6=Saturday) or `"last:<dow>"`. An ordinal the month cannot
 * satisfy (a 5th Friday of a four-Friday month) returns a structured error
 * rather than wrapping into the next month, see {@link nthWeekdayOfMonthCalc}.
 */
function nthWeekdayOfMonthHandler(args: Value[], context?: LineExecutionContext): Value {
	const epochMs = asEpochMs(args[0], "nth weekday of month");
	if (typeof epochMs !== "number") return epochMs;
	const spec = String(args[1].value ?? "");
	const [ordinal, dowText] = spec.split(":");
	const dow = Number(dowText);

	const calendar = calendarOf(context);
	const anchor = calendar.fields(epochMs);
	const year = anchor.year;
	const month0 = anchor.month0;

	if (ordinal === "last") {
		return datetimeValue(lastWeekdayOfMonth(year, month0, dow, calendar));
	}

	const n = Number(ordinal);
	const result = nthWeekdayOfMonthCalc(year, month0, dow, n, calendar);
	if (result === null) {
		return errorValue(
			"NTH_WEEKDAY_OUT_OF_RANGE",
			`there is no ${ordinal}${ordinalSuffix(n)} occurrence of that weekday in the month`
		);
	}
	return datetimeValue(result);
}

/** The suffix for an ordinal number, for the out-of-range message. */
function ordinalSuffix(n: number): string {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) return "th";
	switch (n % 10) {
		case 1: return "st";
		case 2: return "nd";
		case 3: return "rd";
		default: return "th";
	}
}

/**
 * `next month` / `this month` / `last month` -> the first of that month, as a
 * Datetime. `args[0]` is now, `args[1]` the month offset (+1/0/-1). The first
 * of the month matches the anchor `March 2026` resolves to, so the two compose
 * (`1st Monday of next month`).
 */
function monthAnchorShiftHandler(args: Value[], context?: LineExecutionContext): Value {
	const nowMs = asEpochMs(args[0], "month anchor");
	if (typeof nowMs !== "number") return nowMs;
	const offset = args[1].toNumber();
	return datetimeValue(monthAnchor(nowMs, offset, calendarOf(context)));
}

const MODE_YMD = "ymd";

/**
 * `age of <date>` / `age of <date> on <date>` / `age of <date> in years,
 * months and days` -> the span from a birth date to a reference date, computed
 * by walking the calendar rather than dividing a millisecond span, so the leap
 * cases are right (see `DateArithmetic.ts`).
 *
 * `args[0]` is the birth date, `args[1]` the reference date (now, unless an
 * `on <date>` was given), `args[2]` the mode: `"years"` for a single whole-year
 * count (a `years` quantity, "36 years"), or `"ymd"` for the three-part
 * breakdown (a String, "36 years, 2 months, 9 days").
 */
function ageBetweenHandler(args: Value[], context?: LineExecutionContext): Value {
	const birthMs = asEpochMs(args[0], "age of");
	if (typeof birthMs !== "number") return birthMs;
	const refMs = asEpochMs(args[1], "age of");
	if (typeof refMs !== "number") return refMs;
	const mode = String(args[2].value ?? "years");
	const calendar = calendarOf(context);

	if (mode === MODE_YMD) {
		return stringValue(formatSpan(calendarBreakdown(birthMs, refMs, calendar)));
	}
	return uomValue(wholeYearsBetween(birthMs, refMs, calendar), "years");
}

/**
 * Renders a calendar span as "36 years, 2 months, 9 days", dropping any zero
 * part (so a whole number of years reads "36 years", not "36 years, 0 months, 0
 * days") but keeping "0 days" when every part is zero, so the same day reads as
 * a real answer rather than an empty string.
 */
function formatSpan(span: { years: number; months: number; days: number }): string {
	const parts: string[] = [];
	if (span.years !== 0) parts.push(pluralise(span.years, "year"));
	if (span.months !== 0) parts.push(pluralise(span.months, "month"));
	if (span.days !== 0) parts.push(pluralise(span.days, "day"));
	if (parts.length === 0) return pluralise(0, "day");
	return parts.join(", ");
}

/** `1 year` / `2 years`, the singular kept for a count of exactly one. */
function pluralise(count: number, unit: string): string {
	return `${count} ${unit}${Math.abs(count) === 1 ? "" : "s"}`;
}

/** `nthWeekdayOfMonth` plugin: `<ordinal> <weekday> of <month>` -> a date. */
export const nthWeekdayOfMonthFn = nthWeekdayOfMonthHandler;
/** `monthAnchorShift` plugin: `next`/`this`/`last month` -> the first of it. */
export const monthAnchorShift = monthAnchorShiftHandler;
/** `ageBetween` plugin: `age of <date>` -> whole years or a ymd breakdown. */
export const ageBetween = ageBetweenHandler;
