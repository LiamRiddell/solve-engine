/**
 * Factoring polynomials in more than one variable.
 *
 * `Factor.ts` handles one variable completely, by the rational-root theorem,
 * and stops at content and common-monomial extraction the moment a second
 * variable appears. That stop is principled, because multivariate factoring in
 * general is a much harder problem than the univariate case and the honest
 * options are a real algorithm or none. What it left out, though, is the handful
 * of shapes a person actually writes: `x^2-y^2`, `x^3+y^3`, `x^2+2xy+y^2`, and
 * `ax+ay+bx+by`.
 *
 * So this is patterns, not an algorithm, and it says so. Each one is recognised
 * exactly, over exact coefficients, and produces a factorization that multiplies
 * back to the input. Anything not matching a pattern is declined, which leaves
 * the caller exactly where it was before.
 *
 * ## What it does not do
 *
 * It does not recurse. `x^6-y^6` is both a difference of squares and a
 * difference of cubes; the squares pattern matches first and gives
 * `(x^3-y^3)(x^3+y^3)`, which is correct and not fully factored. Recursing would
 * mean calling back into `Factor.ts`, which calls this, and the extra
 * factorization is not worth a circular dependency between the two.
 */

import { type SymbolicNode, constNode } from "@solve-js/symbolic/SymbolicNode";
import {
	type Rational,
	rationalMul,
	rationalDiv,
	rationalNeg,
	isRationalOne,
} from "@solve-js/symbolic/Rational";
import {
	type Polynomial,
	type MonomialKey,
	type Monomial,
	monomialToKey,
	monomialFromKey,
	compareMonomials,
	fromPolynomial,
} from "@solve-js/symbolic/Polynomial";
import { exactIntegerSqrt, exactIntegerCbrt } from "@solve-js/symbolic/Radicals";

/** One term of a polynomial, pulled out of the term map so the patterns below can read as algebra. */
interface Term {
	readonly key: MonomialKey;
	readonly coefficient: Rational;
}

/** The exact `n`-th root of a rational, or `null` when it is irrational. Only the second and third roots are needed. */
function exactRoot(value: Rational, degree: 2 | 3): Rational | null {
	const rootOf = degree === 2 ? exactIntegerSqrt : exactIntegerCbrt;
	const numerator = rootOf(value.n);
	const denominator = rootOf(value.d);
	return numerator === null || denominator === null ? null : { n: numerator, d: denominator };
}

/** The exact `n`-th root of a monomial, or `null` when some exponent is not divisible by `n`. */
function monomialRoot(key: MonomialKey, degree: number): MonomialKey | null {
	const monomial = monomialFromKey(key);
	const root: Monomial = new Map();
	for (const [name, exponent] of monomial) {
		if (exponent % degree !== 0) return null;
		root.set(name, exponent / degree);
	}
	return monomialToKey(root);
}

/** Multiplies two monomials. */
function monomialMul(a: MonomialKey, b: MonomialKey): MonomialKey {
	const product = monomialFromKey(a);
	for (const [name, exponent] of monomialFromKey(b)) {
		product.set(name, (product.get(name) ?? 0) + exponent);
	}
	return monomialToKey(product);
}

/** Divides one monomial by another, which the caller must already know divides it. */
function monomialDiv(a: MonomialKey, b: MonomialKey): MonomialKey {
	const quotient = monomialFromKey(a);
	for (const [name, exponent] of monomialFromKey(b)) {
		const remaining = (quotient.get(name) ?? 0) - exponent;
		if (remaining <= 0) quotient.delete(name);
		else quotient.set(name, remaining);
	}
	return monomialToKey(quotient);
}

/** The highest monomial dividing both, taking the lower exponent of each shared variable. */
function monomialGcd(a: MonomialKey, b: MonomialKey): MonomialKey {
	const left = monomialFromKey(a);
	const shared: Monomial = new Map();
	for (const [name, exponent] of monomialFromKey(b)) {
		const other = left.get(name);
		if (other !== undefined) shared.set(name, Math.min(other, exponent));
	}
	return monomialToKey(shared);
}

/** The variable names a monomial mentions. */
function namesOf(keys: readonly MonomialKey[]): string[] {
	const names = new Set<string>();
	for (const key of keys) for (const name of monomialFromKey(key).keys()) names.add(name);
	return [...names].sort();
}

/** Builds an expression from a term list, going through {@link fromPolynomial} so the ordering matches everything else. */
function termsToNode(terms: readonly Term[]): SymbolicNode {
	const map = new Map<MonomialKey, Rational>();
	for (const term of terms) map.set(term.key, term.coefficient);
	return fromPolynomial({ terms: map, vars: namesOf(terms.map(term => term.key)) });
}

/** Multiplies a list of factors into one expression. */
function product(factors: readonly SymbolicNode[]): SymbolicNode {
	let result = factors[0];
	for (let i = 1; i < factors.length; i++) result = { kind: "mul", left: result, right: factors[i] };
	return result;
}

/**
 * The terms of a polynomial in the same order {@link fromPolynomial} prints
 * them, highest first.
 *
 * Through {@link compareMonomials} rather than by sorting the key strings. The
 * patterns below read positionally, so `x^2+2xy+y^2` has to arrive with `x^2`
 * first; sorting keys as text puts `x*y` first, because `*` sorts before `^`.
 */
function orderedTerms(p: Polynomial): Term[] {
	const terms: Term[] = [...p.terms].map(([key, coefficient]) => ({ key, coefficient }));
	return terms.sort((a, b) => compareMonomials(a.key, b.key, p.vars));
}

/**
 * Factors a multivariate polynomial by pattern.
 *
 * @param p - The polynomial, already stripped of its content and common
 * monomial by the caller.
 * @returns The factored expression, or `null` when no pattern matched.
 */
export function factorMultivariate(p: Polynomial): SymbolicNode | null {
	if (p.vars.length < 2) return null;

	const terms = orderedTerms(p);
	if (terms.length === 2) return factorBinomial(terms[0], terms[1]);
	if (terms.length === 3) return factorPerfectSquare(terms);
	if (terms.length === 4) return factorByGrouping(terms);
	return null;
}

/**
 * A difference of squares, or a sum or difference of cubes.
 *
 * Each needs both terms to be exact powers, coefficient and monomial together:
 * `4x^2-9y^2` matches because four and nine are squares and both exponents are
 * even, while `2x^2-y^2` does not, since its factorization needs `sqrt(2)` and
 * so is not over the rationals at all.
 */
function factorBinomial(first: Term, second: Term): SymbolicNode | null {
	const firstPositive = first.coefficient.n > 0n;
	const secondPositive = second.coefficient.n > 0n;
	// A leading negative is left alone: negating to match a pattern would produce
	// a factorization with a spurious -1 out front.
	if (!firstPositive) return null;

	const squares = asPowerPair(first, second, 2);
	if (squares !== null && !secondPositive) {
		// A^2 - B^2 = (A-B)(A+B)
		return product([
			termsToNode([squares.a, negated(squares.b)]),
			termsToNode([squares.a, squares.b]),
		]);
	}

	const cubes = asPowerPair(first, second, 3);
	if (cubes === null) return null;
	// A^3 - B^3 = (A-B)(A^2+AB+B^2), and A^3 + B^3 = (A+B)(A^2-AB+B^2).
	const linear = secondPositive
		? termsToNode([cubes.a, cubes.b])
		: termsToNode([cubes.a, negated(cubes.b)]);
	const middle = secondPositive ? negated(multiplyTerms(cubes.a, cubes.b)) : multiplyTerms(cubes.a, cubes.b);
	return product([linear, termsToNode([squareOf(cubes.a), middle, squareOf(cubes.b)])]);
}

/** Both terms as exact `degree`-th powers, or `null` when either is not one. */
function asPowerPair(first: Term, second: Term, degree: 2 | 3): { a: Term; b: Term } | null {
	const magnitude = second.coefficient.n < 0n ? rationalNeg(second.coefficient) : second.coefficient;
	const firstRoot = exactRoot(first.coefficient, degree);
	const secondRoot = exactRoot(magnitude, degree);
	if (firstRoot === null || secondRoot === null) return null;

	const firstKey = monomialRoot(first.key, degree);
	const secondKey = monomialRoot(second.key, degree);
	if (firstKey === null || secondKey === null) return null;

	return { a: { key: firstKey, coefficient: firstRoot }, b: { key: secondKey, coefficient: secondRoot } };
}

/** Negates a term. */
function negated(term: Term): Term {
	return { key: term.key, coefficient: rationalNeg(term.coefficient) };
}

/** Multiplies two terms. */
function multiplyTerms(a: Term, b: Term): Term {
	return { key: monomialMul(a.key, b.key), coefficient: rationalMul(a.coefficient, b.coefficient) };
}

/** Squares a term. */
function squareOf(term: Term): Term {
	return multiplyTerms(term, term);
}

/**
 * A perfect-square trinomial, `A^2 ± 2AB + B^2`.
 *
 * The outer terms have to be squares and the middle one exactly twice their
 * roots' product. `x^2+3xy+y^2` fails that last test and is left alone, which
 * is right: it does not factor over the rationals.
 */
function factorPerfectSquare(terms: readonly Term[]): SymbolicNode | null {
	const [first, middle, last] = terms;
	if (first.coefficient.n < 0n || last.coefficient.n < 0n) return null;

	const roots = asPowerPair(first, last, 2);
	if (roots === null) return null;

	const cross = multiplyTerms(roots.a, roots.b);
	if (cross.key !== middle.key) return null;

	const twice = rationalMul(cross.coefficient, { n: 2n, d: 1n });
	const negative = middle.coefficient.n < 0n;
	const magnitude = negative ? rationalNeg(middle.coefficient) : middle.coefficient;
	if (!isRationalOne(rationalDiv(magnitude, twice))) return null;

	const base = termsToNode([roots.a, negative ? negated(roots.b) : roots.b]);
	return { kind: "pow", base, exponent: constNode(2) };
}

/**
 * Four terms that split into two pairs sharing a factor.
 *
 * `ax+ay+bx+by` pairs as `a(x+y) + b(x+y)`, so the shared `x+y` comes out and
 * `a+b` is what is left. All three ways of pairing four terms are tried, since
 * the terms arrive in degree order rather than in the order that groups.
 */
function factorByGrouping(terms: readonly Term[]): SymbolicNode | null {
	const pairings: [number, number][][] = [
		[[0, 1], [2, 3]],
		[[0, 2], [1, 3]],
		[[0, 3], [1, 2]],
	];

	for (const pairing of pairings) {
		const first = splitPair(terms[pairing[0][0]], terms[pairing[0][1]]);
		const second = splitPair(terms[pairing[1][0]], terms[pairing[1][1]]);
		if (first === null || second === null) continue;
		if (!cofactorsAgree(first.cofactor, second.cofactor)) continue;

		return product([
			termsToNode([first.common, second.common]),
			termsToNode(first.cofactor),
		]);
	}
	return null;
}

/**
 * Splits a pair of terms into what they share and what is left.
 *
 * The shared part takes the first term's whole coefficient rather than a
 * greatest common divisor of the two, which makes the leftover start with one.
 * That is what lets two pairs be compared directly: both leftovers are written
 * in the same normal form, so equality is a term-by-term check rather than a
 * proportionality test.
 */
function splitPair(first: Term, second: Term): { common: Term; cofactor: Term[] } | null {
	const shared = monomialGcd(first.key, second.key);
	const common: Term = { key: shared, coefficient: first.coefficient };
	const cofactor: Term[] = [
		{ key: monomialDiv(first.key, shared), coefficient: { n: 1n, d: 1n } },
		{ key: monomialDiv(second.key, shared), coefficient: rationalDiv(second.coefficient, first.coefficient) },
	];
	// Two terms that shared everything would leave a constant cofactor, which is
	// not a factorization of anything.
	return cofactor[0].key === cofactor[1].key ? null : { common, cofactor };
}

/** Whether two cofactors are the same polynomial, term for term. */
function cofactorsAgree(a: readonly Term[], b: readonly Term[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((term, index) =>
		term.key === b[index].key
		&& term.coefficient.n === b[index].coefficient.n
		&& term.coefficient.d === b[index].coefficient.d);
}
