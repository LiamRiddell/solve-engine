/**
 * The pure calendar arithmetic behind the nth-weekday and age forms. Tested on
 * its own, with no engine, because it is where the calendar-awareness lives
 * (the leap cases, the borrow, the no-such-occurrence boundary) and a wrong
 * answer here is invisible through the grammar until someone hits the exact
 * date that exposes it.
 */

import { describe, expect, test } from "@jest/globals";
import {
	nthWeekdayOfMonth,
	lastWeekdayOfMonth,
	wholeYearsBetween,
	calendarBreakdown,
	monthAnchor,
} from "@solve-js/packages/datetime/DateArithmetic";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

/** A local-midnight epoch as a Y-M-D triple, for readable assertions. */
function ymd(ms: number | null): [number, number, number] | null {
	if (ms === null) return null;
	const d = new Date(ms);
	return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

describe("nthWeekdayOfMonth", () => {
	// March 2026: the 1st is a Sunday, so Tuesdays fall on 3, 10, 17, 24, 31.
	test("2nd Tuesday of March 2026 is the 10th", () => {
		expect(ymd(nthWeekdayOfMonth(2026, 2, 2, 2, DATE_CALENDAR))).toEqual([2026, 3, 10]);
	});

	test("1st Tuesday of March 2026 is the 3rd", () => {
		expect(ymd(nthWeekdayOfMonth(2026, 2, 2, 1, DATE_CALENDAR))).toEqual([2026, 3, 3]);
	});

	// November 2026: Thursdays are 5, 12, 19, 26.
	test("4th Thursday of November 2026 is the 26th", () => {
		expect(ymd(nthWeekdayOfMonth(2026, 10, 4, 4, DATE_CALENDAR))).toEqual([2026, 11, 26]);
	});

	test("a 5th occurrence the month does not have is null, never a wrap", () => {
		// April 2026 has four Fridays (3, 10, 17, 24), so no fifth.
		expect(nthWeekdayOfMonth(2026, 3, 5, 5, DATE_CALENDAR)).toBeNull();
	});

	test("a 5th occurrence the month does have resolves", () => {
		// March 2026 has five Tuesdays (3, 10, 17, 24, 31).
		expect(ymd(nthWeekdayOfMonth(2026, 2, 2, 5, DATE_CALENDAR))).toEqual([2026, 3, 31]);
	});
});

describe("lastWeekdayOfMonth", () => {
	test("last Friday of November 2026 is the 27th", () => {
		expect(ymd(lastWeekdayOfMonth(2026, 10, 5, DATE_CALENDAR))).toEqual([2026, 11, 27]);
	});

	test("last day-of-week that lands on the month's final day", () => {
		// 31 March 2026 is a Tuesday, so the last Tuesday is the 31st itself.
		expect(ymd(lastWeekdayOfMonth(2026, 2, 2, DATE_CALENDAR))).toEqual([2026, 3, 31]);
	});
});

describe("wholeYearsBetween", () => {
	const on = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

	test("a birthday already passed this year counts", () => {
		expect(wholeYearsBetween(on(1990, 6, 15), on(2026, 8, 26), DATE_CALENDAR)).toBe(36);
	});

	test("a birthday still to come this year does not count yet", () => {
		expect(wholeYearsBetween(on(1990, 6, 15), on(2026, 6, 14), DATE_CALENDAR)).toBe(35);
		expect(wholeYearsBetween(on(1990, 6, 15), on(2026, 6, 15), DATE_CALENDAR)).toBe(36);
	});

	test("a 29 February birth ticks over on 1 March in a non-leap year", () => {
		expect(wholeYearsBetween(on(2000, 2, 29), on(2025, 2, 28), DATE_CALENDAR)).toBe(24);
		expect(wholeYearsBetween(on(2000, 2, 29), on(2025, 3, 1), DATE_CALENDAR)).toBe(25);
	});
});

describe("calendarBreakdown", () => {
	const on = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

	test("years, months and days, borrowing where a field goes negative", () => {
		expect(calendarBreakdown(on(1990, 6, 15), on(2026, 8, 26), DATE_CALENDAR)).toEqual({ years: 36, months: 2, days: 11 });
	});

	test("a whole number of years is years with no months or days", () => {
		expect(calendarBreakdown(on(2020, 1, 1), on(2026, 1, 1), DATE_CALENDAR)).toEqual({ years: 6, months: 0, days: 0 });
	});

	test("borrowing a month's real length for the days", () => {
		// 31 Jan to 1 Mar (non-leap): one month and a day, not a negative day.
		expect(calendarBreakdown(on(2023, 1, 31), on(2023, 3, 1), DATE_CALENDAR)).toEqual({ years: 0, months: 1, days: 1 });
	});
});

describe("monthAnchor", () => {
	test("the first of the month, offset months away", () => {
		const august = new Date(2026, 7, 26).getTime();
		expect(ymd(monthAnchor(august, 1, DATE_CALENDAR))).toEqual([2026, 9, 1]); // next month
		expect(ymd(monthAnchor(august, 0, DATE_CALENDAR))).toEqual([2026, 8, 1]); // this month
		expect(ymd(monthAnchor(august, -1, DATE_CALENDAR))).toEqual([2026, 7, 1]); // last month
	});

	test("an offset that crosses a year boundary", () => {
		const december = new Date(2026, 11, 10).getTime();
		expect(ymd(monthAnchor(december, 1, DATE_CALENDAR))).toEqual([2027, 1, 1]);
	});
});
