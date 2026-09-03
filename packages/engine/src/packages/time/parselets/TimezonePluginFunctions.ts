import { Value, stringValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import {
  zonedWallClockToUtcMs, formatTimeInZone, formatDateInZone,
  dayShiftBetweenZones, resolveOffsetMinutes,
} from "../timezones/ZoneMath";

/**
 * Timezone plugin functions, registered via `pluginFunctions` (not
 * `VMBuiltins.ts`'s shared `builtinFunctions` registry), since this logic
 * is genuinely Time-package-specific (city/IANA-zone lookups), unlike the
 * generic math functions (`gcd`, `sqrt`, ...) that belong in the shared
 * registry. Matches `examples/osrs`'s `OsrsParselet.ts` pattern: a stable
 * package-local name per function, `CALL_PLUGIN` emitted by that name
 * (`builder.emitPluginCall(name, argCount)`) in the parselet, the actual
 * handler registered in `TimePackage.ts`'s `pluginFunctions` field.
 *
 * Each handler reads the clock and the zones through the calendar backend on
 * its execution context (`calendarOf(context)`), the engine's own.
 */

export const ZONE_CONVERT_FN = "zoneConvert";
/** Plugin name for `time in <zone>`, the current wall clock there. */
export const TIME_IN_ZONE_FN = "timeInZone";
/** Plugin name for `date in <zone>`, which can differ from the local date. */
export const DATE_IN_ZONE_FN = "dateInZone";
/** Plugin name for the offset between two zones, as a duration. */
export const TIME_DIFFERENCE_FN = "timeDifference";

/**
 * `<clock-time> <sourceZone> in <targetZone>` -> targetZone's wall-clock
 * for that instant, e.g. "6pm Sydney in Chicago" -> "1:00 AM (-1 day)".
 * Anchored to today's (system-local) calendar date, matching
 * `ClockTimeParselet`'s own "today" convention for the bare (no zone)
 * form.
 */
export function zoneConvertHandler(args: Value[], context?: LineExecutionContext): Value {
  const totalMinutes = args[0].toNumber();
  const sourceZoneRef = args[1].value as string;
  const targetZoneRef = args[2].value as string;
  const calendar = calendarOf(context);

  const today = calendar.fields(calendar.now());
  const utcMs = zonedWallClockToUtcMs(
    today.year, today.month0, today.day,
    Math.floor(totalMinutes / 60), totalMinutes % 60,
    sourceZoneRef, calendar,
  );

  const time = formatTimeInZone(utcMs, targetZoneRef, calendar);
  const dayShift = dayShiftBetweenZones(utcMs, targetZoneRef, sourceZoneRef, calendar);
  if (dayShift === 0) return stringValue(time);
  const sign = dayShift > 0 ? "+" : "";
  return stringValue(`${time} (${sign}${dayShift} day${Math.abs(dayShift) === 1 ? "" : "s"})`);
}

/** `time in <city>` -> that zone's current wall-clock time, e.g. "3:45 PM". */
export function timeInZoneHandler(args: Value[], context?: LineExecutionContext): Value {
  const zoneRef = args[0].value as string;
  const calendar = calendarOf(context);
  return stringValue(formatTimeInZone(calendar.now(), zoneRef, calendar));
}

/** `date in <city>` -> that zone's current calendar date, e.g. "July 31, 2026". */
export function dateInZoneHandler(args: Value[], context?: LineExecutionContext): Value {
  const zoneRef = args[0].value as string;
  const calendar = calendarOf(context);
  return stringValue(formatDateInZone(calendar.now(), zoneRef, calendar));
}

/**
 * `time difference between <city1> and <city2>` -> a directional,
 * human-readable offset delta, e.g. "Moscow is 8 hours ahead of Seattle".
 * Computed at the current instant, a zone's offset can shift across a
 * DST transition, so this is a live "right now" answer, not a fixed
 * constant.
 *
 * Takes 4 args: [zoneRef1, zoneRef2, displayName1, displayName2]. The
 * display names are the user's OWN typed text (see
 * `ZoneReference.ts`'s `displayName`), not derived from the resolved
 * zone, "Seattle" and "Los Angeles" both resolve to the same IANA zone
 * (`America/Los_Angeles`), and deriving the label from the zone id alone
 * would silently rename whichever one the user didn't type.
 */
export function timeDifferenceHandler(args: Value[], context?: LineExecutionContext): Value {
  const zoneRef1 = args[0].value as string;
  const zoneRef2 = args[1].value as string;
  const label1 = args[2].value as string;
  const label2 = args[3].value as string;
  const calendar = calendarOf(context);
  const now = calendar.now();

  const offset1 = resolveOffsetMinutes(zoneRef1, now, calendar);
  const offset2 = resolveOffsetMinutes(zoneRef2, now, calendar);
  const diff = offset2 - offset1;

  if (diff === 0) {
    return stringValue(`${label2} and ${label1} currently share the same UTC offset`);
  }
  const ahead = diff > 0 ? label2 : label1;
  const behind = diff > 0 ? label1 : label2;
  const absDiff = Math.abs(diff);
  const hours = Math.floor(absDiff / 60);
  const minutes = absDiff % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return stringValue(`${ahead} is ${parts.join(" ")} ahead of ${behind}`);
}
