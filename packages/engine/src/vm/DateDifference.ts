import { Value, uomValue } from "@solve-js/vm/Value";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { dayNumber } from "@solve-js/calendar/Gregorian";

/**
 * The difference between two calendar dates, as a count of days, or null when
 * either side is not a calendar date.
 *
 * `2026-12-25 - 2026-12-24` and `25/12/2026 - 24/12/2026` answered `24:00`: two
 * datetimes subtract to a span in milliseconds shown on a clock, which is the
 * right reading for `9:30 - 8:30` and for two moments, and the wrong one for two
 * days, where the question is how many days apart they are. A date written
 * without a time of day (grain `date`) names a whole day, so the difference of
 * two of them is now that many days, `1 day`, and goes on to whatever the line
 * does next (`in weeks`, `+ 2026-01-01`, `* 2`).
 *
 * Counted on the calendar rather than from the milliseconds, as `days between`
 * counts it, so a day the clocks change in (23 or 25 hours long) is still one
 * day: `31/03/2024 - 30/03/2024` is 1 day in London, not 0.96.
 *
 * The boundary: a side with a time of day (`now`, `2026-12-25 09:00`, a clock
 * time) keeps the elapsed span on a clock, since a time in the question asks
 * for the hours. A date read in a named zone is an instant and keeps it too.
 *
 * @param later - The left operand, the date subtracted from.
 * @param earlier - The right operand, the date taken away.
 * @param calendar - The engine's calendar, which reads each date's day.
 * @returns The signed day count as a quantity in days, or null.
 */
export function dateDifference(later: Value, earlier: Value, calendar: CalendarBackend): Value | null {
	if (later.grain !== "date" || earlier.grain !== "date") return null;
	const a = calendar.fields(later.toNumber());
	const b = calendar.fields(earlier.toNumber());
	const days = dayNumber(a.year, a.month0, a.day) - dayNumber(b.year, b.month0, b.day);
	return uomValue(days, Math.abs(days) === 1 ? "day" : "days");
}
