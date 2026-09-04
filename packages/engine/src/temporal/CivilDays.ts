/**
 * The day arithmetic behind `Date`'s field normalisation, for the `Temporal`
 * backend.
 *
 * `Date` normalises a set of wall-clock fields before it resolves them in a
 * zone: month 13 rolls into the next year, day 0 into the month before, a
 * time past midnight into the next day, and only the final instant is
 * clipped to the range `Date` represents. That is the `MakeDay` and
 * `MakeTime` order of the ECMAScript specification, and a backend built on
 * another library has to follow it to answer what `Date` answers on the last
 * representable day and for a rolled-over literal. `Date` does this
 * arithmetic inside its own setters, where a second backend cannot reach it,
 * so it is written out here with nothing clipped.
 *
 * Under `temporal/` rather than `calendar/Gregorian.ts` because only the
 * `Temporal` backend needs it: the `Date` backend gets the same arithmetic
 * from `Date` itself, and keeping it here keeps it out of the root entry's
 * bundle. The unit spec measures it against `Date.UTC` and `setUTCFullYear`
 * wherever `Date` can represent the date.
 *
 * @module CivilDays
 */

/** A calendar date as year, zero-based month and day, the shape the civil-day arithmetic exchanges. */
export interface CivilDate {
	readonly year: number;
	/** Zero-based month: 0 is January, 11 is December. */
	readonly month0: number;
	/** Day of the month, from 1. */
	readonly day: number;
}

/**
 * The day number of a calendar date, counted from 1 January 1970, by
 * arithmetic alone: no `Date`, so no clip to the range `Date` represents.
 *
 * This is the `MakeDay` step of the ECMAScript specification, which a
 * backend needs unclipped: `Date` normalises a set of fields (month 13, day
 * 0, a time past midnight) before it resolves them in a zone and clips the
 * result, so a wall-clock time on the last representable day is an instant,
 * not `NaN`, and a backend built on another library must follow the same
 * order. An overflowing month or day rolls into the adjacent year or month,
 * as {@link utcMs}'s do, and a fractional field is truncated, as `Date`
 * truncates it.
 *
 * @param year - The calendar year, read as written.
 * @param month0 - Zero-based month; overflow rolls into the adjacent year.
 * @param day - Day of the month; overflow rolls into the adjacent month.
 * @returns Whole days since 1 January 1970, negative before it, or `NaN` when a field is not finite.
 */
export function civilDayNumber(year: number, month0: number, day: number): number {
	const y0 = Math.trunc(year);
	const m0 = Math.trunc(month0);
	const d = Math.trunc(day);
	if (!Number.isFinite(y0) || !Number.isFinite(m0) || !Number.isFinite(d)) return Number.NaN;
	// Normalise the month into the year first, then count from the first of
	// that month, so a day of 0 or 40 is a plain offset from a real month.
	const y = y0 + Math.floor(m0 / 12);
	const m = ((m0 % 12) + 12) % 12 + 1;
	// The days-from-civil arithmetic, with the year taken to start in March
	// so a leap day is the last day of the cycle rather than an exception.
	const shiftedYear = y - (m <= 2 ? 1 : 0);
	const era = Math.floor(shiftedYear / 400);
	const yearOfEra = shiftedYear - era * 400;
	const dayOfYear = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5);
	const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
	return era * 146_097 + dayOfEra - 719_468 + (d - 1);
}

/**
 * The calendar date of a day number, the inverse of {@link civilDayNumber}.
 *
 * @param days - Whole days since 1 January 1970, negative before it.
 * @returns The date, or `NaN` in every field when `days` is not finite.
 */
export function civilFromDayNumber(days: number): CivilDate {
	if (!Number.isFinite(days)) return { year: Number.NaN, month0: Number.NaN, day: Number.NaN };
	const z = Math.trunc(days) + 719_468;
	const era = Math.floor(z / 146_097);
	const dayOfEra = z - era * 146_097;
	const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365);
	const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
	const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
	const day = dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1;
	const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
	const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
	return { year, month0: month - 1, day };
}
