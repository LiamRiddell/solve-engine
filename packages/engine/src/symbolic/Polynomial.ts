/**
 * A canonical sparse multivariate polynomial over the rationals, and the
 * conversion both ways between it and a {@link SymbolicNode} tree.
 *
 * The tree is the right representation for arbitrary expressions but the wrong
 * one for algebra: `2*b + 3*b` and `5*b` are different trees for the same
 * value, so deciding they are equal means pattern matching on shape. A
 * polynomial keyed by monomial gives one canonical form per value, which is
 * what makes expansion, term collection through a product, factoring and root
 * finding possible at all.
 *
 * ## Not every expression is a polynomial, and that is the point
 *
 * {@link toPolynomial} returns `null` rather than guessing whenever the input
 * falls outside the representation: a non-constant denominator, a non-integer
 * or symbolic exponent, or any function call. **Bias every ambiguous case
 * toward `null`.** A wrong polynomial is far worse than no polynomial, because
 * the caller silently gets an answer for a different expression.
 *
 * That null return is also load-bearing for existing behaviour. `vx/sx-tx` is a
 * rational function, not a polynomial, so it converts to `null` and keeps the
 * tree simplifier's own handling, which is what preserves the shipped symbolic
 * matrix inverse output.
 *
 * Nothing here is reachable from `simplifySymbolic`'s `mul` or `div` cases, and
 * `expandSymbolic` is never called by the simplifier at all. See `Simplify.ts`
 * for the invariant.
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
	RATIONAL_MINUS_ONE,
	isRationalInteger,
} from "@solve-js/symbolic/Rational";

/**
 * The canonical text form of one monomial.
 *
 * Variables appear in sorted order joined by `*`, an exponent of one is
 * written bare, and the constant term is the empty string. `"x^2*y"` is the
 * key for `x squared times y`. Sorting is what makes the key canonical, so
 * `y*x^2` and `x^2*y` cannot produce two different entries for one term.
 */
export type MonomialKey = string;

/**
 * A polynomial as a sum of monomial terms with rational coefficients.
 *
 * Build one with {@link toPolynomial} rather than by hand, so the invariants
 * hold: no term ever carries a zero coefficient, and {@link Polynomial.vars} is
 * sorted.
 */
export interface Polynomial {
	/** Non-zero terms only. A zero polynomial has an empty map. */
	readonly terms: ReadonlyMap<MonomialKey, Rational>;
	/** Every variable appearing in any term, sorted, so output order is deterministic. */
	readonly vars: readonly string[];
}

/**
 * Largest exponent {@link toPolynomial} will multiply out.
 *
 * `(x+y)^n` has `n+1` terms in one variable but grows combinatorially in
 * several, so this bounds the work before it starts rather than after.
 */
export const EXPAND_MAX_POW_EXPONENT = 32;

/**
 * Largest number of distinct terms a polynomial may carry.
 *
 * Multiplying two dense multivariate polynomials multiplies their term counts,
 * so this is the ceiling that stops a product chain from exhausting memory.
 */
export const POLYNOMIAL_MAX_TERMS = 2_000;

/**
 * Largest total degree any single term may reach.
 *
 * Degree grows additively under multiplication and multiplicatively under
 * exponentiation, so an unbounded chain of either escapes quickly.
 */
export const POLYNOMIAL_MAX_DEGREE = 64;

/** A monomial as a variable-to-exponent map. Exponents are always positive integers; a variable with exponent zero is removed. */
type Monomial = Map<string, number>;

/** Serializes a monomial to its canonical {@link MonomialKey}. */
function monomialToKey(monomial: Monomial): MonomialKey {
	const names = [...monomial.keys()].sort();
	return names.map(name => (monomial.get(name) === 1 ? name : `${name}^${monomial.get(name)}`)).join("*");
}

/** Parses a canonical {@link MonomialKey} back into a variable-to-exponent map. */
function monomialFromKey(key: MonomialKey): Monomial {
	const monomial: Monomial = new Map();
	if (key === "") return monomial;
	for (const factor of key.split("*")) {
		const caret = factor.indexOf("^");
		if (caret === -1) monomial.set(factor, 1);
		else monomial.set(factor.slice(0, caret), Number(factor.slice(caret + 1)));
	}
	return monomial;
}

/** Total degree of a monomial, the sum of its exponents. */
function monomialDegree(key: MonomialKey): number {
	let total = 0;
	for (const exponent of monomialFromKey(key).values()) total += exponent;
	return total;
}

/** Assembles a Polynomial from a term map, dropping zero coefficients and deriving the sorted variable list. */
function build(terms: Map<MonomialKey, Rational>): Polynomial | null {
	const kept = new Map<MonomialKey, Rational>();
	const names = new Set<string>();
	for (const [key, coeff] of terms) {
		if (isRationalZero(coeff)) continue;
		if (monomialDegree(key) > POLYNOMIAL_MAX_DEGREE) return null;
		kept.set(key, coeff);
		for (const name of monomialFromKey(key).keys()) names.add(name);
	}
	if (kept.size > POLYNOMIAL_MAX_TERMS) return null;
	return { terms: kept, vars: [...names].sort() };
}

/** The polynomial equal to a single rational constant. */
function constantPolynomial(value: Rational): Polynomial {
	return isRationalZero(value)
		? { terms: new Map(), vars: [] }
		: { terms: new Map([["", value]]), vars: [] };
}

/**
 * Adds two polynomials.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns The sum, or `null` when a safety limit would be exceeded.
 */
export function polyAdd(a: Polynomial, b: Polynomial): Polynomial | null {
	const terms = new Map(a.terms);
	for (const [key, coeff] of b.terms) {
		const existing = terms.get(key);
		terms.set(key, existing === undefined ? coeff : rationalAdd(existing, coeff));
	}
	return build(terms);
}

/**
 * Subtracts one polynomial from another.
 *
 * @param a - Minuend.
 * @param b - Subtrahend.
 * @returns The difference, or `null` when a safety limit would be exceeded.
 */
export function polySub(a: Polynomial, b: Polynomial): Polynomial | null {
	return polyAdd(a, polyScale(b, RATIONAL_MINUS_ONE));
}

/**
 * Multiplies two polynomials, distributing every term pair.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns The product, or `null` when a safety limit would be exceeded.
 */
export function polyMul(a: Polynomial, b: Polynomial): Polynomial | null {
	// The term count of a product is bounded by the product of the term counts,
	// so check before doing the work rather than after allocating it.
	if (a.terms.size * b.terms.size > POLYNOMIAL_MAX_TERMS) return null;

	const terms = new Map<MonomialKey, Rational>();
	for (const [leftKey, leftCoeff] of a.terms) {
		const leftMonomial = monomialFromKey(leftKey);
		for (const [rightKey, rightCoeff] of b.terms) {
			const combined: Monomial = new Map(leftMonomial);
			for (const [name, exponent] of monomialFromKey(rightKey)) {
				combined.set(name, (combined.get(name) ?? 0) + exponent);
			}
			const key = monomialToKey(combined);
			const coeff = rationalMul(leftCoeff, rightCoeff);
			const existing = terms.get(key);
			terms.set(key, existing === undefined ? coeff : rationalAdd(existing, coeff));
		}
	}
	return build(terms);
}

/**
 * Raises a polynomial to a non-negative integer power by repeated multiplication.
 *
 * @param p - The base polynomial.
 * @param exponent - A non-negative integer exponent.
 * @returns The power, or `null` for a negative exponent, one past
 * {@link EXPAND_MAX_POW_EXPONENT}, or a safety-limit breach.
 */
export function polyPow(p: Polynomial, exponent: number): Polynomial | null {
	if (exponent < 0 || !Number.isInteger(exponent) || exponent > EXPAND_MAX_POW_EXPONENT) return null;
	let result = constantPolynomial(RATIONAL_ONE);
	for (let i = 0; i < exponent; i++) {
		const next = polyMul(result, p);
		if (next === null) return null;
		result = next;
	}
	return result;
}

/**
 * Multiplies every coefficient by a rational.
 *
 * @param p - The polynomial.
 * @param k - The scale factor. Scaling by zero yields the zero polynomial.
 * @returns The scaled polynomial.
 */
export function polyScale(p: Polynomial, k: Rational): Polynomial {
	if (isRationalZero(k)) return { terms: new Map(), vars: [] };
	const terms = new Map<MonomialKey, Rational>();
	for (const [key, coeff] of p.terms) terms.set(key, rationalMul(coeff, k));
	return { terms, vars: p.vars };
}

/**
 * The degree of a polynomial.
 *
 * @param p - The polynomial.
 * @param variable - When given, the highest exponent of that variable alone.
 * Otherwise the highest total degree across all terms.
 * @returns The degree. A zero polynomial has degree zero.
 */
export function polyDegree(p: Polynomial, variable?: string): number {
	let highest = 0;
	for (const key of p.terms.keys()) {
		const degree = variable === undefined ? monomialDegree(key) : (monomialFromKey(key).get(variable) ?? 0);
		if (degree > highest) highest = degree;
	}
	return highest;
}

/**
 * The single variable of a univariate polynomial.
 *
 * @param p - The polynomial.
 * @returns That variable's name, or `null` when the polynomial is constant or
 * involves more than one variable.
 */
export function polyUnivariateVar(p: Polynomial): string | null {
	return p.vars.length === 1 ? p.vars[0] : null;
}

/**
 * Dense ascending coefficients of a univariate polynomial.
 *
 * @param p - The polynomial, which must involve no variable other than `variable`.
 * @param variable - The variable to read powers of.
 * @returns `[c0, c1, ..., cn]` where index `i` is the coefficient of
 * `variable^i`, with explicit zeros for absent powers.
 */
export function polyCoefficients(p: Polynomial, variable: string): Rational[] {
	const degree = polyDegree(p, variable);
	const coefficients: Rational[] = new Array(degree + 1).fill(RATIONAL_ZERO);
	for (const [key, coeff] of p.terms) {
		coefficients[monomialFromKey(key).get(variable) ?? 0] = coeff;
	}
	return coefficients;
}

/**
 * Converts an expression tree into canonical polynomial form.
 *
 * @param node - The tree to convert. It should already be simplified, though
 * this does not require it.
 * @returns The polynomial, or `null` when `node` is not a polynomial over the
 * rationals: a non-constant denominator, a non-integer or symbolic exponent,
 * any function call, or a safety-limit breach.
 */
export function toPolynomial(node: SymbolicNode, allowDistribution = true): Polynomial | null {
	switch (node.kind) {
		case "const":
			return constantPolynomial(node.value);
		case "var":
			return { terms: new Map([[node.name, RATIONAL_ONE]]), vars: [node.name] };
		case "neg": {
			const operand = toPolynomial(node.operand, allowDistribution);
			return operand === null ? null : polyScale(operand, RATIONAL_MINUS_ONE);
		}
		case "add": {
			const left = toPolynomial(node.left, allowDistribution);
			const right = left === null ? null : toPolynomial(node.right, allowDistribution);
			return left === null || right === null ? null : polyAdd(left, right);
		}
		case "sub": {
			const left = toPolynomial(node.left, allowDistribution);
			const right = left === null ? null : toPolynomial(node.right, allowDistribution);
			return left === null || right === null ? null : polySub(left, right);
		}
		case "mul": {
			const left = toPolynomial(node.left, allowDistribution);
			const right = left === null ? null : toPolynomial(node.right, allowDistribution);
			if (left === null || right === null) return null;
			// Multiplying into a multi-term sum is expansion, and the simplifier
			// is not allowed to do that (see `Simplify.ts`), so it converts with
			// distribution disabled and gets `null` here, leaving `(x+1)*(x+2)`
			// as the user wrote it.
			//
			// Refusing only when BOTH sides are sums is not enough. Distributing
			// a single factor over `(x-4)` copies that factor into both terms,
			// and distributing a bare constant over a three-term sum grows the
			// tree as well. So in this mode a product converts only when both
			// sides are single terms, which is exactly what collecting `2b + 3b`
			// into `5b` needs and nothing beyond it.
			if (!allowDistribution && (left.terms.size > 1 || right.terms.size > 1)) return null;
			return polyMul(left, right);
		}
		case "div": {
			// Only a genuinely constant, non-zero denominator is divisible here.
			// Anything else is a rational function, which this representation
			// cannot express, so it must come back null rather than be approximated.
			const right = toPolynomial(node.right, allowDistribution);
			if (right === null || right.vars.length > 0) return null;
			const divisor = right.terms.get("") ?? RATIONAL_ZERO;
			if (isRationalZero(divisor)) return null;
			const left = toPolynomial(node.left, allowDistribution);
			return left === null ? null : polyScale(left, rationalDiv(RATIONAL_ONE, divisor));
		}
		case "pow": {
			if (node.exponent.kind !== "const" || !isRationalInteger(node.exponent.value)) return null;
			const exponent = Number(node.exponent.value.n);
			const base = toPolynomial(node.base, allowDistribution);
			if (base === null) return null;
			// Raising a sum to a power is expansion too, for the same reason.
			if (!allowDistribution && base.terms.size > 1) return null;
			return polyPow(base, exponent);
		}
		case "complex":
			// Coefficients here are rational by construction, so a complex literal
			// puts the expression outside this representation. Returning null is what
			// keeps factor and solve working over the rationals by default.
			return null;
		case "call":
			// A function of an unknown is never a polynomial in it.
			return null;
	}
}

/**
 * Orders two monomials for display, highest first, by graded lexicographic
 * order: total degree, then the exponent of each variable in turn.
 *
 * This is what makes `(x+y)^2` read as `x^2+2x*y+y^2` rather than
 * `2x*y+x^2+y^2`. Sorting the key strings instead would order by character
 * code, where `*` (42) sorts before `^` (94), putting the cross term first.
 * Comparing exponent vectors is both conventional and independent of how a key
 * happens to be spelled.
 */
function compareMonomials(a: MonomialKey, b: MonomialKey, vars: readonly string[]): number {
	const degreeDifference = monomialDegree(b) - monomialDegree(a);
	if (degreeDifference !== 0) return degreeDifference;

	const left = monomialFromKey(a);
	const right = monomialFromKey(b);
	for (const name of vars) {
		const difference = (right.get(name) ?? 0) - (left.get(name) ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/** Builds the node for one monomial, `x^2*y`, as a left-leaning product of powers. */
function monomialToNode(key: MonomialKey): SymbolicNode {
	const monomial = monomialFromKey(key);
	const names = [...monomial.keys()].sort();
	let result: SymbolicNode | null = null;
	for (const name of names) {
		const exponent = monomial.get(name)!;
		const factor = exponent === 1 ? varNode(name) : powNode(varNode(name), constNode({ n: BigInt(exponent), d: 1n }));
		result = result === null ? factor : { kind: "mul", left: result, right: factor };
	}
	return result ?? constNode(RATIONAL_ONE);
}

/** Builds the node for one term, folding the coefficient in and wrapping a negative one in `neg` so the formatter renders `x-3` rather than `x+-3`. */
function termToNode(key: MonomialKey, coeff: Rational): SymbolicNode {
	if (key === "") return constNode(coeff);

	const magnitude = coeff.n < 0n ? rationalNeg(coeff) : coeff;
	const monomial = monomialToNode(key);
	const positive = isRationalOne(magnitude)
		? monomial
		: { kind: "mul" as const, left: constNode(magnitude), right: monomial };
	return coeff.n < 0n ? { kind: "neg", operand: positive } : positive;
}

/**
 * Converts a polynomial back into an expression tree.
 *
 * Terms come out in descending total degree, then lexicographically by
 * monomial key, so `x^2+3x+2` reads the way it is conventionally written and
 * two equal polynomials always render identically.
 *
 * @param p - The polynomial to render.
 * @returns The tree. A zero polynomial becomes the constant `0`.
 */
export function fromPolynomial(p: Polynomial): SymbolicNode {
	const keys = [...p.terms.keys()].sort((a, b) => compareMonomials(a, b, p.vars));
	if (keys.length === 0) return constNode(RATIONAL_ZERO);

	// Lead with a positive term when the polynomial has one, so `5 - y` comes
	// back as `5-y` rather than `-y+5`. Two reasons, and the second is the one
	// that matters. It reads the way a person writes it. And it keeps the tree
	// from growing: a leading negative needs a `neg` wrapper where the original
	// had a `sub`, which broke `Simplify.ts`'s promise never to grow a tree, by
	// one node for every additive level. The rule is deterministic and depends
	// only on the polynomial, so two equal polynomials still render identically.
	if (p.terms.get(keys[0])!.n < 0n) {
		const firstPositive = keys.findIndex(key => p.terms.get(key)!.n > 0n);
		if (firstPositive > 0) keys.unshift(...keys.splice(firstPositive, 1));
	}

	let result = termToNode(keys[0], p.terms.get(keys[0])!);
	for (let i = 1; i < keys.length; i++) {
		const coeff = p.terms.get(keys[i])!;
		// A negative term becomes a subtraction rather than an addition of a
		// negation. That is one node smaller, which matters: `Simplify.ts`
		// promises never to grow a tree, and routing `x - y` through here as
		// `x + (-y)` broke exactly that promise by a node every time.
		if (coeff.n < 0n) {
			result = { kind: "sub", left: result, right: termToNode(keys[i], rationalNeg(coeff)) };
		} else {
			result = { kind: "add", left: result, right: termToNode(keys[i], coeff) };
		}
	}
	return result;
}

/**
 * Multiplies out every product and power in an expression.
 *
 * Never called from `simplifySymbolic`, which is forbidden from growing a
 * tree. This is the explicitly-invoked counterpart.
 *
 * @param node - The expression to expand.
 * @returns The expanded expression, or `node` unchanged when it is not a
 * polynomial. `expand(sin(x))` is `sin(x)` rather than an error, since there is
 * nothing to expand but nothing wrong either.
 */
export function expandSymbolic(node: SymbolicNode): SymbolicNode {
	const polynomial = toPolynomial(node);
	return polynomial === null ? node : fromPolynomial(polynomial);
}
