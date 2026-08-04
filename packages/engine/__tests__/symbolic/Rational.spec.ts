/**
 * Exact rational arithmetic, the foundation everything else in the CAS rests on.
 *
 * `rationalFromNumber` is the sharpest edge in the module and gets the most
 * attention here: converting through the IEEE expansion rather than the decimal
 * string would make `0.1` into `3602879701896397/36028797018963968`, which is
 * mathematically correct and ruins every display and every factorization
 * downstream.
 */
import { describe, expect, test } from "@jest/globals";
import {
	type Rational,
	RATIONAL_ZERO,
	RATIONAL_ONE,
	RATIONAL_MINUS_ONE,
	RATIONAL_MAX_BITS,
	rational,
	rationalFromNumber,
	rationalToNumber,
	rationalAdd,
	rationalSub,
	rationalMul,
	rationalDiv,
	rationalNeg,
	rationalPow,
	rationalCompare,
	isRationalZero,
	isRationalOne,
	isRationalMinusOne,
	isRationalInteger,
	formatRational,
} from "@solve-js/symbolic/Rational";

/** Renders a rational as `n/d` for comparison, bypassing the display rules. */
function pair(r: Rational): string {
	return `${r.n}/${r.d}`;
}

describe("rationalFromNumber — conversion by the written decimal, not the IEEE expansion", () => {
	test("a tenth is one tenth, not its binary expansion", () => {
		expect(pair(rationalFromNumber(0.1))).toBe("1/10");
	});

	test("the classic floating-point sum is exact here", () => {
		expect(pair(rationalAdd(rationalFromNumber(0.1), rationalFromNumber(0.2)))).toBe("3/10");
	});

	test("a negative decimal", () => {
		expect(pair(rationalFromNumber(-2.5))).toBe("-5/2");
	});

	test("integers take the fast path", () => {
		expect(pair(rationalFromNumber(42))).toBe("42/1");
		expect(pair(rationalFromNumber(-7))).toBe("-7/1");
		expect(pair(rationalFromNumber(0))).toBe("0/1");
	});

	test("an integer beyond the double's contiguous range still converts exactly", () => {
		expect(pair(rationalFromNumber(2 ** 53))).toBe("9007199254740992/1");
	});

	test("the small-exponent form toString emits below 1e-6", () => {
		// String(1e-7) is "1e-7", not "0.0000001", so the exponent branch runs.
		expect(pair(rationalFromNumber(1e-7))).toBe("1/10000000");
	});

	test("the large-exponent form toString emits at or above 1e21", () => {
		expect(pair(rationalFromNumber(1e21))).toBe("1000000000000000000000/1");
	});

	test("a value with both a fraction and an exponent", () => {
		expect(pair(rationalFromNumber(1.5e-7))).toBe("3/20000000");
	});

	test("NaN and the infinities have no rational image and are refused", () => {
		expect(() => rationalFromNumber(Number.NaN)).toThrow(/no exact value/i);
		expect(() => rationalFromNumber(Number.POSITIVE_INFINITY)).toThrow(/no exact value/i);
		expect(() => rationalFromNumber(Number.NEGATIVE_INFINITY)).toThrow(/no exact value/i);
	});
});

describe("normalization", () => {
	test("a fraction is reduced", () => {
		expect(pair(rational(4n, 8n))).toBe("1/2");
	});

	test("a negative denominator moves its sign to the numerator", () => {
		expect(pair(rational(1n, -2n))).toBe("-1/2");
		expect(pair(rational(-1n, -2n))).toBe("1/2");
	});

	test("zero normalizes to a single canonical form", () => {
		expect(pair(rational(0n, 5n))).toBe("0/1");
		expect(pair(rational(0n, -5n))).toBe("0/1");
	});

	test("a zero denominator is a division by zero", () => {
		expect(() => rational(1n, 0n)).toThrow(/division by zero/i);
	});

	test("equal values are structurally identical, which is what lets them be map keys", () => {
		expect(rational(2n, 4n)).toEqual(rational(1n, 2n));
		expect(rationalFromNumber(0.5)).toEqual(rational(1n, 2n));
	});
});

describe("arithmetic is exact", () => {
	test("addition and subtraction", () => {
		expect(pair(rationalAdd(rational(1n, 3n), rational(1n, 6n)))).toBe("1/2");
		expect(pair(rationalSub(rational(1n, 3n), rational(1n, 6n)))).toBe("1/6");
	});

	test("a third added three times is exactly one", () => {
		const third = rational(1n, 3n);
		expect(pair(rationalAdd(rationalAdd(third, third), third))).toBe("1/1");
	});

	test("multiplication and division", () => {
		expect(pair(rationalMul(rational(2n, 3n), rational(3n, 4n)))).toBe("1/2");
		expect(pair(rationalDiv(rational(1n, 2n), rational(1n, 4n)))).toBe("2/1");
	});

	test("dividing by zero is refused rather than producing infinity", () => {
		expect(() => rationalDiv(RATIONAL_ONE, RATIONAL_ZERO)).toThrow(/division by zero/i);
	});

	test("negation", () => {
		expect(pair(rationalNeg(rational(2n, 3n)))).toBe("-2/3");
		expect(pair(rationalNeg(RATIONAL_ZERO))).toBe("0/1");
	});

	test("integer powers, including negative ones", () => {
		expect(pair(rationalPow(rational(2n, 3n), 3n))).toBe("8/27");
		expect(pair(rationalPow(rational(2n, 3n), -2n))).toBe("9/4");
		expect(pair(rationalPow(rational(5n, 1n), 0n))).toBe("1/1");
	});

	test("zero to a negative power is refused", () => {
		expect(() => rationalPow(RATIONAL_ZERO, -1n)).toThrow(/zero raised to a negative/i);
	});
});

describe("comparison and predicates", () => {
	test("comparison works across differing denominators and signs", () => {
		expect(rationalCompare(rational(1n, 3n), rational(1n, 2n))).toBe(-1);
		expect(rationalCompare(rational(1n, 2n), rational(1n, 3n))).toBe(1);
		expect(rationalCompare(rational(2n, 4n), rational(1n, 2n))).toBe(0);
		expect(rationalCompare(rational(-1n, 2n), rational(1n, 3n))).toBe(-1);
	});

	test("sorting a mixed list puts it in ascending order", () => {
		const values = [rational(1n, 2n), rational(-3n, 1n), RATIONAL_ZERO, rational(1n, 3n)];
		expect(values.slice().sort(rationalCompare).map(pair)).toEqual(["-3/1", "0/1", "1/3", "1/2"]);
	});

	test("the predicates", () => {
		expect(isRationalZero(RATIONAL_ZERO)).toBe(true);
		expect(isRationalZero(rational(0n, 7n))).toBe(true);
		expect(isRationalOne(RATIONAL_ONE)).toBe(true);
		expect(isRationalOne(rational(3n, 3n))).toBe(true);
		expect(isRationalMinusOne(RATIONAL_MINUS_ONE)).toBe(true);
		expect(isRationalInteger(rational(6n, 3n))).toBe(true);
		expect(isRationalInteger(rational(1n, 3n))).toBe(false);
	});
});

describe("rationalToNumber", () => {
	test("ordinary values round-trip", () => {
		expect(rationalToNumber(rational(1n, 2n))).toBe(0.5);
		expect(rationalToNumber(rational(-7n, 1n))).toBe(-7);
		expect(rationalToNumber(rational(1n, 3n))).toBeCloseTo(1 / 3, 15);
	});

	test("a ratio of two values that each overflow a double still gives the ratio", () => {
		// Both components are far beyond 2^1024, so the naive Number(n)/Number(d)
		// would be Infinity/Infinity and produce NaN. The `+ 1n` keeps the pair
		// coprime, so normalization cannot quietly reduce this to 3/1 and make
		// the test prove nothing. Written with `<<` rather than `**`: the test
		// tsconfig targets ES6, where `**` lowers to Math.pow, which throws on
		// bigints. That is the same trap Rational.ts's own bigintPow documents.
		const huge = 1n << 1400n;
		expect(rationalToNumber(rational(huge * 3n + 1n, huge))).toBeCloseTo(3, 9);
	});
});

describe("the magnitude ceiling", () => {
	test("a value past RATIONAL_MAX_BITS is refused rather than growing without bound", () => {
		const nearLimit = rational(1n << BigInt(RATIONAL_MAX_BITS - 1), 1n);
		expect(() => rationalMul(nearLimit, rational(4n, 1n))).toThrow(/too large/i);
	});

	test("a value just inside the ceiling is accepted", () => {
		expect(() => rational(1n << BigInt(RATIONAL_MAX_BITS - 1), 1n)).not.toThrow();
	});
});

describe("formatRational — the display rules", () => {
	test("whole numbers print as digits", () => {
		expect(formatRational(rational(2n, 1n))).toBe("2");
		expect(formatRational(rational(-7n, 1n))).toBe("-7");
		expect(formatRational(rational(4n, 2n))).toBe("2");
	});

	test("a short terminating decimal prints as one", () => {
		expect(formatRational(rational(5n, 2n))).toBe("2.5");
		expect(formatRational(rational(1n, 10n))).toBe("0.1");
		expect(formatRational(rational(-3n, 4n))).toBe("-0.75");
	});

	test("a non-terminating fraction prints as a fraction, which is the only exact option", () => {
		expect(formatRational(rational(1n, 3n))).toBe("1/3");
		expect(formatRational(rational(2n, 3n))).toBe("2/3");
		expect(formatRational(rational(-1n, 6n))).toBe("-1/6");
	});

	test("a fraction too large to read falls back to a rounded decimal", () => {
		// sqrt(2) converted exactly is 14142135623730951/10000000000000000:
		// correct, and useless on screen.
		expect(formatRational(rationalFromNumber(Math.SQRT2))).toBe("1.4142135624");
	});

	test("every rendering parses back to the same value where it is exact", () => {
		const exactCases = [rational(5n, 2n), rational(1n, 10n), rational(-3n, 4n), rational(2n, 1n)];
		for (const value of exactCases) {
			expect(pair(rationalFromNumber(Number(formatRational(value))))).toBe(pair(value));
		}
	});
});
