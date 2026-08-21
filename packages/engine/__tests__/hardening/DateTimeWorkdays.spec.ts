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
 * The blocks up to "weekend and workday predicates" configure no calendar, so
 * they pin the weekends-only default. The last two blocks then add the natural-
 * language offset/`between` grammar and a host holiday calendar, which is the
 * feature this file's default cases are the baseline for. See `vm/VM.ts`'s
 * `addBusinessDays()` and `constants/Configuration.ts`'s `date.holidays`; the
 * skipping logic itself is unit-tested in `__tests__/vm/BusinessDays.spec.ts`.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { HolidayCalendar } from "@solve-js/constants/Configuration";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

/** Evaluate against an engine that has a host holiday calendar configured. */
function evaluateWithHolidays(source: string, holidays: HolidayCalendar) {
	const engine = newTrackedEngine("en", false, { date: { holidays } } as never);
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

describe("N working days after/before/from a date, in words", () => {
	test("the words spell out exactly the same offset as the arithmetic form", () => {
		// The whole point of the natural-language form: it must agree with
		// `<date> + N workdays` to the millisecond, so both walk one calendar.
		expectDate("5 working days after 2024-03-29", 2024, 4, 5);
		expect(num("5 working days after 2024-03-29")).toBe(num("2024-03-29 + 5 workdays"));
	});

	test("business days is a synonym for working days", () => {
		expect(num("5 business days after 2024-03-29")).toBe(num("5 working days after 2024-03-29"));
	});

	test("from reads like after", () => {
		expect(num("3 working days from 2024-03-29")).toBe(num("3 working days after 2024-03-29"));
	});

	test("before walks backwards, the mirror of after", () => {
		// Friday March 29 minus five working days is the Friday before.
		expectDate("5 working days before 2024-03-29", 2024, 3, 22);
		expect(num("5 working days before 2024-04-05")).toBe(num("2024-04-05 - 5 workdays"));
	});

	test("after and before round-trip", () => {
		expectDate("5 working days before (5 working days after 2024-03-29)", 2024, 3, 29);
	});

	test("the singular day form is accepted for a count of one", () => {
		expectDate("1 working day after 2024-03-29", 2024, 4, 1);
	});

	test("a relative anchor works, not only a literal", () => {
		// Structural, since "today" moves: the answer is always a weekday.
		const value = evaluate("3 business days from today");
		expect(value.type).toBe(ValueType.Datetime);
		expect(evaluate(`${new Date(value.toNumber()).getFullYear()}-01-01 is a workday`).type).not.toBe(ValueType.Error);
		expect(new Date(value.toNumber()).getDay()).not.toBe(0);
		expect(new Date(value.toNumber()).getDay()).not.toBe(6);
	});

	test("an anchor that is not a date is a clear error, not a wrong date", () => {
		expect(evaluate("5 working days after 3").type).toBe(ValueType.Error);
	});

	test("weekends and month ends are skipped, same as the arithmetic form", () => {
		// August 31 2024 was a Saturday; the following Monday is in September.
		expectDate("1 working day after 2024-08-30", 2024, 9, 2);
	});
});

describe("working days between two dates", () => {
	test("every working day in a month, both ends counted", () => {
		// Jan 1 2024 (Mon) through Jan 31 (Wed): 23 weekdays.
		expect(num("working days between 2024-01-01 and 2024-01-31")).toBe(23);
	});

	test("business days between is the same count", () => {
		expect(num("business days between 2024-01-01 and 2024-01-31")).toBe(23);
	});

	test("the order of the two dates does not matter", () => {
		expect(num("working days between 2024-01-31 and 2024-01-01")).toBe(23);
	});

	test("a single working week is five", () => {
		// Monday April 1 through Sunday April 7 2024.
		expect(num("working days between 2024-04-01 and 2024-04-07")).toBe(5);
	});

	test("the same two dates as a plain span still measure calendar days", () => {
		// The working-day count must not have disturbed `days between`.
		expect(evaluate("days between 2024-01-01 and 2024-01-31").type).toBe(ValueType.Uom);
		expect(num("days between 2024-01-01 and 2024-01-31")).toBe(30);
	});

	test("a non-date endpoint is refused", () => {
		expect(evaluate("working days between 2024-01-01 and 5").type).toBe(ValueType.Error);
	});
});

describe("a configured holiday calendar excludes those days too", () => {
	// Christmas Day 2024 (Wed) and Boxing Day (Thu), as a plain list a host
	// might pass. The same dates as a predicate function are covered in the
	// resolver's own unit tests.
	const christmas: HolidayCalendar = ["2024-12-25", "2024-12-26"];

	test("an offset steps over the holidays", () => {
		// Tuesday Dec 24 + 1 working day skips the 25th and 26th to Friday 27.
		const value = evaluateWithHolidays("1 working day after 2024-12-24", christmas);
		expect(value.type).toBe(ValueType.Datetime);
		expect(value.toNumber()).toBe(new Date(2024, 11, 27).getTime());
	});

	test("with no calendar the same offset stops on the 25th", () => {
		expectDate("1 working day after 2024-12-24", 2024, 12, 25);
	});

	test("the count drops the holidays inside the window", () => {
		// Mon Dec 23 through Fri Dec 27: five weekdays, minus the two holidays.
		expect(evaluateWithHolidays("working days between 2024-12-23 and 2024-12-27", christmas).toNumber()).toBe(3);
		expect(num("working days between 2024-12-23 and 2024-12-27")).toBe(5);
	});

	test("weekends stay excluded whether or not a calendar is set", () => {
		// A holiday list that names only weekdays must not resurrect weekends.
		expect(evaluateWithHolidays("working days between 2024-04-01 and 2024-04-07", christmas).toNumber()).toBe(5);
	});

	test("the arithmetic form and the words agree under the same calendar", () => {
		const words = evaluateWithHolidays("1 working day after 2024-12-24", christmas).toNumber();
		const arithmetic = evaluateWithHolidays("2024-12-24 + 1 workday", christmas).toNumber();
		expect(words).toBe(arithmetic);
	});
});
