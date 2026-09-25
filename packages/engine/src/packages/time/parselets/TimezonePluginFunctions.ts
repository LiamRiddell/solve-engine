import { Value, ValueType, datetimeValue, errorValue, stringValue } from "@solve-js/vm/Value";
import { wallTimeOn } from "@solve-js/calendar/WallTime";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import { utcMs } from "@solve-js/calendar/Gregorian";
import {
  formatTimeInZone, formatDateInZone, resolveOffsetMinutes,
  wallClockInstants, describeMinutes, dayShiftSuffix, zoneLabel,
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
/**
 * Plugin name for a clock time converted into several zones, or on a named
 * date: `3pm London on 23 September 2026 in Tokyo, New York and Sydney`.
 */
export const ZONE_CONVERT_AT_FN = "zoneConvertAt";
/** Plugin name for `time in <zone>`, the current wall clock there. */
export const TIME_IN_ZONE_FN = "timeInZone";
/** Plugin name for `date in <zone>`, which can differ from the local date. */
export const DATE_IN_ZONE_FN = "dateInZone";
/** Plugin name for the offset between two zones, as a duration. */
export const TIME_DIFFERENCE_FN = "timeDifference";
/** Plugin name for a clock time on a named day, `3pm on 23 September 2026`. */
export const CLOCK_TIME_ON_DATE_FN = "clockTimeOnDate";

/**
 * The codes the timezone forms refuse with, as Error values rather than
 * thrown errors: each is a well-formed line asking a question that has no
 * single answer.
 */
export const TimezoneErrorCodes = {
  /** `1:30am London on 29 March 2026 in Tokyo`: the clocks went forward over 1:30, so it never happened in London that day. */
  TIME_ZONE_SKIPPED_TIME: "TIME_ZONE_SKIPPED_TIME",
  /** `1:30am London on 25 October 2026 in Tokyo`: the clocks went back over 1:30, so it happened twice and names no one moment. */
  TIME_ZONE_REPEATED_TIME: "TIME_ZONE_REPEATED_TIME",
  /** `3pm London on 5 in Tokyo`, or `3pm on 5`: the `on` clause was given something that is not a date. */
  TIME_ZONE_EXPECTED_DATE: "TIME_ZONE_EXPECTED_DATE",
  /** `overlap of 9am to 5pm in London`: one place has nothing to overlap with. */
  OVERLAP_NEEDS_TWO_ZONES: "OVERLAP_NEEDS_TWO_ZONES",
  /** `overlap of 9am to 9am in London and Paris`: hours that start where they end have no length. */
  OVERLAP_HOURS_EMPTY: "OVERLAP_HOURS_EMPTY",
} as const;

/** A zone reference and the name the reader called it by, as a form's arguments carry them. */
export interface NamedZone {
  /** IANA zone identifier, or a fixed-offset encoding. See `ZoneMath.ts`. */
  zoneRef: string;
  /** The name as the reader typed it, title-cased. See `ZoneReference.ts`. */
  label: string;
}

/**
 * Read `(zoneRef, label)` pairs from a plugin call's arguments, from `start`
 * to the end. The parselets push each zone as those two strings, in the order
 * the reader wrote them.
 */
export function namedZonesFrom(args: Value[], start: number): NamedZone[] {
  const zones: NamedZone[] = [];
  for (let i = start; i + 1 < args.length; i += 2) {
    zones.push({ zoneRef: args[i].value as string, label: args[i + 1].value as string });
  }
  return zones;
}

/**
 * The calendar day an `on <date>` argument names, read in the backend's zone,
 * or the refusal when the argument is not a date at all.
 */
export function calendarDayOf(dateArg: Value, calendar: CalendarBackend): { year: number; month0: number; day: number } | Value {
  if (dateArg.type !== ValueType.Datetime) {
    return errorValue(
      TimezoneErrorCodes.TIME_ZONE_EXPECTED_DATE,
      `"on" takes a date, as in "on 23 September 2026"`,
    );
  }
  const f = calendar.fields(dateArg.toNumber());
  return { year: f.year, month0: f.month0, day: f.day };
}

/** A wall clock and a calendar day written out for a message: `1:30 AM` and `March 29, 2026`. */
function describeReading(year: number, month0: number, day: number, minutes: number, calendar: CalendarBackend): { time: string; date: string } {
  // Written through UTC so no zone's own transition can move the reading.
  return {
    time: calendar.formatTimeInZone("UTC", utcMs(year, month0, day, 0, minutes)),
    date: calendar.formatDateInZone("UTC", utcMs(year, month0, day)),
  };
}

/**
 * The one instant a wall-clock reading names in a zone, or the refusal when it
 * names none or two.
 *
 * A reading inside the hour the clocks skip, or the hour they repeat, is a
 * question with no single answer, so it is refused with the reason rather than
 * answered with a guess: the conversion would otherwise quietly move a meeting
 * by an hour on the one day it matters.
 */
function instantOfReading(
  year: number, month0: number, day: number, minutes: number,
  source: NamedZone, calendar: CalendarBackend,
): number | Value {
  const instants = wallClockInstants(year, month0, day, minutes, source.zoneRef, calendar);
  if (instants.length === 1) return instants[0];
  const { time, date } = describeReading(year, month0, day, minutes, calendar);
  return instants.length === 0
    ? errorValue(
      TimezoneErrorCodes.TIME_ZONE_SKIPPED_TIME,
      `${time} did not happen in ${source.label} on ${date}: the clocks went forward past it`,
    )
    : errorValue(
      TimezoneErrorCodes.TIME_ZONE_REPEATED_TIME,
      `${time} happened twice in ${source.label} on ${date}, when the clocks went back, so it names no single moment`,
    );
}

/**
 * `<clock-time> <sourceZone> in <targetZone>` -> targetZone's wall-clock
 * for that instant, e.g. "6pm Sydney in Chicago" -> "1:00 AM (-1 day)".
 * Anchored to today's (system-local) calendar date, matching
 * `ClockTimeParselet`'s own "today" convention for the bare (no zone)
 * form. A reading today's daylight-saving change skips or repeats in the
 * source zone is refused; see {@link instantOfReading}.
 */
export function zoneConvertHandler(args: Value[], context?: LineExecutionContext): Value {
  const totalMinutes = args[0].toNumber();
  const sourceZoneRef = args[1].value as string;
  const targetZoneRef = args[2].value as string;
  const calendar = calendarOf(context);

  const today = calendar.fields(calendar.now());
  const source = { zoneRef: sourceZoneRef, label: zoneLabel(sourceZoneRef) };
  const at = instantOfReading(today.year, today.month0, today.day, totalMinutes, source, calendar);
  if (typeof at !== "number") return at;

  return stringValue(formatTimeInZone(at, targetZoneRef, calendar) + dayShiftSuffix(at, targetZoneRef, sourceZoneRef, calendar));
}

/**
 * `<clock-time> <sourceZone> [on <date>] in <zone>, <zone> and <zone> [on
 * <date>]` -> the wall clock in each target zone at that instant.
 *
 * Arguments: `[minutes, sourceZoneRef, sourceLabel, date, ...(zoneRef,
 * label) per target]`. The date is the `on` clause's value, or `now` when the
 * line has none, so an undated line reads today exactly as
 * {@link zoneConvertHandler} does.
 *
 * One target answers as that form does, the time and any day shift. Several
 * answer as a list, each time labelled with the name the reader used, since a
 * bare column of times would leave the reader to count which is which. The day
 * shift is against the source zone's date, the day the reader named.
 */
export function zoneConvertAtHandler(args: Value[], context?: LineExecutionContext): Value {
  const totalMinutes = args[0].toNumber();
  const source: NamedZone = { zoneRef: args[1].value as string, label: args[2].value as string };
  const calendar = calendarOf(context);
  const day = calendarDayOf(args[3], calendar);
  if (day instanceof Value) return day;
  const targets = namedZonesFrom(args, 4);

  const at = instantOfReading(day.year, day.month0, day.day, totalMinutes, source, calendar);
  if (typeof at !== "number") return at;

  const readings = targets.map((target) =>
    formatTimeInZone(at, target.zoneRef, calendar) + dayShiftSuffix(at, target.zoneRef, source.zoneRef, calendar));
  if (targets.length === 1) return stringValue(readings[0]);
  return stringValue(targets.map((target, i) => `${target.label} ${readings[i]}`).join(", "));
}

/**
 * `3pm on 23 September 2026` -> that day at that time, the instant the ISO
 * literal `2026-09-23T15:00` names and with its wall-clock grain (#692), so
 * it goes wherever that literal goes: into a zone, a duration added, between
 * two dates.
 *
 * Arguments: `[minutes, date]`. A date that failed passes its error through;
 * anything else that is not a date is refused as the zone forms refuse it.
 */
export function clockTimeOnDateHandler(args: Value[], context?: LineExecutionContext): Value {
  if (args[1]?.type === ValueType.Error) return args[1];
  const calendar = calendarOf(context);
  if (args[1]?.type !== ValueType.Datetime) return calendarDayOf(args[1], calendar) as Value;
  const at = wallTimeOn(args[1].toNumber(), args[0].toNumber() * 60, calendar);
  if (at === null) {
    return errorValue(TimezoneErrorCodes.TIME_ZONE_EXPECTED_DATE, `"on" takes a date from the year 0 to 9999, as in "on 23 September 2026"`);
  }
  return datetimeValue(at, "datetime");
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
 * With `on <date>` (#697) both offsets are taken on that day instead, at noon
 * in the first place: a date names a day, not a moment, and on the day a place
 * changes its clocks the gap changes during it, so the answer states the
 * moment it read. Noon is clear of every clock change in use.
 *
 * Takes 4 args: [zoneRef1, zoneRef2, displayName1, displayName2], and a fifth,
 * the date, when the line has an `on` clause. The
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
  let at = calendar.now();
  let onDay = "";
  if (args.length > 4) {
    // A date that failed (`on 29 February 2027`) says why, rather than that it is not a date.
    if (args[4].type === ValueType.Error) return args[4];
    const day = calendarDayOf(args[4], calendar);
    if (day instanceof Value) return day;
    const noon = instantOfReading(day.year, day.month0, day.day, NOON_MINUTES, { zoneRef: zoneRef1, label: label1 }, calendar);
    if (typeof noon !== "number") return noon;
    at = noon;
    onDay = describeReading(day.year, day.month0, day.day, NOON_MINUTES, calendar).date;
  }

  const offset1 = resolveOffsetMinutes(zoneRef1, at, calendar);
  const offset2 = resolveOffsetMinutes(zoneRef2, at, calendar);
  const diff = offset2 - offset1;

  if (diff === 0) {
    return stringValue(onDay === ""
      ? `${label2} and ${label1} currently share the same UTC offset`
      : `${label2} and ${label1} share the same UTC offset on ${onDay}`);
  }
  const ahead = diff > 0 ? label2 : label1;
  const behind = diff > 0 ? label1 : label2;
  const gap = `${ahead} is ${describeMinutes(Math.abs(diff))} ahead of ${behind}`;
  return stringValue(onDay === "" ? gap : `${gap} on ${onDay}`);
}

/** Noon, as minutes after midnight: the moment a dated time difference reads its offsets at. */
const NOON_MINUTES = 720;
