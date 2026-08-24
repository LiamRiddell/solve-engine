/**
 * Operations spelled out in words.
 *
 * Every one of these already existed as a symbol or a function call. What was
 * missing was the spelling Soulver documents, which is the one people reach for
 * when they are writing a calculation rather than typing one.
 *
 * Nothing here is new maths. `gcd of 20 and 30` reuses the same builtin as
 * `gcd(20, 30)`, and `square root of 81` the same one as `sqrt(81)`, which is
 * the point: the gap was grammar, not capability.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function num(source: string): number {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value.toNumber();
}

describe("arithmetic written out", () => {
	test("multiplied by", () => {
		expect(num("3 multiplied by 4")).toBe(12);
	});

	test("divided by", () => {
		expect(num("1,000 divided by 200")).toBe(5);
	});

	test("the shorter spellings still work", () => {
		expect(num("3 multiply by 4")).toBe(12);
		expect(num("1000 divide by 200")).toBe(5);
	});

	test("they keep multiplication precedence", () => {
		expect(num("2 + 3 multiplied by 4")).toBe(14);
	});
});

describe("larger and smaller, both spellings", () => {
	test("greater of", () => {
		expect(num("greater of 100 and 200")).toBe(200);
	});

	test("lesser of", () => {
		expect(num("lesser of 5 and 10")).toBe(5);
	});

	test("the original spellings are untouched", () => {
		expect(num("larger of 100 and 200")).toBe(200);
		expect(num("smaller of 5 and 10")).toBe(5);
	});

	test("an operand may now contain a `+`", () => {
		// Only possible since `and` stopped being the PLUS token: the operand
		// slot used to have to stop at multiplication precedence to avoid
		// swallowing "and Y", which stopped a real "+" too.
		expect(num("larger of 1 + 1 and 3")).toBe(3);
	});
});

describe("gcd and lcm as phrases", () => {
	test("gcd of", () => {
		expect(num("gcd of 20 and 30")).toBe(10);
	});

	test("lcm of", () => {
		expect(num("lcm of 5 and 8")).toBe(40);
	});

	test("the function forms are unchanged", () => {
		expect(num("gcd(20, 30)")).toBe(10);
		expect(num("lcm(5, 8)")).toBe(40);
	});
});

describe("roots as phrases", () => {
	test("square root of", () => {
		expect(num("square root of 81")).toBe(9);
	});

	test("cube root of", () => {
		expect(num("cube root of 27")).toBe(3);
	});

	test("the phrase takes the whole expression after it", () => {
		// "square root of 3 * 27" is the root of 81, which is how it reads.
		expect(num("square root of 3 * 27")).toBe(9);
	});

	test("sqrt() and cbrt() are unchanged", () => {
		expect(num("sqrt(16)")).toBe(4);
		expect(num("cbrt(343)")).toBe(7);
	});
});

describe("what the new phrases must not claim", () => {
	test("`:greater` and `:lesser` are still usable variable names", () => {
		// The whole reason these are fused two-word phrases rather than bare
		// keywords: only "greater of" is claimed, never "greater".
		const engine = newTrackedEngine();
		engine.evaluateExpression(":greater = 9");
		engine.evaluateExpression(":lesser = 4");
		const value = engine.evaluateExpression(":greater + :lesser");
		expect(value.toNumber()).toBe(13);
	});

	test("`:gcd` and `:root` were never usable, and still are not", () => {
		// Not this change's doing: both are function names (gcd(), root via
		// sqrt's family), so the colon form has always been rejected. Recorded
		// so "we claimed this word" stays distinguishable from "already taken".
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression(":gcd = 4")).toThrow(/after colon/i);
		expect(() => engine.evaluateExpression(":root = 9")).toThrow(/after colon/i);
	});
});
