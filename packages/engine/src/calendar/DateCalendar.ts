import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { DatetimeZoneErrorCodes } from "@solve-js/errors/ErrorCode";
import type { CalendarBackend, CalendarFields, ZonedFields } from "./CalendarBackend";
import { dayNumber, daysInMonth, utcMs } from "./Gregorian";
import { dateInZone, isSupportedZone, longDateInZone, longDateOptions, mayPrecedeYearOne, timeInZone, namedZoneWallClockToUtcMs, timeOfDayInZone, zonedFields } from "./IntlZone";
import { checkedClock } from "./Clock";

/**
 * `new Date(year, month0, day)`, local midnight, with the year read as written.
 *
 * The constructor reads a year from 0 to 99 as the 1900s. Such a year is built
 * four hundred years on, where the Gregorian calendar repeats exactly, and the
 * year set back with `setFullYear`, which keeps the local date and time of day
 * and never windows. Every other year is the constructor's own answer.
 *
 * @param year - The year, as written: 26 is 26 AD.
 * @param month0 - Zero-based month; overflow rolls as the constructor rolls it.
 * @param day - Day of the month; overflow rolls as the constructor rolls it.
 * @returns A `Date` at local midnight on that day.
 */
export function localDate(year: number, month0: number, day: number): Date {
	// The window is the years whose integer part is 0 to 99, which is every
	// year above -1 and below 100. Tested on the year itself, so the common
	// year (2026) reads no global: `Math` inside a `vm` context costs hundreds
	// of nanoseconds, and this runs for every date literal a line holds.
	if (!(year > -1 && year < 100)) return new Date(year, month0, day);
	const whole = Math.trunc(year);
	const date = new Date(whole + 400, month0, day);
	date.setFullYear(date.getFullYear() - 400);
	return date;
}

/**
 * The default {@link CalendarBackend}: the JavaScript `Date` object, read in
 * the host process's time zone, with `Intl.DateTimeFormat` for named zones.
 *
 * This is the calendar code the engine has always run, moved behind the
 * interface method by method rather than rewritten, so a host that configures
 * nothing sees the same instants and the same strings it did before the
 * backend existed. Where `Date` has a quirk (an out-of-range instant answers
 * `NaN`), the quirk is kept here deliberately: the point of this backend is to
 * be the behaviour the `Temporal` backend is measured against, not to improve
 * on it. The one quirk not kept is the constructor's reading of a year from 0
 * to 99 as the 1900s: every year the engine hands a backend is one already
 * read off a date or written out in full, so that window put 26 AD in 1926 and
 * refused `1 Jan 0001` as no real day (#823).
 *
 * It stays the default because it is the one calendar every supported runtime
 * has. `Temporal` ships unflagged in Node 26 and in current Chrome, Firefox
 * and Deno, but not in Safari or in the Node 22 and 24 the engine supports,
 * and the smallest polyfill adds about twenty kilobytes gzipped to a bundle
 * that a host doing plain arithmetic never needs. A host that wants
 * `Temporal` opts in through the engine's `calendar` option with the backend
 * from `solve-engine/temporal`, and pays for it only then.
 */
export class DateCalendar implements CalendarBackend {
	now(): number {
		return Date.now();
	}

	fields(epochMs: number): CalendarFields {
		const d = new Date(epochMs);
		return {
			year: d.getFullYear(),
			month0: d.getMonth(),
			day: d.getDate(),
			weekday: d.getDay(),
			hour: d.getHours(),
			minute: d.getMinutes(),
			second: d.getSeconds(),
			millisecond: d.getMilliseconds(),
		};
	}

	localMidnight(year: number, month0: number, day: number): number {
		return localDate(year, month0, day).getTime();
	}

	localWallClock(year: number, month0: number, day: number, minutesPastMidnight: number): number {
		// Anchored at midnight and then moved by the minutes FIELD, so the
		// result is the wall-clock reading asked for whatever the day's length.
		const anchored = localDate(year, month0, day);
		anchored.setMinutes(minutesPastMidnight);
		return anchored.getTime();
	}

	addDays(epochMs: number, days: number): number {
		const date = new Date(epochMs);
		date.setDate(date.getDate() + days);
		return date.getTime();
	}

	addMonths(epochMs: number, months: number): number {
		const date = new Date(epochMs);
		const dayOfMonth = date.getDate();
		// Parked on the 1st before the month field moves: `setMonth()` keeps
		// the day number, so a 31st aimed at a 30-day month would overflow
		// into the month after it. Clamping afterwards is what keeps the month
		// the caller asked for.
		date.setDate(1);
		date.setMonth(date.getMonth() + months);
		date.setDate(Math.min(dayOfMonth, daysInMonth(date.getFullYear(), date.getMonth())));
		return date.getTime();
	}

	utcOffsetMinutes(epochMs: number): number {
		// `getTimezoneOffset()` is (UTC minus local), so its sign is inverted
		// relative to the "+HH:MM ahead of UTC" reading every caller wants.
		// Subtracted from zero rather than negated, so a zero offset is 0 and
		// not -0, which a second backend could not be expected to reproduce.
		return 0 - new Date(epochMs).getTimezoneOffset();
	}

	parseIso8601(text: string): number {
		return new Date(text).getTime();
	}

	formatLongDate(epochMs: number, locale: string): string {
		const date = new Date(epochMs);
		// The era only before year 1, where the year alone reads as AD (#823).
		const beforeYearOne = mayPrecedeYearOne(epochMs) && date.getFullYear() < 1;
		return date.toLocaleDateString(locale, longDateOptions(beforeYearOne));
	}

	formatTimeOfDay(epochMs: number, locale: string): string {
		return new Date(epochMs).toLocaleTimeString(locale);
	}

	zoneOffsetMinutes(zone: string, epochMs: number): number {
		// The `Intl` round trip: read the instant as the zone's wall-clock
		// fields, re-read those fields as if they were UTC, and the difference
		// from the instant is the zone's offset then, daylight saving included.
		const f = zonedFields(zone, epochMs);
		// `|| 0` folds the -0 a negative sub-minute difference rounds to.
		return Math.round((utcMs(f.year, f.month0, f.day, f.hour, f.minute, f.second) - epochMs) / 60000) || 0;
	}

	fieldsInZone(zone: string, epochMs: number): ZonedFields {
		return zonedFields(zone, epochMs);
	}

	formatTimeInZone(zone: string, epochMs: number): string {
		return timeInZone(zone, epochMs);
	}

	formatDateInZone(zone: string, epochMs: number): string {
		return dateInZone(zone, epochMs);
	}
}

/**
 * The one `Date` backend, shared by every engine that configures no other.
 *
 * Stateless, so sharing is safe: it holds no zone of its own and reads the
 * process's. It is also what the sites with no engine in hand use (the
 * normaliser rules that fuse a literal, `days in <period>`, the stocks and
 * historical-currency date phrases, and `formatValue`), which is why an
 * engine's own backend is the default here rather than a second copy.
 */
export const DATE_CALENDAR: CalendarBackend = new DateCalendar();

/**
 * The backend a plugin function or converter should compute with: the one
 * on its execution context, or the `Date` backend when the handler was
 * called with no context (a direct call from a test, or an `as` converter
 * invoked outside the VM).
 *
 * @param context - The execution context the handler received, if any.
 * @returns The engine's backend when the context carries one, else {@link DATE_CALENDAR}.
 */
export function calendarOf(context?: { readonly calendar?: CalendarBackend }): CalendarBackend {
	return context?.calendar ?? DATE_CALENDAR;
}

/**
 * The `Date` backend, computing in a named IANA zone instead of the host
 * process's.
 *
 * Every zone-free answer is inherited unchanged from {@link DateCalendar}:
 * `now()` is still the clock, `parseIso8601` still reads the two ECMAScript
 * spellings, and the four named-zone methods already took the zone as an
 * argument. What changes is what "local" means, which is exactly the set of
 * questions {@link CalendarBackend} says depends on a zone: which day an
 * instant falls on, what a wall-clock reading names, what a day or a month
 * later is, and what the offset from UTC is.
 *
 * Those are answered through `Intl`, the same data the base class already
 * reads named zones with, so the accuracy is the same and nothing new is
 * bundled. The one place it is a simplification is a wall clock that a
 * daylight-saving transition made ambiguous or non-existent (01:30 on a
 * spring-forward morning): {@link namedZoneWallClockToUtcMs} resolves it one way,
 * and a `Temporal` backend's `disambiguation: 'compatible'` may resolve it an
 * hour differently.
 */
/**
 * An ISO 8601 date-time with a time of day and NO offset and no `Z`: the one
 * spelling whose instant depends on which zone reads it. Anchored at both
 * ends, so a date-only string and anything carrying an offset fall through to
 * the base class untouched.
 */
const ISO_LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

/** The fields the base class answers for an instant `Date` cannot hold: every one `NaN`. */
const NAN_FIELDS: CalendarFields = Object.freeze({
	year: Number.NaN, month0: Number.NaN, day: Number.NaN, weekday: Number.NaN,
	hour: Number.NaN, minute: Number.NaN, second: Number.NaN, millisecond: Number.NaN,
});

/**
 * Whether `Date` can hold an instant: finite and within 8.64e15 milliseconds
 * of the epoch. `Intl` throws a `RangeError` for any other, where the local
 * methods' contract is to answer `NaN` (or `Invalid Date`, as `Date` writes
 * one), so the zone-bound backend checks before it asks.
 */
function representable(epochMs: number): boolean {
	return Number.isFinite(epochMs) && Math.abs(epochMs) <= 8.64e15;
}

class ZonedDateCalendar extends DateCalendar {
	private readonly clock: (() => number) | undefined;

	/**
	 * @param namedZone - An IANA zone name `Intl` accepts.
	 * @param clock - The checked clock `now()` reads, or none for `Date.now`.
	 */
	constructor(private readonly namedZone: string, clock?: () => number) {
		super();
		this.clock = clock;
	}

	now(): number {
		return this.clock === undefined ? super.now() : this.clock();
	}

	zone(): string {
		return this.namedZone;
	}

	fields(epochMs: number): CalendarFields {
		if (!representable(epochMs)) return NAN_FIELDS;
		const f = zonedFields(this.namedZone, epochMs);
		// `zonedFields` answers no weekday and no millisecond: the weekday is a
		// pure function of the zoned date (`Gregorian.dayNumber`, counting from a
		// Thursday), and the millisecond is the instant's own, which no zone
		// offset in use is fractional enough to move.
		const weekday = (((dayNumber(f.year, f.month0, f.day) + 4) % 7) + 7) % 7;
		return {
			year: f.year, month0: f.month0, day: f.day, weekday,
			hour: f.hour, minute: f.minute, second: f.second,
			millisecond: ((epochMs % 1000) + 1000) % 1000,
		};
	}

	localMidnight(year: number, month0: number, day: number): number {
		return namedZoneWallClockToUtcMs(year, month0, day, 0, 0, this.namedZone);
	}

	localWallClock(year: number, month0: number, day: number, minutesPastMidnight: number): number {
		// The minutes go in as the MINUTE field, not as elapsed time, so a
		// reading of 540 is 09:00 on that date even on a 23-hour day. `Date.UTC`
		// rolls a minute field past 59 into the hour, which is what makes one
		// argument enough.
		return namedZoneWallClockToUtcMs(year, month0, day, 0, minutesPastMidnight, this.namedZone);
	}

	addDays(epochMs: number, days: number): number {
		if (!representable(epochMs)) return Number.NaN;
		const f = zonedFields(this.namedZone, epochMs);
		return this.reanchor(f, f.day + days, epochMs);
	}

	addMonths(epochMs: number, months: number): number {
		if (!representable(epochMs)) return Number.NaN;
		const f = zonedFields(this.namedZone, epochMs);
		// `utcMs` rather than `Date.UTC`, so a date in the first century keeps its year.
		const target = new Date(utcMs(f.year, f.month0 + months, 1));
		const clampedDay = Math.min(f.day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));
		return namedZoneWallClockToUtcMs(
			target.getUTCFullYear(), target.getUTCMonth(), clampedDay,
			f.hour, f.minute, this.namedZone,
		) + f.second * 1000 + (((epochMs % 1000) + 1000) % 1000);
	}

	utcOffsetMinutes(epochMs: number): number {
		if (!representable(epochMs)) return Number.NaN;
		return this.zoneOffsetMinutes(this.namedZone, epochMs);
	}

	parseIso8601(text: string): number {
		// The one reading in that contract that depends on a zone: a date-time
		// with no offset and no `Z` is LOCAL time, and local here is the named
		// zone. Without this the backend contradicted itself, computing
		// `2026-04-03` at New York midnight while reading `2026-04-03T09:30` as
		// half past nine in the host process's zone. It is also what the
		// `Temporal` backend already does (`TemporalCalendar.parseIso8601`
		// resolves a bare wall clock in its own zone), so the two agree.
		//
		// Everything else is the base class byte for byte: a date-only string is
		// still UTC midnight and an explicit offset is still subtracted, both
		// frozen by the interface's contract.
		const matched = ISO_LOCAL_DATE_TIME.exec(text.trim());
		if (matched === null) return super.parseIso8601(text);
		const [, year, month, day, hour, minute, second, fraction] = matched;
		const millisecond = fraction === undefined ? 0 : Number(fraction.slice(0, 3).padEnd(3, "0"));
		return namedZoneWallClockToUtcMs(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), this.namedZone)
			+ (second === undefined ? 0 : Number(second)) * 1000 + millisecond;
	}

	formatLongDate(epochMs: number, locale: string): string {
		if (!representable(epochMs)) return "Invalid Date";
		return longDateInZone(this.namedZone, epochMs, locale);
	}

	formatTimeOfDay(epochMs: number, locale: string): string {
		if (!representable(epochMs)) return "Invalid Date";
		return timeOfDayInZone(this.namedZone, epochMs, locale);
	}

	/** Rebuild an instant on a (possibly overflowed) day, holding its wall clock down to the millisecond. */
	private reanchor(f: ZonedFields, day: number, epochMs: number): number {
		return namedZoneWallClockToUtcMs(f.year, f.month0, day, f.hour, f.minute, this.namedZone)
			+ f.second * 1000 + (((epochMs % 1000) + 1000) % 1000);
	}
}

/**
 * A `Date` backend that computes in a named time zone rather than the host
 * process's.
 *
 * This is how a host pins the zone the engine reads dates in, and it is the
 * only knob for it: the zone belongs to the calendar backend, which already
 * owns what "local" means, so there is deliberately no `date.zone` config
 * field to drift against it.
 *
 * ```ts
 * import { createEngine, dateCalendarInZone } from "solve-engine";
 * const engine = createEngine({ calendar: dateCalendarInZone("Asia/Tokyo") });
 * ```
 *
 * It ships on the `Date` backend on purpose. `Temporal` is undefined on Node
 * 24 and in Safari, so "pass a `Temporal` backend" would put the zone out of
 * reach for most hosts today; `Temporal` stays an accuracy upgrade for the
 * ambiguous wall clocks around a daylight-saving transition, never a
 * prerequisite for naming a zone at all.
 *
 * A test, or any host that needs the same answer on every run, pins the clock
 * as well: `dateCalendarInZone("UTC", { now: () => Date.UTC(2026, 0, 1) })`
 * computes `today` as 1 January 2026 whatever the machine's clock says, with
 * no need to replace `Date.now` for the whole process.
 *
 * @param zone - An IANA zone name, e.g. `"Asia/Tokyo"`.
 * @param options - The clock to read; see {@link DateCalendarOptions}.
 * @returns A backend whose local zone is that one.
 * @throws A `DATE_ZONE_UNKNOWN` config error when this runtime's `Intl` does
 *   not know the zone. Refused here rather than per line, because a backend
 *   that cannot compute in the zone it was asked for must not quietly answer
 *   in another one. A `DATE_CLOCK_INVALID` config error when `options.now` is
 *   given and is not a function.
 */
export function dateCalendarInZone(zone: string, options: DateCalendarOptions = {}): CalendarBackend {
	if (typeof zone !== "string" || !isSupportedZone(zone)) {
		throw ErrorFactory.config(
			DatetimeZoneErrorCodes.DATE_ZONE_UNKNOWN,
			`dateCalendarInZone(${describeZone(zone)}) is not a time zone this runtime knows.${spacedZoneHint(zone)}`,
			{ zone: typeof zone === "string" ? zone : typeof zone },
		);
	}
	const clock = options?.now === undefined ? undefined : checkedClock(options.now, "dateCalendarInZone");
	return new ZonedDateCalendar(zone, clock);
}

/**
 * What {@link dateCalendarInZone} takes beside the zone.
 */
export interface DateCalendarOptions {
	/**
	 * The clock `now()` reads, in epoch milliseconds. Defaults to `Date.now`.
	 * Pin it to compute `today` and `now` on a fixed date. A clock that is not
	 * a function is refused when the backend is built; a reading that is not a
	 * moment in time (`NaN`, an infinity, past the range `Date` holds), or a
	 * clock that throws, is refused on the line that read it, both with
	 * `DATE_CLOCK_INVALID`. The `Temporal` backend's `now` is checked the same way.
	 */
	now?: () => number;
}

/** A zone as the refusal quotes it: a string in quotes, anything else by its type. */
function describeZone(zone: unknown): string {
	return typeof zone === "string" ? `"${zone}"` : `given ${zone === null ? "null" : typeof zone}, not a zone name,`;
}

/**
 * The hint for a zone that is known once the space around it is gone, which is
 * easy to paste and hard to see in a quoted name. Refused rather than trimmed,
 * because a backend guessing at its zone is what the refusal exists to stop.
 */
function spacedZoneHint(zone: unknown): string {
	if (typeof zone !== "string") return "";
	const trimmed = zone.trim();
	if (trimmed === zone || trimmed === "" || !isSupportedZone(trimmed)) return "";
	return ` The name has space around it; "${trimmed}" is one.`;
}
