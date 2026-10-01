/**
 * The time-zone answers as values (#757): a time in another zone, and the
 * difference between two places' clocks.
 *
 * Both used to be finished English text built inside the time package, which a
 * formatter could not localise and arithmetic could not use. A time in a zone
 * is now a `Datetime` with the time-of-day grain, held as the instant it names
 * and read in the zone (`Value.zone`), counted from the day the reader named
 * (`Value.timeAnchor`) and written to the minute (`Value.timePrecision`). A
 * difference is a signed duration in hours carrying the two places
 * (`Value.zoneDifference`).
 *
 * This module writes the English text each one stood for, exactly as the time
 * package wrote it: the formatter shows it under an English locale, and the VM
 * reads it where the old text was compared or joined (`== "7:00 PM"`, `"at " +
 * ...`), so a note written against the text keeps its answer. Nothing here
 * depends on a calendar backend: a zone answer always names its zone, and the
 * zone is read through `Intl`, which every backend's own zone reads share.
 */

import { Value, ValueType, type DatetimeGrain } from "@solve-js/vm/Value";
import type { CalendarBackend, ZonedFields } from "@solve-js/calendar/CalendarBackend";
import { decodeFixedOffsetMinutes, encodeNamedOffset, isFixedOffset, isNamedOffset, timeInZone, zonedFields, zonedWallClockToUtcMs } from "@solve-js/calendar/IntlZone";
import { utcFields, utcMs } from "@solve-js/calendar/Gregorian";

/** The grain a zone answer carries. */
const TIME_GRAIN: DatetimeGrain = "time";

/** Milliseconds in a day, for a day shift counted between two calendar dates. */
const DAY_MS = 86_400_000;

/**
 * A length of time in whole minutes, written the way the timezone forms write
 * one: `3 hours`, `1 hour 30 minutes`, `45 minutes`.
 *
 * @param totalMinutes - A non-negative whole number of minutes.
 * @returns The written length.
 */
export function describeMinutes(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
	if (minutes > 0 || hours === 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
	return parts.join(" ");
}

/**
 * A signed day shift as the timezone forms suffix it: ` (+1 day)`, ` (-2
 * days)`, or nothing for zero.
 *
 * @param shift - Whole days, positive when the clock is on a later day.
 * @returns The suffix with its leading space, or the empty string.
 */
export function dayShiftWords(shift: number): string {
	if (shift === 0 || !Number.isFinite(shift)) return "";
	return ` (${shift > 0 ? "+" : ""}${shift} day${Math.abs(shift) === 1 ? "" : "s"})`;
}

/**
 * The zone reference a zone answer is read in. A fixed offset the reader typed
 * as a place to convert into (`3pm London in GMT+8`) is the clock they asked to
 * see, so it is recorded as a named offset, the encoding the formatter shows
 * on that clock (see `calendar/IntlZone.ts`); every other reference is kept.
 *
 * @param zoneRef - The target zone reference from the parselet.
 * @returns The reference to record on the value.
 */
export function shownZone(zoneRef: string): string {
	if (isFixedOffset(zoneRef) && !isNamedOffset(zoneRef)) return encodeNamedOffset(decodeFixedOffsetMinutes(zoneRef));
	return zoneRef;
}

/**
 * The calendar fields a zone shows for an instant: a fixed offset by
 * arithmetic, a named zone through `fieldsInZone` when a backend is given and
 * `Intl` otherwise.
 *
 * @param epochMs - The instant.
 * @param zoneRef - A zone reference, named or fixed.
 * @param calendar - The backend whose zone reads to use, when there is one.
 * @returns The fields.
 */
export function fieldsShownIn(epochMs: number, zoneRef: string, calendar?: CalendarBackend): ZonedFields {
	if (isFixedOffset(zoneRef)) return utcFields(epochMs + decodeFixedOffsetMinutes(zoneRef) * 60000);
	return calendar === undefined ? zonedFields(zoneRef, epochMs) : calendar.fieldsInZone(zoneRef, epochMs);
}

/**
 * An instant on a calendar day as a zone counts it: noon there, which is clear
 * of every clock change in use, so the zone reads the instant as that day
 * whatever its offset does. A zone answer's `timeAnchor`.
 *
 * @param year - The calendar year.
 * @param month0 - Zero-based month.
 * @param day - Day of the month.
 * @param zoneRef - The zone the day is counted in.
 * @param calendar - The backend that resolves a named zone.
 * @returns The instant, in epoch milliseconds.
 */
export function noonOnDay(year: number, month0: number, day: number, zoneRef: string, calendar: CalendarBackend): number {
	if (isFixedOffset(zoneRef)) return utcMs(year, month0, day, 12) - decodeFixedOffsetMinutes(zoneRef) * 60000;
	return zonedWallClockToUtcMs(year, month0, day, 12, 0, zoneRef, calendar);
}

/**
 * Whether a value is a time in a zone as the timezone forms answer one: a
 * time of day, written to the minute, read in a zone.
 *
 * @param value - Any value.
 */
export function isZoneTime(value: Value): boolean {
	return value.type === ValueType.Datetime && value.grain === TIME_GRAIN && value.timePrecision === "minute" && typeof value.zone === "string";
}

/**
 * The whole days a time of day has moved from the day it is counted from, both
 * read in its zone: `+1` for Tokyo's 8 in the morning after an evening in
 * London. Zero when the value records no anchor or no zone.
 *
 * @param value - A Datetime.
 * @param calendar - The backend whose zone reads to use, when there is one.
 * @returns The signed shift.
 */
export function dayShiftOf(value: Value, calendar?: CalendarBackend): number {
	if (value.timeAnchor === undefined || typeof value.zone !== "string") return 0;
	const at = fieldsShownIn(value.toNumber(), value.zone, calendar);
	const from = fieldsShownIn(value.timeAnchor, value.zone, calendar);
	const shift = Math.round((utcMs(at.year, at.month0, at.day) - utcMs(from.year, from.month0, from.day)) / DAY_MS);
	return Number.isFinite(shift) ? shift : 0;
}

/**
 * A zone's wall clock to the minute in English, `7:00 PM`, as the timezone
 * forms have always written it.
 *
 * @param epochMs - The instant.
 * @param zoneRef - A zone reference, named or fixed.
 * @returns The time.
 */
export function clockInZone(epochMs: number, zoneRef: string): string {
	if (isFixedOffset(zoneRef)) return timeInZone("UTC", epochMs + decodeFixedOffsetMinutes(zoneRef) * 60000);
	return timeInZone(zoneRef, epochMs);
}

/**
 * The English text of a time in a zone, `7:00 PM` or `8:00 AM (+1 day)`, or
 * undefined for a value that is not one (see {@link isZoneTime}).
 *
 * @param value - Any value.
 * @param calendar - The backend whose zone reads to use for the day shift, when there is one.
 * @returns The text, or undefined.
 */
export function zoneTimeText(value: Value, calendar?: CalendarBackend): string | undefined {
	if (!isZoneTime(value)) return undefined;
	const at = value.toNumber();
	if (!Number.isFinite(at)) return undefined;
	try {
		return clockInZone(at, value.zone as string) + dayShiftWords(dayShiftOf(value, calendar));
	} catch {
		// A zone `Intl` cannot read (a restored snapshot naming one this runtime
		// lacks) has no text; the caller shows the value as it shows any other.
		return undefined;
	}
}

/**
 * The gap a zone difference holds, in whole minutes, positive when the second
 * place is ahead, or undefined for a value that is not one.
 *
 * Only a duration in hours that carries {@link Value.zoneDifference}: anything
 * else a sidecar might have been copied onto is shown as the quantity it is.
 *
 * @param value - Any value.
 * @returns The signed minutes, or undefined.
 */
export function zoneDifferenceMinutes(value: Value): number | undefined {
	if (value.type !== ValueType.Uom || value.zoneDifference === undefined || value.unit !== "hours") return undefined;
	const hours = value.value as number;
	if (!Number.isFinite(hours)) return undefined;
	// `|| 0` folds a negative zero, which has no direction to state.
	return Math.round(hours * 60) || 0;
}

/**
 * The English text of a zone difference, `Tokyo is 8 hours ahead of London`,
 * with the day it was read on after it when the line named one (`... on March
 * 1, 2027`, #697), or undefined for a value that is not one.
 *
 * @param value - Any value.
 * @returns The text, or undefined.
 */
export function zoneDifferenceText(value: Value): string | undefined {
	const minutes = zoneDifferenceMinutes(value);
	if (minutes === undefined || value.zoneDifference === undefined) return undefined;
	const { from, to, on } = value.zoneDifference;
	// A gap read on a named day (#697) says which day; the gap right now says
	// it is current.
	if (minutes === 0) return on === undefined ? `${to} and ${from} currently share the same UTC offset` : `${to} and ${from} share the same UTC offset on ${on}`;
	const ahead = minutes > 0 ? to : from;
	const behind = minutes > 0 ? from : to;
	const gap = `${ahead} is ${describeMinutes(Math.abs(minutes))} ahead of ${behind}`;
	return on === undefined ? gap : `${gap} on ${on}`;
}

/**
 * The English text a zone answer stood for, or undefined for any other value.
 *
 * @param value - Any value.
 * @returns The text the timezone forms answered before they answered values.
 */
export function zoneAnswerText(value: Value): string | undefined {
	if (value.type === ValueType.Datetime) return zoneTimeText(value);
	if (value.type === ValueType.Uom) return zoneDifferenceText(value);
	return undefined;
}

/**
 * For `==` and `!=` between text and a zone answer, whether the text is the
 * answer's English text, or null when the pair is not text and a zone answer.
 *
 * A note written while the answers were text compared them with text
 * (`(3pm London in Tokyo) == "11:00 PM"`), and keeps that answer.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @returns Whether the two read the same, or null.
 */
export function zoneAnswerEqualsText(l: Value, r: Value): boolean | null {
	if ((l.type === ValueType.String) === (r.type === ValueType.String)) return null;
	const [text, other] = l.type === ValueType.String ? [l, r] : [r, l];
	const written = zoneAnswerText(other);
	return written === undefined ? null : written === text.value;
}

/**
 * Text joined to a zone answer with `+`, as the English text the answer stood
 * for (`"at " + (3pm London in Tokyo)` is `at 11:00 PM`), or null when the
 * pair is not text and a zone answer.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @returns The joined text, or null.
 */
export function zoneAnswerJoinedText(l: Value, r: Value): string | null {
	if ((l.type === ValueType.String) === (r.type === ValueType.String)) return null;
	const other = l.type === ValueType.String ? r : l;
	const written = zoneAnswerText(other);
	if (written === undefined) return null;
	return l.type === ValueType.String ? (l.value as string) + written : written + (r.value as string);
}
