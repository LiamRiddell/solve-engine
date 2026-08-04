/**
 * Solving a polynomial equation for one variable, over the reals.
 *
 * ## The order of attack, and why it is this order
 *
 * Exact answers first, approximation only as a last resort and always labelled
 * as such. Rational roots are extracted by the same rational-root theorem
 * `Factor.ts` uses, then a surviving quadratic is solved by formula. Only a
 * remainder that neither of those reaches falls through to numerical root
 * finding.
 *
 * A quadratic with a positive non-square discriminant returns its **surd**
 * form, so `x^2-2=0` gives `sqrt(2)` rather than `1.41421356`. A system that
 * advertises exact arithmetic and then hands back a rounded decimal has quietly
 * stopped being one. The surd is reduced to lowest form, so the equal but
 * unreadable `sqrt(8)/2` does not surface.
 *
 * ## What is deliberately not here
 *
 * Complex roots. A negative discriminant reports that there are no real
 * solutions rather than inventing `i`, because there is no complex value type
 * to express the answer in. That is a stated limitation, not a silent one.
 *
 * Cardano's method for a cubic with no rational root. Its *casus irreducibilis*
 * case has three real roots that cannot be written without complex
 * intermediates, so the exact path would be correct for some cubics and not
 * others. Those go to the numerical fallback instead, which is honest about
 * being approximate.
 */

import {
	type SymbolicNode,
	constNode,
} from "@solve-js/symbolic/SymbolicNode";
import {
	type Rational,
	RATIONAL_ZERO,
	rationalAdd,
	rationalMul,
	rationalDiv,
	rationalNeg,
	rationalSub,
	rationalToNumber,
	rationalCompare,
	isRationalZero,
} from "@solve-js/symbolic/Rational";
import {
	type Polynomial,
	toPolynomial,
	fromPolynomial,
	polyDegree,
	polyCoefficients,
} from "@solve-js/symbolic/Polynomial";
import { rationalRoots } from "@solve-js/symbolic/Factor";

/**
 * Highest polynomial degree {@link solveForVariable} will attempt.
 *
 * Beyond this the numerical fallback's interval scan becomes the dominant cost
 * and the answers get progressively less trustworthy, so declining is better
 * than a slow guess.
 */
export const SOLVE_MAX_DEGREE = 8;

/** Iteration ceiling for the bisection fallback, enough to reach {@link NEWTON_TOLERANCE} from any bracket the scan produces. */
export const NEWTON_MAX_ITERATIONS = 100;

/** Convergence width for the numerical fallback. */
export const NEWTON_TOLERANCE = 1e-12;

/** How many sub-intervals the numerical fallback scans for sign changes across the root bound. */
const NUMERIC_SCAN_STEPS = 2_000;

/**
 * The outcome of solving an equation.
 *
 * Several of these are answers rather than failures. "No real solutions" is the
 * correct and complete response to `x^2+1=0` over the reals, and an identity is
 * the correct response to `x+1=x+1`.
 */
export type SolveOutcome =
	/** One or more solutions. `exact` carries those expressible as a rational or a surd; `approximate` carries any found numerically. */
	| { kind: "roots"; readonly exact: readonly SymbolicNode[]; readonly approximate: readonly number[] }
	/** Real solutions exist nowhere, as for `x^2+1=0`. */
	| { kind: "no-real-solutions"; readonly reason: string }
	/** True for every value of the variable, as for `x+1=x+1`. */
	| { kind: "identity" }
	/** True for no value of the variable, as for `x=x+1`. */
	| { kind: "contradiction" }
	/** Outside what this module attempts, with the reason stated. */
	| { kind: "unsupported"; readonly reason: string };

/** Evaluates descending-order coefficients at a rational point, by Horner's method. */
function evaluateRational(descending: readonly Rational[], x: Rational): Rational {
	let total = RATIONAL_ZERO;
	for (const coeff of descending) total = rationalAdd(rationalMul(total, x), coeff);
	return total;
}

/** Evaluates descending-order coefficients at a double, for the numerical fallback only. */
function evaluateNumeric(descending: readonly Rational[], x: number): number {
	let total = 0;
	for (const coeff of descending) total = total * x + rationalToNumber(coeff);
	return total;
}

/** Divides descending-order coefficients by `(x - root)`, discarding the remainder. Only call with a confirmed root. */
function divideByRoot(descending: readonly Rational[], root: Rational): Rational[] {
	const quotient: Rational[] = [descending[0]];
	for (let i = 1; i < descending.length - 1; i++) {
		quotient.push(rationalAdd(descending[i], rationalMul(quotient[i - 1], root)));
	}
	return quotient;
}

/** Exact integer square root, or `null` when `value` is not a perfect square. Decides whether a discriminant gives rational roots or surds. */
function exactSqrt(value: bigint): bigint | null {
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

/**
 * Solves `ax^2 + bx + c = 0` over the reals.
 *
 * @returns Exact root nodes, which are rational constants when the
 * discriminant is a perfect square and surd expressions when it is not, or
 * `null` when the discriminant is negative and there are no real roots.
 */
function solveQuadratic(a: Rational, b: Rational, c: Rational): SymbolicNode[] | null {
	// discriminant = b^2 - 4ac
	const discriminant = rationalSub(rationalMul(b, b), rationalMul(rational4(), rationalMul(a, c)));
	if (rationalCompare(discriminant, RATIONAL_ZERO) < 0) return null;

	const twoA = rationalMul(rational2(), a);
	if (isRationalZero(discriminant)) return [constNode(rationalDiv(rationalNeg(b), twoA))];

	// A perfect-square discriminant needs both numerator and denominator to be
	// perfect squares, since the rational's own square root is taken componentwise.
	const rootN = exactSqrt(discriminant.n);
	const rootD = exactSqrt(discriminant.d);
	if (rootN !== null && rootD !== null) {
		const root: Rational = { n: rootN, d: rootD };
		const plus = rationalDiv(rationalAdd(rationalNeg(b), root), twoA);
		const minus = rationalDiv(rationalSub(rationalNeg(b), root), twoA);
		// Ascending, so a pair of roots always reads low to high.
		return rationalCompare(minus, plus) <= 0 ? [constNode(minus), constNode(plus)] : [constNode(plus), constNode(minus)];
	}

	// Irrational but real: return the surd rather than a decimal.
	const surd = surdNode(discriminant);
	// Subtracting the surd gives the smaller root when the leading coefficient
	// is positive, so this ordering matches the rational case above.
	const ascending = rationalCompare(twoA, RATIONAL_ZERO) > 0;
	const lower: SymbolicNode = { kind: "div", left: { kind: "sub", left: constNode(rationalNeg(b)), right: surd }, right: constNode(twoA) };
	const upper: SymbolicNode = { kind: "div", left: { kind: "add", left: constNode(rationalNeg(b)), right: surd }, right: constNode(twoA) };
	return ascending ? [lower, upper] : [upper, lower];
}

/**
 * Builds the square root of a positive rational in lowest surd form.
 *
 * `sqrt(8)` becomes `2*sqrt(2)` rather than being left as-is, which is what
 * makes `x^2-2=0` come out as `sqrt(2)` instead of the equal but unreadable
 * `sqrt(8)/2`. Written as a `sqrt` call rather than a power of one half so it
 * renders the way it is normally written, and so the simplifier's own exact
 * folding collapses it when the radicand turns out to be a perfect square.
 *
 * `sqrt(n/d)` is computed as `sqrt(n*d)/d`, which keeps the whole extraction in
 * integers.
 */
function surdNode(value: Rational): SymbolicNode {
	const radicand = value.n * value.d;

	// Pull out the largest square factor by trial division.
	let extracted = 1n;
	let remaining = radicand;
	for (let factor = 2n; factor * factor <= remaining; factor++) {
		const square = factor * factor;
		while (remaining % square === 0n) {
			remaining /= square;
			extracted *= factor;
		}
	}

	const root: SymbolicNode = { kind: "call", name: "sqrt", args: [constNode({ n: remaining, d: 1n })] };
	const scale: Rational = { n: extracted, d: value.d };
	return isRationalOneValue(scale) ? root : { kind: "mul", left: constNode(scale), right: root };
}

/** Whether a rational is exactly one, used by {@link surdNode} to skip a redundant coefficient. */
function isRationalOneValue(value: Rational): boolean {
	return value.n === 1n && value.d === 1n;
}

/** The rational two, built once per call rather than exported, since it is only needed here. */
function rational2(): Rational {
	return { n: 2n, d: 1n };
}

/** The rational four. */
function rational4(): Rational {
	return { n: 4n, d: 1n };
}

/**
 * Real roots of a polynomial found numerically, by scanning for sign changes
 * across the Cauchy root bound and bisecting each bracket.
 *
 * Bisection rather than Newton-Raphson: it cannot diverge, cannot stall on a
 * zero derivative, and its error bound is known in advance. For a fallback
 * whose whole purpose is to give an answer where the exact methods could not,
 * predictability is worth more than the faster convergence.
 */
function numericRoots(descending: readonly Rational[]): number[] {
	const leading = rationalToNumber(descending[0]);
	if (leading === 0) return [];

	// Cauchy bound: every real root lies within 1 + max|a_i / a_n|.
	let bound = 0;
	for (let i = 1; i < descending.length; i++) {
		const ratio = Math.abs(rationalToNumber(descending[i]) / leading);
		if (ratio > bound) bound = ratio;
	}
	bound += 1;

	const roots: number[] = [];
	const step = (2 * bound) / NUMERIC_SCAN_STEPS;
	let previousX = -bound;
	let previousY = evaluateNumeric(descending, previousX);
	for (let i = 1; i <= NUMERIC_SCAN_STEPS; i++) {
		const x = -bound + i * step;
		const y = evaluateNumeric(descending, x);
		if (previousY === 0) roots.push(previousX);
		else if ((previousY < 0) !== (y < 0)) roots.push(bisect(descending, previousX, x));
		previousX = x;
		previousY = y;
	}
	return roots;
}

/** Narrows a sign-change bracket to {@link NEWTON_TOLERANCE}. */
function bisect(descending: readonly Rational[], low: number, high: number): number {
	let left = low;
	let right = high;
	let leftValue = evaluateNumeric(descending, left);
	for (let i = 0; i < NEWTON_MAX_ITERATIONS && right - left > NEWTON_TOLERANCE; i++) {
		const middle = (left + right) / 2;
		const middleValue = evaluateNumeric(descending, middle);
		if ((leftValue < 0) === (middleValue < 0)) {
			left = middle;
			leftValue = middleValue;
		} else {
			right = middle;
		}
	}
	return (left + right) / 2;
}

/**
 * Solves `lhs = rhs` for one variable over the reals.
 *
 * @param lhs - Left-hand side of the equation.
 * @param rhs - Right-hand side.
 * @param variable - The variable to solve for.
 * @returns The outcome. See {@link SolveOutcome}; several of its cases are
 * answers rather than failures.
 */
export function solveForVariable(lhs: SymbolicNode, rhs: SymbolicNode, variable: string): SolveOutcome {
	const polynomial = toPolynomial({ kind: "sub", left: lhs, right: rhs });
	if (polynomial === null) {
		return {
			kind: "unsupported",
			reason: "this is not a polynomial equation (it divides by an unknown, or calls a function of one)",
		};
	}

	const others = polynomial.vars.filter(name => name !== variable);
	const degree = polyDegree(polynomial, variable);

	if (others.length > 0) {
		// With another unknown present the roots are themselves expressions in
		// it. That is only worth doing, and only reliably correct, in the linear
		// case; anything higher would need the quadratic formula over symbolic
		// coefficients including a symbolic discriminant sign.
		if (degree !== 1) {
			return {
				kind: "unsupported",
				reason: `solving for "${variable}" needs the equation to be linear in it when other unknowns (${others.join(", ")}) are present`,
			};
		}
		return solveLinearWithOtherUnknowns(polynomial, variable);
	}

	if (degree === 0) {
		return polynomial.terms.size === 0 ? { kind: "identity" } : { kind: "contradiction" };
	}
	if (degree > SOLVE_MAX_DEGREE) {
		return { kind: "unsupported", reason: `degree ${degree} is above the supported maximum of ${SOLVE_MAX_DEGREE}` };
	}

	const descending = [...polyCoefficients(polynomial, variable)].reverse();
	return solveUnivariate(descending);
}

/** Solves `a*x + b = 0` where `a` and `b` may themselves involve other unknowns. */
function solveLinearWithOtherUnknowns(polynomial: Polynomial, variable: string): SolveOutcome {
	// Split terms into those carrying exactly one power of the variable and
	// those carrying none, then x = -constantPart / coefficientPart.
	const coefficientTerms = new Map<string, Rational>();
	const constantTerms = new Map<string, Rational>();
	for (const [key, coeff] of polynomial.terms) {
		const factors = key.split("*").filter(part => part.length > 0);
		const index = factors.indexOf(variable);
		if (index === -1) {
			constantTerms.set(key, coeff);
		} else {
			factors.splice(index, 1);
			coefficientTerms.set(factors.join("*"), coeff);
		}
	}

	const namesOf = (terms: Map<string, Rational>): string[] => {
		const names = new Set<string>();
		for (const key of terms.keys()) {
			for (const part of key.split("*")) {
				if (part.length > 0) names.add(part.split("^")[0]);
			}
		}
		return [...names].sort();
	};

	const coefficient = fromPolynomial({ terms: coefficientTerms, vars: namesOf(coefficientTerms) });
	const constant = fromPolynomial({ terms: constantTerms, vars: namesOf(constantTerms) });
	return {
		kind: "roots",
		exact: [{ kind: "div", left: { kind: "neg", operand: constant }, right: coefficient }],
		approximate: [],
	};
}

/** Solves a single-variable polynomial given its descending coefficients. */
function solveUnivariate(descending: readonly Rational[]): SolveOutcome {
	const exact: SymbolicNode[] = [];
	let remaining = [...descending];

	// Exact rational roots first, each divided out so the remaining degree drops.
	let roots = [...rationalRoots(remaining)].sort(rationalCompare);
	while (roots.length > 0 && remaining.length > 1) {
		for (const root of roots) {
			while (remaining.length > 1 && isRationalZero(evaluateRational(remaining, root))) {
				remaining = divideByRoot(remaining, root);
			}
			// A repeated root is one solution, not several, so it is recorded once.
			exact.push(constNode(root));
		}
		roots = remaining.length > 1 ? [...rationalRoots(remaining)].sort(rationalCompare) : [];
	}

	const leftoverDegree = remaining.length - 1;
	if (leftoverDegree === 1) {
		exact.push(constNode(rationalDiv(rationalNeg(remaining[1]), remaining[0])));
		return { kind: "roots", exact, approximate: [] };
	}
	if (leftoverDegree === 2) {
		const quadratic = solveQuadratic(remaining[0], remaining[1], remaining[2]);
		if (quadratic === null) {
			return exact.length > 0
				? { kind: "roots", exact, approximate: [] }
				: { kind: "no-real-solutions", reason: "the discriminant is negative, so both roots are complex" };
		}
		return { kind: "roots", exact: [...exact, ...quadratic], approximate: [] };
	}
	if (leftoverDegree <= 0) {
		return exact.length > 0
			? { kind: "roots", exact, approximate: [] }
			: { kind: "no-real-solutions", reason: "there is no value that satisfies this equation" };
	}

	// Degree three or more with no rational root left. Approximate, and say so.
	const approximate = numericRoots(remaining);
	if (exact.length === 0 && approximate.length === 0) {
		return { kind: "no-real-solutions", reason: "no real root was found within the polynomial's root bound" };
	}
	return { kind: "roots", exact, approximate };
}
