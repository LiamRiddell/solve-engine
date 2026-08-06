/**
 * `10% on 200` / `10% off 200`, and the degree-taking trig functions.
 *
 * Both are alternative spellings of things the engine could already do, and
 * both are what Soulver documents.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function num(source: string): number {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value.toNumber();
}

describe("a rate applied with the rate stated first", () => {
	test("`10% on 200` is 220", () => {
		expect(num("10% on 200")).toBeCloseTo(220, 6);
	});

	test("`10% off 200` is 180", () => {
		expect(num("10% off 200")).toBeCloseTo(180, 6);
	});

	test("it agrees with the other word order", () => {
		expect(num("10% on 200")).toBeCloseTo(num("200 + 10%"), 6);
		expect(num("10% off 200")).toBeCloseTo(num("200 - 10%"), 6);
	});

	test("the base may be an expression", () => {
		expect(num("10% off 100 + 100")).toBeCloseTo(180, 6);
	});
});

describe("what `on` and `off` must not steal", () => {
	/**
	 * These are why the operator is recognised by a normalizer rule keyed on
	 * the preceding `%` rather than by claiming the bare words. Claiming them
	 * broke both of the first two, which is how the rule came to exist.
	 */
	test("`on` away from a percentage is still an ordinary word", () => {
		// The stocks package uses it ("stock(AAPL) on April 12, 2005") and so
		// does the datetime grammar. Claiming the bare word broke the stocks
		// suite outright; this checks the word is still free.
		const engine = newTrackedEngine("en");
		engine.evaluateExpression(":on = 5");
		const [value] = engine.evaluateExpression(":on + 1");
		expect(value.toNumber()).toBe(6);
	});

	test("`5% off what is 190` is still the solve-for-the-base grammar", () => {
		expect(num("5% off what is 190")).toBeCloseTo(200, 6);
	});

	test("`5% on what is 210` likewise", () => {
		expect(num("5% on what is 210")).toBeCloseTo(200, 6);
	});
});

describe("degree-taking trig", () => {
	test("sind", () => {
		expect(num("sind(90)")).toBeCloseTo(1, 10);
	});

	test("cosd and tand", () => {
		expect(num("cosd(180)")).toBeCloseTo(-1, 10);
		expect(num("tand(45)")).toBeCloseTo(1, 10);
	});

	test("asind returns degrees", () => {
		expect(num("asind(0.5)")).toBeCloseTo(30, 10);
	});

	test("acosd and atand return degrees", () => {
		expect(num("acosd(0.5)")).toBeCloseTo(60, 10);
		expect(num("atand(1)")).toBeCloseTo(45, 10);
	});

	test("they agree with the unit-carrying spelling", () => {
		expect(num("sind(90)")).toBeCloseTo(num("sin(90 degrees)"), 10);
	});

	test("the radian functions are unchanged", () => {
		expect(num("sin(pi/2)")).toBeCloseTo(1, 10);
	});
});
