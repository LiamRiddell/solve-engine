import type { ZonedFields } from "./CalendarBackend";

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
 * @module IntlZone
 */

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
