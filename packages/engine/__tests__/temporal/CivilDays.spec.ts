/**
 * The civil-day arithmetic the `Temporal` backend normalises fields with,
 * measured against the `Date` it stands in for.
 *
 * `temporal/CivilDays.ts` is `Date`'s own `MakeDay` written out, so the
 * oracle is `Date` wherever `Date` can represent the date: `setUTCFullYear`,
 * which reads a year as written and rolls an overflowing day the same way.
 * Past that range only the round trip can be checked.
 */

import { describe, expect, test } from "@jest/globals";
import { civilDayNumber, civilFromDayNumber } from "@solve-js/temporal/CivilDays";

describe("the civil day arithmetic", () => {
	test("agrees with Date.UTC's day number wherever Date can represent the date", () => {
		const years = [-1000, -1, 0, 1, 99, 100, 400, 1582, 1600, 1700, 1800, 1900, 1969, 1970, 2000, 2024, 2100, 2400, 275000];
		for (const year of years) for (const month0 of [0, 1, 2, 5, 11]) for (const day of [1, 15, 28, 29, 31]) {
			// `setUTCFullYear` reads the year as written (no two-digit window)
			// and rolls an overflowing day the way MakeDay does, which is the
			// oracle the arithmetic must match.
			const expected = Math.floor(new Date(0).setUTCFullYear(year, month0, day) / 86_400_000);
			expect({ year, month0, day, n: civilDayNumber(year, month0, day) }).toEqual({ year, month0, day, n: expected });
		}
	});

	test("rolls an overflowing month or day the way MakeDay does", () => {
		expect(civilDayNumber(2024, 12, 1)).toBe(civilDayNumber(2025, 0, 1));
		expect(civilDayNumber(2024, -1, 1)).toBe(civilDayNumber(2023, 11, 1));
		expect(civilDayNumber(2024, 1, 0)).toBe(civilDayNumber(2024, 0, 31));
		expect(civilDayNumber(2023, 1, 30)).toBe(civilDayNumber(2023, 2, 2));
		expect(civilDayNumber(2024, 0, 1.9)).toBe(civilDayNumber(2024, 0, 1));
		expect(civilDayNumber(Number.NaN, 0, 1)).toBeNaN();
	});

	test("the day number round-trips to its date, past the range Date represents", () => {
		for (const days of [-1_000_000_000, -719_468, -1, 0, 1, 19_723, 100_000_000, 100_000_001]) {
			const civil = civilFromDayNumber(days);
			expect(civilDayNumber(civil.year, civil.month0, civil.day)).toBe(days);
		}
		expect(civilFromDayNumber(0)).toEqual({ year: 1970, month0: 0, day: 1 });
		expect(civilFromDayNumber(-719_468)).toEqual({ year: 0, month0: 2, day: 1 });
		expect(civilFromDayNumber(19_723)).toEqual({ year: 2024, month0: 0, day: 1 });
		expect(Object.values(civilFromDayNumber(Number.NaN)).every(Number.isNaN)).toBe(true);
	});
});
