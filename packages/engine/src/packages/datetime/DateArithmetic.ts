/**
 * Pure, dependency-free calendar arithmetic for the datetime package's
 * calendar-aware features: the nth weekday of a month (`2nd Tuesday of March
 * 2026`) and age in whole years or a years/months/days breakdown (`age of
 * 15/06/1990`).
 *
 * Every function here takes and returns plain numbers (epoch milliseconds at
 * local midnight, or field integers), never a `Value`, and computes through
 * the {@link CalendarBackend} it is handed, so it carries no engine import and
 * is unit-testable on its own with the `Date` backend. The plugin handlers in
 * `DatetimeCalendarPluginFunctions.ts` wrap these into `Value`s and pass the
 * engine's backend in.
 *
 * ## Why a calendar walk, not a millisecond division
 * `<unit> between` and `<unit> since` already answer a span by dividing a
 * millisecond difference by a fixed unit length (a 365-day year, a 30-day
 * month), which is exact for days and weeks but wrong for years and months: a
 * person born on 29 February is a whole year older on the next 28 February, and
 * "1 month" is 28 to 31 days depending on which month. Age and the breakdown
 * are the forms where that difference is the whole point, so they step the
 * calendar's own day/month/year fields instead. See `DateLiteralNormalizerRule`
 * for the millisecond-division site this deliberately does not use.
 *
 * All dates are read in local time, matching `formatDatetime()` and the
 * `DATE_NOW` epoch (both local), so a breakdown of two local-midnight literals
 * never picks up a stray hour from a timezone offset.
 */

import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { dayNumber, daysInMonth } from "@solve-js/calendar/Gregorian";

/**
 * The date of the `n`-th occurrence of a weekday in a month, or `null` when the
 * month has no such occurrence (a 5th Friday in a four-Friday month).
 *
 * Returns local-midnight epoch ms so the result is a pure date, formatted
 * "Tuesday, March 10, 2026" with no time of day, exactly as a bare date literal
 * is. It deliberately does NOT wrap into the next month: `5th Friday of April`
 * where April has four is not silently answered as the first Friday of May,
 * because the reader asked for a day this month that does not exist and a
 * wrong-month date is worse than an honest error. `n` is 1-based; `dow` is
 * 0=Sunday..6=Saturday, matching `CalendarFields.weekday`.
 */
export function nthWeekdayOfMonth(year: number, month0: number, dow: number, n: number, calendar: CalendarBackend): number | null {
	const firstDow = calendar.fields(calendar.localMidnight(year, month0, 1)).weekday;
	const offsetToFirst = (dow - firstDow + 7) % 7;
	const day = 1 + offsetToFirst + (n - 1) * 7;
	if (day < 1 || day > daysInMonth(year, month0)) return null;
	return calendar.localMidnight(year, month0, day);
}

/**
 * The date of the LAST occurrence of a weekday in a month (`last Friday of
 * November 2026`). Always exists, so unlike {@link nthWeekdayOfMonth} it never
 * returns null. Local-midnight epoch ms, `dow` 0=Sunday..6=Saturday.
 */
export function lastWeekdayOfMonth(year: number, month0: number, dow: number, calendar: CalendarBackend): number {
	const lastDay = daysInMonth(year, month0);
	const lastDow = calendar.fields(calendar.localMidnight(year, month0, lastDay)).weekday;
	const offsetBack = (lastDow - dow + 7) % 7;
	return calendar.localMidnight(year, month0, lastDay - offsetBack);
}

/**
 * Whole calendar years between two dates, the count a person's age is: the
 * number of birthdays that have passed. Decrements the raw year difference when
 * `to` has not yet reached the month-and-day of `from` in its year, so a
 * birthday later this year does not count yet.
 *
 * Leap-year correct by construction: a 29 February birth compares its day (29)
 * against the reference day, so the year only ticks over on 1 March in a
 * non-leap year, which is where the Gregorian calendar puts it. `from` is
 * expected to be on or before `to`; a `from` after `to` returns a negative
 * count, which the caller may treat as it sees fit.
 */
export function wholeYearsBetween(fromMs: number, toMs: number, calendar: CalendarBackend): number {
	const from = calendar.fields(fromMs);
	const to = calendar.fields(toMs);
	let years = to.year - from.year;
	const beforeAnniversary =
		to.month0 < from.month0 ||
		(to.month0 === from.month0 && to.day < from.day);
	if (beforeAnniversary) years--;
	return years;
}

/** A calendar span split into whole years, months and days. */
export interface CalendarSpan {
	readonly years: number;
	readonly months: number;
	readonly days: number;
}

/** A calendar date: the part of the backend's calendar fields the month walk carries. */
interface CalendarDate {
	readonly year: number;
	readonly month0: number;
	readonly day: number;
}

/** `from` advanced by `n` whole months, the day clamped to the month's end. */
function addMonthsClamped(from: CalendarDate, n: number): CalendarDate {
	const targetYear = from.year;
	const targetMonth = from.month0 + n;
	// Normalise year/month first, then clamp the day, so 31 January + 1 month is
	// 28 February, not a rolled-over 3 March.
	const year = targetYear + Math.floor(targetMonth / 12);
	const month0 = ((targetMonth % 12) + 12) % 12;
	const day = Math.min(from.day, daysInMonth(year, month0));
	return { year, month0, day };
}

/**
 * The span between two dates as whole years, months and days, the way a person
 * reads an age or a duration ("36 years, 2 months, 9 days"), not as a single
 * divided unit.
 *
 * Counts whole months by advancing `from` a month at a time (clamping the day
 * to each month's end, so a 31st does not roll into the next month), stopping at
 * the last month that does not overshoot `to`, then counts the remaining days
 * from there. That clamp is why "31 January to 1 March" is one month and a day
 * rather than a negative-day artefact of a fixed-length subtraction. `from` is
 * expected on or before `to`.
 */
export function calendarBreakdown(fromMs: number, toMs: number, calendar: CalendarBackend): CalendarSpan {
	const from = calendar.fields(fromMs);
	const to = calendar.fields(toMs);

	let months = (to.year - from.year) * 12 + (to.month0 - from.month0);
	let anchor = addMonthsClamped(from, months);
	// The month arithmetic can overshoot by one when `to`'s day is earlier than
	// `from`'s; step back until the anchor is on or before `to`.
	if (calendar.localMidnight(anchor.year, anchor.month0, anchor.day) > toMs) {
		months--;
		anchor = addMonthsClamped(from, months);
	}

	const days = dayNumber(to.year, to.month0, to.day) - dayNumber(anchor.year, anchor.month0, anchor.day);

	return { years: Math.floor(months / 12), months: months % 12, days };
}

/**
 * The first of a month, `offsetMonths` away from the month `fromMs` falls in.
 * `next month`/`this month`/`last month` resolve through this, matching the
 * month-anchor convention that `March 2026` is the first of that month.
 */
export function monthAnchor(fromMs: number, offsetMonths: number, calendar: CalendarBackend): number {
	const d = calendar.fields(fromMs);
	// The month may overflow the year; `localMidnight` normalises it the way
	// `Date` does.
	return calendar.localMidnight(d.year, d.month0 + offsetMonths, 1);
}
