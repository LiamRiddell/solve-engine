/**
 * Polynomial factoring over the rationals.
 *
 * ## What "factored" means here
 *
 * Factoring is only well defined once you say **over what**. `x^2-2` is
 * irreducible over the rationals but factors over the reals as
 * `(x-sqrt(2))(x+sqrt(2))`, and `x^2+1` factors only over the complex numbers.
 * This module factors **over the rationals**, so both of those come back
 * unchanged. That is a real answer, not a failure, and the documentation says
 * so rather than leaving a user to guess.
 *
 * The consequence worth stating plainly: a polynomial with no rational roots is
 * returned as one irreducible factor even in the cases where it does split into
 * higher-degree rational pieces that this module does not search for. See the
 * strategy list on {@link factorSymbolic} for exactly what is attempted.
 *
 * ## Why this is exact
 *
 * The rational-root theorem tests a candidate by evaluating the polynomial at
 * it and asking whether the result is zero. In floating point a near-miss and a
 * true root are indistinguishable, so the whole method depends on the exact
 * arithmetic in `Rational.ts`. This is the clearest reason the CAS could not
 * have been built on doubles.
 */

import {
	type SymbolicNode,
	constNode,
	varNode,
	powNode,
} from "@solve-js/symbolic/SymbolicNode";
import {
	type Rational,
	RATIONAL_ZERO,
	RATIONAL_ONE,
	rationalAdd,
	rationalMul,
	rationalDiv,
	rationalNeg,
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
import { factorMultivariate } from "@solve-js/symbolic/MultivariateFactor";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Highest degree this module will attempt to factor.
 *
 * The rational-root search is the expensive step and its cost grows with the
 * size of the leading and trailing coefficients rather than with degree alone,
 * but degree bounds how many times that search is repeated as factors are
 * divided out.
 */
export const FACTOR_MAX_DEGREE = 12;

/**
 * Ceiling on the number of candidate roots the rational-root theorem may test.
 *
 * This is the step that actually blows up. Candidates are every `±p/q` for `p`
 * dividing the trailing coefficient and `q` the leading one, so the set is the
 * **product** of two divisor sets. A trailing coefficient of 720720 alone has
 * 240 divisors, and a comparable leading coefficient would put the product in
 * the tens of thousands before any of them is tested.
 */
export const FACTOR_MAX_ROOT_CANDIDATES = 4_096;

/**
 * A polynomial written as a rational constant times a list of irreducible
 * factors with multiplicity.
 */
export interface Factorization {
	/** The rational content pulled out front. One when the polynomial was already primitive. */
	readonly content: Rational;
	/** Irreducible-over-the-rationals factors, in ascending degree. */
	readonly factors: readonly { readonly base: SymbolicNode; readonly power: number }[];
}

/** Greatest common divisor of two non-negative bigints. */
function gcd(a: bigint, b: bigint): bigint {
	let x = a < 0n ? -a : a;
	let y = b < 0n ? -b : b;
	while (y !== 0n) {
		const remainder = x % y;
		x = y;
		y = remainder;
	}
	return x;
}

/** Least common multiple of two positive bigints. */
function lcm(a: bigint, b: bigint): bigint {
	if (a === 0n || b === 0n) return 0n;
	return (a / gcd(a, b)) * b;
}

/**
 * Every positive divisor of a positive bigint, by trial division to its square
 * root.
 *
 * @returns The divisors, or `null` once more than {@link FACTOR_MAX_ROOT_CANDIDATES}
 * have been found, so a highly-composite coefficient stops the search rather
 * than exhausting time here.
 */
function divisors(value: bigint): bigint[] | null {
	const magnitude = value < 0n ? -value : value;
	if (magnitude === 0n) return null;
	const found: bigint[] = [];
	for (let candidate = 1n; candidate * candidate <= magnitude; candidate++) {
		if (magnitude % candidate !== 0n) continue;
		found.push(candidate);
		const paired = magnitude / candidate;
		if (paired !== candidate) found.push(paired);
		if (found.length > FACTOR_MAX_ROOT_CANDIDATES) return null;
	}
	return found;
}

/** Evaluates a descending-order coefficient list at `x`, by Horner's method. */
function evaluateAt(descending: readonly Rational[], x: Rational): Rational {
	let total = RATIONAL_ZERO;
	for (const coeff of descending) total = rationalAdd(rationalMul(total, x), coeff);
	return total;
}

/**
 * Divides a descending-order polynomial by `(x - root)` using synthetic
 * division.
 *
 * @returns The quotient's descending coefficients. The remainder is discarded,
 * so only call this with a value already confirmed to be a root.
 */
function divideByRoot(descending: readonly Rational[], root: Rational): Rational[] {
	const quotient: Rational[] = [descending[0]];
	for (let i = 1; i < descending.length - 1; i++) {
		quotient.push(rationalAdd(descending[i], rationalMul(quotient[i - 1], root)));
	}
	return quotient;
}

/**
 * Every rational root of a univariate polynomial, by the rational-root theorem.
 *
 * @param descending - Coefficients from the highest power down. The leading
 * coefficient must be non-zero and the trailing one must also be non-zero (a
 * zero constant term means `x` itself is a factor, which the caller removes as
 * a common monomial first).
 * @returns The distinct rational roots, each listed once.
 * @throws {EngineError} `SYMBOLIC_FACTOR_LIMIT_EXCEEDED` when the candidate set
 * would exceed {@link FACTOR_MAX_ROOT_CANDIDATES}.
 */
export function rationalRoots(descending: readonly Rational[]): readonly Rational[] {
	if (descending.length < 2) return [];

	// Clear denominators so the theorem's integer statement applies.
	let multiplier = 1n;
	for (const coeff of descending) multiplier = lcm(multiplier, coeff.d);
	const integers = descending.map(coeff => (coeff.n * multiplier) / coeff.d);

	const leading = integers[0];
	const trailing = integers[integers.length - 1];
	if (trailing === 0n) return [];

	const numeratorDivisors = divisors(trailing);
	const denominatorDivisors = divisors(leading);
	if (numeratorDivisors === null || denominatorDivisors === null) {
		throw ErrorFactory.execution(
			"SYMBOLIC_FACTOR_LIMIT_EXCEEDED",
			"This polynomial's coefficients have too many divisors to search for rational roots.",
			{ limit: FACTOR_MAX_ROOT_CANDIDATES },
		);
	}
	if (numeratorDivisors.length * denominatorDivisors.length > FACTOR_MAX_ROOT_CANDIDATES) {
		throw ErrorFactory.execution(
			"SYMBOLIC_FACTOR_LIMIT_EXCEEDED",
			"This polynomial has too many candidate rational roots to test.",
			{ limit: FACTOR_MAX_ROOT_CANDIDATES },
		);
	}

	const roots: Rational[] = [];
	const seen = new Set<string>();
	for (const p of numeratorDivisors) {
		for (const q of denominatorDivisors) {
			for (const sign of [1n, -1n]) {
				const candidate: Rational = { n: (sign * p) / gcd(p, q), d: q / gcd(p, q) };
				const key = `${candidate.n}/${candidate.d}`;
				if (seen.has(key)) continue;
				seen.add(key);
				if (isRationalZero(evaluateAt(descending, candidate))) roots.push(candidate);
			}
		}
	}
	return roots;
}

/** Builds the node for `x - root`, or `x + |root|` when the root is negative, so the display reads naturally. */
function linearFactorNode(variable: string, root: Rational): SymbolicNode {
	if (isRationalZero(root)) return varNode(variable);
	return root.n > 0n
		? { kind: "sub", left: varNode(variable), right: constNode(root) }
		: { kind: "add", left: varNode(variable), right: constNode(rationalNeg(root)) };
}

/** Rebuilds a descending coefficient list into an expression tree in the given variable. */
function coefficientsToNode(descending: readonly Rational[], variable: string): SymbolicNode {
	const degree = descending.length - 1;
	const terms = new Map<string, Rational>();
	descending.forEach((coeff, index) => {
		if (isRationalZero(coeff)) return;
		const power = degree - index;
		terms.set(power === 0 ? "" : power === 1 ? variable : `${variable}^${power}`, coeff);
	});
	return fromPolynomial({ terms, vars: terms.size > 0 ? [variable] : [] });
}

/**
 * Factors a univariate polynomial over the rationals by repeatedly extracting
 * rational roots.
 *
 * @param descending - Coefficients from the highest power down.
 * @param variable - The variable name, used to build the factor nodes.
 * @returns The factorization. A polynomial with no rational roots comes back as
 * a single factor, which is the correct answer over the rationals.
 */
export function factorUnivariate(descending: readonly Rational[], variable: string): Factorization {
	const factors: { base: SymbolicNode; power: number }[] = [];
	let remaining = [...descending];

	// A root can repeat, so each one is divided out until it stops being one.
	// That is what turns (x-1)^2 into a single factor with power two rather
	// than two identical factors.
	let roots = rationalRoots(remaining);
	while (roots.length > 0 && remaining.length > 2) {
		for (const root of roots) {
			let multiplicity = 0;
			while (remaining.length > 1 && isRationalZero(evaluateAt(remaining, root))) {
				remaining = divideByRoot(remaining, root);
				multiplicity++;
			}
			if (multiplicity > 0) factors.push({ base: linearFactorNode(variable, root), power: multiplicity });
		}
		roots = remaining.length > 2 ? rationalRoots(remaining) : [];
	}

	// Whatever survives is irreducible over the rationals as far as this module
	// searches. A leading coefficient other than one stays inside it rather than
	// being pulled out, so the product still multiplies back to the input.
	const leftoverDegree = remaining.length - 1;
	if (leftoverDegree >= 1) {
		factors.push({ base: coefficientsToNode(remaining, variable), power: 1 });
		return { content: RATIONAL_ONE, factors };
	}
	return { content: remaining.length === 1 ? remaining[0] : RATIONAL_ONE, factors };
}

/** Multiplies a content constant and a factor list back into one expression tree. */
function factorizationToNode(factorization: Factorization): SymbolicNode {
	const pieces: SymbolicNode[] = [];
	if (!isRationalOne(factorization.content)) pieces.push(constNode(factorization.content));
	for (const factor of factorization.factors) {
		pieces.push(factor.power === 1 ? factor.base : powNode(factor.base, constNode({ n: BigInt(factor.power), d: 1n })));
	}
	if (pieces.length === 0) return constNode(RATIONAL_ONE);

	let result = pieces[0];
	for (let i = 1; i < pieces.length; i++) result = { kind: "mul", left: result, right: pieces[i] };
	return result;
}

/** The rational content of a polynomial: the gcd of its numerators over the lcm of its denominators. */
function contentOf(p: Polynomial): Rational {
	let numeratorGcd = 0n;
	let denominatorLcm = 1n;
	for (const coeff of p.terms.values()) {
		numeratorGcd = gcd(numeratorGcd, coeff.n);
		denominatorLcm = lcm(denominatorLcm, coeff.d);
	}
	if (numeratorGcd === 0n) return RATIONAL_ONE;
	return { n: numeratorGcd, d: denominatorLcm };
}

/** The highest power of each variable dividing every term, as a monomial key, plus the polynomial with it removed. */
function extractCommonMonomial(p: Polynomial): { monomial: Map<string, number>; reduced: Polynomial } {
	const common = new Map<string, number>();
	for (const name of p.vars) {
		let lowest = Infinity;
		for (const key of p.terms.keys()) {
			const exponent = exponentOf(key, name);
			if (exponent < lowest) lowest = exponent;
		}
		if (lowest > 0 && lowest !== Infinity) common.set(name, lowest);
	}
	if (common.size === 0) return { monomial: common, reduced: p };

	const terms = new Map<string, Rational>();
	for (const [key, coeff] of p.terms) {
		const exponents = parseKey(key);
		for (const [name, shared] of common) exponents.set(name, (exponents.get(name) ?? 0) - shared);
		terms.set(buildKey(exponents), coeff);
	}
	const names = new Set<string>();
	for (const key of terms.keys()) for (const name of parseKey(key).keys()) names.add(name);
	return { monomial: common, reduced: { terms, vars: [...names].sort() } };
}

/** Exponent of one variable within a monomial key. */
function exponentOf(key: string, name: string): number {
	return parseKey(key).get(name) ?? 0;
}

/** Parses a monomial key into a variable-to-exponent map, mirroring `Polynomial.ts`'s own encoding. */
function parseKey(key: string): Map<string, number> {
	const exponents = new Map<string, number>();
	if (key === "") return exponents;
	for (const factor of key.split("*")) {
		const caret = factor.indexOf("^");
		if (caret === -1) exponents.set(factor, 1);
		else exponents.set(factor.slice(0, caret), Number(factor.slice(caret + 1)));
	}
	return exponents;
}

/** Serializes a variable-to-exponent map back into a monomial key, dropping zero exponents. */
function buildKey(exponents: Map<string, number>): string {
	const names = [...exponents.keys()].filter(name => (exponents.get(name) ?? 0) > 0).sort();
	return names.map(name => (exponents.get(name) === 1 ? name : `${name}^${exponents.get(name)}`)).join("*");
}

/** Builds the node for a common monomial such as `2x` or `x^2*y`. */
function monomialNode(monomial: Map<string, number>): SymbolicNode | null {
	const names = [...monomial.keys()].sort();
	let result: SymbolicNode | null = null;
	for (const name of names) {
		const exponent = monomial.get(name)!;
		const factor = exponent === 1 ? varNode(name) : powNode(varNode(name), constNode({ n: BigInt(exponent), d: 1n }));
		result = result === null ? factor : { kind: "mul", left: result, right: factor };
	}
	return result;
}

/**
 * Factors an expression over the rationals.
 *
 * Strategies, in the order attempted:
 *
 * 1. Convert to polynomial form. Anything that is not a polynomial over the
 *    rationals is returned unchanged.
 * 2. Pull out the rational content, the shared factor across all coefficients.
 * 3. Pull out the highest power of each variable dividing every term, so
 *    `2x^2+4x` becomes `2x*(x+2)`.
 * 4. If more than one variable remains, hand off to
 *    {@link factorMultivariate}'s pattern set: a difference of squares, a sum
 *    or difference of cubes, a perfect-square trinomial, or four terms that
 *    group. Anything it declines stops here, with the content and common
 *    monomial extracted and nothing guessed at beyond them.
 * 5. Extract rational roots by the rational-root theorem, dividing each out
 *    with its multiplicity.
 * 6. Leave whatever survives as one irreducible-over-the-rationals factor.
 *
 * @param node - The expression to factor.
 * @returns The factored expression, or `node` unchanged when it is not a
 * polynomial, is already irreducible, or exceeds {@link FACTOR_MAX_DEGREE}.
 * @throws {EngineError} `SYMBOLIC_FACTOR_LIMIT_EXCEEDED` when the rational-root
 * candidate set grows past {@link FACTOR_MAX_ROOT_CANDIDATES}.
 */
export function factorSymbolic(node: SymbolicNode): SymbolicNode {
	const polynomial = toPolynomial(node);
	if (polynomial === null || polynomial.terms.size === 0) return node;
	if (polyDegree(polynomial) > FACTOR_MAX_DEGREE) return node;
	// A constant has no factorization in this sense. Splitting an integer into
	// primes is a different feature, and without this the content-extraction
	// path below would hand back `12*1`.
	if (polynomial.vars.length === 0) return node;

	const content = contentOf(polynomial);
	const primitive = isRationalOne(content)
		? polynomial
		: scaleTerms(polynomial, rationalDiv(RATIONAL_ONE, content));

	const { monomial, reduced } = extractCommonMonomial(primitive);
	const monomialFactor = monomialNode(monomial);

	const variable = polyUnivariateVar(reduced);
	if (variable === null) {
		// Constant remainder, or genuinely multivariate. The pattern set in
		// `MultivariateFactor.ts` covers the shapes a person actually writes;
		// anything it declines stops at the content and common monomial.
		const patterned = factorMultivariate(reduced);
		if (patterned !== null) return assemble(content, monomialFactor, patterned);
		const pieces = buildPieces(content, monomialFactor, reduced);
		return pieces ?? node;
	}

	const descending = [...polyCoefficients(reduced, variable)].reverse();
	const factorization = factorUnivariate(descending, variable);
	const combinedContent = rationalMul(content, factorization.content);

	// Nothing was achieved only when the result is a single factor raised to the
	// first power, which is the input rewritten. A single factor with a power
	// above one is a genuine factorization, `(x-1)^2` being the case that makes
	// the distinction matter.
	const isUnchanged =
		factorization.factors.length <= 1 &&
		(factorization.factors[0]?.power ?? 1) === 1 &&
		monomialFactor === null &&
		isRationalOne(combinedContent);
	if (isUnchanged) return node;

	const pieces: SymbolicNode[] = [];
	if (!isRationalOne(combinedContent)) pieces.push(constNode(combinedContent));
	if (monomialFactor !== null) pieces.push(monomialFactor);
	pieces.push(factorizationToNode({ content: RATIONAL_ONE, factors: factorization.factors }));

	let result = pieces[0];
	for (let i = 1; i < pieces.length; i++) result = { kind: "mul", left: result, right: pieces[i] };
	return result;
}

/** Multiplies every coefficient of a polynomial by a rational, used to divide out the content. */
function scaleTerms(p: Polynomial, k: Rational): Polynomial {
	const terms = new Map<string, Rational>();
	for (const [key, coeff] of p.terms) terms.set(key, rationalMul(coeff, k));
	return { terms, vars: p.vars };
}

/**
 * Multiplies an already-factored remainder back together with the content and
 * common monomial that were pulled off before it.
 *
 * @param content - The rational content, left off when it is one.
 * @param monomialFactor - The common monomial, or `null` when there was none.
 * @param factored - The factored remainder.
 * @returns The whole factorization as one expression.
 */
function assemble(content: Rational, monomialFactor: SymbolicNode | null, factored: SymbolicNode): SymbolicNode {
	const pieces: SymbolicNode[] = [];
	if (!isRationalOne(content)) pieces.push(constNode(content));
	if (monomialFactor !== null) pieces.push(monomialFactor);
	pieces.push(factored);

	let result = pieces[0];
	for (let i = 1; i < pieces.length; i++) result = { kind: "mul", left: result, right: pieces[i] };
	return result;
}

/** Assembles the content, common monomial and remainder for the multivariate stop case, or `null` when nothing was extracted. */
function buildPieces(content: Rational, monomialFactor: SymbolicNode | null, reduced: Polynomial): SymbolicNode | null {
	if (monomialFactor === null && isRationalOne(content)) return null;
	const pieces: SymbolicNode[] = [];
	if (!isRationalOne(content)) pieces.push(constNode(content));
	if (monomialFactor !== null) pieces.push(monomialFactor);
	pieces.push(fromPolynomial(reduced));

	let result = pieces[0];
	for (let i = 1; i < pieces.length; i++) result = { kind: "mul", left: result, right: pieces[i] };
	return result;
}
