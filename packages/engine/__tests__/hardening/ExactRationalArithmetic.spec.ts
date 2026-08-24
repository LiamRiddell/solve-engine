/**
 * Fractions are exact, because a third written with "/" should compute like a
 * third and not like the nearest double to it.
 *
 * A quotient of two integers used to be an IEEE double from the moment it was
 * written, so "1/49 * 49" came back 0.9999999999999999, "5/6 - 1/6 - 1/6 - 1/6
 * - 1/6 - 1/6" came back 1.6e-16 instead of 0, and "1/1000003 as fraction"
 * answered "0/1" because the continued-fraction guess ran past its ceiling and
 * collapsed to zero. Those are the drifts a person who wrote a recipe, a split
 * or a share notices, and the second thing an exact calculator fixes after
 * money.
 *
 * A fraction now carries an exact rational (a bigint numerator and denominator,
 * always reduced) alongside the double. Integer division seeds it, "+", "-",
 * "*", "/", unary minus and comparison keep it, and "as fraction" renders it
 * exactly. The double is still there and is recomputed from the reduced
 * rational, so "1/3" reads back as the same 0.3333333333333333 it always did
 * and nothing that consumed `.value` or `toNumber()` had to change.
 *
 * The boundary is deliberate and asserted at the bottom: exactness holds only
 * for a fraction written with "/". A decimal literal ("0.1 + 0.2") is still the
 * double it was, a plain integer sum ("1e16 + 1 - 1e16") never grows a rational
 * and keeps its float association, transcendental work ("sqrt(2)^2") is still
 * float, and a bigint quotient ("100n / 3n") stays exact integer division.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/** The formatted, user-facing result of a single expression. */
function display(expr: string): string {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const [value] = engine.evaluateExpression(expr);
	return formatValue(value);
}

/** The evaluated Value, for asserting its number, type and rational sidecar directly. */
function evaluate(expr: string) {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const [value] = engine.evaluateExpression(expr);
	return value;
}

describe("the headline cases compute exactly rather than by luck", () => {
	test.each<[string, number]>([
		["1/3 + 1/3 + 1/3", 1],
		["2/7 * 14", 4],
		["2/3 + 1/3", 1],
		["1/3 * 3", 1],
		["7 * (1/7)", 1],
	])("%s is exactly %d", (expr, expected) => {
		expect(evaluate(expr).toNumber()).toBe(expected);
	});
});

describe("the value is the fraction, not the double it used to drift to", () => {
	test("a whole product that the doubles fall just short of", () => {
		// 1/49 * 49 is 0.9999999999999999 in doubles, and reads back as exactly 1.
		expect(evaluate("1/49 * 49").toNumber()).toBe(1);
	});

	test("a sum of sixths that the doubles fall just short of", () => {
		expect(evaluate("1/6 + 1/6 + 1/6 + 1/6 + 1/6 + 1/6").toNumber()).toBe(1);
	});

	test("a difference that the doubles leave a 1.6e-16 crumb of", () => {
		// 5/6 minus five sixths is exactly zero, where the doubles leave
		// 1.6653345369377348e-16 behind.
		expect(evaluate("5/6 - 1/6 - 1/6 - 1/6 - 1/6 - 1/6").toNumber()).toBe(0);
	});

	test("a repeated subtraction of a third", () => {
		expect(evaluate("1 - 1/3 - 1/3 - 1/3").toNumber()).toBe(0);
	});
});

describe("comparison is on the fraction, not on whichever double it landed on", () => {
	test.each<[string, boolean]>([
		["1/49 * 49 == 1", true],
		["5/6 - 1/6 - 1/6 - 1/6 - 1/6 - 1/6 == 0", true],
		["1/3 + 1/3 + 1/3 == 1", true],
		["1/3 < 1/2", true],
		["2/3 > 1/2", true],
		["2/4 == 1/2", true],
		["1/3 <= 1/3", true],
		["1/3 >= 1/3", true],
		["1/3 != 1/2", true],
	])("%s is %s", (expr, expected) => {
		expect(evaluate(expr).value).toBe(expected);
	});
});

describe("as fraction renders the exact fraction, reduced", () => {
	test.each<[string, string]>([
		["1/3 as fraction", "= 1/3"],
		["2/7 as fraction", "= 2/7"],
		["10/4 as fraction", "= 5/2"],
		["6/3 as fraction", "= 2"],
		["(1/3 + 1/7) as fraction", "= 10/21"],
		["(1/3 * 1/7) as fraction", "= 1/21"],
		["(1/2 - 1/3) as fraction", "= 1/6"],
		["-(1/3) as fraction", "= -1/3"],
		// The float continued-fraction guess collapses this to "0/1"; the exact
		// rational renders it as the fraction it actually is.
		["(1/1000003) as fraction", "= 1/1000003"],
	])("%s is %s", (expr, expected) => {
		expect(display(expr)).toBe(expected);
	});

	test("a value with no exact rational still gets the continued-fraction reading", () => {
		// 0.75 is a decimal literal, not a fraction, so it has no rational
		// sidecar and "as fraction" reads its double the way it always has.
		expect(display("0.75 as fraction")).toBe("= 3/4");
	});
});

describe("as decimal asks for the decimal, dropping the fraction", () => {
	test("a third reads back as the nearest double to a third", () => {
		const value = evaluate("1/3 as decimal");
		expect(value.type).toBe(ValueType.Number);
		expect(value.rational).toBeUndefined();
		expect(value.toNumber()).toBe(0.3333333333333333);
	});
});

describe("the fraction is reduced to lowest terms", () => {
	test.each<[string, bigint, bigint]>([
		["10/4", 5n, 2n],
		["6/3", 2n, 1n],
		["2/8", 1n, 4n],
		["100/10", 10n, 1n],
		["-4/6", -2n, 3n],
	])("%s reduces to %s/%s", (expr, n, d) => {
		const value = evaluate(expr);
		expect(value.rational).toEqual({ n, d });
	});
});

describe("the fraction value carries an exact rational and stays a Number", () => {
	test("a quotient of two integers is a Number with a rational sidecar", () => {
		const value = evaluate("1/3");
		expect(value.type).toBe(ValueType.Number);
		expect(value.rational).toEqual({ n: 1n, d: 3n });
		// The double is the same nearest-double a plain "1/3" always produced.
		expect(value.value).toBe(0.3333333333333333);
	});

	test("exactness survives a variable reference", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const doc = engine.parseDocument("a = 1/3\na + a + a", { inputType: "plaintext" });
		const last = doc.lines[doc.lines.length - 1];
		expect(last.result!.toNumber()).toBe(1);
	});

	test("a division that reduces to a whole number reads back exactly", () => {
		expect(evaluate("20/4").toNumber()).toBe(5);
		expect(evaluate("20/4").rational).toEqual({ n: 5n, d: 1n });
	});
});

describe("what must keep working", () => {
	test("a bare decimal sum between two plain numbers is still the double it was", () => {
		// The boundary: "0.1 + 0.2" is not a fraction written with "/", so it is
		// not made exact, and the famous double answer is the right one to keep.
		const value = evaluate("0.1 + 0.2");
		expect(value.type).toBe(ValueType.Number);
		expect(value.rational).toBeUndefined();
		expect(value.value).toBe(0.30000000000000004);
	});

	test("a decimal literal times three keeps its double drift", () => {
		expect(evaluate("0.1 * 3").toNumber()).toBe(0.30000000000000004);
		expect(evaluate("0.1 + 0.1 + 0.1").toNumber()).toBe(0.30000000000000004);
	});

	test("a plain integer sum never becomes a fraction, so its float association holds", () => {
		// If "1e16 + 1" had become the exact rational it is, this would answer 1,
		// which is the wrong double and would break IEEE association. Preserve-
		// only arithmetic means a sum with no fraction in it never grows one.
		expect(evaluate("1e16 + 1 - 1e16").toNumber()).toBe(0);
		expect(evaluate("1e16 - 1e16 + 1").toNumber()).toBe(1);
	});

	test("transcendental work is still float", () => {
		expect(evaluate("sqrt(2)^2").toNumber()).toBeCloseTo(2, 10);
	});

	test("a bigint quotient is still exact integer division, not a fraction", () => {
		const value = evaluate("100n / 3n");
		expect(value.type).toBe(ValueType.BigInt);
		expect(value.value).toBe(33n);
		expect(value.rational).toBeUndefined();
	});

	test("division by zero is still the double Infinity, not an error or a fraction", () => {
		const value = evaluate("1/0");
		expect(value.type).toBe(ValueType.Number);
		expect(value.rational).toBeUndefined();
		expect(value.toNumber()).toBe(Infinity);
	});

	test("zero over zero is still NaN, and unequal to itself", () => {
		expect(evaluate("0/0").toNumber()).toBeNaN();
		expect(evaluate("0/0 == 0/0").value).toBe(false);
	});

	test("a non-integer operand keeps the division on the float path", () => {
		// 5e-324 is not a whole number, so it has no rational image and the
		// quotient underflows to zero exactly as it did before.
		expect(evaluate("5e-324 / 2").toNumber()).toBe(0);
	});

	test("a non-currency unit is untouched", () => {
		expect(display("1.5 kg + 1.5 kg")).toBe("= 3.00 kg");
	});

	test("money keeps its own exact-decimal path, not the rational one", () => {
		expect(display("$0.10 + $0.20")).toBe("= $0.30");
	});

	test("the default display of a fraction is still its decimal", () => {
		// The boundary chosen for this slice: a fraction displays as its decimal
		// unless "as fraction" is asked for, so no existing float-division result
		// flips. "10 / 4" stays "2.50".
		expect(display("10/4")).toBe("= 2.50");
		expect(display("1/3")).toBe("= 0.33");
	});
});
