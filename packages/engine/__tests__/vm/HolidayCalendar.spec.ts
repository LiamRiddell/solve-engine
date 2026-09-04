/**
 * Resolving a host's holiday calendar to the VM's predicate.
 *
 * A host may hand over a function or a plain list of dates, in several date
 * shapes; `resolveHolidayPredicate()` collapses all of them to one
 * `(epochMs) => boolean`, taking the engine's calendar backend as its second
 * argument. These tests pin the two things that are easy to get
 * subtly wrong: that a `YYYY-MM-DD` string names its LOCAL calendar day (not a
 * UTC instant that shifts west of Greenwich), and that no calendar resolves to
 * `undefined` so the VM can tell "weekends-only" from "an empty calendar".
 */

import { describe, expect, test } from "@jest/globals";
import { resolveHolidayPredicate } from "@solve-js/vm/HolidayCalendar";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

/** Local midnight, the instant a date literal evaluates to. */
const ms = (year: number, month: number, day: number) => new Date(year, month - 1, day).getTime();

describe("resolveHolidayPredicate", () => {
	test("no calendar resolves to undefined (weekends-only)", () => {
		expect(resolveHolidayPredicate(undefined, DATE_CALENDAR)).toBeUndefined();
	});

	test("a predicate is wrapped to take an epoch", () => {
		const predicate = resolveHolidayPredicate((date) => date.getMonth() === 11 && date.getDate() === 25, DATE_CALENDAR);
		expect(predicate).toBeDefined();
		expect(predicate!(ms(2024, 12, 25))).toBe(true);
		expect(predicate!(ms(2024, 12, 24))).toBe(false);
	});

	test("a list of YYYY-MM-DD strings matches those local calendar days", () => {
		const predicate = resolveHolidayPredicate(["2024-12-25", "2024-12-26"], DATE_CALENDAR)!;
		expect(predicate(ms(2024, 12, 25))).toBe(true);
		expect(predicate(ms(2024, 12, 26))).toBe(true);
		expect(predicate(ms(2024, 12, 27))).toBe(false);
	});

	test("a string with a time component still matches on its date", () => {
		const predicate = resolveHolidayPredicate(["2024-12-25T09:30:00"], DATE_CALENDAR)!;
		expect(predicate(ms(2024, 12, 25))).toBe(true);
	});

	test("a matched string day holds at any time of that day", () => {
		const predicate = resolveHolidayPredicate(["2024-12-25"], DATE_CALENDAR)!;
		expect(predicate(ms(2024, 12, 25) + 18 * 60 * 60 * 1000)).toBe(true);
	});

	test("Date objects are accepted", () => {
		const predicate = resolveHolidayPredicate([new Date(2024, 11, 25)], DATE_CALENDAR)!;
		expect(predicate(ms(2024, 12, 25))).toBe(true);
		expect(predicate(ms(2024, 12, 24))).toBe(false);
	});

	test("epoch-millisecond numbers are accepted", () => {
		const predicate = resolveHolidayPredicate([ms(2024, 12, 25)], DATE_CALENDAR)!;
		expect(predicate(ms(2024, 12, 25))).toBe(true);
	});

	test("a Set (any iterable) is accepted", () => {
		const predicate = resolveHolidayPredicate(new Set(["2024-12-25"]), DATE_CALENDAR)!;
		expect(predicate(ms(2024, 12, 25))).toBe(true);
	});

	test("an empty list is a real, always-false calendar, not undefined", () => {
		const predicate = resolveHolidayPredicate([], DATE_CALENDAR);
		expect(predicate).toBeDefined();
		expect(predicate!(ms(2024, 12, 25))).toBe(false);
	});

	test("unreadable entries are dropped rather than throwing", () => {
		const predicate = resolveHolidayPredicate(["not-a-date", "2024-12-25", ""], DATE_CALENDAR)!;
		expect(predicate(ms(2024, 12, 25))).toBe(true);
		expect(predicate(ms(2024, 12, 24))).toBe(false);
	});
});
