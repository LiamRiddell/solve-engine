/**
 * Rounding written the way it is said.
 *
 * The engine could already round, but only by configuring the formatter, which
 * changes how every answer is displayed rather than rounding one value inside
 * an expression. They are different things: the formatter cannot express
 * `21 rounded up to nearest 5`, and it cannot feed a rounded number into the
 * next line's arithmetic. The parity audit credited this page to that
 * configuration, and not one of its ten documented forms parsed.
 *
 * https://documentation.soulver.app/syntax-reference/general/number-rounding
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function num(source: string): number {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value.toNumber();
}

describe("rounding to a whole number", () => {
	test("`5.5 rounded` is 6", () => {
		expect(num("5.5 rounded")).toBe(6);
	});

	test("`5.5 rounded down` is 5", () => {
		expect(num("5.5 rounded down")).toBe(5);
	});

	test("`5.5 rounded up` is 6", () => {
		expect(num("5.4 rounded up")).toBe(6);
	});

	test("rounding down is a floor, not a truncation toward zero", () => {
		expect(num("-2.5 rounded down")).toBe(-3);
	});
});

describe("rounding to an increment", () => {
	test("`37 to nearest 10` is 40", () => {
		expect(num("37 to nearest 10")).toBe(40);
	});

	test("`2,100 to nearest thousand` is 2,000", () => {
		expect(num("2,100 to nearest thousand")).toBe(2_000);
	});

	test("`$490 rounded to nearest hundred` is $500", () => {
		expect(num("$490 rounded to nearest hundred")).toBe(500);
	});

	test("`21 rounded up to nearest 5` is 25", () => {
		expect(num("21 rounded up to nearest 5")).toBe(25);
	});

	test("`17 rounded down to nearest 3` is 15", () => {
		expect(num("17 rounded down to nearest 3")).toBe(15);
	});

	test("`to the nearest` reads the same", () => {
		expect(num("37 to the nearest 10")).toBe(40);
	});

	test("an increment that is neither a number nor a magnitude says so", () => {
		expect(() => num("37 to nearest banana")).toThrow(/expected a positive number/i);
	});
});

describe("rounding to decimal places", () => {
	test("`1/3 to 2 dp` is 0.33", () => {
		expect(num("1/3 to 2 dp")).toBeCloseTo(0.33, 10);
	});

	test("`pi to 5 digits` is 3.14159", () => {
		expect(num("pi to 5 digits")).toBeCloseTo(3.14159, 10);
	});

	test("the long spelling", () => {
		expect(num("1/3 to 2 decimal places")).toBeCloseTo(0.33, 10);
	});

	test("zero places rounds to a whole number", () => {
		expect(num("2.7 to 0 dp")).toBe(3);
	});
});

describe("what rounding binds to", () => {
	test("the whole expression to its left, not the last term", () => {
		// `1/3 to 2 dp` has to round a third. Binding tighter would round the
		// 3 and then divide, giving 0.333...
		expect(num("1/3 to 2 dp")).toBeCloseTo(0.33, 10);
		expect(num("10 + 27 to nearest 10")).toBe(40);
	});
});

describe("what rounding must not break", () => {
	test("`round(x)` is still the function it always was", () => {
		// "round" is deliberately NOT claimed as the new keyword; only
		// "rounded" is. Claiming it would have broken every round() call.
		expect(num("round(5.5)")).toBe(6);
	});

	test("`100 to 150` is still a percentage change", () => {
		// The reason "to nearest" and "to N dp" are fused into single tokens:
		// "to" already means this.
		expect(num("100 to 150")).toBeCloseTo(0.5, 10);
	});

	test("`:rounded` is not a usable variable name, and that is the accepted cost", () => {
		// Recorded rather than hidden. "rounded" is a bare keyword, the same
		// accepted risk as "between"/"from"/"over" elsewhere in the engine.
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression(":rounded = 5")).toThrow();
	});
});
