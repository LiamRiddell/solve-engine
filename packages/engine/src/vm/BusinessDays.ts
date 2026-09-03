/**
 * Pure business-day arithmetic: the calendar walk behind workday offsets and
 * the working-day count.
 *
 * Weekends (Saturday and Sunday) are decidable from the date alone, so they
 * are always skipped. Public holidays are not decidable from the date, so they
 * arrive as an optional `isHoliday` predicate the host supplies (see
 * `vm/HolidayCalendar.ts` and `constants/Configuration.ts`'s `date.holidays`).
 * With no predicate the walk is weekends-only, which is the honest default:
 * the engine skips exactly the days it can prove are non-working, and nothing
 * more.
 *
 * These functions are deliberately free of engine types and of `Value`, so the
 * skipping logic can be unit-tested directly (see
 * `__tests__/vm/BusinessDays.spec.ts`) rather than only through a whole
 * expression. `vm/VM.ts` is the one caller that wires in the host predicate and
 * the configured offset limits, and turns a `null` (limit reached) into the
 * engine's structured error.
 *
 * Every walk steps the calendar backend's day field (`CalendarBackend.addDays`)
 * rather than adding a fixed number of milliseconds, matching `vm/VM.ts`'s
 * `addCalendarDays()`: a day that contains a daylight-saving transition is 23
 * or 25 hours long, and being an hour out is enough to land on the day before
 * or after the one asked for. The backend is a parameter rather than an
 * import so the VM can pass its engine's own; see `calendar/CalendarBackend.ts`.
 */

import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";

/** A host-supplied test for whether an instant falls on a public holiday. */
export type HolidayPredicate = (epochMs: number) => boolean;

/** Milliseconds in a day with no daylight-saving transition. Used only to size
 *  a span into whole days, never to move a date, so the DST caveat above does
 *  not apply (the caller rounds, and the walk itself steps the day field). */
const MS_PER_DAY = 86_400_000;

/** True for Saturday or Sunday, in the local time zone the rest of the engine's
 *  date arithmetic already works in, read through `calendar`. */
export function isWeekend(epochMs: number, calendar: CalendarBackend): boolean {
	const day = calendar.weekday(epochMs); // 0 = Sunday .. 6 = Saturday
	return day === 0 || day === 6;
}

/**
 * True for a working day: a weekday that the host's calendar, if any, does not
 * mark as a holiday. With no calendar this is just "not a weekend". `calendar`
 * is the backend the weekday is read through.
 */
export function isBusinessDay(epochMs: number, isHoliday: HolidayPredicate | undefined, calendar: CalendarBackend): boolean {
	if (isWeekend(epochMs, calendar)) return false;
	return isHoliday ? !isHoliday(epochMs) : true;
}

/** Local midnight of the calendar date `epochMs` falls on, so a time-of-day
 *  cannot tip a count onto the wrong day. */
function startOfLocalDay(epochMs: number, calendar: CalendarBackend): number {
	const d = calendar.fields(epochMs);
	return calendar.localMidnight(d.year, d.month0, d.day);
}

/**
 * Advance (or, for negative `n`, retreat) `startMs` by `n` business days,
 * landing on a business day: `Friday + 1 working day` is the following Monday,
 * and if a Monday is a configured holiday it is the Tuesday.
 *
 * `maxCalendarSteps` caps the walk. A caller passes the number of calendar days
 * its configured offset limit allows, which also makes a pathological calendar
 * (one that marks every day a holiday, so no step ever counts) terminate rather
 * than loop forever. Returns `null` when the cap is reached, which the caller
 * reports as a limit error, distinct from a real landing date.
 *
 * `calendar` is the backend each step is taken through.
 */
export function addBusinessDays(
	startMs: number,
	n: number,
	isHoliday: HolidayPredicate | undefined,
	maxCalendarSteps: number,
	calendar: CalendarBackend,
): number | null {
	// Truncated to whole business days, mirroring the milliseconds path: a
	// fractional count of working days names no calendar date of its own.
	let remaining = Math.trunc(Math.abs(n));
	const direction = n >= 0 ? 1 : -1;
	let current = startMs;
	let steps = 0;
	while (remaining > 0) {
		current = calendar.addDays(current, direction);
		steps++;
		if (steps > maxCalendarSteps) return null;
		if (isBusinessDay(current, isHoliday, calendar)) remaining--;
	}
	return current;
}

/**
 * Count the business days between two dates, INCLUSIVE of both endpoints and
 * independent of the order the two are written in (there is no direction to
 * "between" in English, so `A and B` counts the same as `B and A`).
 *
 * Counted on calendar-date granularity: the time of day on either endpoint is
 * dropped first, so `working days between 1 Jan and 31 Jan` is every working
 * day in that window, both ends included. Inclusive is the reading a deadline
 * question wants ("how many working days do I have from today through Friday").
 *
 * `maxCalendarSteps` bounds the span the same way {@link addBusinessDays} bounds
 * its walk; returns `null` when the two dates are further apart than that, which
 * the caller reports as a range error.
 *
 * `calendar` is the backend the endpoints are read and the days stepped through.
 */
export function countBusinessDaysBetween(
	aMs: number,
	bMs: number,
	isHoliday: HolidayPredicate | undefined,
	maxCalendarSteps: number,
	calendar: CalendarBackend,
): number | null {
	const startDay = startOfLocalDay(Math.min(aMs, bMs), calendar);
	const endDay = startOfLocalDay(Math.max(aMs, bMs), calendar);
	// Rounded because a span crossing a daylight-saving change is a whole
	// number of days plus or minus an hour, and both endpoints are already
	// local midnights.
	const spanDays = Math.round((endDay - startDay) / MS_PER_DAY);
	if (spanDays > maxCalendarSteps) return null;
	let count = 0;
	let current = startDay;
	for (let i = 0; i <= spanDays; i++) {
		if (isBusinessDay(current, isHoliday, calendar)) count++;
		current = calendar.addDays(current, 1);
	}
	return count;
}
