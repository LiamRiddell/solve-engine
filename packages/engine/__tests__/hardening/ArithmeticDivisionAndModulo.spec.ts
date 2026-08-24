/**
 * Division and modulo, including the cases everyone forgets.
 *
 * Dividing by zero and taking a remainder with a negative operand are the two
 * places where languages genuinely disagree with each other, so an engine has
 * to pick a convention and hold it. This one follows the double: `x / 0` is a
 * signed infinity rather than an error, and `mod` truncates toward zero, so
 * the remainder takes the sign of the LEFT operand (`-5 mod 2` is -1, not 1).
 *
 * That is the C/JavaScript convention. Python and a mathematician would both
 * say 1, because they floor instead of truncating. Neither is wrong; what
 * would be wrong is the engine answering -1 in one place and 1 in another, so
 * every sign combination is written out below rather than a representative
 * sample.
 *
 * The reference for each expected value is the same expression evaluated in
 * plain JavaScript with `/` and `%`, computed separately and written in.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("dividing by zero", () => {
	test("gives a signed infinity rather than raising", () => {
		expect(num("1 / 0")).toBe(Infinity);
		expect(num("-1 / 0")).toBe(-Infinity);
	});

	test("and the sign of the zero counts", () => {
		expect(num("1 / -0")).toBe(-Infinity);
		expect(num("-1 / -0")).toBe(Infinity);
	});

	test("zero over zero is the indeterminate case", () => {
		expect(num("0 / 0")).toBeNaN();
	});

	test("a divide by zero inside a larger expression keeps propagating", () => {
		expect(num("(1 / 0) + 1")).toBe(Infinity);
		expect(num("2 * (1 / 0)")).toBe(Infinity);
		expect(num("(1 / 0) / (1 / 0)")).toBeNaN();
	});
});

describe("modulo with every sign combination", () => {
	test("both positive", () => {
		expect(num("5 mod 2")).toBe(1);
		expect(num("2 mod 5")).toBe(2);
	});

	test("negative left operand keeps its sign", () => {
		// Truncated division: -5 / 2 truncates to -2, and -5 - (-2 * 2) = -1.
		// A floored convention would answer 1 here.
		expect(num("-5 mod 2")).toBe(-1);
		expect(num("-2 mod 5")).toBe(-2);
	});

	test("negative right operand does not change the sign of the result", () => {
		expect(num("5 mod -2")).toBe(1);
		expect(num("2 mod -5")).toBe(2);
	});

	test("both negative", () => {
		expect(num("-5 mod -2")).toBe(-1);
	});

	test("an exact division leaves nothing behind", () => {
		expect(num("6 mod 3")).toBe(0);
		expect(num("-6 mod 3")).toBe(-0);
	});
});

describe("modulo of things that are not whole", () => {
	test("a fractional left operand keeps its fraction", () => {
		expect(num("5.5 mod 2")).toBe(1.5);
		expect(num("-5.5 mod 2")).toBe(-1.5);
	});

	test("a fractional divisor works too", () => {
		expect(num("5 mod 2.5")).toBe(0);
		expect(num("5 mod 1.5")).toBe(0.5);
	});

	test("and inherits representation error like any other arithmetic", () => {
		// 0.3 is not exactly three tenths, so the remainder against a tenth is
		// a hair under a tenth rather than zero. Answering 0 here would mean
		// the engine had rounded behind the reader's back.
		expect(num("0.3 mod 0.1")).toBe(0.09999999999999998);
	});
});

describe("modulo by zero", () => {
	test("has no answer and says so as NaN, matching division", () => {
		expect(num("5 mod 0")).toBeNaN();
		expect(num("0 mod 0")).toBeNaN();
		expect(num("-5 mod 0")).toBeNaN();
	});
});

describe("modulo of infinities", () => {
	test("an infinite left operand has no remainder", () => {
		expect(num("(1 / 0) mod 2")).toBeNaN();
	});

	test("an infinite divisor leaves the left operand alone", () => {
		expect(num("5 mod (1 / 0)")).toBe(5);
	});
});

describe("division stays exact where doubles allow it", () => {
	test("powers of two divide without error", () => {
		expect(num("1 / 2")).toBe(0.5);
		expect(num("1 / 2 / 2")).toBe(0.25);
		expect(num("8 / 4 / 2")).toBe(1);
	});

	test("and inexactly where they do not", () => {
		expect(num("1 / 3")).toBe(0.3333333333333333);
		expect(num("2 / 3")).toBe(0.6666666666666666);
		// Not 1: the two thirds above round in opposite directions.
		expect(num("1 / 3 + 2 / 3")).toBe(1);
		expect(num("10 / 3 * 3")).toBe(10);
	});
});
