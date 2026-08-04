/**
 * Exact complex arithmetic over the Gaussian rationals.
 *
 * The point of exactness here is recognising a real answer as real. In floating
 * point a conjugate pair's imaginary parts cancel to something near zero but
 * almost never to zero, so `(1+i)(1-i)` keeps an imaginary trace forever. With
 * exact components it is `2`, and the field laws below can be asserted rather
 * than approximated.
 */
import { describe, expect, test } from "@jest/globals";
import {
	type Complex,
	COMPLEX_ZERO,
	COMPLEX_ONE,
	COMPLEX_I,
	complex,
	isReal,
	isComplexZero,
	complexAdd,
	complexSub,
	complexMul,
	complexDiv,
	complexNeg,
	complexConjugate,
	complexNormSquared,
	complexPow,
	complexEquals,
	formatComplex,
	exactComplexSqrt,
} from "@solve-js/symbolic/Complex";
import { rational, RATIONAL_ZERO } from "@solve-js/symbolic/Rational";

/** Shorthand for a complex from two integers. */
function z(re: number, im: number): Complex {
	return complex(rational(BigInt(re)), rational(BigInt(im)));
}

describe("the field laws hold exactly", () => {
	const a = z(2, 3);
	const b = z(-1, 4);
	const c = z(5, -2);

	test("addition commutes and associates", () => {
		expect(complexEquals(complexAdd(a, b), complexAdd(b, a))).toBe(true);
		expect(complexEquals(complexAdd(complexAdd(a, b), c), complexAdd(a, complexAdd(b, c)))).toBe(true);
	});

	test("multiplication commutes and associates", () => {
		expect(complexEquals(complexMul(a, b), complexMul(b, a))).toBe(true);
		expect(complexEquals(complexMul(complexMul(a, b), c), complexMul(a, complexMul(b, c)))).toBe(true);
	});

	test("multiplication distributes over addition", () => {
		const left = complexMul(a, complexAdd(b, c));
		const right = complexAdd(complexMul(a, b), complexMul(a, c));
		expect(complexEquals(left, right)).toBe(true);
	});

	test("the identities behave", () => {
		expect(complexEquals(complexAdd(a, COMPLEX_ZERO), a)).toBe(true);
		expect(complexEquals(complexMul(a, COMPLEX_ONE), a)).toBe(true);
	});

	test("every non-zero value has an exact inverse", () => {
		for (const value of [a, b, c, COMPLEX_I]) {
			const inverse = complexDiv(COMPLEX_ONE, value);
			expect(complexEquals(complexMul(value, inverse), COMPLEX_ONE)).toBe(true);
		}
	});

	test("subtraction and negation agree", () => {
		expect(complexEquals(complexSub(a, b), complexAdd(a, complexNeg(b)))).toBe(true);
	});

	test("dividing by zero is refused rather than producing a NaN pair", () => {
		expect(() => complexDiv(a, COMPLEX_ZERO)).toThrow(/division by zero/i);
	});
});

describe("the imaginary unit", () => {
	test("i squared is exactly minus one", () => {
		expect(complexEquals(complexMul(COMPLEX_I, COMPLEX_I), z(-1, 0))).toBe(true);
	});

	test("the powers of i cycle with period four", () => {
		const expected = [z(1, 0), z(0, 1), z(-1, 0), z(0, -1)];
		for (let n = 0; n < 12; n++) {
			expect(complexEquals(complexPow(COMPLEX_I, BigInt(n)), expected[n % 4])).toBe(true);
		}
	});

	test("a negative power of i is exact too", () => {
		expect(complexEquals(complexPow(COMPLEX_I, -1n), z(0, -1))).toBe(true);
	});
});

describe("conjugates and the modulus", () => {
	test("a value times its conjugate is real, and exactly so", () => {
		for (const value of [z(1, 1), z(2, 3), z(-4, 5)]) {
			const product = complexMul(value, complexConjugate(value));
			expect(isReal(product)).toBe(true);
			// This is the assertion floating point cannot make: exactly zero
			// imaginary part, not merely a small one.
			expect(product.im.n).toBe(0n);
		}
	});

	test("conjugation is its own inverse", () => {
		const value = z(2, -7);
		expect(complexEquals(complexConjugate(complexConjugate(value)), value)).toBe(true);
	});

	test("the conjugate of a product is the product of the conjugates", () => {
		const a = z(2, 3);
		const b = z(-1, 5);
		expect(complexEquals(complexConjugate(complexMul(a, b)), complexMul(complexConjugate(a), complexConjugate(b)))).toBe(true);
	});

	test("the squared modulus matches the value times its conjugate", () => {
		const value = z(3, 4);
		expect(complexNormSquared(value)).toEqual(rational(25n));
	});
});

describe("exact square roots", () => {
	test("a negative real gives a purely imaginary root", () => {
		expect(complexEquals(exactComplexSqrt(z(-4, 0))!, z(0, 2))).toBe(true);
		expect(complexEquals(exactComplexSqrt(z(-9, 0))!, z(0, 3))).toBe(true);
	});

	test("a Gaussian rational root is found when there is one", () => {
		// (3+4i)^2 is -7+24i, so the root of -7+24i is 3+4i.
		expect(complexEquals(exactComplexSqrt(z(-7, 24))!, z(3, 4))).toBe(true);
	});

	test("every exact root squares back to what it came from", () => {
		for (const value of [z(-4, 0), z(-9, 0), z(-7, 24), z(0, 0), z(16, 0)]) {
			const root = exactComplexSqrt(value);
			if (root === null) continue;
			expect(complexEquals(complexMul(root, root), value)).toBe(true);
		}
	});

	test("an irrational root declines rather than approximating", () => {
		expect(exactComplexSqrt(z(-2, 0))).toBeNull();
		expect(exactComplexSqrt(z(0, 1))).toBeNull();
	});
});

describe("predicates", () => {
	test("a zero imaginary part means the value is really real", () => {
		expect(isReal(z(5, 0))).toBe(true);
		expect(isReal(z(0, 5))).toBe(false);
		expect(isComplexZero(COMPLEX_ZERO)).toBe(true);
		expect(isComplexZero(z(0, 1))).toBe(false);
	});
});

describe("formatComplex", () => {
	test("writes the way a person writes it", () => {
		expect(formatComplex(z(2, 3))).toBe("2+3i");
		expect(formatComplex(z(2, -3))).toBe("2-3i");
		expect(formatComplex(z(0, 1))).toBe("i");
		expect(formatComplex(z(0, -1))).toBe("-i");
		expect(formatComplex(z(0, 3))).toBe("3i");
		expect(formatComplex(z(-1, -2))).toBe("-1-2i");
	});

	test("a real value renders with no imaginary part at all", () => {
		expect(formatComplex(z(4, 0))).toBe("4");
		expect(formatComplex(COMPLEX_ZERO)).toBe("0");
	});

	test("fractional parts stay exact", () => {
		expect(formatComplex(complex(rational(1n, 2n), rational(1n, 3n)))).toBe("0.5+1/3i");
	});

	test("a unit coefficient is a bare i, not 1i", () => {
		expect(formatComplex(complex(RATIONAL_ZERO, rational(1n)))).toBe("i");
	});
});
