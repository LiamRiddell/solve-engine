/**
 * Polynomial division and greatest common divisors over the rationals.
 *
 * This is the piece the rest of the rational-function machinery stands on.
 * Cancelling `(x^2-1)/(x-1)` to `x+1`, splitting a fraction into partial
 * fractions, and integrating a rational function all reduce to "divide these
 * two polynomials and find what they share".
 *
 * Everything here is univariate. Multivariate GCD is a genuinely harder problem
 * (the usual approaches are modular or use Kronecker substitution), and the
 * univariate case covers what cancellation, partial fractions and rational
 * integration actually need. {@link polynomialGcd} declines rather than guessing
 * when handed more than one variable.
 *
 * Coefficients are exact, which matters more here than almost anywhere else in
 * the system: the Euclidean algorithm decides at every step whether a remainder
 * is zero, and in floating point that question has no reliable answer.
 */

import {
	type Rational,
	RATIONAL_ZERO,
	RATIONAL_ONE,
	rationalAdd,
	rationalSub,
	rationalMul,
	rationalDiv,
	isRationalZero,
	isRationalOne,
} from "@solve-js/symbolic/Rational";
import {
	type Polynomial,
	toPolynomial,
	fromPolynomial,
	polyDegree,
	polyUnivariateVar,
	polyCoefficients,
} from "@solve-js/symbolic/Polynomial";
import type { SymbolicNode } from "@solve-js/symbolic/SymbolicNode";

/** A polynomial as dense coefficients, index `i` holding the coefficient of `x^i`. */
export type Coefficients = readonly Rational[];

/** Drops trailing zero coefficients, so the degree is always the real one. */
function trim(coefficients: Rational[]): Rational[] {
	let last = coefficients.length - 1;
	while (last >= 0 && isRationalZero(coefficients[last])) last--;
	return coefficients.slice(0, last + 1);
}

/**
 * Whether a coefficient list is the zero polynomial.
 *
 * @param coefficients - Ascending coefficients.
 * @returns True when every coefficient is zero.
 */
export function isZeroPolynomial(coefficients: Coefficients): boolean {
	return coefficients.every(isRationalZero);
}

/**
 * Divides one polynomial by another, exactly.
 *
 * @param dividend - Ascending coefficients of the numerator.
 * @param divisor - Ascending coefficients of the denominator, which must not be
 * the zero polynomial.
 * @returns The quotient and remainder, both ascending, satisfying
 * `dividend = divisor * quotient + remainder` with the remainder of lower
 * degree than the divisor.
 * @throws {Error} When the divisor is zero, which is a caller error rather than
 * a user-facing condition.
 */
export function polynomialDivide(
	dividend: Coefficients,
	divisor: Coefficients,
): { quotient: Rational[]; remainder: Rational[] } {
	const numerator = trim([...dividend]);
	const denominator = trim([...divisor]);
	if (denominator.length === 0) throw new Error("polynomialDivide: division by the zero polynomial");

	const divisorDegree = denominator.length - 1;
	const leading = denominator[divisorDegree];
	const remainder = [...numerator];
	const quotient: Rational[] = new Array(Math.max(0, numerator.length - divisorDegree)).fill(RATIONAL_ZERO);

	for (let degree = remainder.length - 1; degree >= divisorDegree; degree--) {
		if (isRationalZero(remainder[degree])) continue;
		const factor = rationalDiv(remainder[degree], leading);
		const offset = degree - divisorDegree;
		quotient[offset] = factor;
		for (let i = 0; i <= divisorDegree; i++) {
			remainder[offset + i] = rationalSub(remainder[offset + i], rationalMul(factor, denominator[i]));
		}
	}

	return { quotient: trim(quotient), remainder: trim(remainder) };
}

/** Scales a coefficient list so its leading coefficient is one, which makes the GCD canonical. */
function monic(coefficients: Rational[]): Rational[] {
	const trimmed = trim(coefficients);
	if (trimmed.length === 0) return trimmed;
	const leading = trimmed[trimmed.length - 1];
	if (isRationalOne(leading)) return trimmed;
	return trimmed.map(coefficient => rationalDiv(coefficient, leading));
}

/**
 * The greatest common divisor of two coefficient lists, by Euclid's algorithm.
 *
 * @param a - Ascending coefficients.
 * @param b - Ascending coefficients.
 * @returns The monic GCD. Two polynomials sharing no factor give `[1]`, and the
 * GCD of zero with anything is that other polynomial.
 */
export function coefficientGcd(a: Coefficients, b: Coefficients): Rational[] {
	let left = trim([...a]);
	let right = trim([...b]);

	while (right.length > 0) {
		const { remainder } = polynomialDivide(left, right);
		left = right;
		right = remainder;
	}
	return monic(left);
}

/**
 * The greatest common divisor of two polynomials.
 *
 * @param a - Left polynomial.
 * @param b - Right polynomial.
 * @returns The monic GCD, or `null` when either polynomial involves more than
 * one variable, which this does not attempt.
 */
export function polynomialGcd(a: Polynomial, b: Polynomial): Polynomial | null {
	const variable = sharedVariable(a, b);
	if (variable === undefined) return null;

	// A constant shares no polynomial factor with anything, so the GCD is one.
	if (variable === null) return toPolynomial({ kind: "const", value: RATIONAL_ONE });

	const gcd = coefficientGcd(polyCoefficients(a, variable), polyCoefficients(b, variable));
	return coefficientsToPolynomial(gcd, variable);
}

/**
 * The one variable two polynomials are written in.
 *
 * @returns The variable name, `null` when both are constants, or `undefined`
 * when they involve more than one variable between them and so are outside what
 * this module handles.
 */
function sharedVariable(a: Polynomial, b: Polynomial): string | null | undefined {
	const names = new Set([...a.vars, ...b.vars]);
	if (names.size === 0) return null;
	if (names.size > 1) return undefined;
	return [...names][0];
}

/** Rebuilds a Polynomial from ascending coefficients in one variable. */
function coefficientsToPolynomial(coefficients: Coefficients, variable: string): Polynomial {
	const terms = new Map<string, Rational>();
	coefficients.forEach((coefficient, power) => {
		if (isRationalZero(coefficient)) return;
		terms.set(power === 0 ? "" : power === 1 ? variable : `${variable}^${power}`, coefficient);
	});
	return { terms, vars: terms.size > 0 && coefficients.length > 1 ? [variable] : [] };
}

/**
 * Reduces a fraction of two polynomials to lowest terms.
 *
 * @param numerator - The numerator.
 * @param denominator - The denominator.
 * @returns The reduced pair, or `null` when the two are outside what
 * {@link polynomialGcd} handles or share no factor worth cancelling.
 */
export function cancelRational(
	numerator: Polynomial,
	denominator: Polynomial,
): { numerator: Polynomial; denominator: Polynomial } | null {
	const gcd = polynomialGcd(numerator, denominator);
	if (gcd === null) return null;
	// A constant GCD means there is nothing to cancel, and reporting that as
	// "no change" rather than rebuilding an identical pair keeps the caller from
	// looping.
	if (polyDegree(gcd) === 0) return null;

	const variable = polyUnivariateVar(gcd);
	if (variable === null) return null;

	const gcdCoefficients = polyCoefficients(gcd, variable);
	const reducedNumerator = polynomialDivide(polyCoefficients(numerator, variable), gcdCoefficients);
	const reducedDenominator = polynomialDivide(polyCoefficients(denominator, variable), gcdCoefficients);

	return {
		numerator: coefficientsToPolynomial(reducedNumerator.quotient, variable),
		denominator: coefficientsToPolynomial(reducedDenominator.quotient, variable),
	};
}

/**
 * Cancels the common factors of a quotient of two expressions.
 *
 * This is the explicit counterpart to the simplifier's own narrow cancellation:
 * it multiplies out both sides, divides by their greatest common divisor, and
 * rebuilds. `(x^2-1)/(x-1)` becomes `x+1`.
 *
 * @param node - The expression to reduce.
 * @returns The reduced expression, or `node` unchanged when it is not a
 * quotient of polynomials in one variable, or when there is nothing to cancel.
 */
export function cancelSymbolic(node: SymbolicNode): SymbolicNode {
	if (node.kind !== "div") return node;

	const numerator = toPolynomial(node.left);
	const denominator = toPolynomial(node.right);
	if (numerator === null || denominator === null) return node;

	const reduced = cancelRational(numerator, denominator);
	if (reduced === null) return node;

	// The constant is only divided through as the last step of a cancellation
	// that already happened. Doing it unconditionally would rewrite `x/3` as
	// `1/3x`, which is the same number and a worse way to write it.
	return divideOutConstant(reduced.numerator, reduced.denominator, node);
}

/**
 * Rebuilds a reduced fraction, folding a constant denominator into the
 * numerator.
 *
 * The polynomial GCD is monic, so it never carries a numeric factor away with
 * it: `(2x^2+4x)/(2x)` cancels to `(2x+4)/2` and stops. Dividing through by a
 * leftover constant denominator finishes the job and gives `x+2`.
 *
 * @param numerator - The reduced numerator.
 * @param denominator - The reduced denominator.
 * @param original - Returned unchanged when nothing improved, so the caller can
 * detect "no progress" by identity.
 * @returns The rebuilt expression.
 */
function divideOutConstant(numerator: Polynomial, denominator: Polynomial, original: SymbolicNode): SymbolicNode {
	if (polyDegree(denominator) === 0) {
		const constant = denominator.terms.get("") ?? RATIONAL_ONE;
		if (isRationalZero(constant)) return original;
		const scaled = new Map<string, Rational>();
		for (const [key, coefficient] of numerator.terms) scaled.set(key, rationalDiv(coefficient, constant));
		return fromPolynomial({ terms: scaled, vars: numerator.vars });
	}
	return { kind: "div", left: fromPolynomial(numerator), right: fromPolynomial(denominator) };
}

/**
 * The square-free part of a polynomial, and the multiplicities it came from.
 *
 * A polynomial shares a factor with its own derivative exactly where that factor
 * is repeated, so `gcd(p, p')` isolates the repeats. This is what lets a
 * factorization report `(x-1)^2` rather than two identical factors, and it is
 * the first step of most serious factoring algorithms.
 *
 * @param coefficients - Ascending coefficients.
 * @returns The square-free part, ascending and monic.
 */
export function squareFreePart(coefficients: Coefficients): Rational[] {
	const trimmed = trim([...coefficients]);
	if (trimmed.length <= 1) return monic(trimmed);

	const derivative: Rational[] = [];
	for (let power = 1; power < trimmed.length; power++) {
		derivative.push(rationalMul(trimmed[power], { n: BigInt(power), d: 1n }));
	}

	const shared = coefficientGcd(trimmed, derivative);
	if (shared.length <= 1) return monic(trimmed);
	return monic(polynomialDivide(trimmed, shared).quotient);
}

/**
 * Evaluates ascending coefficients at a rational point, by Horner's method.
 *
 * @param coefficients - Ascending coefficients.
 * @param x - The point.
 * @returns The value there.
 */
export function evaluateCoefficients(coefficients: Coefficients, x: Rational): Rational {
	let total = RATIONAL_ZERO;
	for (let i = coefficients.length - 1; i >= 0; i--) {
		total = rationalAdd(rationalMul(total, x), coefficients[i]);
	}
	return total;
}
