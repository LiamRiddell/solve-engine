/**
 * Bitwise operators on operands that are not tidy 32-bit integers.
 *
 * `&`, `|`, `~`, `<<`, `>>` and `>>>` are defined on a 32-bit word, but the
 * engine hands them doubles, so every one of them silently converts first:
 * truncate toward zero, wrap modulo 2^32, then reinterpret as signed (or, for
 * `>>>`, unsigned). That conversion is where the surprises live. `1 << 32` is
 * 1 rather than 4294967296 because the shift count is taken modulo 32, and
 * `1e20 & 1` is 0 because 1e20 does not survive the wrap in any recognisable
 * form.
 *
 * None of that is avoidable without inventing a different operator, but all of
 * it is worth pinning, because the failure mode of a bitwise op on a value it
 * cannot represent is a plausible-looking wrong number rather than an error.
 * Every expectation below is the same expression evaluated in JavaScript,
 * computed separately and written in by hand.
 *
 * Precedence is not tested here, it is tested in
 * hardening/ArithmeticPrecedence.spec.ts, which is where the ranking these
 * operators now share with C and JavaScript is pinned. Every case below stays
 * parenthesised or single-operator so that this file keeps testing the 32-bit
 * conversion and nothing else.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("and, or, not on whole numbers", () => {
	test("the ordinary cases", () => {
		// 1100 & 1010 = 1000, 1100 | 1010 = 1110.
		expect(num("12 & 10")).toBe(8);
		expect(num("12 | 10")).toBe(14);
		expect(num("5 & 3")).toBe(1);
		expect(num("5 | 3")).toBe(7);
	});

	test("complement is one's complement, so it crosses zero", () => {
		// ~n is -(n+1) for every integer n, which is the part people get
		// wrong when they expect a bit count to stay positive.
		expect(num("~5")).toBe(-6);
		expect(num("~-5")).toBe(4);
		expect(num("~0")).toBe(-1);
		expect(num("~-1")).toBe(0);
	});

	test("a negative operand is all ones above its magnitude", () => {
		expect(num("-1 & 255")).toBe(255);
		expect(num("255 & -1")).toBe(255);
		expect(num("-1 | 0")).toBe(-1);
	});
});

describe("fractional operands are truncated toward zero, not rounded", () => {
	test("positive fractions lose the fraction", () => {
		// 2.9 truncates to 2, so this is 2 & 3, not 3 & 3.
		expect(num("2.9 & 3")).toBe(2);
		expect(num("2.5 & 3")).toBe(2);
	});

	test("negative fractions truncate toward zero as well", () => {
		expect(num("-2.9 & 3")).toBe(2);
		expect(num("-2.5 | 0")).toBe(-2);
	});

	test("complement of a fraction below one is complement of zero", () => {
		expect(num("~0.5")).toBe(-1);
		expect(num("~-0.5")).toBe(-1);
	});
});

describe("operands that do not fit in 32 bits wrap", () => {
	test("exactly 2^32 wraps to zero", () => {
		expect(num("4294967296 | 0")).toBe(0);
		expect(num("4294967297 | 0")).toBe(1);
	});

	test("2^31 reads back as the most negative int32", () => {
		expect(num("2147483648 | 0")).toBe(-2147483648);
	});

	test("a number far past the range keeps only its low bits", () => {
		// 1e20 mod 2^32 is 1661992960, which is what every subsequent bit
		// operation actually sees. The 1e20 is gone.
		expect(num("1e20 | 0")).toBe(1661992960);
		expect(num("1e20 & 1")).toBe(0);
	});

	test("Infinity and NaN convert to zero", () => {
		expect(num("(1 / 0) | 0")).toBe(0);
		expect(num("(0 / 0) | 0")).toBe(0);
	});
});

describe("shifts", () => {
	test("left shift multiplies until it overflows the sign bit", () => {
		expect(num("1 << 4")).toBe(16);
		expect(num("1 << 30")).toBe(1073741824);
		// One more bit lands on the sign bit and the answer goes negative.
		expect(num("1 << 31")).toBe(-2147483648);
	});

	test("the shift count is taken modulo 32", () => {
		// This is the one that looks broken and is not: 1 << 32 is 1 << 0.
		expect(num("1 << 32")).toBe(1);
		expect(num("1 << 33")).toBe(2);
	});

	test("a negative shift count wraps into that range too", () => {
		// -1 mod 32 is 31, so this is 2 << 31, which overflows to zero.
		expect(num("2 << -1")).toBe(0);
	});

	test("signed right shift preserves the sign", () => {
		expect(num("5 >> 1")).toBe(2);
		expect(num("-8 >> 1")).toBe(-4);
		expect(num("-5 >> 1")).toBe(-3);
		// All ones stays all ones however far it goes.
		expect(num("-1 >> 31")).toBe(-1);
	});

	test("unsigned right shift does not, which is the whole difference", () => {
		expect(num("5 >>> 1")).toBe(2);
		expect(num("-8 >>> 1")).toBe(2147483644);
		expect(num("-5 >>> 1")).toBe(2147483645);
		expect(num("-1 >>> 31")).toBe(1);
	});

	test("shifting a negative by zero is how you read it as unsigned", () => {
		expect(num("-1 >>> 0")).toBe(4294967295);
	});
});

describe("results stay numbers", () => {
	test("so a bitwise result feeds straight into arithmetic", () => {
		expect(num("(5 & 3) + 1")).toBe(2);
		expect(num("(1 << 8) / 2")).toBe(128);
		expect(num("(~0) * -1")).toBe(1);
	});

	test("and into another bitwise operator", () => {
		expect(num("(12 & 10) | 1")).toBe(9);
		expect(num("(1 << 4) >> 2")).toBe(4);
		expect(num("~(~5)")).toBe(5);
	});
});
