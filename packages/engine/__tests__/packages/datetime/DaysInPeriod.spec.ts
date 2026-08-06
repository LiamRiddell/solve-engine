/**
 * `days in <calendar period>`, and the conversion it is spelled identically to.
 *
 * `days in February 2020` asks how long a real month is. `days in 3 weeks`
 * converts a quantity. The first two words are the same, and the answers come
 * from completely different places: February is 28 days or 29 depending on the
 * year, and no conversion factor expresses that.
 *
 * Registering `days in` as an ordinary fused phrase claimed both and broke the
 * conversion, which is why it is a normalizer rule with lookahead instead.
 * Most of the tests below exist to pin that boundary rather than the
 * arithmetic.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("how long a named period is", () => {
	test("`days in February 2020` is 29, a leap year", () => {
		expect(num("days in February 2020")).toBe(29);
	});

	test("and 28 in a year that is not", () => {
		expect(num("days in February 2021")).toBe(28);
	});

	test("a month with 30 days", () => {
		expect(num("days in April 2024")).toBe(30);
	});

	test("`days in Q3` is 92", () => {
		expect(num("days in Q3")).toBe(92);
	});

	test("the quarters differ from one another", () => {
		expect(num("days in Q1 2024")).toBe(91); // leap year February
		expect(num("days in Q1 2023")).toBe(90);
		expect(num("days in Q2 2024")).toBe(91);
		expect(num("days in Q4 2024")).toBe(92);
	});

	test("a whole year", () => {
		expect(num("days in 2024")).toBe(366);
		expect(num("days in 2023")).toBe(365);
	});

	test("a period that is not one says what it expected", () => {
		expect(() => evaluate("days in banana")).toThrow();
	});
});

describe("the conversion it must not claim", () => {
	test("`days in 3 weeks` is still 21", () => {
		// The regression an unconditional `days in` phrase caused.
		expect(num("days in 3 weeks")).toBeCloseTo(21, 6);
	});

	test("and still carries the unit", () => {
		expect(evaluate("days in 3 weeks").unit).toBe("days");
	});

	test("other reversed conversions are untouched", () => {
		expect(num("seconds in a day")).toBeCloseTo(86400, 6);
		expect(num("hours in a week")).toBeCloseTo(168, 6);
		expect(num("meters in 10 km")).toBeCloseTo(10000, 6);
	});

	test("the ordinary conversion direction is untouched", () => {
		expect(num("3 weeks in days")).toBeCloseTo(21, 6);
	});
});

describe("week numbers", () => {
	test("`week number on march 12, 2021` is 10", () => {
		expect(num("week number on march 12, 2021")).toBe(10);
	});

	test("the spelling that already existed still works", () => {
		expect(num("week of march 12, 2021")).toBe(10);
	});
});
