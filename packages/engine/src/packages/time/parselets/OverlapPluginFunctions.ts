import { Value, errorValue, stringValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import { utcMs } from "@solve-js/calendar/Gregorian";
import { formatTimeInZone, zonedWallClockToUtcMs, describeMinutes, dayShiftSuffix } from "../timezones/ZoneMath";
import { TimezoneErrorCodes, calendarDayOf, namedZonesFrom, type NamedZone } from "./TimezonePluginFunctions";

/** Plugin name for `overlap of <hours> in <zone> and <zone> [on <date>]`. */
export const HOURS_OVERLAP_FN = "hoursOverlap";

/** A stretch of time between two instants, in epoch milliseconds, start inclusive. */
type Span = readonly [start: number, end: number];

/**
 * How many days either side of the first place's day another place's hours
 * are looked for. Two zones are at most 26 hours apart (UTC-12 to UTC+14),
 * so a day either side already reaches every stretch that can meet the first
 * place's; two is margin, not a requirement.
 */
const NEIGHBOURING_DAYS = 2;

/**
 * The hours a place keeps on one of its calendar days, as the stretch of real
 * time they cover. Hours that end at or before they start run past midnight
 * into the next day, as `10pm to 6am` does.
 *
 * Each end is its own wall-clock reading, so a daylight-saving change inside
 * the hours makes the stretch an hour shorter or longer, which is what the
 * people working them live through.
 */
function hoursOn(
  day: { year: number; month0: number; day: number }, offsetDays: number,
  startMinutes: number, endMinutes: number, zoneRef: string, calendar: CalendarBackend,
): Span {
  const startDay = day.day + offsetDays;
  const endDay = endMinutes <= startMinutes ? startDay + 1 : startDay;
  return [
    zonedWallClockToUtcMs(day.year, day.month0, startDay, 0, startMinutes, zoneRef, calendar),
    zonedWallClockToUtcMs(day.year, day.month0, endDay, 0, endMinutes, zoneRef, calendar),
  ];
}

/** Sort stretches and join any that meet or overlap, so none is counted twice. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** `London, Paris and Tokyo`: names joined the way a sentence lists them. */
function listNames(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One shared stretch, read on every place's own clock: `London 2:00 PM to
 * 5:00 PM, New York 9:00 AM to 12:00 PM`. A place whose date differs from the
 * first place's at the start of the stretch carries the day shift, as a
 * conversion does.
 */
function describeSpan([start, end]: Span, zones: NamedZone[], calendar: CalendarBackend): string {
  const first = zones[0];
  return zones
    .map((zone) =>
      `${zone.label} ${formatTimeInZone(start, zone.zoneRef, calendar)} to ${formatTimeInZone(end, zone.zoneRef, calendar)}` +
      dayShiftSuffix(start, zone.zoneRef, first.zoneRef, calendar))
    .join(", ");
}

/**
 * `overlap of 9am to 5pm in London and New York on 23 September 2026` -> the
 * stretch of the day that falls inside those hours in every place named, read
 * on each place's own clock, with its length first: `3 hours: London 2:00 PM
 * to 5:00 PM, New York 9:00 AM to 12:00 PM`.
 *
 * Arguments: `[startMinutes, endMinutes, date, ...(zoneRef, label) per
 * place]`. The date is the `on` clause's value, or `now` when the line has
 * none.
 *
 * The day is the first place's. Its hours on that date are the starting
 * stretch, and each further place cuts it down to the part that falls inside
 * that place's own hours on any of its days, since a place on the far side of
 * the date line keeps its matching hours on its yesterday or its tomorrow:
 * Tokyo's morning is San Francisco's previous afternoon. Every end is read on
 * its own day's clock, so daylight saving is applied place by place and date
 * by date.
 *
 * Hours longer than twelve can meet another place's twice in one day, once at
 * each end; both stretches are given, and the length is their total. No shared
 * stretch at all is an answer rather than a fault, so it is said in words.
 */
export function hoursOverlapHandler(args: Value[], context?: LineExecutionContext): Value {
  const startMinutes = args[0].toNumber();
  const endMinutes = args[1].toNumber();
  const calendar = calendarOf(context);
  const day = calendarDayOf(args[2], calendar);
  if (day instanceof Value) return day;
  const zones = namedZonesFrom(args, 3);

  if (zones.length < 2) {
    return errorValue(
      TimezoneErrorCodes.OVERLAP_NEEDS_TWO_ZONES,
      `An overlap needs two or more places, as in "overlap of 9am to 5pm in London and New York"`,
    );
  }
  if (startMinutes === endMinutes) {
    const time = calendar.formatTimeInZone("UTC", utcMs(2000, 0, 1, 0, startMinutes));
    return errorValue(
      TimezoneErrorCodes.OVERLAP_HOURS_EMPTY,
      `${time} to ${time} has no length, so no time falls inside it`,
    );
  }

  let shared: Span[] = [hoursOn(day, 0, startMinutes, endMinutes, zones[0].zoneRef, calendar)];
  for (const zone of zones.slice(1)) {
    const next: Span[] = [];
    for (const [start, end] of shared) {
      for (let offset = -NEIGHBOURING_DAYS; offset <= NEIGHBOURING_DAYS; offset++) {
        const [hoursStart, hoursEnd] = hoursOn(day, offset, startMinutes, endMinutes, zone.zoneRef, calendar);
        const from = Math.max(start, hoursStart);
        const to = Math.min(end, hoursEnd);
        if (to > from) next.push([from, to]);
      }
    }
    shared = merge(next);
  }

  if (shared.length === 0) {
    return stringValue(`No overlap between ${listNames(zones.map((zone) => zone.label))}`);
  }
  const totalMinutes = Math.round(shared.reduce((sum, [start, end]) => sum + (end - start), 0) / 60000);
  return stringValue(`${describeMinutes(totalMinutes)}: ${shared.map((span) => describeSpan(span, zones, calendar)).join("; ")}`);
}
