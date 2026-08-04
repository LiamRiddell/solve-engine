/**
 * Solving a polynomial equation for one variable.
 *
 * ## The order of attack, and why it is this order
 *
 * Exact answers first, approximation only as a last resort and always labelled
 * as such. Rational roots are extracted by the same rational-root theorem
 * `Factor.ts` uses, each one dividing the degree down. What survives goes to
 * the closed form for its degree: the quadratic formula, Cardano for a cubic,
 * and the biquadratic or resolvent-cubic split for a quartic. Only a remainder
 * that none of those reaches falls through to numerical root finding.
 *
 * A quadratic with a positive non-square discriminant returns its **surd**
 * form, so `x^2-2=0` gives `sqrt(2)` rather than `1.41421356`. A system that
 * advertises exact arithmetic and then hands back a rounded decimal has quietly
 * stopped being one. The surd is reduced to lowest form, so the equal but
 * unreadable `sqrt(8)/2` does not surface.
 *
 * Complex roots are returned, not skipped. `x^2+1=0` gives `-i` and `i`. The
 * "no real solutions" outcome survives for the cases where it is genuinely the
 * answer, such as a quartic whose complex roots have no closed form here.
 *
 * ## What is deliberately not here
 *
 * The *casus irreducibilis*: a cubic with three distinct real roots and no
 * rational one. Those roots provably cannot be written in real radicals, so
 * `CubicQuartic.ts` returns them numerically and this module labels them
 * approximate. See that module's header for why the trigonometric form is not
 * dressed up as an exact answer.
 *
 * A general quartic that neither is biquadratic nor splits into two rational
 * quadratics. Ferrari's method reaches it, but through a radical nested four
 * deep that nothing downstream could read or use.
 */

import {
	type SymbolicNode,
	constNode,
	complexNode,
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
import { COMPLEX_I, complex as complexValue } from "@solve-js/symbolic/Complex";
import { exactIntegerSqrt, surdNode } from "@solve-js/symbolic/Radicals";
import { type RootSet, solveCubic, solveQuartic } from "@solve-js/symbolic/CubicQuartic";

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

/**
 * Solves `ax^2 + bx + c = 0` over the complex numbers.
 *
 * A negative discriminant gives a conjugate pair rather than nothing. That is
 * what a quadratic actually has, and reporting "no real solutions" instead was
 * a limitation of not having a complex number to say it with.
 *
 * @returns The exact roots: rational constants for a perfect-square
 * discriminant, surds for a positive non-square one, and complex values for a
 * negative one.
 */
function solveQuadratic(a: Rational, b: Rational, c: Rational): SymbolicNode[] {
	// discriminant = b^2 - 4ac
	const discriminant = rationalSub(rationalMul(b, b), rationalMul(rational4(), rationalMul(a, c)));
	const twoA = rationalMul(rational2(), a);

	if (rationalCompare(discriminant, RATIONAL_ZERO) < 0) {
		return complexQuadraticRoots(rationalNeg(b), discriminant, twoA);
	}
	if (isRationalZero(discriminant)) return [constNode(rationalDiv(rationalNeg(b), twoA))];

	// A perfect-square discriminant needs both numerator and denominator to be
	// perfect squares, since the rational's own square root is taken componentwise.
	const rootN = exactIntegerSqrt(discriminant.n);
	const rootD = exactIntegerSqrt(discriminant.d);
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
 * The conjugate pair for a quadratic whose discriminant is negative.
 *
 * `sqrt(D)` for negative `D` is `sqrt(-D) * i`, so the roots are
 * `(-b ± sqrt(|D|) i) / 2a`. When `sqrt(|D|)` is rational the whole root is a
 * Gaussian rational and comes back as a single exact complex value; otherwise
 * the irrational part stays as a surd multiplied by `i`.
 *
 * The negative root is returned first, matching the ordering the real cases use.
 *
 * @param negatedB - `-b`, already negated by the caller.
 * @param discriminant - The negative discriminant.
 * @param twoA - `2a`.
 * @returns The two roots.
 */
function complexQuadraticRoots(negatedB: Rational, discriminant: Rational, twoA: Rational): SymbolicNode[] {
	const magnitude = rationalNeg(discriminant);
	const rootN = exactIntegerSqrt(magnitude.n);
	const rootD = exactIntegerSqrt(magnitude.d);

	if (rootN !== null && rootD !== null) {
		// Everything stays in the Gaussian rationals, so each root is one exact
		// complex value rather than an expression.
		const imaginary = rationalDiv({ n: rootN, d: rootD }, twoA);
		const real = rationalDiv(negatedB, twoA);
		return [
			complexNode(complexValue(real, rationalNeg(imaginary))),
			complexNode(complexValue(real, imaginary)),
		];
	}

	// The imaginary part is irrational, so it keeps its surd form times `i`.
	//
	// The division by `2a` is folded into the radicand rather than left outside
	// it: `sqrt(m)/2a` is `sqrt(m/(2a)^2)`, which reduces. Building it the naive
	// way leaves `-2*sqrt(2)*i/2` for `x^2+2=0`, since the simplifier's
	// common-factor cancellation cannot see a `2` buried inside a surd's own
	// coefficient. Doing the algebra here instead gives `-sqrt(2)*i`.
	const real = rationalDiv(negatedB, twoA);
	const scaledRadicand = rationalDiv(magnitude, rationalMul(twoA, twoA));
	const imaginary: SymbolicNode = { kind: "mul", left: surdNode(scaledRadicand), right: complexNode(COMPLEX_I) };

	if (isRationalZero(real)) {
		return [{ kind: "neg", operand: imaginary }, imaginary];
	}
	return [
		{ kind: "sub", left: constNode(real), right: imaginary },
		{ kind: "add", left: constNode(real), right: imaginary },
	];
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

/**
 * The closed form for a leftover cubic or quartic, when one exists.
 *
 * Reached only after every rational root has been divided out, so what arrives
 * here genuinely needs radicals. A cubic always has a closed form of some kind;
 * a quartic has one only in the two families {@link solveQuartic} covers.
 *
 * @param descending - Descending coefficients of the leftover polynomial.
 * @returns The roots, or `null` when the numerical fallback should take over.
 */
function closedFormRoots(descending: readonly Rational[]): RootSet | null {
	if (descending.length === 4) {
		return solveCubic(descending[0], descending[1], descending[2], descending[3]);
	}
	if (descending.length === 5) {
		return solveQuartic(descending[0], descending[1], descending[2], descending[3], descending[4], solveQuadratic);
	}
	return null;
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
		return { kind: "roots", exact: [...exact, ...quadratic], approximate: [] };
	}
	if (leftoverDegree <= 0) {
		return exact.length > 0
			? { kind: "roots", exact, approximate: [] }
			: { kind: "no-real-solutions", reason: "there is no value that satisfies this equation" };
	}

	const closedForm = closedFormRoots(remaining);
	if (closedForm !== null) {
		return { kind: "roots", exact: [...exact, ...closedForm.exact], approximate: closedForm.approximate };
	}

	// Degree five or more, or a quartic with no readable closed form. Approximate,
	// and say so.
	const approximate = numericRoots(remaining);
	if (exact.length === 0 && approximate.length === 0) {
		return { kind: "no-real-solutions", reason: "no real root was found within the polynomial's root bound" };
	}
	return { kind: "roots", exact, approximate };
}
