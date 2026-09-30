import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";

/**
 * Moving a moment by a length of time the way a calendar does: months and
 * years by the month field, whole days by the day field, so a daylight-saving
 * change or a short month does not put the answer on the wrong date.
 *
 * Shared by the VM's `<date> + <duration>` and by a sweep that steps a date
 * (`line 3 for start from 2026-01-01 to 2026-06-01 step 1 month`, #744), so
 * both land on the same dates.
 */

/** Milliseconds in a day of 24 hours, for the fractional part of a day step. */
const MS_PER_DAY = 86_400_000;

/**
 * How many calendar months one of these units spans.
 *
 * The unit table gives a month and a year fixed lengths (2,592,000 and
 * 31,536,000 seconds, i.e. exactly 30 and 365 days). Those ratios are correct
 * for pure duration arithmetic, which is why they are left alone: `2 years in
 * days` genuinely is 730 days, and other code depends on that. They are not
 * correct for landing on a calendar date, because a real month is 28 to 31
 * days and a real year is 365 or 366, so no single ratio can put "a year after
 * January 1 2024" on January 1 2025 (linearly it lands on December 31 2024,
 * a day early, and drifts further with every year added).
 *
 * Every unit named here is therefore shifted with `setMonth()` instead, by
 * this many months. Everything not named here keeps whatever the table says.
 */
export const CALENDAR_MONTHS_PER_UNIT: Record<string, number> = {
    month: 1, months: 1, mo: 1,
    year: 12, years: 12, yr: 12, y: 12, a: 12,
    decade: 120, decades: 120, dec: 120,
    century: 1200, centuries: 1200,
    millennium: 12000, millennia: 12000,
};

/**
 * Move `epochMs` by `days` calendar days, holding the local wall-clock time.
 *
 * Stepping the day field is the whole point, the same reason the VM's
 * addBusinessDays() does it. A day is only 86,400,000 ms when no
 * daylight-saving transition falls inside it: the day a zone springs forward
 * is 23 hours long and the day it falls back is 25. Adding a flat 86,400,000
 * across either one lands an hour off, and an hour off a local midnight is a
 * different calendar day, so `2024-11-03 + 1 day` answered November 3 again
 * in Los Angeles and `26/10/2024 + 2 days` answered October 27 in London.
 * The calendar backend moves the day field and recomputes the offset (see
 * `CalendarBackend.addDays`), so the answer is the day the user named in
 * every zone.
 */
export function addCalendarDays(epochMs: number, days: number, calendar: CalendarBackend): number {
    const whole = Math.trunc(days);
    const shifted = calendar.addDays(epochMs, whole);
    // A shift far enough out to leave the range a Date can represent gives an
    // Invalid Date. Falling back to the linear arithmetic hands back the same
    // out-of-range number as before rather than turning it into a NaN here.
    if (Number.isNaN(shifted)) return epochMs + days * MS_PER_DAY;
    // A fractional part is elapsed time, not a calendar step ("1.5 days" is a
    // day and then twelve hours), so it is added as milliseconds.
    return shifted + (days - whole) * MS_PER_DAY;
}

/**
 * Move `epochMs` by `months` calendar months, clamping to the end of the month
 * it lands in: January 31 plus a month is February 28, or February 29 in a leap
 * year, and never March.
 *
 * The clamp lives in `CalendarBackend.addMonths`, which parks the day on the
 * 1st before the month field moves. A bare month step keeps the day number,
 * so the 31st of a month whose target has 30 days overflows into the month
 * after it, which is how `2024-01-31 + 1 month` answered March 1 and
 * `2024-03-31 - 1 month` answered March 1 as well. Clamping is what every
 * calendar application does with this case, and it is the only choice that
 * keeps the month the user asked for.
 */
export function addCalendarMonths(epochMs: number, months: number, calendar: CalendarBackend): number {
    const whole = Math.trunc(months);
    const shifted = calendar.addMonths(epochMs, whole);
    // A leftover fraction of a month names no calendar date of its own, so it
    // falls back to the table's fixed-length month. Same overflow reasoning as
    // addCalendarDays() above for the NaN case.
    const monthMs = convertUnit(1, "month", "ms");
    if (Number.isNaN(shifted)) return epochMs + months * monthMs;
    return shifted + (months - whole) * monthMs;
}

/**
 * `epochMs` moved by `amount` of `unit` on the calendar, or undefined when the
 * unit is not one the calendar steps: a month, a year and their multiples move
 * the month field (clamped to the month's last day), and a time unit that is a
 * whole number of days (a day, a week, a fortnight) moves the day field,
 * keeping the wall-clock time. A shorter time unit, a workday and a unit that
 * is not a time are left to the caller.
 *
 * @param epochMs - The moment to move.
 * @param amount - How many of `unit`, signed.
 * @param unit - The unit, as written.
 * @param calendar - The calendar backend to step through.
 * @returns The moved moment, or undefined.
 */
export function shiftByCalendarUnit(epochMs: number, amount: number, unit: string, calendar: CalendarBackend): number | undefined {
    // An own-property read: the unit is a word the reader typed, and the table
    // is a plain object.
    const monthsPerUnit = Object.prototype.hasOwnProperty.call(CALENDAR_MONTHS_PER_UNIT, unit) ? CALENDAR_MONTHS_PER_UNIT[unit] : undefined;
    if (monthsPerUnit !== undefined) return addCalendarMonths(epochMs, amount * monthsPerUnit, calendar);

    // Measure first: a unit that is not a duration at all has to contribute
    // nothing rather than be rescued by a lenient conversion.
    if (getMeasure(unit) === "time") {
        // Whether a unit is a whole number of days is read out of the unit
        // table rather than listed here, so weeks and fortnights are covered
        // by the same rule as days. Sub-day units fail the test and are left
        // to the caller's linear path, which is what they want.
        let daysPerUnit = 0;
        try { daysPerUnit = convertUnit(1, unit, "day"); } catch { /* Ignore */ }
        if (Number.isInteger(daysPerUnit) && daysPerUnit >= 1) {
            return addCalendarDays(epochMs, amount * daysPerUnit, calendar);
        }
    }
    return undefined;
}
