/**
 * Asking for whichever part of a percentage relationship you do not have.
 *
 * `5% of what is 6` already existed. This is the order Soulver documents,
 * where you state what you know first, and none of it parsed.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function num(source: string): number {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value.toNumber();
}

describe("solving for the base", () => {
	test("`20 is 10% of what` is 200", () => {
		expect(num("20 is 10% of what")).toBeCloseTo(200, 6);
	});

	test("`180 is 10% off what` is 200", () => {
		expect(num("180 is 10% off what")).toBeCloseTo(200, 6);
	});

	test("`220 is 10% on what` is 200", () => {
		expect(num("220 is 10% on what")).toBeCloseTo(200, 6);
	});

	test("a fraction reads the same as a rate", () => {
		expect(num("50 is 1/5 of what")).toBeCloseTo(250, 6);
	});
});

describe("solving for the rate", () => {
	test("`20 is what % of 200` is 10%", () => {
		expect(num("20 is what % of 200")).toBeCloseTo(0.1, 10);
	});

	test("`180 is what % off 200` is 10%", () => {
		expect(num("180 is what % off 200")).toBeCloseTo(0.1, 10);
	});

	test("`180 is what % on 150` is 20%", () => {
		expect(num("180 is what % on 150")).toBeCloseTo(0.2, 10);
	});

	test("`50 to 75 is what %` is 50%", () => {
		// No trailing preposition: the left operand is already the change.
		expect(num("50 to 75 is what %")).toBeCloseTo(0.5, 10);
	});
});

describe("the logarithm, same shape and same trigger", () => {
	test("`81 is 9 to what power` is 2", () => {
		expect(num("81 is 9 to what power")).toBeCloseTo(2, 10);
	});

	test("`27 is 3 to the what power` reads the same", () => {
		expect(num("27 is 3 to what power")).toBeCloseTo(3, 10);
	});
});

describe("what it binds to", () => {
	test("the whole expression on its left", () => {
		expect(num("10 + 10 is what % of 200")).toBeCloseTo(0.1, 10);
	});
});

describe("what `is` must not break", () => {
	test("the `is to` proportion phrase still wins", () => {
		// Fused earlier than the bare keyword, which is what makes claiming
		// "is" safe at all.
		expect(num("6 is to 60 as 8 is to what")).toBeCloseTo(80, 6);
	});

	test("`5% of what is 6` still works in the other word order", () => {
		expect(num("5% of what is 6")).toBeCloseTo(120, 6);
	});

	test("a bare `is` with nothing recognisable after it fails loudly", () => {
		expect(() => num("20 is 5")).toThrow();
	});

	test("comparisons are untouched", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("20km == 20,000 m");
		expect(value.value).toBe(true);
	});
});
