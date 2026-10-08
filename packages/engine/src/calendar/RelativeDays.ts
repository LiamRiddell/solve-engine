/**
 * Where a day named by its relation to today starts: `today`, `tomorrow`,
 * `next friday`, `3 days ago`.
 *
 * Every version of the engine has read these as the current instant moved by
 * whole days, so at noon `tomorrow` is noon tomorrow and `days until 25
 * december` counts the half of today already gone. That is a fair reading of a
 * clock, and the wrong one for a note that plans by the day, where `tomorrow`
 * is a date and `today + 3 weeks` should not carry the minute the line was
 * typed. A host chooses which its readers mean with `date.relativeDays`:
 *
 * - `'now'` (the default): the current instant, with its time of day, as
 *   before. Leaving the setting unset changes nothing.
 * - `'midnight'`: the start of the day, a date with no time of day, so
 *   `tomorrow` shows as a date and `days until` counts whole days.
 *
 * `now` is the current instant under both, and so is a span shorter than a day
 * (`2 hours ago`, `minutes until 5pm`), which is a question about the clock.
 *
 * @module RelativeDays
 */

import { DatetimeZoneErrorCodes } from "@solve-js/errors/ErrorCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";

/** Where a relative day starts: the current instant, or the start of the day. See the module note. */
export type RelativeDayAnchor = "now" | "midnight";

/** Every value `date.relativeDays` takes, in the order the refusal names them. */
export const RELATIVE_DAY_ANCHORS: readonly RelativeDayAnchor[] = ["now", "midnight"];

/**
 * The setting a host passed, checked, or the default when it passed none.
 *
 * Checked once, when the engine is built, rather than per line: a setting
 * quietly ignored is every relative date quietly showing the time the host
 * asked it not to.
 *
 * @param value - What `date.relativeDays` holds, typed or not.
 * @returns The anchor, `'now'` when unset.
 * @throws {EngineError} `DATE_RELATIVE_DAYS_INVALID` for anything else.
 */
export function resolveRelativeDays(value: unknown): RelativeDayAnchor {
	if (value === undefined) return "now";
	if (value === "now" || value === "midnight") return value;
	const shown = typeof value === "string" ? JSON.stringify(value) : typeof value;
	throw ErrorFactory.config(
		DatetimeZoneErrorCodes.DATE_RELATIVE_DAYS_INVALID,
		`date.relativeDays takes "now" or "midnight", and ${shown} is neither.`,
		{ setting: "date.relativeDays", value: typeof value === "string" ? value : typeof value },
	);
}

/**
 * The instant `today` stands for under `anchor`: the clock's reading for
 * `'now'`, and the local midnight that begins the current day for
 * `'midnight'`.
 *
 * Read from the backend's own clock and fields, so the day is the one the
 * engine computes in, whatever zone the host process runs in.
 *
 * @param calendar - The engine's calendar backend.
 * @param anchor - Where a relative day starts.
 * @returns Epoch milliseconds.
 */
export function relativeDayInstant(calendar: CalendarBackend, anchor: RelativeDayAnchor): number {
	const now = calendar.now();
	return anchor === "midnight" ? startOfDay(calendar, now) : now;
}

/**
 * The instant the local day holding `epochMs` begins: its local midnight, or
 * the first moment after it on a day whose midnight the zone skips (Chile and
 * Cuba spring forward at 00:00, so those days begin at 01:00).
 *
 * @param calendar - The engine's calendar backend, whose zone decides the day.
 * @param epochMs - Any instant on the day.
 * @returns Epoch milliseconds.
 */
export function startOfDay(calendar: CalendarBackend, epochMs: number): number {
	const day = calendar.fields(epochMs);
	return calendar.localMidnight(day.year, day.month0, day.day);
}

/**
 * Where a calendar day stepped by whole days lands: the start of the day it
 * reaches, when it began at the start of its own.
 *
 * Stepping a day keeps its wall clock, which is right for every day but one
 * kind. On a day whose midnight the zone skips, the day starts at 01:00, and
 * that hour was carried onto every day stepped to from it, so `tomorrow` read
 * as one in the morning. A day that did not begin at its start (`today + 2
 * hours`, then `+ 1 day`) keeps its time, since a time was asked for.
 *
 * @param calendar - The engine's calendar backend.
 * @param fromMs - The day before the step.
 * @param steppedMs - The same wall clock on the day reached.
 * @returns The instant to answer with.
 */
export function landOnDayStart(calendar: CalendarBackend, fromMs: number, steppedMs: number): number {
	return fromMs === startOfDay(calendar, fromMs) ? startOfDay(calendar, steppedMs) : steppedMs;
}
