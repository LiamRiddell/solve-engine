/**
 * The exact base-ten arithmetic money is built on, tested on its own.
 *
 * The engine's headline is a calculator you can write money in, and a currency
 * value that is an IEEE double underneath gets money wrong in the one way that
 * audience notices at once: "0.1 + 0.2" is "0.30000000000000004" as a double.
 * This module is the fix, a bigint coefficient plus an integer scale, so every
 * property the money paths lean on (exact +, -, *, terminating and rounded /,
 * ordering, and half-away-from-zero display) is pinned here where it can be
 * read without a VM around it.
 */

import { describe, expect, test } from "@jest/globals";
import {
	decimalFromLiteral,
	decimalFromInteger,
	decimalFromNumberIfExact,
	decimalAdd,
	decimalSubtract,
	decimalMultiply,
	decimalDivide,
	decimalNegate,
	decimalCompare,
	decimalRound,
	decimalIsZero,
	decimalToString,
	decimalToNumber,
	decimalToFixed,
	type DecimalData,
} from "@solve-js/decimal";

describe("reading a decimal from the text it was written as", () => {
	test.each<[string, bigint, number]>([
		["0.10", 10n, 2],
		["1.005", 1005n, 3],
		["1234.5", 12345n, 1],
		["0.30", 30n, 2],
		[".5", 5n, 1],
		["5.", 5n, 0],
		["-1.25", -125n, 2],
		["100", 100n, 0],
	])("%s parses to coef %s scale %i", (text, coef, scale) => {
		expect(decimalFromLiteral(text)).toEqual<DecimalData>({ coef, scale });
	});

	test("the digits go straight into the coefficient, never through a double", () => {
		// The whole point: "1.005" as a double is 1.00499999..., so a parse that
		// went via parseFloat would lose the third decimal. The coefficient is
		// exactly 1005.
		expect(decimalFromLiteral("1.005").coef).toBe(1005n);
	});

	test("a malformed literal is a structured error, not a guess", () => {
		expect(() => decimalFromLiteral("2.5e-3")).toThrow(/decimal literal/i);
	});
});

describe("the float boundary: which numbers have an exact decimal", () => {
	test("a whole-valued double does", () => {
		expect(decimalFromNumberIfExact(3)).toEqual<DecimalData>({ coef: 3n, scale: 0 });
		expect(decimalFromNumberIfExact(-100)).toEqual<DecimalData>({ coef: -100n, scale: 0 });
	});

	test("a fractional double does not, and says so", () => {
		// 0.1 is not its printed decimal, it is the nearest double to it, so
		// there is nothing exact to recover. null is what keeps float where it
		// belongs when it meets money.
		expect(decimalFromNumberIfExact(0.1)).toBeNull();
		expect(decimalFromNumberIfExact(Math.sqrt(2))).toBeNull();
	});

	test("neither infinity nor NaN does", () => {
		expect(decimalFromNumberIfExact(Infinity)).toBeNull();
		expect(decimalFromNumberIfExact(-Infinity)).toBeNull();
		expect(decimalFromNumberIfExact(NaN)).toBeNull();
	});
});

describe("exact addition, subtraction and multiplication", () => {
	test("the reported case: 0.10 + 0.20 is exactly 0.30", () => {
		const sum = decimalAdd(decimalFromLiteral("0.10"), decimalFromLiteral("0.20"));
		expect(decimalToString(sum)).toBe("0.30");
		expect(decimalToNumber(sum)).toBe(0.3);
	});

	test("scales align before adding", () => {
		// 1.5 + 0.005 keeps the finer scale.
		const sum = decimalAdd(decimalFromLiteral("1.5"), decimalFromLiteral("0.005"));
		expect(decimalToString(sum)).toBe("1.505");
	});

	test("subtraction that a double reports as 0.010000000000005116", () => {
		const diff = decimalSubtract(decimalFromLiteral("100"), decimalFromLiteral("99.99"));
		expect(decimalToString(diff)).toBe("0.01");
	});

	test("multiplication adds the scales", () => {
		// 1.10 (scale 2) * 3 (scale 0) is 3.30 (scale 2).
		const product = decimalMultiply(decimalFromLiteral("1.10"), decimalFromInteger(3));
		expect(product).toEqual<DecimalData>({ coef: 330n, scale: 2 });
		expect(decimalToString(product)).toBe("3.30");
	});

	test("a fractional multiplier stays exact", () => {
		// 0.70 * 1.10 is 0.7700, the tax-like case a double rounds early.
		const product = decimalMultiply(decimalFromLiteral("0.70"), decimalFromLiteral("1.10"));
		expect(decimalToNumber(product)).toBe(0.77);
	});

	test("negation flips the sign and keeps the scale", () => {
		expect(decimalNegate(decimalFromLiteral("0.10"))).toEqual<DecimalData>({ coef: -10n, scale: 2 });
	});
});

describe("division, exact where it terminates and rounded where it does not", () => {
	test("a terminating quotient is exact", () => {
		const q = decimalDivide(decimalFromInteger(10), decimalFromInteger(4));
		expect(decimalToNumber(q)).toBe(2.5);
	});

	test("a repeating quotient rounds to the guard scale, half away from zero", () => {
		const q = decimalDivide(decimalFromInteger(10), decimalFromInteger(3));
		// Twenty threes: enough that the double taken from it matches 10/3.
		expect(decimalToNumber(q)).toBe(10 / 3);
		expect(decimalToFixed(q, 2)).toBe("3.33");
	});

	test("2 / 3 rounds its last kept digit up", () => {
		const q = decimalDivide(decimalFromInteger(2), decimalFromInteger(3), 4);
		// 0.66666... to four places, last digit rounded away from zero.
		expect(decimalToString(q)).toBe("0.6667");
	});
});

describe("half-away-from-zero rounding, the money display rule", () => {
	test.each<[string, number, string]>([
		["1.005", 2, "1.01"],
		["2.675", 2, "2.68"],
		["0.145", 2, "0.15"],
		["0.144", 2, "0.14"],
		["2.5", 0, "3"],
		["-2.5", 0, "-3"],
		["-1.005", 2, "-1.01"],
		["0.30", 2, "0.30"],
		["10", 2, "10.00"],
	])("%s to %i places is %s", (literal, dp, expected) => {
		expect(decimalToFixed(decimalFromLiteral(literal), dp)).toBe(expected);
	});

	test("rounding a value it was handed exactly does not move it", () => {
		expect(decimalToFixed(decimalFromLiteral("0.30"), 2)).toBe("0.30");
	});

	test("rounding never produces a negative zero", () => {
		expect(decimalToFixed(decimalFromLiteral("-0.001"), 2)).toBe("0.00");
	});
});

describe("ordering", () => {
	test.each<[string, string, -1 | 0 | 1]>([
		["0.1", "0.2", -1],
		["0.30", "0.3", 0],
		["1.005", "1.00", 1],
		["-0.01", "0.01", -1],
	])("compare(%s, %s) is %i", (a, b, expected) => {
		expect(decimalCompare(decimalFromLiteral(a), decimalFromLiteral(b))).toBe(expected);
	});

	test("equality ignores trailing-zero scale differences", () => {
		expect(decimalCompare(decimalFromLiteral("0.5"), decimalFromLiteral("0.50"))).toBe(0);
	});
});

describe("small helpers", () => {
	test("zero is zero at any scale", () => {
		expect(decimalIsZero(decimalFromLiteral("0.00"))).toBe(true);
		expect(decimalIsZero(decimalFromInteger(0))).toBe(true);
		expect(decimalIsZero(decimalFromLiteral("0.01"))).toBe(false);
	});

	test("rounding up in scale is exact padding", () => {
		expect(decimalRound(decimalFromLiteral("1.5"), 3)).toEqual<DecimalData>({ coef: 1500n, scale: 3 });
	});

	test("toString renders a bare integer without a point", () => {
		expect(decimalToString(decimalFromInteger(42))).toBe("42");
		expect(decimalToString(decimalFromLiteral("-7"))).toBe("-7");
	});
});
