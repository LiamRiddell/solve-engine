import type { ZonedFields } from "./CalendarBackend";

/**
 * Gregorian arithmetic that does not depend on a time zone, shared by every
 * {@link CalendarBackend} rather than implemented behind each one.
 *
 * A backend exists to answer the questions whose answer depends on a zone:
 * which local day an instant falls on, what the same wall-clock time a month
 * later is. Once the fields are known, the day number of a date, the ISO week
 * it falls in and the instant its fields name in UTC are pure functions of
 * those fields. Keeping them here, with one implementation, is what makes two
 * backends agree on them by construction.
 *
 * The arithmetic is `Date`'s own UTC methods, which read and write the number
 * with no zone consulted. That includes `Date`'s reading of a year from 0 to
 * 99 as the 1900s in `Date.UTC`, kept because the engine's results are
 * measured against it.
 *
 * @module Gregorian
 */

/** Milliseconds in a UTC day, which has no daylight-saving transition to make it longer or shorter. */
const MS_PER_DAY = 86_400_000;

/**
 * The instant a set of calendar fields names in UTC, in epoch milliseconds.
 *
 * @param year - The calendar year (0 to 99 read as the 1900s, as `Date.UTC` does).
 * @param month0 - Zero-based month; overflow rolls into the adjacent year.
 * @param day - Day of the month; overflow rolls into the adjacent month.
 * @param hour - Hour of the day, default 0.
 * @param minute - Minute of the hour, default 0.
 * @param second - Second of the minute, default 0.
 * @returns Epoch milliseconds, or `NaN` when the fields are not finite.
 */
export function utcMs(year: number, month0: number, day: number, hour = 0, minute = 0, second = 0): number {
	return Date.UTC(year, month0, day, hour, minute, second);
}

/**
 * Days in a calendar month, honouring the leap-year rule, century rule
 * included.
 *
 * Day zero of the following month is the last day of this one, which applies
 * the rule without restating it. Shared rather than a backend method because
 * the answer never depends on a zone, and the month clamp in a month step and
 * the count in `days in <period>` must not move between backends.
 *
 * @param year - The calendar year (0 to 99 read as the 1900s, as `Date.UTC` does).
 * @param month0 - Zero-based month; overflow rolls into the adjacent year.
 * @returns 28 to 31.
 */
export function daysInMonth(year: number, month0: number): number {
	return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * A calendar date's day count from the epoch, for a difference between two
 * dates that no daylight-saving hour can tip onto the wrong day.
 *
 * @param year - The calendar year.
 * @param month0 - Zero-based month.
 * @param day - Day of the month.
 * @returns Whole days since 1 January 1970, negative before it.
 */
export function dayNumber(year: number, month0: number, day: number): number {
	return Math.floor(Date.UTC(year, month0, day) / MS_PER_DAY);
}

/**
 * The calendar date and wall-clock time an instant has in UTC.
 *
 * The fixed-offset zones (`GMT+8`) are converted by shifting the instant by
 * the offset and reading it as UTC, which is what this is for.
 *
 * @param epochMs - The instant.
 * @returns Its UTC fields, each `NaN` for an unrepresentable instant.
 */
export function utcFields(epochMs: number): ZonedFields {
	const d = new Date(epochMs);
	return {
		year: d.getUTCFullYear(),
		month0: d.getUTCMonth(),
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
		second: d.getUTCSeconds(),
	};
}

/**
 * The ISO 8601 week number (1 to 53) of a calendar date.
 *
 * ISO weeks start on Monday and week 1 is the one containing the first
 * Thursday of the year, which is why this steps to the Thursday of the
 * date's week before counting. A naive "day of year over seven" disagrees
 * with every calendar application for the first and last days of a year.
 *
 * @param year - The calendar year.
 * @param month0 - Zero-based month.
 * @param day - Day of the month.
 * @returns The week number, 1 to 53.
 */
export function isoWeekNumber(year: number, month0: number, day: number): number {
	// A date-only copy in UTC, so no local hour can shift the day.
	const target = new Date(Date.UTC(year, month0, day));
	// `getUTCDay()` counts Sunday as 0. Map to ISO's Monday 1 to Sunday 7,
	// then step to the Thursday of the same week.
	const isoDay = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
	target.setUTCDate(target.getUTCDate() + 4 - isoDay);
	const yearStart = Date.UTC(target.getUTCFullYear(), 0, 1);
	const days = Math.floor((target.getTime() - yearStart) / MS_PER_DAY);
	return Math.floor(days / 7) + 1;
}
