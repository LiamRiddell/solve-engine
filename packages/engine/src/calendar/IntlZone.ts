import type { CalendarBackend, ZonedFields } from "./CalendarBackend";
import { utcMs } from "./Gregorian";

/**
 * Named-zone reads through `Intl.DateTimeFormat`, shared by every backend.
 *
 * `Intl` is the one place every supported runtime keeps the IANA time zone
 * database, so it is what the `Date` backend answers a named-zone question
 * with, and it is also what writes a zoned wall-clock time out in a locale for
 * the `Temporal` backend: `Temporal`'s own `toLocaleString` is `Intl`
 * underneath, and calling `Intl` directly with the zone keeps the two backends
 * on one formatting path, so the string a timezone form shows cannot depend on
 * which backend produced it.
 *
 * Every function here throws the runtime's own `RangeError` for a zone name it
 * does not know or an instant it cannot represent, which is the contract the
 * backend's named-zone methods state.
 *
 * ## The zone reference, and why the encoding lives here
 * A "zone reference" is either a real IANA identifier (`"Australia/Sydney"`) or
 * the synthetic fixed-offset form `"UTCOFFSET:<minutes>"`, which the numeric
 * `GMT+N`/`UTC-N` spelling needs because it has no IANA identifier of its own
 * and no daylight-saving rule to consult. {@link encodeFixedOffset},
 * {@link isFixedOffset} and {@link decodeFixedOffsetMinutes} are the only code
 * that knows the encoding exists.
 *
 * The encoding and {@link zonedWallClockToUtcMs} were written in the time
 * package (`packages/time/timezones/ZoneMath.ts`, which still re-exports every
 * one of them, so nothing that imported them there changed). They moved here
 * because the zone-bound `Date` backend needs them and `calendar/` may not
 * import from `packages/`: a backend reaching into an optional package for its
 * own arithmetic is the cycle the layering rule in `engine/EngineContext.ts`
 * exists to prevent.
 *
 * @module IntlZone
 */

const FIXED_OFFSET_PREFIX = "UTCOFFSET:";

/**
 * Encode a fixed UTC offset as a zone reference.
 *
 * @param offsetMinutes - Minutes ahead of UTC, negative behind it.
 * @returns The `"UTCOFFSET:<minutes>"` reference.
 */
export function encodeFixedOffset(offsetMinutes: number): string {
	return `${FIXED_OFFSET_PREFIX}${offsetMinutes}`;
}

/**
 * Whether a zone reference is a fixed offset rather than a named IANA zone.
 *
 * @param zoneRef - The reference to test.
 * @returns True for the `"UTCOFFSET:<minutes>"` form.
 */
export function isFixedOffset(zoneRef: string): boolean {
	return zoneRef.startsWith(FIXED_OFFSET_PREFIX);
}

/**
 * Read the minutes out of a fixed-offset zone reference.
 *
 * @param zoneRef - A reference {@link isFixedOffset} accepted.
 * @returns Minutes ahead of UTC, negative behind it.
 */
export function decodeFixedOffsetMinutes(zoneRef: string): number {
	return parseInt(zoneRef.slice(FIXED_OFFSET_PREFIX.length), 10);
}

/**
 * The UTC offset a zone reference has AT a given instant, in minutes,
 * positive when ahead of UTC.
 *
 * A fixed offset is its own answer. A named zone is resolved through the
 * backend, so a `Temporal` backend answers with `Temporal`'s zone data rather
 * than the `Date` backend's `Intl` round trip.
 *
 * @param zoneRef - An IANA name or a fixed-offset reference.
 * @param atMs - The instant to read the offset at.
 * @param calendar - The backend that resolves a named zone.
 * @returns The offset in minutes.
 */
export function resolveOffsetMinutes(zoneRef: string, atMs: number, calendar: CalendarBackend): number {
	if (isFixedOffset(zoneRef)) return decodeFixedOffsetMinutes(zoneRef);
	return calendar.zoneOffsetMinutes(zoneRef, atMs);
}

/**
 * The UTC instant a wall-clock reading names when read as local time in a
 * zone reference, in epoch milliseconds.
 *
 * Single-pass rather than iteratively refined against the daylight-saving
 * transition it might land in: the standard simplification every comparable
 * "convert this local time to another zone" tool makes, and it only matters
 * within the hour or two around a transition instant, which is inherent to any
 * offset-based approach without a full transition-table walk.
 *
 * @param year - The calendar year.
 * @param month0 - Zero-based month; overflow rolls into the adjacent year.
 * @param day - Day of the month; overflow rolls into the adjacent month.
 * @param hour - Hour of the day.
 * @param minute - Minute of the hour; overflow rolls into the adjacent hour.
 * @param zoneRef - The zone the reading is in.
 * @param calendar - The backend that resolves a named zone.
 * @returns Epoch milliseconds.
 */
export function zonedWallClockToUtcMs(
	year: number, month0: number, day: number, hour: number, minute: number,
	zoneRef: string, calendar: CalendarBackend,
): number {
	const naiveUtcMs = utcMs(year, month0, day, hour, minute, 0);
	const offsetMinutes = resolveOffsetMinutes(zoneRef, naiveUtcMs, calendar);
	return naiveUtcMs - offsetMinutes * 60000;
}

/**
 * Whether this runtime's `Intl` can format in a named zone.
 *
 * Asked once, at the point a host names a zone, so a backend that cannot
 * compute in the zone it was given refuses there rather than answering in
 * another one per line.
 *
 * @param zone - An IANA zone name.
 * @returns True when `Intl` accepts the name.
 */
export function isSupportedZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** An `en-US` formatter for a zone, the style the timezone forms answer in. */
function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options });
}

/**
 * The calendar date and wall-clock time a named zone shows for an instant.
 *
 * @param zone - An IANA zone name.
 * @param epochMs - The instant.
 * @returns The zone's fields, with a zero-based month.
 */
export function zonedFields(zone: string, epochMs: number): ZonedFields {
	// `h23` so midnight reads as hour 0 rather than 24.
	const dtf = formatter(zone, {
		hourCycle: "h23",
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit",
	});
	const parts: Record<string, string> = {};
	for (const p of dtf.formatToParts(epochMs)) parts[p.type] = p.value;
	return {
		year: +parts.year, month0: +parts.month - 1, day: +parts.day,
		hour: +parts.hour, minute: +parts.minute, second: +parts.second,
	};
}

/**
 * The wall-clock time in a named zone, `1:00 AM`, in the `en-US` style the
 * timezone forms answer in.
 *
 * @param zone - An IANA zone name.
 * @param epochMs - The instant.
 * @returns The formatted time.
 */
export function timeInZone(zone: string, epochMs: number): string {
	return formatter(zone, { hour: "numeric", minute: "2-digit", hour12: true }).format(epochMs);
}

/**
 * The calendar date in a named zone, `July 31, 2026`, in the `en-US` style
 * the timezone forms answer in.
 *
 * @param zone - An IANA zone name.
 * @param epochMs - The instant.
 * @returns The formatted date.
 */
export function dateInZone(zone: string, epochMs: number): string {
	return formatter(zone, { year: "numeric", month: "long", day: "numeric" }).format(epochMs);
}

/**
 * The spelled-out date a named zone shows for an instant, in a locale:
 * `Tuesday, March 10, 2026` in `en`.
 *
 * The zone-bound counterpart of `CalendarBackend.formatLongDate`, which reads
 * the backend's own zone. Separate from {@link dateInZone} because that one is
 * pinned to `en-US` for the timezone forms, while this follows the locale the
 * engine was asked to display in.
 *
 * @param zone - An IANA zone name.
 * @param epochMs - The instant.
 * @param locale - The BCP-47 tag to spell the date in.
 * @returns The formatted date.
 */
export function longDateInZone(zone: string, epochMs: number, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		timeZone: zone, weekday: "long", year: "numeric", month: "long", day: "numeric",
	}).format(epochMs);
}

/**
 * The time of day a named zone shows for an instant, in a locale:
 * `9:30:00 AM` in `en`.
 *
 * The zone-bound counterpart of `CalendarBackend.formatTimeOfDay`. The three
 * fields are all `numeric` because that is what `toLocaleTimeString()` with no
 * options requests, and the two spellings have to agree: measured, `en-GB`
 * gives `09:30:05` both ways, where a `2-digit` minute and second would give
 * `9:30:05`.
 *
 * @param zone - An IANA zone name.
 * @param epochMs - The instant.
 * @param locale - The BCP-47 tag to write the time in.
 * @returns The formatted time.
 */
export function timeOfDayInZone(zone: string, epochMs: number, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		timeZone: zone, hour: "numeric", minute: "numeric", second: "numeric",
	}).format(epochMs);
}
