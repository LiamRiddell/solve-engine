/**
 * Timezone math over the calendar backend's named-zone reads (the native
 * `Intl.DateTimeFormat`/IANA data for the `Date` backend): zero external
 * dependency, DST-correct, and always as current as the runtime's own tz
 * database (no bundled table to go stale).
 *
 * A "zone reference" as used throughout this module is one of:
 * - A real IANA zone identifier (e.g. `"Australia/Sydney"`).
 * - A synthetic fixed-offset encoding, `"UTCOFFSET:<minutes>"` (e.g.
 *   `"UTCOFFSET:480"` for GMT+8), for the numeric `GMT+N`/`UTC-N` form
 *   which has no IANA identifier of its own and needs no DST awareness
 *   (a fixed offset is fixed, by definition).
 *
 * The encoding, and the wall-clock conversion built on it, now live in
 * `calendar/IntlZone.ts` and are re-exported below: the zone-bound `Date`
 * backend needs them and `calendar/` may not import from `packages/`. What
 * they do is unchanged, and every importer of this module keeps working.
 * `encodeFixedOffset`, `isFixedOffset` and `decodeFixedOffsetMinutes` are
 * still the only code that needs to know the encoding exists, everything
 * else just calls `resolveOffsetMinutes` and {@link zoneLabel}.
 *
 * Every function that reads a zone takes the {@link CalendarBackend} to read
 * it through, passed down from the plugin function's execution context. A
 * fixed offset needs no zone data at all: the instant is shifted by the
 * offset and read as UTC, which is zone-free arithmetic from
 * `calendar/Gregorian.ts`.
 */

import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { utcFields, utcMs } from "@solve-js/calendar/Gregorian";
import { decodeFixedOffsetMinutes, isFixedOffset } from "@solve-js/calendar/IntlZone";

/**
 * The zone-reference primitives, re-exported from where they now live.
 *
 * They moved to `calendar/IntlZone.ts` unchanged, because the zone-bound
 * `Date` backend needs them and `calendar/` may not import from `packages/`.
 * Re-exported here rather than removed so every existing importer of
 * `ZoneMath` (the time package's parselets and their tests) is untouched, and
 * so this module still reads as the one place the timezone forms compute in.
 */
export { encodeFixedOffset, resolveOffsetMinutes, zonedWallClockToUtcMs } from "@solve-js/calendar/IntlZone";

/** Format a UTC instant as `zoneRef`'s local wall-clock time, e.g. "1:00 AM". */
export function formatTimeInZone(atMs: number, zoneRef: string, calendar: CalendarBackend): string {
  if (isFixedOffset(zoneRef)) {
    // Shifted by the offset and written out as UTC: a fixed offset has no
    // zone data to consult.
    const offsetMs = decodeFixedOffsetMinutes(zoneRef) * 60000;
    return calendar.formatTimeInZone("UTC", atMs + offsetMs);
  }
  return calendar.formatTimeInZone(zoneRef, atMs);
}

/** Format a UTC instant as `zoneRef`'s local calendar date, e.g. "July 31, 2026". */
export function formatDateInZone(atMs: number, zoneRef: string, calendar: CalendarBackend): string {
  if (isFixedOffset(zoneRef)) {
    const offsetMs = decodeFixedOffsetMinutes(zoneRef) * 60000;
    return calendar.formatDateInZone("UTC", atMs + offsetMs);
  }
  return calendar.formatDateInZone(zoneRef, atMs);
}

/** The calendar (year, month0, day) `zoneRef` shows for a given instant. */
export function zonedYMD(atMs: number, zoneRef: string, calendar: CalendarBackend): { year: number; month0: number; day: number } {
  if (isFixedOffset(zoneRef)) {
    const d = utcFields(atMs + decodeFixedOffsetMinutes(zoneRef) * 60000);
    return { year: d.year, month0: d.month0, day: d.day };
  }
  const d = calendar.fieldsInZone(zoneRef, atMs);
  return { year: d.year, month0: d.month0, day: d.day };
}

/**
 * Signed whole-day difference between the calendar dates `zoneRef` and
 * `relativeToZoneRef` show for the SAME instant, e.g. +1 if `zoneRef`'s
 * date is one day ahead of `relativeToZoneRef`'s. Correctly handles
 * month/year boundaries (unlike naively diffing day-of-month numbers).
 */
export function dayShiftBetweenZones(atMs: number, zoneRef: string, relativeToZoneRef: string, calendar: CalendarBackend): number {
  const a = zonedYMD(atMs, zoneRef, calendar);
  const b = zonedYMD(atMs, relativeToZoneRef, calendar);
  const aMs = utcMs(a.year, a.month0, a.day);
  const bMs = utcMs(b.year, b.month0, b.day);
  return Math.round((aMs - bMs) / 86400000);
}

/**
 * Every instant a wall-clock reading names in a zone, earliest first.
 *
 * Almost always one. A daylight-saving change makes the other two answers
 * real: the hour the clocks jump over when they go forward never happens, so a
 * reading inside it names no instant, and the hour they repeat when they go
 * back happens twice, so a reading inside it names two. `zonedWallClockToUtcMs`
 * has to pick one answer for those readings and says so; this is for a form
 * that would rather refuse than pick.
 *
 * The candidates are the reading taken at each offset the zone has within a
 * day either side, and a candidate is kept only if the zone really shows the
 * reading at it. A day either side covers every transition near the reading,
 * because no zone changes its offset twice within two days. A fixed offset has
 * no transitions, so its one candidate is its answer.
 *
 * @param year - The calendar year.
 * @param month0 - Zero-based month.
 * @param day - Day of the month; overflow rolls into the adjacent month.
 * @param minutes - Minutes past midnight on the wall clock.
 * @param zoneRef - The zone the reading is in.
 * @param calendar - The backend that resolves a named zone.
 * @returns Zero, one or two instants, in epoch milliseconds.
 */
export function wallClockInstants(
  year: number, month0: number, day: number, minutes: number,
  zoneRef: string, calendar: CalendarBackend,
): number[] {
  const naive = utcMs(year, month0, day, 0, minutes, 0);
  if (isFixedOffset(zoneRef)) return [naive - decodeFixedOffsetMinutes(zoneRef) * 60000];
  const offsetAt = (atMs: number): number => calendar.zoneOffsetMinutes(zoneRef, atMs);
  const offsets = new Set([offsetAt(naive - 86400000), offsetAt(naive), offsetAt(naive + 86400000)]);
  const found: number[] = [];
  for (const offset of offsets) {
    const candidate = naive - offset * 60000;
    if (candidate + offsetAt(candidate) * 60000 === naive && !found.includes(candidate)) found.push(candidate);
  }
  return found.sort((a, b) => a - b);
}

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
 * The signed day shift a zone's date has against another's at one instant,
 * written as the timezone forms suffix it: ` (+1 day)`, ` (-1 day)`, or
 * nothing when the two dates agree.
 *
 * @param atMs - The instant.
 * @param zoneRef - The zone whose date is described.
 * @param relativeToZoneRef - The zone it is compared with.
 * @param calendar - The backend that resolves a named zone.
 * @returns The suffix, with its leading space, or the empty string.
 */
export function dayShiftSuffix(atMs: number, zoneRef: string, relativeToZoneRef: string, calendar: CalendarBackend): string {
  const shift = dayShiftBetweenZones(atMs, zoneRef, relativeToZoneRef, calendar);
  if (shift === 0) return "";
  const sign = shift > 0 ? "+" : "";
  return ` (${sign}${shift} day${Math.abs(shift) === 1 ? "" : "s"})`;
}

/**
 * A human-readable label for a zone reference, used in "time difference"
 * output. For a real IANA zone, the last path segment with underscores
 * replaced by spaces (e.g. `"Europe/Moscow"` -> `"Moscow"`,
 * `"America/Los_Angeles"` -> `"Los Angeles"`). For a fixed offset,
 * `"UTC+8"`/`"UTC-5"`.
 */
export function zoneLabel(zoneRef: string): string {
  if (isFixedOffset(zoneRef)) {
    const minutes = decodeFixedOffsetMinutes(zoneRef);
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    const hours = Math.floor(abs / 60);
    const mins = abs % 60;
    return mins === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(mins).padStart(2, "0")}`;
  }
  const lastSegment = zoneRef.split("/").pop() ?? zoneRef;
  return lastSegment.replace(/_/g, " ");
}
