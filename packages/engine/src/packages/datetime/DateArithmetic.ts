/**
 * Pure, dependency-free calendar arithmetic for the datetime package's
 * calendar-aware features: the nth weekday of a month (`2nd Tuesday of March
 * 2026`) and age in whole years or a years/months/days breakdown (`age of
 * 15/06/1990`).
 *
 * Every function here takes and returns plain numbers (epoch milliseconds at
 * local midnight, or field integers), never a `Value`, so it carries no engine
 * import and is unit-testable on its own. The plugin handlers in
 * `DatetimeCalendarPluginFunctions.ts` wrap these into `Value`s.
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

import { daysInMonth } from "@solve-js/utilities/Calendar";

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
 * 0=Sunday..6=Saturday, matching `Date.getDay()`.
 */
export function nthWeekdayOfMonth(year: number, month0: number, dow: number, n: number): number | null {
	const firstDow = new Date(year, month0, 1).getDay();
	const offsetToFirst = (dow - firstDow + 7) % 7;
	const day = 1 + offsetToFirst + (n - 1) * 7;
	if (day < 1 || day > daysInMonth(year, month0)) return null;
	return new Date(year, month0, day).getTime();
}

/**
 * The date of the LAST occurrence of a weekday in a month (`last Friday of
 * November 2026`). Always exists, so unlike {@link nthWeekdayOfMonth} it never
 * returns null. Local-midnight epoch ms, `dow` 0=Sunday..6=Saturday.
 */
export function lastWeekdayOfMonth(year: number, month0: number, dow: number): number {
	const lastDay = daysInMonth(year, month0);
	const lastDow = new Date(year, month0, lastDay).getDay();
	const offsetBack = (lastDow - dow + 7) % 7;
	return new Date(year, month0, lastDay - offsetBack).getTime();
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
export function wholeYearsBetween(fromMs: number, toMs: number): number {
	const from = new Date(fromMs);
	const to = new Date(toMs);
	let years = to.getFullYear() - from.getFullYear();
	const beforeAnniversary =
		to.getMonth() < from.getMonth() ||
		(to.getMonth() === from.getMonth() && to.getDate() < from.getDate());
	if (beforeAnniversary) years--;
	return years;
}

/** A calendar span split into whole years, months and days. */
export interface CalendarSpan {
	readonly years: number;
	readonly months: number;
	readonly days: number;
}

/** `from` advanced by `n` whole months, the day clamped to the month's end. */
function addMonthsClamped(from: Date, n: number): Date {
	const targetYear = from.getFullYear();
	const targetMonth = from.getMonth() + n;
	// Normalise year/month first, then clamp the day, so 31 January + 1 month is
	// 28 February, not a rolled-over 3 March.
	const year = targetYear + Math.floor(targetMonth / 12);
	const month0 = ((targetMonth % 12) + 12) % 12;
	const day = Math.min(from.getDate(), daysInMonth(year, month0));
	return new Date(year, month0, day);
}

/** A local date's day count from the epoch, for a DST-proof day difference. */
function dayNumber(d: Date): number {
	return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
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
export function calendarBreakdown(fromMs: number, toMs: number): CalendarSpan {
	const from = new Date(fromMs);
	const to = new Date(toMs);

	let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
	// The month arithmetic can overshoot by one when `to`'s day is earlier than
	// `from`'s; step back until the anchor is on or before `to`.
	if (addMonthsClamped(from, months) > to) months--;

	const anchor = addMonthsClamped(from, months);
	const days = dayNumber(to) - dayNumber(anchor);

	return { years: Math.floor(months / 12), months: months % 12, days };
}

/**
 * The first of a month, `offsetMonths` away from the month `fromMs` falls in.
 * `next month`/`this month`/`last month` resolve through this, matching the
 * month-anchor convention that `March 2026` is the first of that month.
 */
export function monthAnchor(fromMs: number, offsetMonths: number): number {
	const d = new Date(fromMs);
	return new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1).getTime();
}
