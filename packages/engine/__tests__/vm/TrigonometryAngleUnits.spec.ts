/**
 * Trigonometric functions and the unit on their argument.
 *
 * `sin(45 deg)` returned the sine of forty-five *radians*. The builtins read
 * their argument through `toNumber()`, which discards the unit, so the degrees
 * were dropped between the parser and the arithmetic and the result was a
 * plausible-looking number that was simply wrong. Nothing surfaced: no error,
 * no warning, and 0.85 is not obviously not a sine of forty-five degrees.
 *
 * The reference points below are the exact ones rather than the arbitrary ones,
 * because those are the values a reader can check without a calculator: a
 * quarter turn is 1, thirty degrees is a half, and forty-five degrees gives the
 * same answer whichever way the angle is written.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluates one line through a real engine and returns the number. */
function evaluate(source: string): number {
	const engine = newTrackedEngine("en");
	try {
		return engine.evaluateExpression(source)[0].toNumber();
	} finally {
		engine.clear();
	}
}

describe("an angle unit is converted rather than discarded", () => {
	test("degrees", () => {
		expect(evaluate("sin(90 deg)")).toBeCloseTo(1, 12);
		expect(evaluate("sin(30 deg)")).toBeCloseTo(0.5, 12);
		expect(evaluate("cos(60 deg)")).toBeCloseTo(0.5, 12);
		expect(evaluate("cos(180 deg)")).toBeCloseTo(-1, 12);
		expect(evaluate("tan(45 deg)")).toBeCloseTo(1, 12);
	});

	test("every spelling of degrees agrees", () => {
		for (const spelling of ["deg", "degs", "degree", "degrees"]) {
			expect(evaluate(`sin(90 ${spelling})`)).toBeCloseTo(1, 12);
		}
	});

	test("gradians, where a right angle is a hundred", () => {
		expect(evaluate("sin(100 gradians)")).toBeCloseTo(1, 12);
		expect(evaluate("cos(200 gradians)")).toBeCloseTo(-1, 12);
	});

	test("the same angle in either unit gives the same answer", () => {
		// The property that makes this a conversion rather than a second scale.
		expect(evaluate("sin(45 deg)")).toBeCloseTo(evaluate("sin(50 gradians)"), 12);
		expect(evaluate("sin(180 deg)")).toBeCloseTo(evaluate("sin(Pi)"), 12);
	});
});

describe("what is left alone", () => {
	test("a plain number is still radians", () => {
		// The default, and unchanged. `sin(1)` must not start meaning one degree.
		expect(evaluate("sin(Pi/2)")).toBeCloseTo(1, 12);
		expect(evaluate("sin(0)")).toBe(0);
		expect(evaluate("cos(0)")).toBe(1);
		expect(evaluate("sin(1)")).toBeCloseTo(0.8414709848, 9);
	});

	test("radians written as a unit are already radians", () => {
		expect(evaluate("sin(1 radian)")).toBeCloseTo(evaluate("sin(1)"), 12);
	});

	test("a unit that is not an angle keeps the previous behaviour", () => {
		// Not an invitation to guess at what a mass was supposed to mean. This
		// falls through to the plain number, as it did before.
		expect(evaluate("sin(45 kg)")).toBeCloseTo(evaluate("sin(45)"), 12);
	});
});

describe("the wrong answer this replaced", () => {
	test("forty-five degrees is no longer forty-five radians", () => {
		// The regression in one line. sin(45 rad) is 0.8509, sin(45 deg) is
		// 0.7071, and the engine used to return the first for input that said
		// the second.
		expect(evaluate("sin(45 deg)")).toBeCloseTo(0.7071067812, 9);
		expect(evaluate("sin(45 deg)")).not.toBeCloseTo(evaluate("sin(45)"), 3);
	});
});
