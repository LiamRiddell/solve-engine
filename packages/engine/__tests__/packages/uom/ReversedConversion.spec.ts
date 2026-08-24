/**
 * Conversions asked the other way round: "how many X in Y".
 *
 * `10 km in meters` has always worked. `meters in 10 km` is the same question
 * with the parts swapped, and it failed on the leading unit, which had nothing
 * in front of it to convert.
 *
 * It is a token reorder rather than a second conversion grammar, so there is
 * still exactly one code path that performs a conversion, and this is only a
 * different way of spelling the input.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("asking how many X in Y", () => {
	test("`meters in 10 km` is 10,000", () => {
		expect(num("meters in 10 km")).toBeCloseTo(10000, 6);
	});

	test("`days in 3 weeks` is 21", () => {
		expect(num("days in 3 weeks")).toBeCloseTo(21, 6);
	});

	test("`seconds in a day` is 86,400", () => {
		expect(num("seconds in a day")).toBeCloseTo(86400, 6);
	});

	test("`an` works as well as `a`", () => {
		expect(num("minutes in an hour")).toBeCloseTo(60, 6);
	});

	test("the answer carries the unit that was asked for", () => {
		expect(evaluate("days in 3 weeks").unit).toBe("days");
		expect(evaluate("meters in 10 km").unit).toBe("meters");
	});

	test("it agrees with the ordinary ordering", () => {
		expect(num("meters in 10 km")).toBeCloseTo(num("10 km in meters"), 6);
		expect(num("days in 3 weeks")).toBeCloseTo(num("3 weeks in days"), 6);
	});
});

describe("what the reorder must not claim", () => {
	test("`days in February 2020` is left for the calendar grammar", () => {
		// A different question: how long is a named period. Rewriting it to
		// "February 2020 in days" would answer something nobody asked. It is
		// now handled by DaysInPeriodParselet, and 29 rather than any
		// conversion factor is how you can tell which path took it.
		expect(num("days in February 2020")).toBe(29);
	});

	test("the ordinary direction is untouched", () => {
		expect(num("10 km in m")).toBeCloseTo(10000, 6);
		expect(num("100 pounds in kg")).toBeCloseTo(45.36, 1);
	});

	test("a bare unit not at the start of a line is untouched", () => {
		// The rule only fires at position zero, because anywhere else a unit is
		// far more likely to belong to something already being parsed. Eight
		// kilometres, not eight thousand: `in m` binds to the `3 km` beside it
		// rather than to the sum, which is the pre-existing behaviour and is
		// what must not change.
		const value = evaluate("5 km + 3 km in m");
		expect(value.toNumber()).toBeCloseTo(8, 6);
		expect(value.unit).toBe("km");
	});

	test("`in` as a unit conversion after a quantity still works", () => {
		expect(num("90 minutes in hours")).toBeCloseTo(1.5, 6);
	});
});
