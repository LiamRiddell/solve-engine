/**
 * The calendar the engine computes dates with, behind one interface.
 *
 * Every date the engine holds is an instant: epoch milliseconds in a
 * `Datetime` value, with no zone attached. Every date *question* the engine
 * answers is a calendar question about that instant: which day it falls on,
 * what the same wall-clock time a month later is, whether it is a Saturday,
 * how it is written out. Answering those needs a time zone and a set of
 * calendar rules, and until this interface existed the answer was always the
 * JavaScript `Date` object read in the host process's own zone, scattered
 * across some twenty files.
 *
 * A backend gathers those questions into one place so that a different
 * implementation can answer them. Two ship with the engine. {@link DateCalendar}
 * is the same `Date` code moved behind these methods and is the default, so
 * nothing observable changes for a host that configures nothing. The
 * `Temporal` backend (`solve-engine/temporal`) answers the same questions
 * through a `Temporal` implementation the host hands it, native or polyfilled,
 * and carries a time zone of its own rather than the process's; the engine
 * never imports a polyfill.
 *
 * The contract is deliberately narrow. Methods take and return plain numbers
 * and strings, never a `Date` or a `Temporal` object, so a `Datetime` value's
 * payload stays a number and no worker message, snapshot or arena entry
 * changes shape. Arithmetic whose answer does not depend on a zone (a day
 * number, the days in a month, the ISO week) lives beside the backend in
 * `calendar/Gregorian.ts` rather than behind it, because sharing one
 * implementation is what keeps two backends from disagreeing on it.
 *
 * The shape is public and settled by the two backends that implement it. A
 * host may implement the interface directly; a change to it follows the
 * package's semantic versioning, so a new required method is a major.
 *
 * @module CalendarBackend
 */

/**
 * The calendar fields of one instant, read in the backend's zone.
 *
 * `month0` counts from zero (January is 0) and `weekday` from Sunday (0) to
 * Saturday (6), matching `Date` at every internal boundary so a backend cannot
 * be off by one against the code that reads it. Every field is `NaN` for an
 * instant the backend cannot represent.
 */
export interface CalendarFields {
	readonly year: number;
	/** Zero-based month: 0 is January, 11 is December. */
	readonly month0: number;
	/** Day of the month, from 1. */
	readonly day: number;
	/** Day of the week: 0 is Sunday, 6 is Saturday. */
	readonly weekday: number;
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
	readonly millisecond: number;
}

/**
 * The calendar fields a named time zone shows for an instant: the date and
 * the wall-clock time, with the same zero-based month as {@link CalendarFields}.
 * Sub-second precision is never needed for a zone conversion, so there is no
 * millisecond field.
 */
export interface ZonedFields {
	readonly year: number;
	/** Zero-based month: 0 is January, 11 is December. */
	readonly month0: number;
	/** Day of the month, from 1. */
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
}

/**
 * The calendar computations the engine performs, as one replaceable unit.
 *
 * "Local" throughout means the backend's own zone: the host process's zone for
 * the `Date` backend, the configured zone for the `Temporal` one. A local
 * operation that cannot be represented (an instant past the range the backend
 * supports, a field that is not finite) answers `NaN`, never throws; the
 * caller decides what an unrepresentable date means for its form.
 *
 * The four named-zone methods are the exception, and the contract is stated on
 * each: a zone name the runtime does not know throws its `RangeError`, as
 * `Intl` and `Temporal` both do, because a zone reaches the backend only from
 * the engine's own zone registry and an unknown one is a data fault the caller
 * should see rather than a `NaN` to display. Callers hand those methods a
 * finite instant (`now()`, or a literal already checked).
 */
export interface CalendarBackend {
	/** The current instant, in epoch milliseconds. Read at evaluation time, never baked into bytecode. */
	now(): number;

	/** The local calendar fields of an instant, `weekday` included. See {@link CalendarFields}. */
	fields(epochMs: number): CalendarFields;

	/**
	 * Local midnight on a calendar date, in epoch milliseconds.
	 *
	 * Fields overflow the way `Date`'s do (month 12 is January of the next
	 * year, day 0 the last day of the month before), which is what a caller
	 * checking for a rolled-over literal relies on: build the date, read its
	 * fields back, and a 30 February shows up as 1 or 2 March.
	 */
	localMidnight(year: number, month0: number, day: number): number;

	/**
	 * A wall-clock time on a calendar date, given as minutes past local
	 * midnight, in epoch milliseconds.
	 *
	 * The minutes name a clock reading, not an elapsed span: 540 minutes is
	 * 09:00 on that date even on a day with a daylight-saving transition,
	 * where 540 minutes of elapsed time from midnight would land at 10:00 or
	 * 08:00.
	 */
	localWallClock(year: number, month0: number, day: number, minutesPastMidnight: number): number;

	/**
	 * Move an instant by whole calendar days, holding the local wall-clock
	 * time. A day that contains a daylight-saving transition is 23 or 25
	 * hours long, so this is a field step, not an addition of milliseconds.
	 */
	addDays(epochMs: number, days: number): number;

	/**
	 * Move an instant by whole calendar months, holding the local wall-clock
	 * time and clamping the day to the length of the month landed in: 31
	 * January plus a month is 28 February, or 29 in a leap year, never 3 March.
	 */
	addMonths(epochMs: number, months: number): number;

	/** The local zone's offset from UTC at an instant, in minutes, positive when ahead of UTC. */
	utcOffsetMinutes(epochMs: number): number;

	/**
	 * Parse an ISO 8601 date or date-time string to epoch milliseconds, or
	 * `NaN` when it names no instant.
	 *
	 * A date-only string (`2019-04-01`) is UTC midnight; a date-time with no
	 * offset and no `Z` is local time. Both readings are the ECMAScript ones,
	 * and every backend reproduces them so the two spellings of a literal keep
	 * meaning the same instant whichever backend is in use.
	 */
	parseIso8601(text: string): number;

	/** The spelled-out local date in a locale, `Tuesday, March 10, 2026` in `en`. */
	formatLongDate(epochMs: number, locale: string): string;

	/** The local time of day in a locale, `9:30:00 AM` in `en`. */
	formatTimeOfDay(epochMs: number, locale: string): string;

	/**
	 * A named IANA zone's offset from UTC at an instant, in minutes, positive
	 * when ahead of UTC. Throws the runtime's `RangeError` for a zone it does
	 * not know or an instant it cannot represent.
	 */
	zoneOffsetMinutes(zone: string, epochMs: number): number;

	/**
	 * The calendar date and wall-clock time a named IANA zone shows for an
	 * instant. Throws the runtime's `RangeError` for a zone it does not know or
	 * an instant it cannot represent.
	 */
	fieldsInZone(zone: string, epochMs: number): ZonedFields;

	/**
	 * The wall-clock time in a named IANA zone, `1:00 AM`, in the `en-US` style
	 * the timezone forms answer in. Throws the runtime's `RangeError` for a
	 * zone it does not know or an instant it cannot represent.
	 */
	formatTimeInZone(zone: string, epochMs: number): string;

	/**
	 * The calendar date in a named IANA zone, `July 31, 2026`, in the `en-US`
	 * style the timezone forms answer in. Throws the runtime's `RangeError` for
	 * a zone it does not know or an instant it cannot represent.
	 */
	formatDateInZone(zone: string, epochMs: number): string;

	/**
	 * The zone this backend's "local" means, when it can name one.
	 *
	 * Optional, and deliberately so: the interface's own contract says a new
	 * REQUIRED method is a major, and every backend written against the shipped
	 * shape has to keep compiling. A backend that reads the host process's zone
	 * (the default {@link DateCalendar}) leaves it undefined rather than
	 * reporting a zone it does not itself compute in; one built for a named zone
	 * (`dateCalendarInZone`, the `Temporal` backend) returns that IANA name.
	 *
	 * A caller that needs "which zone is local here" and gets `undefined` should
	 * fall back to whatever it meant by local before, never guess a name.
	 */
	zone?(): string;
}
