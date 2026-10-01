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
 * and no daylight-saving rule to consult. An offset the reader named after a
 * date (`in UTC-5`) is encoded as `"UTCNAMED:<minutes>"`, the same arithmetic
 * with one difference in how the date displays. {@link encodeFixedOffset},
 * {@link encodeNamedOffset}, {@link isFixedOffset}, {@link isNamedOffset} and
 * {@link decodeFixedOffsetMinutes} are the only code that knows the encoding
 * exists.
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
const NAMED_OFFSET_PREFIX = "UTCNAMED:";

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
 * Encode a fixed UTC offset the reader named as the zone to read a date in,
 * `2026-04-03T15:00 in UTC-5`.
 *
 * The same arithmetic as {@link encodeFixedOffset}, and every function here
 * treats the two alike, because an offset is an offset. They differ only in
 * what a date carrying one shows: an offset a reader named is the clock they
 * asked to see the answer on, as a named zone is, while an offset an ISO
 * literal carried (`...+09:00`) only records how the instant was written and
 * leaves the display in the engine's own zone. See {@link isNamedOffset}.
 *
 * @param offsetMinutes - Minutes ahead of UTC, negative behind it.
 * @returns The `"UTCNAMED:<minutes>"` reference.
 */
export function encodeNamedOffset(offsetMinutes: number): string {
	return `${NAMED_OFFSET_PREFIX}${offsetMinutes}`;
}

/**
 * Whether a zone reference is a fixed offset rather than a named IANA zone,
 * in either encoding.
 *
 * @param zoneRef - The reference to test.
 * @returns True for the `"UTCOFFSET:<minutes>"` and `"UTCNAMED:<minutes>"` forms.
 */
export function isFixedOffset(zoneRef: string): boolean {
	return zoneRef.startsWith(FIXED_OFFSET_PREFIX) || zoneRef.startsWith(NAMED_OFFSET_PREFIX);
}

/**
 * Whether a zone reference is a fixed offset the reader named, which a date
 * is shown in. See {@link encodeNamedOffset}.
 *
 * @param zoneRef - The reference to test.
 * @returns True for the `"UTCNAMED:<minutes>"` form only.
 */
export function isNamedOffset(zoneRef: string): boolean {
	return zoneRef.startsWith(NAMED_OFFSET_PREFIX);
}

/**
 * Read the minutes out of a fixed-offset zone reference.
 *
 * @param zoneRef - A reference {@link isFixedOffset} accepted.
 * @returns Minutes ahead of UTC, negative behind it.
 */
export function decodeFixedOffsetMinutes(zoneRef: string): number {
	const prefix = zoneRef.startsWith(NAMED_OFFSET_PREFIX) ? NAMED_OFFSET_PREFIX : FIXED_OFFSET_PREFIX;
	return parseInt(zoneRef.slice(prefix.length), 10);
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
 * Two passes, not one. The first offset has to be read at the naive instant
 * (the fields taken as if they were UTC), because the real instant is what is
 * being computed; that naive instant is wrong by the zone's own offset, so in a
 * zone far from UTC it can fall on the other side of a daylight-saving
 * transition from the reading itself. Measured: 22:30 on 4 April 2026 in
 * Auckland answered 10:30 UTC on a single pass, an hour late, because the naive
 * instant is thirteen hours on and lands past the transition at 14:00 UTC on
 * the 4th. Re-reading the offset at the first guess and using it when the two
 * disagree narrows the window from the size of the offset to the transition
 * itself.
 *
 * What remains is inherent to any offset-based approach without a full
 * transition-table walk: a wall clock a spring-forward skipped never happened,
 * and one a fall-back repeated happened twice, so the answer for those readings
 * is a choice rather than a fact. A `Temporal` backend's
 * `disambiguation: 'compatible'` may choose differently, and the
 * calendar-backends page says so.
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
	const naiveOffset = resolveOffsetMinutes(zoneRef, naiveUtcMs, calendar);
	const firstGuess = naiveUtcMs - naiveOffset * 60000;
	const refinedOffset = resolveOffsetMinutes(zoneRef, firstGuess, calendar);
	if (refinedOffset === naiveOffset) return firstGuess;

	// The two offsets disagree, so the reading sits near a transition. Taking
	// the refined one on trust moved the answer the wrong way in any zone
	// behind UTC: asking for 00:30 on a spring-forward morning in New York
	// landed on the previous day. Read each candidate back instead, and keep
	// the one that really shows the wall clock that was asked for.
	const secondGuess = naiveUtcMs - refinedOffset * 60000;
	const shows = (candidate: number): boolean =>
		candidate + resolveOffsetMinutes(zoneRef, candidate, calendar) * 60000 === naiveUtcMs;
	if (shows(firstGuess)) return firstGuess;
	if (shows(secondGuess)) return secondGuess;

	// Neither shows it, so the reading is one a spring-forward skipped: it
	// never happened. The later instant is the one past the transition, which
	// is the same choice `Temporal`'s `disambiguation: 'compatible'` makes,
	// so the two backends agree on a reading that is a choice either way.
	return Math.max(firstGuess, secondGuess);
}

/**
 * A named zone's offset from UTC at an instant, in milliseconds, to the
 * second: the zone's wall clock read back as if it were UTC, less the instant
 * with its own milliseconds set aside.
 *
 * Whole minutes are not enough before a zone adopted standard time. London
 * kept local mean time until 1847, 1 minute 15 seconds behind UTC, and a wall
 * clock resolved with the offset rounded to a minute landed 15 seconds before
 * midnight, on the day before the one asked for (#823).
 */
function offsetMsInZone(zone: string, epochMs: number): number {
	const f = zonedFields(zone, epochMs);
	const wholeSecond = epochMs - (((epochMs % 1000) + 1000) % 1000);
	return utcMs(f.year, f.month0, f.day, f.hour, f.minute, f.second) - wholeSecond;
}

/**
 * The UTC instant a wall-clock reading names in a named IANA zone, to the
 * second, in epoch milliseconds.
 *
 * The same two passes and the same choice for a skipped or repeated reading as
 * {@link zonedWallClockToUtcMs}, with the offset read to the second rather
 * than rounded to a minute, which is what the zone-bound `Date` backend needs
 * for the local mean times in force before standard time. A fixed-offset
 * reference has no such offsets and keeps the minute version.
 *
 * @param year - The calendar year, as written.
 * @param month0 - Zero-based month; overflow rolls into the adjacent year.
 * @param day - Day of the month; overflow rolls into the adjacent month.
 * @param hour - Hour of the day.
 * @param minute - Minute of the hour; overflow rolls into the adjacent hour.
 * @param zone - An IANA zone name `Intl` accepts.
 * @returns Epoch milliseconds, or `NaN` when a field is not finite or the
 *   instant is past the range `Date` holds.
 */
export function namedZoneWallClockToUtcMs(year: number, month0: number, day: number, hour: number, minute: number, zone: string): number {
	const naive = utcMs(year, month0, day, hour, minute, 0);
	if (!Number.isFinite(naive)) return Number.NaN;
	const offsetAt = (t: number): number => {
		try {
			return offsetMsInZone(zone, t);
		} catch {
			// Past the range `Intl` formats: the reading names no instant.
			return Number.NaN;
		}
	};
	const naiveOffset = offsetAt(naive);
	const firstGuess = naive - naiveOffset;
	const refinedOffset = offsetAt(firstGuess);
	if (Number.isNaN(naiveOffset) || Number.isNaN(refinedOffset)) return Number.NaN;
	if (refinedOffset === naiveOffset) return firstGuess;
	const secondGuess = naive - refinedOffset;
	const shows = (candidate: number): boolean => candidate + offsetAt(candidate) === naive;
	if (shows(firstGuess)) return firstGuess;
	if (shows(secondGuess)) return secondGuess;
	return Math.max(firstGuess, secondGuess);
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
		era: "short",
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit",
	});
	const parts: Record<string, string> = {};
	for (const p of dtf.formatToParts(epochMs)) parts[p.type] = p.value;
	// `Intl` writes the year of its era, so 975 BC comes back as 975, which
	// read as a number is AD 975 (#823). The formatter is pinned to `en-US`,
	// whose era before year 1 is `BC`, and the fields count astronomically as
	// `Date` does: 1 BC is year 0, 975 BC is year -974.
	const eraYear = +parts.year;
	const year = parts.era === "BC" ? 1 - eraYear : eraYear;
	return {
		year, month0: +parts.month - 1, day: +parts.day,
		hour: +parts.hour, minute: +parts.minute, second: +parts.second,
	};
}

/**
 * Midnight UTC on 1 January of year 1, the first day of the common era, in
 * epoch milliseconds. `Date.UTC` cannot be asked for it, since it reads year 1
 * as 1901.
 */
export const YEAR_ONE_UTC_MS = -62_135_596_800_000;

/**
 * Two days, the margin {@link mayPrecedeYearOne} allows either side of
 * {@link YEAR_ONE_UTC_MS}: more than any zone's offset from UTC, the
 * local mean times before standard time included.
 */
const ERA_MARGIN_MS = 2 * 86_400_000;

/**
 * Whether an instant could fall before year 1 in some zone, the cheap test a
 * formatter makes before it asks the zone which year it is. False for every
 * date since the second day of the common era, so a modern date pays one
 * comparison and no `Intl` call.
 *
 * @param epochMs - The instant.
 * @returns True within two days of the start of year 1 or before it, and
 *   false for `NaN`.
 */
export function mayPrecedeYearOne(epochMs: number): boolean {
	return epochMs < YEAR_ONE_UTC_MS + ERA_MARGIN_MS;
}

/**
 * The `Intl` options for a spelled-out date, `Tuesday, March 10, 2026` in
 * `en`, with the era added when the date is before year 1.
 *
 * A year before the common era is written as the year of that era, so 975 BC
 * is shown as `975`; without its era that reads as AD 975 (#823). The era is
 * asked for only then, because every other date has always been written with
 * none and adding `AD` to them would change every date a host shows.
 *
 * @param beforeYearOne - Whether the date falls before year 1 where it is read.
 * @returns The options, a fresh object each call.
 */
export function longDateOptions(beforeYearOne: boolean): Intl.DateTimeFormatOptions {
	const options: Intl.DateTimeFormatOptions = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
	if (beforeYearOne) options.era = "short";
	return options;
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
	// The era only before year 1, as the spelled-out date writes it; see longDateOptions.
	const beforeYearOne = mayPrecedeYearOne(epochMs) && zonedFields(zone, epochMs).year < 1;
	return formatter(zone, { year: "numeric", month: "long", day: "numeric", ...(beforeYearOne ? { era: "short" } : {}) }).format(epochMs);
}

/**
 * The spelled-out date a named zone shows for an instant, in a locale:
 * `Tuesday, March 10, 2026` in `en`, and `Saturday, March 10, 975 BC` for a
 * date before year 1 (see {@link longDateOptions}).
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
	const beforeYearOne = mayPrecedeYearOne(epochMs) && zonedFields(zone, epochMs).year < 1;
	return new Intl.DateTimeFormat(locale, { timeZone: zone, ...longDateOptions(beforeYearOne) }).format(epochMs);
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
