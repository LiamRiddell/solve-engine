/**
 * Money multiplied by a count, and a quantity split across two units.
 *
 * Both were refused outright rather than answered wrongly, which is the right
 * failure but still a failure.
 *
 * `$30 × 4 days` reported "Cannot combine incompatible units: USD and days",
 * because there is no such unit as a dollar-day. True in general, and not true
 * in the one case where exactly one side is money: the other side is then a
 * count, and the answer is that much money.
 *
 * `12.5 minutes in minutes and seconds` could not be expressed at all, because
 * every conversion path produces a single number in a single unit.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();
const text = (source: string) => String(evaluate(source).value);

describe("money times a count", () => {
	test("`$30 * 4 days` is $120", () => {
		expect(num("$30 * 4 days")).toBeCloseTo(120, 6);
	});

	test("the answer is money, not a dollar-day", () => {
		expect(evaluate("$30 * 4 days").unit).toBe("USD");
	});

	test("it is commutative", () => {
		expect(num("4 days * $30")).toBeCloseTo(120, 6);
	});

	test("any measure works as the count, not just time", () => {
		expect(num("$5 * 3 km")).toBeCloseTo(15, 6);
	});

	test("a plain number was always fine and still is", () => {
		expect(num("$30 * 4")).toBeCloseTo(120, 6);
	});
});

describe("what money multiplication must not claim", () => {
	test("two non-money measures are still refused", () => {
		// `3 kg × 4 days` really has no meaning worth guessing at, and the
		// restriction to money is what keeps that true.
		expect(evaluate("3 kg * 4 days").type).toBe(ValueType.Error);
	});

	test("a rate is left to the rate path", () => {
		expect(num("30 fps * 3 minutes")).toBeGreaterThan(0);
	});
});

describe("a quantity across two units", () => {
	test("`12.5 minutes in minutes and seconds` is 12 min 30 s", () => {
		expect(text("12.5 minutes in minutes and seconds")).toBe("12 minutes 30 seconds");
	});

	test("`1.4 weeks in hours and minutes`", () => {
		expect(text("1.4 weeks in hours and minutes")).toBe("235 hours 12 minutes");
	});

	test("`4.5 weeks in days and hours`", () => {
		expect(text("4.5 weeks in days and hours")).toBe("31 days 12 hours");
	});

	test("`to` reads the same as `in`", () => {
		expect(text("12.5 minutes to minutes and seconds")).toBe("12 minutes 30 seconds");
	});

	test("it works outside time", () => {
		expect(text("1500 m in km and m")).toBe("1 km 500 m");
	});

	test("nothing is lost: the remainder goes to the smaller unit", () => {
		expect(text("90.5 seconds in minutes and seconds")).toBe("1 minutes 30.5 seconds");
	});
});

describe("what the two-unit form rejects", () => {
	test("units named in the wrong order", () => {
		// Naming the smaller one first has no sensible reading, so it says so
		// rather than producing a zero and a large remainder.
		expect(evaluate("12.5 minutes in seconds and minutes").type).toBe(ValueType.Error);
	});

	test("units from different measures", () => {
		expect(evaluate("12.5 minutes in hours and metres").type).toBe(ValueType.Error);
	});

	test("the ordinary single-unit conversion is untouched", () => {
		expect(num("90 minutes in hours")).toBeCloseTo(1.5, 6);
		expect(num("10 km in m")).toBeCloseTo(10000, 6);
	});

	test("`and` as a list separator elsewhere is untouched", () => {
		expect(num("average of 10 and 20")).toBeCloseTo(15, 6);
	});
});
