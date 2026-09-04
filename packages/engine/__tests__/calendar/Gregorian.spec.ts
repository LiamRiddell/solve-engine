/**
 * The zone-free Gregorian arithmetic every calendar backend shares.
 *
 * `calendar/Gregorian.ts` holds the computations whose answer does not depend
 * on a time zone once the calendar fields are known: the instant a set of
 * fields names in UTC, a date's day number, the ISO week. They are pinned
 * here against fixed dates so a backend can rely on them without re-testing
 * them, and so the ISO week rule (Monday start, week 1 holds the first
 * Thursday) stays exactly what `<date> as week` has always answered.
 */

import { describe, expect, test } from "@jest/globals";
import { utcMs, daysInMonth, dayNumber, utcFields, isoWeekNumber } from "@solve-js/calendar/Gregorian";

describe("daysInMonth", () => {
	test("knows the leap rule, century rule included", () => {
		expect(daysInMonth(2024, 1)).toBe(29);
		expect(daysInMonth(2023, 1)).toBe(28);
		expect(daysInMonth(1900, 1)).toBe(28);
		expect(daysInMonth(2000, 1)).toBe(29);
		expect(daysInMonth(2024, 0)).toBe(31);
		expect(daysInMonth(2024, 3)).toBe(30);
		expect(daysInMonth(2024, 11)).toBe(31);
	});

	test("overflows the month into the adjacent year like Date", () => {
		expect(daysInMonth(2024, 12)).toBe(31);
		expect(daysInMonth(2025, -1)).toBe(31);
	});

	test("is the Date expression it replaced, two-digit years included", () => {
		// `new Date(y, m + 1, 0).getDate()` read a year from 0 to 99 as the
		// 1900s; so does `Date.UTC`, and the shared helper keeps that reading.
		for (const year of [24, 99, 1900, 2000, 2024, 2100]) {
			for (let month0 = 0; month0 < 12; month0++) {
				expect(daysInMonth(year, month0)).toBe(new Date(year, month0 + 1, 0).getDate());
			}
		}
	});
});

describe("utcMs", () => {
	test("is Date.UTC over the same fields", () => {
		expect(utcMs(2024, 0, 31, 10, 30)).toBe(Date.UTC(2024, 0, 31, 10, 30));
		expect(utcMs(2024, 1, 29)).toBe(Date.UTC(2024, 1, 29));
		expect(utcMs(1969, 11, 31, 23, 59, 59)).toBe(-1000);
	});
});

describe("dayNumber", () => {
	test("counts whole days from the epoch, negative before it", () => {
		expect(dayNumber(1970, 0, 1)).toBe(0);
		expect(dayNumber(1970, 0, 2)).toBe(1);
		expect(dayNumber(1969, 11, 31)).toBe(-1);
	});

	test("a difference of day numbers is a calendar day count, leap day included", () => {
		expect(dayNumber(2024, 2, 1) - dayNumber(2024, 1, 1)).toBe(29);
		expect(dayNumber(2023, 2, 1) - dayNumber(2023, 1, 1)).toBe(28);
		expect(dayNumber(2025, 0, 1) - dayNumber(2024, 0, 1)).toBe(366);
	});
});

describe("utcFields", () => {
	test("reads the UTC calendar fields of an instant", () => {
		expect(utcFields(Date.UTC(2024, 1, 29, 23, 59, 58))).toEqual({
			year: 2024, month0: 1, day: 29, hour: 23, minute: 59, second: 58,
		});
		expect(utcFields(0)).toEqual({ year: 1970, month0: 0, day: 1, hour: 0, minute: 0, second: 0 });
	});

	test("an unrepresentable instant reads as NaN in every field", () => {
		expect(Object.values(utcFields(Number.NaN)).every(Number.isNaN)).toBe(true);
	});
});

describe("isoWeekNumber", () => {
	test("week 1 is the week containing the first Thursday", () => {
		// 1 January 2024 was a Monday, so it opens week 1 outright.
		expect(isoWeekNumber(2024, 0, 1)).toBe(1);
		// 30 December 2024 was a Monday whose Thursday is 2 January 2025:
		// week 1 of the following year.
		expect(isoWeekNumber(2024, 11, 30)).toBe(1);
	});

	test("the first days of a year can belong to the previous year's last week", () => {
		// 1 January 2023 was a Sunday, the last day of 2022's week 52.
		expect(isoWeekNumber(2023, 0, 1)).toBe(52);
		// 2020 had 53 weeks; 3 January 2021 (a Sunday) closes the 53rd.
		expect(isoWeekNumber(2021, 0, 3)).toBe(53);
	});

	test("an ordinary mid-year date", () => {
		expect(isoWeekNumber(2026, 2, 10)).toBe(11);
		expect(isoWeekNumber(2024, 5, 15)).toBe(24);
	});
});
