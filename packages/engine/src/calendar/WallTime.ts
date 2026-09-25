/**
 * A calendar day at a time of day, as an instant: what `2026-01-04 14:30` and
 * `3pm on 23 September 2026` mean (#692).
 *
 * The instant is found the way the ISO literal `2026-01-04T14:30` finds its
 * own, by writing the day and the time out as that literal and reading it
 * through the backend's ISO parser, so the spellings cannot answer
 * differently: a wall time in the hour the clocks skip or repeat lands where
 * the `T` literal's does.
 *
 * @module WallTime
 */

import type { CalendarBackend } from "./CalendarBackend";

/** Two digits, as the ISO spelling writes a month, day, hour or minute. */
const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * The instant a wall time names on the calendar day an instant falls on, in
 * the backend's zone.
 *
 * @param dayMs - Any instant on the day; its fields are read in the backend's zone.
 * @param seconds - Whole seconds since midnight, 0 to 86,399.
 * @param calendar - The backend the day is read in and the instant found through.
 * @returns Epoch milliseconds, or null when the day's year has no four-digit
 * ISO spelling or the seconds are not a time of day.
 */
export function wallTimeOn(dayMs: number, seconds: number, calendar: CalendarBackend): number | null {
	if (!Number.isInteger(seconds) || seconds < 0 || seconds >= 86_400) return null;
	const day = calendar.fields(dayMs);
	if (day.year < 0 || day.year > 9999) return null;
	const hh = Math.floor(seconds / 3600);
	const mm = Math.floor((seconds % 3600) / 60);
	const ss = seconds % 60;
	const iso =
		`${String(day.year).padStart(4, "0")}-${pad2(day.month0 + 1)}-${pad2(day.day)}` +
		`T${pad2(hh)}:${pad2(mm)}${ss === 0 ? "" : `:${pad2(ss)}`}`;
	const ms = calendar.parseIso8601(iso);
	return Number.isNaN(ms) ? null : ms;
}
