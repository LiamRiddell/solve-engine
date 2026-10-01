import { Value, ValueType, datetimeValue, errorValue, stringValue, uomValue } from "@solve-js/vm/Value";
import { wallTimeOn } from "@solve-js/calendar/WallTime";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import { utcMs } from "@solve-js/calendar/Gregorian";
import { valueKindName } from "@solve-js/vm/VMConversion";
import { formatDateInZone, resolveOffsetMinutes, wallClockInstants, zoneLabel } from "../timezones/ZoneMath";
import { fieldsShownIn, noonOnDay, shownZone, zoneTimeText } from "@solve-js/vm/ZoneAnswers";

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
/**
 * Plugin name for a time held in a variable, converted from the zone named
 * after it: `t London in Tokyo` with `t = 3pm`.
 */
export const ZONE_CONVERT_NAMED_FN = "zoneConvertNamed";
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
  /** `t London in Tokyo` where `t` holds something that is not a time (`t = 5`): a zone after a name converts the time of day it holds. */
  TIME_ZONE_EXPECTED_TIME: "TIME_ZONE_EXPECTED_TIME",
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
 * A time in a zone as the timezone forms answer one (#757): the instant, read
 * in the target zone, written to the minute, and counted from the day the
 * reader named in the source zone, so the formatter writes the day shift
 * (`8:00 AM (+1 day)`) and a duration added to it moves it as it moves any
 * time. Under an English locale it reads exactly as the text these forms used
 * to answer.
 *
 * @param at - The instant.
 * @param targetZoneRef - The zone it is shown in.
 * @param day - The day the reader named, in the source zone.
 * @param calendar - The backend that resolves a named zone.
 * @returns The Datetime.
 */
export function zoneTimeValue(at: number, targetZoneRef: string, day: { year: number; month0: number; day: number }, calendar: CalendarBackend): Value {
  // The anchor is noon on the reader's day as the target zone counts it, so
  // the shift the formatter reads in the target zone is against that day.
  const value = datetimeValue(at, "time", shownZone(targetZoneRef), noonOnDay(day.year, day.month0, day.day, targetZoneRef, calendar));
  value.timePrecision = "minute";
  return value;
}

/**
 * Several targets answer as one line of text, each time labelled with the name
 * the reader used: a labelled list is a reading, not a value to compute with.
 * Each reading is the English text one target's value stands for.
 */
function labelledReadings(at: number, targets: NamedZone[], day: { year: number; month0: number; day: number }, calendar: CalendarBackend): Value {
  return stringValue(targets.map((target) => `${target.label} ${zoneTimeText(zoneTimeValue(at, target.zoneRef, day, calendar), calendar) ?? ""}`).join(", "));
}

/**
 * `<clock-time> <sourceZone> in <targetZone>` -> targetZone's wall-clock
 * for that instant, e.g. "6pm Sydney in Chicago" -> "1:00 AM (-1 day)", as
 * a time in that zone (see {@link zoneTimeValue}).
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

  return zoneTimeValue(at, targetZoneRef, today, calendar);
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
 * One target answers as that form does, a time in that zone (see
 * {@link zoneTimeValue}). Several answer as a list of text, each time labelled with the name the reader used, since a
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

  if (targets.length === 1) return zoneTimeValue(at, targets[0].zoneRef, day, calendar);
  return labelledReadings(at, targets, day, calendar);
}

/**
 * `<time> <sourceZone> in <zone>, <zone> ...` for a time the reader holds in a
 * variable (`t London in Tokyo`, `t = 3pm`): the time's wall clock and day,
 * read as the source zone's, in each target zone.
 *
 * Arguments: `[time, sourceZoneRef, sourceLabel, ...(zoneRef, label) per
 * target]`. The wall clock is read in the engine's own zone, which is the
 * zone `3pm` and every other time of day is written in, so `t London` with
 * `t = 3pm` names the same moment as `3pm London`, and it answers as
 * {@link zoneConvertAtHandler} does, down to the day shift and the refusal of
 * a skipped or repeated reading. Seconds are not carried: a zone conversion
 * answers to the minute.
 *
 * A time that failed or is still loading is passed through as it came;
 * anything else that is not a time is refused by name.
 */
export function zoneConvertNamedHandler(args: Value[], context?: LineExecutionContext): Value {
  const time = args[0];
  if (time === undefined) return errorValue(TimezoneErrorCodes.TIME_ZONE_EXPECTED_TIME, "A zone after a name converts the time of day it holds, and there was no time before the zone.");
  if (time.type === ValueType.Error || time.type === ValueType.Pending) return time;
  if (time.type !== ValueType.Datetime) {
    return errorValue(
      TimezoneErrorCodes.TIME_ZONE_EXPECTED_TIME,
      `A zone after a name converts the time of day it holds, as in "t London in Tokyo" with t = 3pm, and this holds ${valueKindName(time)}.`,
    );
  }
  const calendar = calendarOf(context);
  // A time already shown in a zone (`t = 3pm London in Tokyo`) holds the wall
  // clock that zone shows; any other time holds the engine's own. A zone read
  // throws past the calendar's range, so that is checked first.
  const inRange = Math.abs(time.toNumber()) <= 8.64e15;
  const f = inRange && time.grain === "time" && typeof time.zone === "string"
    ? fieldsShownIn(time.toNumber(), time.zone, calendar)
    : calendar.fields(time.toNumber());
  if (!inRange || !Number.isFinite(f.year)) {
    return errorValue(TimezoneErrorCodes.TIME_ZONE_EXPECTED_TIME, "A zone after a name converts the time of day it holds, and this time is outside the calendar's range.");
  }
  const source: NamedZone = { zoneRef: args[1].value as string, label: args[2].value as string };
  const targets = namedZonesFrom(args, 3);
  const at = instantOfReading(f.year, f.month0, f.day, f.hour * 60 + f.minute, source, calendar);
  if (typeof at !== "number") return at;

  if (targets.length === 1) return zoneTimeValue(at, targets[0].zoneRef, f, calendar);
  return labelledReadings(at, targets, f, calendar);
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

/**
 * `time in <city>` -> that zone's current wall-clock time, e.g. "3:45 PM", as
 * a time in that zone counted from its own day, so it shows no day shift
 * until a duration moves it (#757).
 */
export function timeInZoneHandler(args: Value[], context?: LineExecutionContext): Value {
  const zoneRef = args[0].value as string;
  const now = calendarOf(context).now();
  const value = datetimeValue(now, "time", shownZone(zoneRef), now);
  value.timePrecision = "minute";
  return value;
}

/** `date in <city>` -> that zone's current calendar date, e.g. "July 31, 2026". */
export function dateInZoneHandler(args: Value[], context?: LineExecutionContext): Value {
  const zoneRef = args[0].value as string;
  const calendar = calendarOf(context);
  return stringValue(formatDateInZone(calendar.now(), zoneRef, calendar));
}

/**
 * `time difference between <city1> and <city2>` -> how far the second
 * place's clock is ahead of the first's, as a signed duration in hours that
 * carries the two places (`Value.zoneDifference`, #757), so it is shown as a
 * direction, e.g. "Moscow is 10 hours ahead of Seattle", and converts and adds
 * as a duration: `in hours` is `10 hours`, and `-10 hours` the other way
 * round. Computed at the current instant, a zone's offset can shift across a
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
  const value = uomValue((offset2 - offset1) / 60, "hours");
  value.zoneDifference = onDay === "" ? { from: label1, to: label2 } : { from: label1, to: label2, on: onDay };
  return value;
}

/** Noon, as minutes after midnight: the moment a dated time difference reads its offsets at. */
const NOON_MINUTES = 720;
