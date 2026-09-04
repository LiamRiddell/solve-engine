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
