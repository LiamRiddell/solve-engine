/**
 * Exact complex arithmetic over the Gaussian rationals.
 *
 * Both components are {@link Rational}, so this is exact in the same sense the
 * rest of the system is: `(1+2i)/(3-4i)` has an exact answer and gets it,
 * rather than a pair of doubles that are nearly right. That matters most where
 * a complex value has to be recognised as zero, which is how a cubic's
 * *casus irreducibilis* is detected and how a conjugate pair cancels.
 *
 * ## Why the number tower stops here
 *
 * Real values stay {@link Rational} throughout. A complex value only appears
 * when something genuinely produces one: a negative discriminant, a square root
 * of a negative number, or an explicit `i`. That keeps every real-only path
 * paying nothing for complex support, and it keeps `factor` and `solve` working
 * over the rationals by default, which is what a CAS is expected to do.
 *
 * A complex whose imaginary part is zero is collapsed back to a real constant
 * at the boundary, so `(1+i)*(1-i)` reads as `2` rather than `2+0i`.
 */

import {
	type Rational,
	RATIONAL_ZERO,
	RATIONAL_ONE,
	rationalAdd,
	rationalSub,
	rationalMul,
	rationalDiv,
	rationalNeg,
	isRationalZero,
	isRationalOne,
	formatRational,
} from "@solve-js/symbolic/Rational";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * An exact complex number, `re + im * i`, with both parts rational.
 *
 * Construct through {@link complex} rather than as an object literal, so the
 * real-collapse convention below stays consistent.
 */
export interface Complex {
	/** Real part. */
	readonly re: Rational;
	/** Imaginary part. Zero means this value is really a real number. */
	readonly im: Rational;
}

/** The complex zero. */
export const COMPLEX_ZERO: Complex = { re: RATIONAL_ZERO, im: RATIONAL_ZERO };

/** The complex one. */
export const COMPLEX_ONE: Complex = { re: RATIONAL_ONE, im: RATIONAL_ZERO };

/** The imaginary unit. */
export const COMPLEX_I: Complex = { re: RATIONAL_ZERO, im: RATIONAL_ONE };

/**
 * Builds a complex number from its two parts.
 *
 * @param re - Real part.
 * @param im - Imaginary part, defaulting to zero.
 * @returns The complex value.
 */
export function complex(re: Rational, im: Rational = RATIONAL_ZERO): Complex {
	return { re, im };
}

/**
 * Whether a complex value is really a real one.
 *
 * @param z - The value to test.
 * @returns True when the imaginary part is exactly zero. Exact, which is the
 * point: in floating point a conjugate pair's imaginary parts cancel to
 * something near zero but rarely to zero, so a real answer would keep an
 * imaginary trace forever.
 */
export function isReal(z: Complex): boolean {
	return isRationalZero(z.im);
}

/**
 * Whether a complex value is exactly zero.
 *
 * @param z - The value to test.
 * @returns True when both parts are zero.
 */
export function isComplexZero(z: Complex): boolean {
	return isRationalZero(z.re) && isRationalZero(z.im);
}

/**
 * Whether a complex value is exactly one.
 *
 * @param z - The value to test.
 * @returns True when it equals one.
 */
export function isComplexOne(z: Complex): boolean {
	return isRationalOne(z.re) && isRationalZero(z.im);
}

/**
 * Exact addition.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `a + b`.
 */
export function complexAdd(a: Complex, b: Complex): Complex {
	return { re: rationalAdd(a.re, b.re), im: rationalAdd(a.im, b.im) };
}

/**
 * Exact subtraction.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `a - b`.
 */
export function complexSub(a: Complex, b: Complex): Complex {
	return { re: rationalSub(a.re, b.re), im: rationalSub(a.im, b.im) };
}

/**
 * Exact multiplication.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `a * b`, by the usual `(ac - bd) + (ad + bc)i`.
 */
export function complexMul(a: Complex, b: Complex): Complex {
	return {
		re: rationalSub(rationalMul(a.re, b.re), rationalMul(a.im, b.im)),
		im: rationalAdd(rationalMul(a.re, b.im), rationalMul(a.im, b.re)),
	};
}

/**
 * Exact division, by multiplying through by the conjugate.
 *
 * @param a - Dividend.
 * @param b - Divisor.
 * @returns `a / b`.
 * @throws {EngineError} `SYMBOLIC_DIVISION_BY_ZERO` when `b` is zero.
 */
export function complexDiv(a: Complex, b: Complex): Complex {
	if (isComplexZero(b)) {
		throw ErrorFactory.execution("SYMBOLIC_DIVISION_BY_ZERO", "Division by zero in a complex expression.");
	}
	// |b|^2, which is real and non-zero, so the two component divisions are exact.
	const denominator = rationalAdd(rationalMul(b.re, b.re), rationalMul(b.im, b.im));
	return {
		re: rationalDiv(rationalAdd(rationalMul(a.re, b.re), rationalMul(a.im, b.im)), denominator),
		im: rationalDiv(rationalSub(rationalMul(a.im, b.re), rationalMul(a.re, b.im)), denominator),
	};
}

/**
 * Exact negation.
 *
 * @param z - The value to negate.
 * @returns `-z`.
 */
export function complexNeg(z: Complex): Complex {
	return { re: rationalNeg(z.re), im: rationalNeg(z.im) };
}

/**
 * The complex conjugate.
 *
 * @param z - The value.
 * @returns `z` with the sign of its imaginary part flipped.
 */
export function complexConjugate(z: Complex): Complex {
	return { re: z.re, im: rationalNeg(z.im) };
}

/**
 * The squared modulus, which stays exact where the modulus itself would not.
 *
 * @param z - The value.
 * @returns `re^2 + im^2`, a rational. The modulus is its square root, which is
 * usually irrational, so callers wanting a magnitude should take the root of
 * this rather than expect one here.
 */
export function complexNormSquared(z: Complex): Rational {
	return rationalAdd(rationalMul(z.re, z.re), rationalMul(z.im, z.im));
}

/**
 * Exact integer power, by repeated squaring.
 *
 * @param base - The base.
 * @param exponent - Integer exponent, which may be negative.
 * @returns `base ** exponent`.
 * @throws {EngineError} `SYMBOLIC_DIVISION_BY_ZERO` for a zero base raised to a
 * negative power.
 */
export function complexPow(base: Complex, exponent: bigint): Complex {
	if (exponent === 0n) return COMPLEX_ONE;
	if (exponent < 0n) {
		if (isComplexZero(base)) {
			throw ErrorFactory.execution("SYMBOLIC_DIVISION_BY_ZERO", "Zero raised to a negative power is undefined.");
		}
		return complexDiv(COMPLEX_ONE, complexPow(base, -exponent));
	}
	let result = COMPLEX_ONE;
	let factor = base;
	let remaining = exponent;
	while (remaining > 0n) {
		if (remaining % 2n === 1n) result = complexMul(result, factor);
		factor = complexMul(factor, factor);
		remaining /= 2n;
	}
	return result;
}

/**
 * Structural equality.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns True when both parts match. Exact, so this is mathematical equality
 * rather than a tolerance comparison.
 */
export function complexEquals(a: Complex, b: Complex): boolean {
	return a.re.n === b.re.n && a.re.d === b.re.d && a.im.n === b.im.n && a.im.d === b.im.d;
}

/**
 * Renders a complex number the way it is written.
 *
 * `3i` rather than `0+3i`, `2-i` rather than `2+-1i`, and a bare real when the
 * imaginary part has vanished.
 *
 * @param z - The value to render.
 * @returns The display string.
 */
export function formatComplex(z: Complex): string {
	if (isRationalZero(z.im)) return formatRational(z.re);

	const magnitude = z.im.n < 0n ? rationalNeg(z.im) : z.im;
	// A unit coefficient is written as a bare `i`, the way a person writes it.
	const imaginary = isRationalOne(magnitude) ? "i" : `${formatRational(magnitude)}i`;

	if (isRationalZero(z.re)) return z.im.n < 0n ? `-${imaginary}` : imaginary;
	return z.im.n < 0n ? `${formatRational(z.re)}-${imaginary}` : `${formatRational(z.re)}+${imaginary}`;
}

/**
 * The exact square roots of a complex number, when both are Gaussian rational.
 *
 * A square root is only exact here when the result stays in the Gaussian
 * rationals, which needs `|z|` and then the two components each to be rational
 * squares. `sqrt(-4)` is exactly `2i`; `sqrt(i)` is not rational and comes back
 * `null` so the caller can leave it symbolic rather than approximate it.
 *
 * @param z - The value to take the root of.
 * @returns The principal root, or `null` when it is not a Gaussian rational.
 */
export function exactComplexSqrt(z: Complex): Complex | null {
	if (isComplexZero(z)) return COMPLEX_ZERO;

	// |z| must be rational for either component to be.
	const modulus = exactRationalSqrt(complexNormSquared(z));
	if (modulus === null) return null;

	// The standard half-angle construction: re' = sqrt((|z| + re)/2).
	const two: Rational = { n: 2n, d: 1n };
	const realPart = exactRationalSqrt(rationalDiv(rationalAdd(modulus, z.re), two));
	if (realPart === null) return null;

	if (isRationalZero(realPart)) {
		// z is a negative real, so the root is purely imaginary.
		const imaginaryPart = exactRationalSqrt(rationalDiv(rationalSub(modulus, z.re), two));
		return imaginaryPart === null ? null : { re: RATIONAL_ZERO, im: imaginaryPart };
	}

	const imaginaryPart = rationalDiv(z.im, rationalMul(two, realPart));
	return { re: realPart, im: imaginaryPart };
}

/** Exact square root of a non-negative rational, or `null` when it is irrational. */
function exactRationalSqrt(value: Rational): Rational | null {
	if (value.n < 0n) return null;
	const numerator = exactBigintSqrt(value.n);
	const denominator = exactBigintSqrt(value.d);
	return numerator === null || denominator === null ? null : { n: numerator, d: denominator };
}

/** Exact integer square root, or `null` when `value` is not a perfect square. */
function exactBigintSqrt(value: bigint): bigint | null {
	if (value < 0n) return null;
	if (value < 2n) return value;
	let previous = value;
	let current = (value + 1n) / 2n;
	while (current < previous) {
		previous = current;
		current = (previous + value / previous) / 2n;
	}
	return previous * previous === value ? previous : null;
}
