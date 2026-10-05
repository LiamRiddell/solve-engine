/**
 * Calendar steps on a date read in a time zone: whole days and whole months
 * counted on that zone's calendar rather than the host's.
 *
 * A date moved by days keeps its wall-clock time (see `addCalendarDays` in
 * `vm/VM.ts`), and the calendar that says what the wall clock reads is the
 * backend's own, which is the host's zone for the default `Date` backend. A
 * date named in a zone (`2024-11-02 12:00 in New York`) is an instant shown on
 * that zone's clock, so stepping it on the host's calendar kept the host's
 * wall clock instead: on a host in UTC, `+ 1 day` across the night New York
 * falls back answered 11:00, twenty-four hours on, where New York's clock
 * reads 12:00 a day later; on a host in London the same line landed an hour
 * off on the night London changes, which New York does not. These helpers read
 * the zone's own fields, move the day or month field, and turn that wall clock
 * back into an instant in the same zone.
 */
import type { CalendarBackend, ZonedFields } from "@solve-js/calendar/CalendarBackend";
import { decodeFixedOffsetMinutes, isFixedOffset, zonedWallClockToUtcMs } from "@solve-js/calendar/IntlZone";
import { daysInMonth } from "@solve-js/calendar/Gregorian";

const MS_PER_DAY = 86_400_000;

/**
 * The calendar fields a zone reference shows for an instant: a fixed offset
 * read from the instant moved by it, a named zone through the backend.
 *
 * @param zoneRef - An IANA name or a fixed-offset reference.
 * @param epochMs - A finite instant.
 * @param calendar - The backend that resolves a named zone.
 * @returns The fields. A named zone the runtime does not know, or an instant
 * past its range, throws the backend's `RangeError`.
 */
export function fieldsInZoneRef(zoneRef: string, epochMs: number, calendar: CalendarBackend): ZonedFields {
	if (!isFixedOffset(zoneRef)) return calendar.fieldsInZone(zoneRef, epochMs);
	const shifted = new Date(epochMs + decodeFixedOffsetMinutes(zoneRef) * 60_000);
	return {
		year: shifted.getUTCFullYear(),
		month0: shifted.getUTCMonth(),
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
		second: shifted.getUTCSeconds(),
	};
}

/**
 * The instant a zone's wall clock shows after its fields are moved, or NaN
 * when there is none: a field not finite, a zone unknown to the runtime, or
 * an instant past the range a date holds.
 */
function stepInZone(
	epochMs: number,
	zoneRef: string,
	calendar: CalendarBackend,
	move: (fields: ZonedFields) => { year: number; month0: number; day: number },
): number {
	if (!Number.isFinite(epochMs)) return Number.NaN;
	try {
		const fields = fieldsInZoneRef(zoneRef, epochMs, calendar);
		const to = move(fields);
		// The milliseconds past the second, which the fields do not carry.
		const millisecond = ((epochMs % 1000) + 1000) % 1000;
		return zonedWallClockToUtcMs(to.year, to.month0, to.day, fields.hour, fields.minute, zoneRef, calendar) + fields.second * 1000 + millisecond;
	} catch (e) {
		// The backend's refusal of an instant or a zone it cannot hold; the
		// caller falls back to the linear step, as it does for the host's.
		if (e instanceof RangeError) return Number.NaN;
		throw e;
	}
}

/**
 * Move an instant by calendar days on a zone's clock, keeping the time that
 * clock shows. A fraction of a day is elapsed time, added as milliseconds.
 *
 * @param epochMs - The instant.
 * @param days - Whole days, possibly with a fraction; negative moves back.
 * @param zoneRef - The zone the instant is read in.
 * @param calendar - The backend that resolves a named zone.
 * @returns The moved instant. When the zone's clock cannot be read there (an
 * instant past the range a date holds), the linear `days * 24 hours`, the
 * same fallback the host's calendar step makes.
 */
export function addZonedCalendarDays(epochMs: number, days: number, zoneRef: string, calendar: CalendarBackend): number {
	const whole = Math.trunc(days);
	const moved = stepInZone(epochMs, zoneRef, calendar, (f) => ({ year: f.year, month0: f.month0, day: f.day + whole }));
	if (Number.isNaN(moved)) return epochMs + days * MS_PER_DAY;
	return moved + (days - whole) * MS_PER_DAY;
}

/**
 * Move an instant by calendar months on a zone's clock, keeping the time that
 * clock shows and clamping the day to the month landed in: 31 January plus a
 * month is 28 February, or 29 in a leap year. A fraction of a month is added
 * as `monthMs` a whole month, as the host's month step does.
 *
 * @param epochMs - The instant.
 * @param months - Whole months, possibly with a fraction; negative moves back.
 * @param zoneRef - The zone the instant is read in.
 * @param calendar - The backend that resolves a named zone.
 * @param monthMs - The length of a month in milliseconds, for the fraction.
 * @returns The moved instant, or the linear `months * monthMs` when the zone's
 * clock cannot be read there.
 */
export function addZonedCalendarMonths(epochMs: number, months: number, zoneRef: string, calendar: CalendarBackend, monthMs: number): number {
	const whole = Math.trunc(months);
	const moved = stepInZone(epochMs, zoneRef, calendar, (f) => {
		const target = f.month0 + whole;
		const year = f.year + Math.floor(target / 12);
		const month0 = ((target % 12) + 12) % 12;
		return { year, month0, day: Math.min(f.day, daysInMonth(year, month0)) };
	});
	if (Number.isNaN(moved)) return epochMs + months * monthMs;
	return moved + (months - whole) * monthMs;
}

/**
 * Move an instant by a walk over calendar dates, read on a zone's calendar:
 * the working-day offsets (`2024-11-01 23:30 in New York + 1 workday`), which
 * count the days that zone's clock shows rather than the host's.
 *
 * The zone's date is handed to `walkDates` as the backend's local midnight of
 * that same date, so the weekend, the host's holiday predicate and the step cap
 * all read it as the calendar date it is. The date the walk lands on is read
 * back, and the zone's wall-clock time put on it, as the day steps above keep
 * it.
 *
 * @param epochMs - The instant.
 * @param zoneRef - The zone the instant is read in.
 * @param calendar - The backend that resolves a named zone.
 * @param walkDates - A walk from one local midnight to another, or `null` when
 * it gives up.
 * @returns The moved instant, `null` when the walk gave up, or NaN when the
 * zone's clock cannot be read there.
 */
export function walkDatesInZone(epochMs: number, zoneRef: string, calendar: CalendarBackend, walkDates: (localMidnightMs: number) => number | null): number | null {
	if (!Number.isFinite(epochMs)) return Number.NaN;
	try {
		const fields = fieldsInZoneRef(zoneRef, epochMs, calendar);
		const landed = walkDates(calendar.localMidnight(fields.year, fields.month0, fields.day));
		if (landed === null) return null;
		const to = calendar.fields(landed);
		const millisecond = ((epochMs % 1000) + 1000) % 1000;
		return zonedWallClockToUtcMs(to.year, to.month0, to.day, fields.hour, fields.minute, zoneRef, calendar) + fields.second * 1000 + millisecond;
	} catch (e) {
		if (e instanceof RangeError) return Number.NaN;
		throw e;
	}
}

/**
 * The backend's local midnight of the calendar date an instant shows in a
 * zone, so a count over calendar dates (`working days between`) reads a zoned
 * endpoint as the day its own zone shows.
 *
 * @param epochMs - The instant.
 * @param zoneRef - The zone it is read in.
 * @param calendar - The backend that resolves a named zone.
 * @returns That local midnight, or NaN when the zone's clock cannot be read there.
 */
export function zonedDateAsLocalMidnight(epochMs: number, zoneRef: string, calendar: CalendarBackend): number {
	if (!Number.isFinite(epochMs)) return Number.NaN;
	try {
		const fields = fieldsInZoneRef(zoneRef, epochMs, calendar);
		return calendar.localMidnight(fields.year, fields.month0, fields.day);
	} catch (e) {
		if (e instanceof RangeError) return Number.NaN;
		throw e;
	}
}
