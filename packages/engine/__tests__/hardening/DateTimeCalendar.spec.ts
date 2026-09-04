/**
 * Adversarial calendar arithmetic: leap years, the century rule, ISO week
 * numbering, and the boundary between a date literal and the arithmetic it
 * is spelled identically to.
 *
 * Every expectation here is a calendar fact worked out independently of the
 * engine, not a recording of what the engine happens to answer. Where the
 * answer depends on the host's timezone (a date literal is local midnight,
 * and a difference between two of them can absorb a DST shift), the
 * expectation is derived from the same `Date` constructor the production
 * code uses, so the test says the same thing in Sydney as in Los Angeles.
 *
 * The `2024 - 5 - 3` group at the bottom is the reason this file exists.
 * The ISO branch of the date-literal rule used to accept any three
 * minus-separated numbers whose first group had four digits, so ordinary
 * subtraction that began with a year-shaped number was silently answered
 * with a date.
 *
 * The first fix for that required the ISO branch's month and day to be
 * zero-padded, which worked and cost `2024-5-3`, an ordinary way to write a
 * date. What actually tells the two apart is whether the expression was
 * written as one uninterrupted run of characters or with spaces around its
 * operators, so that is what the rule tests now (see `writtenAsOneRun` in
 * `datetime/normalizer/DateLiteralNormalizerRule.ts`). Both halves are pinned
 * below: unpadded literals are dates, and every spaced chain, padded or not,
 * is arithmetic.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

/**
 * The same evaluation with the refusal switched off, so a run that now
 * reports a fault answers the number it answered before this release. Used to
 * keep the old expectation beside the new one rather than losing it.
 */
function asArithmetic(source: string): number {
	const engine = newTrackedEngine({ config: { date: { onAmbiguous: "arithmetic" } } });
	return engine.evaluateExpression(source).toNumber();
}

/**
 * Local midnight for a calendar date, mirroring how `buildDateToken()`
 * constructs a date literal. Using it for the expected value is what keeps
 * these tests from asserting one particular host timezone.
 */
function localMidnight(year: number, month: number, day: number): number {
	return new Date(year, month - 1, day).getTime();
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days between two local midnights. Rounding is deliberate:
 * a DST transition inside the span shifts the raw millisecond difference by
 * an hour, which is never enough to change the day count.
 */
function calendarDaysBetween(from: readonly [number, number, number], to: readonly [number, number, number]): number {
	return Math.round((localMidnight(...to) - localMidnight(...from)) / MS_PER_DAY);
}

describe("leap years, including the century rule", () => {
	test("February 29 exists in 2024 and is a real date literal", () => {
		const value = evaluate("2024-02-29");
		expect(value.type).toBe(ValueType.Datetime);
		expect(value.toNumber()).toBe(localMidnight(2024, 2, 29));
	});

	test("February 29 does not exist in 2023, so the literal is refused by name", () => {
		// This used to answer 1992, the subtraction the run is spelled like. An
		// ISO-shaped run has one reading and nothing to fall back to, so a
		// rollover here is a date attempt that failed rather than arithmetic that
		// looked like one.
		const value = evaluate("2023-02-29");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
		expect(value.unit).toBe('"2023-02-29" is not a real date: February 2023 has 28 days.');
		// And the old answer is one setting away.
		expect(asArithmetic("2023-02-29")).toBe(1992);
	});

	test("2000 is a leap year: divisible by 400", () => {
		const value = evaluate("2000-02-29");
		expect(value.type).toBe(ValueType.Datetime);
		expect(value.toNumber()).toBe(localMidnight(2000, 2, 29));
	});

	test("1900 is not a leap year: divisible by 100 but not 400", () => {
		expect(evaluate("1900-02-29").type).toBe(ValueType.Error);
		expect(asArithmetic("1900-02-29")).toBe(1869);
	});

	test("2100 is not a leap year either", () => {
		expect(evaluate("2100-02-29").type).toBe(ValueType.Error);
		expect(asArithmetic("2100-02-29")).toBe(2069);
	});

	test("`days in February` follows the same century rule", () => {
		expect(num("days in February 2000")).toBe(29);
		expect(num("days in February 1900")).toBe(28);
		expect(num("days in February 2100")).toBe(28);
	});

	test("and so does a whole year", () => {
		expect(num("days in 2000")).toBe(366);
		expect(num("days in 1900")).toBe(365);
		expect(num("days in 2100")).toBe(365);
	});

	test("the European spelling of February 29 agrees with the ISO one", () => {
		expect(evaluate("29/02/2024").toNumber()).toBe(localMidnight(2024, 2, 29));
		// Both spellings of the impossible day are refused the same way, which is
		// the agreement this test is about; it used to be that both fell through
		// to arithmetic instead.
		expect(evaluate("29/02/2023").type).toBe(ValueType.Error);
		expect(evaluate("29/02/2023").value).toBe("DATE_NOT_A_CALENDAR_DAY");
		expect(evaluate("2023-02-29").value).toBe("DATE_NOT_A_CALENDAR_DAY");
	});

	test("a leap day's weekday is right two centuries out in each direction", () => {
		// February 28 1900 was a Wednesday and February 28 2100 is a Sunday.
		// Both are checkable by hand from the doomsday of each century, which
		// is what makes them worth pinning: they are far outside any range a
		// lookup table would cover.
		expect(evaluate("1900-02-28 as weekday").value).toBe("Wednesday");
		expect(evaluate("2100-02-28 as weekday").value).toBe("Sunday");
		expect(evaluate("2000-02-29 as weekday").value).toBe("Tuesday");
	});
});

describe("differences between dates", () => {
	test("a leap year is one day longer than the year before it", () => {
		expect(Math.round(num("days between 2024-01-01 and 2025-01-01"))).toBe(366);
		expect(Math.round(num("days between 2023-01-01 and 2024-01-01"))).toBe(365);
	});

	test("January 1 to December 31 is 365 days even in a leap year", () => {
		// The 366th day is December 31 itself, so the gap between the two
		// endpoints is still 365. Getting 366 here would mean the difference
		// had quietly become inclusive.
		expect(Math.round(num("days between 2024-01-01 and 2024-12-31"))).toBe(365);
	});

	test("`between` has no direction, so swapping the endpoints changes nothing", () => {
		expect(num("days between 2024-12-31 and 2024-01-01")).toBe(num("days between 2024-01-01 and 2024-12-31"));
		expect(num("days between 1999-12-31 and 2000-01-01")).toBe(num("days between 2000-01-01 and 1999-12-31"));
	});

	test("a date against itself is zero, not one", () => {
		expect(num("days between 2024-03-15 and 2024-03-15")).toBe(0);
	});

	test("crossing a year boundary is counted like any other span", () => {
		const expected = calendarDaysBetween([1999, 12, 25], [2000, 1, 5]);
		expect(expected).toBe(11);
		expect(Math.round(num("days between 1999-12-25 and 2000-01-05"))).toBe(11);
	});

	test("a difference in seconds matches the real elapsed time between two local midnights", () => {
		// Derived rather than hardcoded to 86400: a host zone that changes
		// its offset between these two dates genuinely has a longer or
		// shorter day, and the engine reporting that is correct.
		const expected = (localMidnight(2024, 1, 2) - localMidnight(2024, 1, 1)) / 1000;
		expect(num("seconds between 2024-01-01 and 2024-01-02")).toBeCloseTo(expected, 6);
	});

	test("subtracting two dates yields a duration rather than another date", () => {
		const value = evaluate("2023-12-25 - 2023-12-24");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.unit).toBe("ms");
		expect(value.toNumber()).toBe(localMidnight(2023, 12, 25) - localMidnight(2023, 12, 24));
	});

	test("`until` counts forwards and `since` counts backwards, with matching magnitudes", () => {
		// Both are measured against "now", so the only stable thing to assert
		// is that they are exact mirrors of each other. Evaluating them one
		// after another leaves a few milliseconds of clock drift between the
		// two readings.
		const until = num("days until 2030-01-01");
		const since = num("days since 2030-01-01");
		expect(until).toBeGreaterThan(0);
		expect(since).toBeLessThan(0);
		expect(until + since).toBeCloseTo(0, 3);
	});
});

describe("ISO week numbers at the year boundary", () => {
	// ISO weeks start on Monday and week 1 is the one holding the first
	// Thursday of the year, so the first days of January frequently belong to
	// the previous year's week 52 or 53. These are the cases a naive
	// day-of-year divided by seven gets wrong.
	test("January 1 2021 is week 53, still part of 2020's last week", () => {
		expect(num("week of 2021-01-01")).toBe(53);
	});

	test("the following Monday starts week 1", () => {
		expect(num("week of 2021-01-04")).toBe(1);
	});

	test("December 31 2020 is week 53 of its own year", () => {
		expect(num("week of 2020-12-31")).toBe(53);
	});

	test("December 30 2019 is already week 1 of 2020", () => {
		expect(num("week of 2019-12-30")).toBe(1);
	});

	test("December 31 2018 is likewise week 1 of 2019", () => {
		expect(num("week of 2018-12-31")).toBe(1);
	});

	test("January 1 2017 is a Sunday, so it is week 52 of 2016", () => {
		expect(num("week of 2017-01-01")).toBe(52);
	});

	test("a 53-week year is recognised as one", () => {
		expect(num("week of 2015-12-28")).toBe(53);
		expect(num("week of 2016-01-01")).toBe(53);
	});

	test("an ordinary 52-week year ends at 52", () => {
		expect(num("week of 2021-12-31")).toBe(52);
		expect(num("week of 2022-01-03")).toBe(1);
	});
});

describe("date literals versus the arithmetic they look like", () => {
	test("a subtraction written with spaces around its operators stays subtraction", () => {
		// The bug this guards: "2024 - 5 - 3" answered "Friday, May 3, 2024".
		// The spaces are the whole signal. Nobody types them when they mean the
		// date, so a spaced chain is arithmetic no matter how date-shaped its
		// groups are.
		expect(evaluate("2024 - 5 - 3").type).toBe(ValueType.Number);
		expect(num("2024 - 5 - 3")).toBe(2016);
		expect(num("2024 - 1 - 1")).toBe(2022);
		expect(num("2020 - 10 - 2")).toBe(2008);
		expect(num("1999 - 2 - 3")).toBe(1994);
	});

	test("a longer subtraction chain is not swallowed either", () => {
		// This one used to answer one millisecond before 2024: the first
		// three groups fused into a date and the trailing "- 1" was then read
		// as subtracting a millisecond from it.
		expect(num("2024 - 1 - 1 - 1")).toBe(2021);
	});

	test("zero-padding a spaced chain does not turn it into a date", () => {
		// This is the one genuinely ambiguous spelling, and it reads as
		// arithmetic. Padding is not evidence of a date: somebody subtracting
		// writes "05" for the same reasons they write it anywhere else, and
		// reading this as May 3 would leave that subtraction with no spelling
		// at all. Spacing is evidence, and it points the other way.
		expect(num("2024 - 05 - 03")).toBe(2016);
		expect(num("12 - 25 - 2023")).toBe(-2036);
		expect(num("1 - 1 - 2020")).toBe(-2020);
	});

	test("a division chain written with spaces stays division", () => {
		// The same reasoning as the subtraction rows above, on the separator
		// the European ordering uses. "25 / 12 / 2023" was Christmas 2023.
		expect(num("25 / 12 / 2023")).toBeCloseTo(25 / 12 / 2023, 12);
		expect(num("10 / 5 / 20")).toBeCloseTo(10 / 5 / 20, 12);
	});

	test("an ISO date is still a date, padded or not", () => {
		expect(evaluate("2023-12-25").toNumber()).toBe(localMidnight(2023, 12, 25));
		expect(evaluate("2023-01-31").toNumber()).toBe(localMidnight(2023, 1, 31));
		expect(evaluate("1999-06-15").toNumber()).toBe(localMidnight(1999, 6, 15));
		// Unpadded, which is how people type it. The US ordering has always
		// accepted "1-1-2020", so requiring padding here was an inconsistency
		// between two spellings of one rule rather than a policy.
		expect(evaluate("2024-5-3").toNumber()).toBe(localMidnight(2024, 5, 3));
		expect(evaluate("2024-5-03").toNumber()).toBe(localMidnight(2024, 5, 3));
		expect(evaluate("2024-05-3").toNumber()).toBe(localMidnight(2024, 5, 3));
	});

	test("a SPACED chain is arithmetic whatever its groups say", () => {
		// Adjacency still decides date-versus-arithmetic before any shape or
		// order is considered, so these are untouched by the refusal below.
		expect(num("2024 - 13 - 01")).toBe(2010);
		expect(num("2024 - 05 - 32")).toBe(1987);
	});

	test("while the unspaced run is a date attempt, and is refused rather than answered", () => {
		// These used to answer 2,010 and 1,987. Written as one run they are
		// unmistakably ISO-shaped, and an ISO shape has no second reading to fall
		// to, so the honest answer is what is wrong with them.
		expect(evaluate("2024-13-01").value).toBe("DATE_NOT_A_CALENDAR_DAY");
		expect(evaluate("2024-05-32").value).toBe("DATE_NOT_A_CALENDAR_DAY");
		expect(asArithmetic("2024-13-01")).toBe(2010);
		expect(asArithmetic("2024-05-32")).toBe(1987);
	});

	test("the US format still requires a 2 or 4 digit year, so short chains stay arithmetic", () => {
		expect(num("20-10-5")).toBe(5);
		expect(num("100-50-25")).toBe(25);
	});

	test("the 2-digit year window turns over between 68 and 69", () => {
		expect(evaluate("25/12/68").toNumber()).toBe(localMidnight(2068, 12, 25));
		expect(evaluate("25/12/69").toNumber()).toBe(localMidnight(1969, 12, 25));
		expect(evaluate("25/12/00").toNumber()).toBe(localMidnight(2000, 12, 25));
		expect(evaluate("25/12/99").toNumber()).toBe(localMidnight(1999, 12, 25));
	});

	test("a slash date is read day-first, consistently across the formats that share a day", () => {
		// 01/02/2025 is February 1, not January 2. Worth pinning because the
		// two readings differ silently rather than erroring, and because the
		// same calendar day written the other three ways has to agree.
		const feb1 = localMidnight(2025, 2, 1);
		expect(evaluate("01/02/2025").toNumber()).toBe(feb1);
		expect(evaluate("01.02.2025").toNumber()).toBe(feb1);
		expect(evaluate("2025-02-01").toNumber()).toBe(feb1);
		expect(evaluate("02-01-2025").toNumber()).toBe(feb1);
	});

	test("a wikilinked daily note unwraps to the same date as the bare literal", () => {
		expect(evaluate("[[2024-01-15]]").toNumber()).toBe(localMidnight(2024, 1, 15));
	});
});

describe("month name dates reject days that do not exist", () => {
	test("a real date parses", () => {
		expect(evaluate("March 9, 2024").toNumber()).toBe(localMidnight(2024, 3, 9));
		expect(evaluate("9 March 2024").toNumber()).toBe(localMidnight(2024, 3, 9));
	});

	test("February 29 in a common year does not", () => {
		expect(() => evaluate("February 29, 2023")).toThrow();
	});

	test("nor does a 30th of February or a 32nd of anything", () => {
		expect(() => evaluate("February 30, 2024")).toThrow();
		expect(() => evaluate("March 32, 2024")).toThrow();
	});
});
