/**
 * Workday arithmetic under pressure: weekends, month ends, year ends, a
 * leap day, and a daylight-saving transition.
 *
 * `<date> + N workdays` is the one piece of date arithmetic in this engine
 * that walks a real calendar (`addBusinessDays()` steps a `Date` one day at
 * a time) rather than adding a fixed number of milliseconds. That makes it
 * the sub-area where the answers can be pinned exactly, so the cases below
 * are chosen to be ones a wrong implementation would get wrong: landing on
 * a Saturday, stepping over a month or year boundary mid-week, and crossing
 * the spring-forward Sunday that a millisecond-based implementation
 * mishandles.
 *
 * No public-holiday calendar is involved, which is a deliberate, documented
 * scope decision rather than an oversight. See `vm/VM.ts`'s
 * `addBusinessDays()`.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

/** Local midnight, matching how a date literal is built. */
function localMidnight(year: number, month: number, day: number): number {
	return new Date(year, month - 1, day).getTime();
}

/** Assert an expression lands exactly on the local midnight of a calendar date. */
function expectDate(source: string, year: number, month: number, day: number): void {
	const value = evaluate(source);
	expect(value.type).toBe(ValueType.Datetime);
	expect(value.toNumber()).toBe(localMidnight(year, month, day));
}

describe("adding workdays skips weekends", () => {
	test("Friday plus one workday is the following Monday", () => {
		// March 29 2024 was a Friday.
		expectDate("2024-03-29 + 1 workday", 2024, 4, 1);
	});

	test("from a Saturday and from a Sunday, both land on the same Monday", () => {
		expectDate("2024-03-30 + 1 workday", 2024, 4, 1);
		expectDate("2024-03-31 + 1 workday", 2024, 4, 1);
	});

	test("a full working week lands a calendar week later", () => {
		expectDate("2024-03-29 + 5 workdays", 2024, 4, 5);
	});

	test("zero workdays is the identity", () => {
		expectDate("2024-03-29 + 0 workdays", 2024, 3, 29);
	});

	test("adding then subtracting the same count round-trips from a weekday", () => {
		expectDate("2024-03-29 + 5 workdays - 5 workdays", 2024, 3, 29);
	});

	test("subtracting walks backwards over the weekend the same way", () => {
		expectDate("2024-03-29 - 5 workdays", 2024, 3, 22);
		expectDate("2024-04-01 - 1 workday", 2024, 3, 29);
		expectDate("2024-09-01 - 1 workday", 2024, 8, 30);
	});
});

describe("workdays across month, year and leap-day boundaries", () => {
	test("Wednesday February 28 2024 plus one workday is the leap day", () => {
		expectDate("2024-02-28 + 1 workday", 2024, 2, 29);
	});

	test("and plus two lands on March 1, stepping over the leap day", () => {
		expectDate("2024-02-28 + 2 workdays", 2024, 3, 1);
	});

	test("in a common year the same date steps straight to March 1", () => {
		// February 28 2023 was a Tuesday, so there is no weekend in the way.
		expectDate("2023-02-28 + 1 workday", 2023, 3, 1);
	});

	test("the leap day itself plus one workday is March 1", () => {
		expectDate("2024-02-29 + 1 workday", 2024, 3, 1);
	});

	test("a month end that falls on a Saturday jumps to the next month's Monday", () => {
		// August 31 2024 was a Saturday; the following Monday is in September.
		expectDate("2024-08-31 + 1 workday", 2024, 9, 2);
		expectDate("2024-08-30 + 1 workday", 2024, 9, 2);
	});

	test("a year boundary is not special", () => {
		// December 31 2024 was a Tuesday.
		expectDate("2024-12-31 + 1 workday", 2025, 1, 1);
	});

	test("a month's worth of workdays lands mid-week, not on a round date", () => {
		// January 1 2024 was a Monday. Twenty-two workdays is four whole weeks
		// plus two days: four weeks reaches Monday January 29, then Tuesday and
		// Wednesday.
		expectDate("2024-01-01 + 22 workdays", 2024, 1, 31);
	});
});

describe("workdays keep the time of day across a daylight-saving change", () => {
	// This is the interesting one. `addBusinessDays()` advances the calendar
	// day rather than adding 86,400,000 milliseconds, so it stays on local
	// midnight through a transition. In Europe/London the clocks went forward
	// on Sunday March 31 2024 and back on Sunday October 27 2024; in North
	// America the equivalents are March 10 and November 3. Every one of these
	// spans crosses at least one of those, and `localMidnight()` computes the
	// expectation the same way, so the assertion holds in every zone.
	test("across the northern spring transition", () => {
		expectDate("2024-03-08 + 1 workday", 2024, 3, 11);
		expectDate("2024-03-29 + 1 workday", 2024, 4, 1);
	});

	test("across the northern autumn transition", () => {
		expectDate("2024-11-01 + 1 workday", 2024, 11, 4);
		expectDate("2024-10-25 + 1 workday", 2024, 10, 28);
	});

	test("across the southern-hemisphere transitions", () => {
		// Australia's changes fall on the first Sunday of April and October.
		expectDate("2024-04-05 + 1 workday", 2024, 4, 8);
		expectDate("2024-10-04 + 1 workday", 2024, 10, 7);
	});
});

describe("counting workdays in a duration", () => {
	test("a whole number of weeks is exact regardless of where it starts", () => {
		expect(num("workdays in 1 week")).toBe(5);
		expect(num("workdays in 3 weeks")).toBe(15);
		expect(num("workdays in 4 weeks")).toBe(20);
	});

	test("a partial week is capped at five", () => {
		expect(num("workdays in 5 days")).toBe(5);
		expect(num("workdays in 6 days")).toBe(5);
		expect(num("workdays in 7 days")).toBe(5);
		expect(num("workdays in 8 days")).toBe(6);
		expect(num("workdays in 10 days")).toBe(8);
	});

	test("zero days is zero workdays", () => {
		expect(num("workdays in 0 days")).toBe(0);
	});

	test("a negative span mirrors the positive one exactly", () => {
		// The count used to be computed straight off a negative day total, so
		// Math.floor() borrowed a whole week and then handed the borrowed days
		// back through the remainder: -3 days answered -1 workday and -10 days
		// answered -6. A negative span is reachable from a subtraction or a
		// variable, not only from a typed literal.
		expect(num("workdays in -1 day")).toBe(-num("workdays in 1 day"));
		expect(num("workdays in -3 days")).toBe(-num("workdays in 3 days"));
		expect(num("workdays in -7 days")).toBe(-num("workdays in 7 days"));
		expect(num("workdays in -10 days")).toBe(-num("workdays in 10 days"));
		expect(num("workdays in -3 weeks")).toBe(-15);
	});

	test("a non-time unit is refused rather than counted", () => {
		expect(evaluate("workdays in 5 kg").type).toBe(ValueType.Error);
	});
});

describe("weekend and workday predicates", () => {
	test("Saturday and Sunday are the weekend, Monday is not", () => {
		// March 16 2024 was a Saturday.
		expect(evaluate("2024-03-16 is a weekend").value).toBe(true);
		expect(evaluate("2024-03-17 is a weekend").value).toBe(true);
		expect(evaluate("2024-03-18 is a weekend").value).toBe(false);
	});

	test("the workday predicate is the exact complement", () => {
		for (const date of ["2024-03-15", "2024-03-16", "2024-03-17", "2024-03-18"]) {
			expect(evaluate(`${date} is a workday`).value).toBe(!evaluate(`${date} is a weekend`).value);
		}
	});

	test("a leap day is judged by its weekday like any other date", () => {
		// February 29 2024 was a Thursday.
		expect(evaluate("2024-02-29 is a workday").value).toBe(true);
	});

	test("a far-future date is too", () => {
		// February 28 2100 is a Sunday.
		expect(evaluate("2100-02-28 is a weekend").value).toBe(true);
	});

	test("a duration is not a date, and is refused rather than read as an epoch", () => {
		expect(evaluate("90 days as weekday").type).toBe(ValueType.Error);
	});
});
