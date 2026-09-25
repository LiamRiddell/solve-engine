/**
 * The plugin functions behind the spoken relative dates (#704): a period's
 * first or last day, and the coming day of a weekday. Each reads the calendar
 * through the line's context, so a pinned or zoned calendar gives the same
 * answer the rest of the date forms do.
 */

import { datetimeValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import { daysInMonth } from "@solve-js/calendar/Gregorian";
import { weekOf } from "@solve-js/calendar/WeekShape";

/** The instant a date form was handed, or the refusal when it is not a date. */
function instantOf(value: Value | undefined, form: string): number | Value {
	if (value === undefined || value.type !== ValueType.Datetime) {
		return errorValue("DATE_EXPECTED", `${form} needs a date to count from.`);
	}
	return value.toNumber();
}

/**
 * `start of month`, `end of next year`, `next week`: the first or last day of a
 * week, month or year, that many periods from now, as a calendar day. A week
 * starts on the engine's first day of the week, Monday unless set (#702).
 *
 * @param args - Now, the period (`"week"`, `"month"` or `"year"`), the offset in
 * periods, and the edge (`"start"` or `"end"`).
 * @param context - The line's context, for the calendar backend.
 * @returns The day, or an error Value.
 */
export function periodEdgeHandler(args: Value[], context?: LineExecutionContext): Value {
	const now = instantOf(args[0], "A period's first or last day");
	if (typeof now !== "number") return now;
	const kind = String(args[1]?.value);
	const offset = Math.trunc(args[2]?.toNumber() ?? 0);
	const end = String(args[3]?.value) === "end";
	const calendar = calendarOf(context);
	const f = calendar.fields(now);
	if (kind === "year") {
		const year = f.year + offset;
		return datetimeValue(end ? calendar.localMidnight(year, 11, 31) : calendar.localMidnight(year, 0, 1), "date");
	}
	if (kind === "month") {
		const index = f.year * 12 + f.month0 + offset;
		const year = Math.floor(index / 12);
		const month0 = index - year * 12;
		return datetimeValue(calendar.localMidnight(year, month0, end ? daysInMonth(year, month0) : 1), "date");
	}
	// A week, from the engine's first day (`date.firstDayOfWeek`, #702),
	// Monday unless set.
	const today = calendar.localMidnight(f.year, f.month0, f.day);
	const sinceFirst = (f.weekday - weekOf(context).firstDay + 7) % 7;
	const first = calendar.addDays(today, offset * 7 - sinceFirst);
	return datetimeValue(end ? calendar.addDays(first, 6) : first, "date");
}

/**
 * `this friday`: the coming day of a weekday, today when today is one, at the
 * time of day now is, as `next friday` keeps it.
 *
 * @param args - Now, and the day of the week (0 is Sunday).
 * @param context - The line's context, for the calendar backend.
 * @returns The date, or an error Value.
 */
export function thisWeekdayHandler(args: Value[], context?: LineExecutionContext): Value {
	const now = instantOf(args[0], "A day of the week");
	if (typeof now !== "number") return now;
	const day = args[1]?.toNumber() ?? 0;
	const calendar = calendarOf(context);
	const ahead = (day - calendar.fields(now).weekday + 7) % 7;
	return datetimeValue(calendar.addDays(now, ahead));
}

/**
 * The first of a month in the current year, for `2nd Tuesday of March` with no
 * year, which reads the year the way `9 March` does: this one.
 *
 * @param args - Now, and the month (0 is January).
 * @param context - The line's context, for the calendar backend.
 * @returns The first of the month, or an error Value.
 */
export function monthThisYearHandler(args: Value[], context?: LineExecutionContext): Value {
	const now = instantOf(args[0], "A month with no year");
	if (typeof now !== "number") return now;
	const calendar = calendarOf(context);
	return datetimeValue(calendar.localMidnight(calendar.fields(now).year, args[1]?.toNumber() ?? 0, 1), "date");
}
