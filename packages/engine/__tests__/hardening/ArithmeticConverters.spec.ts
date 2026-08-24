/**
 * The value converters: fraction, scientific notation, multiplier, and the
 * rounding family.
 *
 * These are the operators a reader reaches for when the raw answer is not the
 * form they want, which means each of them is judged by its output string
 * rather than by a number, and a string result is the easiest kind of result
 * to get quietly wrong. `1/3 as fraction` producing "333333/1000000" would not
 * look like a failure to anyone reading a test summary.
 *
 * So every expected string below was derived from the input by hand: 2.75 is
 * eleven quarters, 0.125 is an eighth, 123456 is 1.23456 times ten to the
 * fifth. Where a conversion has to approximate (a repeating decimal has no
 * exact fraction) the tolerance it is allowed is stated in the test rather
 * than assumed.
 *
 * Rounding is tested for the increments and directions, not for the half-way
 * cases of negative numbers: `-5.5 rounded` currently answers -5 because the
 * underlying primitive rounds halves toward positive infinity, while `5.5
 * rounded` answers 6, and whether "rounded" should be symmetric about zero is
 * a decision rather than a bug. It is reported rather than pinned here.
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
const text = (source: string) => evaluate(source).value as string;

describe("as fraction", () => {
	test("gives the fraction in lowest terms", () => {
		expect(text("0.5 as fraction")).toBe("1/2");
		expect(text("0.125 as fraction")).toBe("1/8");
		expect(text("0.2 as fraction")).toBe("1/5");
		expect(text("2.75 as fraction")).toBe("11/4");
		expect(text("1.5 as fraction")).toBe("3/2");
	});

	test("keeps the sign on the numerator", () => {
		expect(text("-0.75 as fraction")).toBe("-3/4");
		expect(text("-2.25 as fraction")).toBe("-9/4");
	});

	test("a whole number has no denominator to print", () => {
		expect(text("3 as fraction")).toBe("3");
		expect(text("0 as fraction")).toBe("0");
		expect(text("-5 as fraction")).toBe("-5");
	});

	test("a repeating decimal resolves to the fraction it came from", () => {
		// 1/3 is not exactly representable, so a naive reading of the double
		// would produce an enormous denominator. The continued-fraction
		// expansion recovers the intended third.
		expect(text("1 / 3 as fraction")).toBe("1/3");
		expect(text("2 / 3 as fraction")).toBe("2/3");
		expect(text("1 / 7 as fraction")).toBe("1/7");
	});
});

describe("as sci", () => {
	test("normalises to one digit before the point", () => {
		expect(text("123456 as sci")).toBe("1.23456e+5");
		expect(text("1000 as sci")).toBe("1e+3");
		expect(text("0.000123 as sci")).toBe("1.23e-4");
	});

	test("keeps the sign on the mantissa", () => {
		expect(text("-123 as sci")).toBe("-1.23e+2");
		expect(text("-0.5 as sci")).toBe("-5e-1");
	});

	test("zero has no exponent worth having, and says so as e+0", () => {
		expect(text("0 as sci")).toBe("0e+0");
	});

	test("trailing mantissa zeros are trimmed", () => {
		// 1500000 is 1.5e+6, not "1.500000e+6".
		expect(text("1500000 as sci")).toBe("1.5e+6");
		expect(text("1e-7 as sci")).toBe("1e-7");
	});

	test("a value with no mantissa renders as itself", () => {
		// The conversion splits the exponential form on "e", and an infinity
		// or a NaN has no "e" in it, so the exponent half was undefined and
		// the answer read "NaNeundefined": a string that is not a number, not
		// an error, and not anything a reader can act on.
		expect(text("0 / 0 as sci")).toBe("NaN");
		expect(text("1 / 0 as sci")).toBe("Infinity");
		expect(text("-1 / 0 as sci")).toBe("-Infinity");
	});
});

describe("as multiplier", () => {
	test("a ratio is already the multiple", () => {
		expect(text("20 / 5 as multiplier")).toBe("4x");
		expect(text("0.5 as multiplier")).toBe("0.5x");
	});

	test("but a percentage is a change, so it grows from one", () => {
		// 50% more is 1.5 times as much. This is the distinction that only
		// became expressible once `%` produced a Percentage rather than a
		// bare fraction.
		expect(text("50% as multiplier")).toBe("1.5x");
		expect(text("100% as multiplier")).toBe("2x");
	});

	test("and a percentage change reads the same way", () => {
		expect(text("20 to 40 as x")).toBe("2x");
	});
});

describe("rounding to a whole number", () => {
	test("nearest, up, and down", () => {
		expect(num("5.5 rounded")).toBe(6);
		expect(num("5.4 rounded")).toBe(5);
		expect(num("5.5 rounded up")).toBe(6);
		expect(num("5.1 rounded up")).toBe(6);
		expect(num("5.5 rounded down")).toBe(5);
		expect(num("5.9 rounded down")).toBe(5);
	});

	test("up and down mean toward positive and negative, not away from zero", () => {
		// Worth stating explicitly: "rounded down" on a negative number makes
		// it more negative, because down is a direction on the number line.
		expect(num("-5.5 rounded down")).toBe(-6);
		expect(num("-5.5 rounded up")).toBe(-5);
		expect(num("-2.5 rounded up")).toBe(-2);
	});

	test("a whole number is left where it is", () => {
		expect(num("5 rounded")).toBe(5);
		expect(num("5 rounded up")).toBe(5);
		expect(num("-5 rounded down")).toBe(-5);
	});
});

describe("rounding to an increment", () => {
	test("to a number", () => {
		expect(num("37 to nearest 10")).toBe(40);
		expect(num("34 to nearest 10")).toBe(30);
		expect(num("21 rounded up to nearest 5")).toBe(25);
		expect(num("21 rounded down to nearest 5")).toBe(20);
	});

	test("to a magnitude word", () => {
		expect(num("1234 to nearest thousand")).toBe(1000);
		expect(num("1500 to nearest thousand")).toBe(2000);
		expect(num("490 to nearest hundred")).toBe(500);
		expect(num("449 to nearest hundred")).toBe(400);
	});

	test("negative values round to the nearest increment either side", () => {
		expect(num("-37 to nearest 10")).toBe(-40);
		expect(num("-34 to nearest 10")).toBe(-30);
	});

	test("an increment that is not a positive number is refused", () => {
		expect(() => evaluate("37 to nearest 0")).toThrow(/nearest/i);
		expect(() => evaluate("37 to nearest -10")).toThrow(/nearest/i);
	});
});

describe("rounding to decimal places", () => {
	test("rounds the whole expression to its left, not the last operand", () => {
		// The binding power is what makes this a third rounded to two places
		// rather than a division by a rounded 3.
		expect(num("1 / 3 to 2 dp")).toBe(0.33);
		expect(num("2 / 3 to 2 dp")).toBe(0.67);
	});

	test("at various place counts", () => {
		expect(num("1.23456 to 3 dp")).toBe(1.235);
		expect(num("1.23456 to 1 dp")).toBe(1.2);
		expect(num("123.456 to 0 dp")).toBe(123);
		expect(num("2.345 to 2 dp")).toBe(2.35);
	});

	test("carries into the next place when the digits demand it", () => {
		expect(num("99.999 to 2 dp")).toBe(100);
		expect(num("0.999 to 2 dp")).toBe(1);
	});

	test("a place count outside the supported range is refused", () => {
		expect(() => evaluate("1.5 to 101 dp")).toThrow(/place count/i);
	});

	test("and the result is an ordinary number, ready for more arithmetic", () => {
		expect(evaluate("1 / 3 to 2 dp").type).toBe(ValueType.Number);
		expect(num("(1 / 3 to 2 dp) * 3")).toBe(0.99);
	});

	test("a whole number has no decimals to round, so it comes back unchanged", () => {
		// The rounding used to be emitted as "× 10^p, round, ÷ 10^p", which is
		// only exact while the multiplication is. 1e21 has no fractional part
		// at all, and the round trip through 1e23 returned
		// 999999999999999900000: a number that had been asked for MORE
		// precision and came back with less.
		expect(num("1e21 to 2 dp")).toBe(1e21);
		expect(num("1e21 to 0 dp")).toBe(1e21);
		expect(num("123 to 4 dp")).toBe(123);
		expect(num("9007199254740993 to 2 dp")).toBe(9007199254740992);
	});

	test("and asking for more places than a number has changes nothing", () => {
		expect(num("1.5 to 100 dp")).toBe(1.5);
		expect(num("0.25 to 10 dp")).toBe(0.25);
	});

	test("a non-finite value has no decimals either", () => {
		expect(num("1 / 0 to 2 dp")).toBe(Infinity);
		expect(num("0 / 0 to 2 dp")).toBeNaN();
	});
});

describe("the rounding family keeps the unit it was given", () => {
	test("so money that is rounded is still money", () => {
		// `RoundingParselets.ts`'s own header offers this exact line as an
		// example, answering $500. It answered a bare 500: the amount survived
		// and the currency did not, which is the half of an answer that looks
		// most like a whole one.
		const rounded = evaluate("$490 rounded to nearest hundred");
		expect(rounded.type).toBe(ValueType.Uom);
		expect(rounded.unit).toBe("USD");
		expect(rounded.toNumber()).toBe(500);
	});

	test("and so is a measurement", () => {
		for (const source of ["5.4 kg rounded", "5.4 kg rounded up", "5.6 kg rounded down"]) {
			const value = evaluate(source);
			expect(value.type).toBe(ValueType.Uom);
			expect(value.unit).toBe("kg");
		}
		expect(num("5.4 kg rounded")).toBe(5);
		expect(num("5.4 kg rounded up")).toBe(6);
		expect(num("5.6 kg rounded down")).toBe(5);
	});

	test("including through the decimal-places form", () => {
		const value = evaluate("1.239 kg to 2 dp");
		expect(value.unit).toBe("kg");
		expect(value.toNumber()).toBe(1.24);
	});

	test("and abs keeps it too", () => {
		const value = evaluate("abs(-5 kg)");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.unit).toBe("kg");
		expect(value.toNumber()).toBe(5);
	});

	test("while a plain number stays a plain number", () => {
		expect(evaluate("5.4 rounded").type).toBe(ValueType.Number);
		expect(evaluate("abs(-5)").type).toBe(ValueType.Number);
	});
});
