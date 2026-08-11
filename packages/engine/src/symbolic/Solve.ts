/**
 * Solving a polynomial equation for one variable.
 *
 * ## The order of attack, and why it is this order
 *
 * Exact answers first, approximation only as a last resort and always labelled
 * as such.
 *
 * 1. `x` itself, as many times as it divides the polynomial. This step exists
 *    because the rational-root theorem is stated for a **non-zero** constant
 *    term, so without it `x^5-x=0` found no rational roots at all and fell
 *    straight through to numerics, despite every one of its five roots being
 *    exact. Dividing `x` out first is what turns that equation back into
 *    `x^4-1`, whose roots are `±1` and then `±i`.
 * 2. Every rational root, by the same rational-root theorem `Factor.ts` uses,
 *    each divided out **exactly** over the rationals with its full
 *    multiplicity. In floating point a near-root and a real root are
 *    indistinguishable, which is the whole reason `Rational.ts` exists.
 * 3. The closed form for whatever degree survives: the quadratic formula,
 *    Cardano for a cubic, and the biquadratic or resolvent-cubic split for a
 *    quartic.
 * 4. Only a remainder that none of those reaches goes to `NumericRoots.ts`,
 *    which finds **all** of its roots at once in the complex plane.
 *
 * A quadratic with a positive non-square discriminant returns its **surd**
 * form, so `x^2-2=0` gives `sqrt(2)` rather than `1.41421356`. A system that
 * advertises exact arithmetic and then hands back a rounded decimal has quietly
 * stopped being one. The surd is reduced to lowest form, so the equal but
 * unreadable `sqrt(8)/2` does not surface.
 *
 * ## Complex roots are roots
 *
 * `x^2+1=0` gives `-i` and `i`, and the numerical stage works in complex
 * arithmetic throughout rather than scanning the real line for sign changes.
 * A real-only scan is why `solve(x^5-1=0, x)` used to answer with `1` and
 * nothing else: the other four roots are complex, the scan could not see them,
 * and one root out of five was reported as though it were the whole answer.
 *
 * ## Every root is accounted for
 *
 * Each stage records how much of the degree it consumed. When those do not add
 * up to the degree of the equation, the outcome is `incomplete` rather than
 * `roots`, and it carries how many are missing. A partial list presented as a
 * complete one is the worst answer available here, because nothing about it
 * looks wrong.
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
 * deep that nothing downstream could read or use, so its roots come back
 * numerically instead.
 *
 * A quintic's radicals, which by Abel-Ruffini do not exist in general, and the
 * cyclotomic forms that do exist for the special cases such as `x^5-1`. Those
 * nest deeply enough that four accurate decimals are the more useful answer.
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
import { type ApproximateRoot, approximateRoots } from "@solve-js/symbolic/NumericRoots";

/**
 * Highest polynomial degree {@link solveForVariable} will attempt.
 *
 * Beyond this the numerical fallback's interval scan becomes the dominant cost
 * and the answers get progressively less trustworthy, so declining is better
 * than a slow guess.
 */
export const SOLVE_MAX_DEGREE = 8;

/**
 * The outcome of solving an equation.
 *
 * Several of these are answers rather than failures: an identity is the correct
 * response to `x+1=x+1`, and a contradiction to `1=2`.
 *
 * There is deliberately no "no real solutions" case. Every polynomial of degree
 * `n` has `n` roots over the complex numbers, and this solver reports them, so
 * the only honest ways to answer are the complete list, a stated shortfall, or
 * a stated refusal.
 */
export type SolveOutcome =
	/** Every solution. `exact` carries those expressible as a rational, a surd or a Gaussian rational; `approximate` carries any found numerically. */
	| { kind: "roots"; readonly exact: readonly SymbolicNode[]; readonly approximate: readonly ApproximateRoot[] }
	/**
	 * Some solutions, and the count of those this solver could not reach.
	 *
	 * Distinct from `roots` so that a caller cannot present a partial list as a
	 * whole one by accident, which is the failure this case exists to stop.
	 */
	| {
		kind: "incomplete";
		readonly exact: readonly SymbolicNode[];
		readonly approximate: readonly ApproximateRoot[];
		/** How many roots, counted with multiplicity, are unaccounted for. */
		readonly missing: number;
		/** Why they are, in a sentence fit to show a reader. */
		readonly reason: string;
	}
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

/** A real number as an {@link ApproximateRoot}, for the *casus irreducibilis* roots that arrive from `CubicQuartic.ts` as plain doubles. */
function realApproximation(value: number): ApproximateRoot {
	return { re: value, im: 0 };
}

/**
 * Solves `lhs = rhs` for one variable over the complex numbers.
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

/**
 * The rational roots of a polynomial and the factor left once they are gone.
 *
 * `x` comes out first because the rational-root theorem needs a non-zero
 * constant term to say anything at all. Skipping that step is the single defect
 * that made `x^5-x=0` and `x^3-x=0` numerical problems: with a zero constant
 * term {@link rationalRoots} correctly reports no candidates, and the whole
 * equation then fell past every exact method it should have used.
 *
 * @param descending - Descending coefficients, the leading one non-zero.
 * @returns The distinct rational roots in ascending order, and the coefficients
 * of the factor that survives. How much of the degree was consumed is not
 * returned because it does not need to be: every division drops exactly one
 * coefficient, so it is the difference in length and cannot drift from it.
 */
function extractRationalRoots(descending: readonly Rational[]): { roots: Rational[]; remaining: Rational[] } {
	const roots: Rational[] = [];
	let remaining = [...descending];

	let powersOfX = 0;
	while (remaining.length > 1 && isRationalZero(remaining[remaining.length - 1])) {
		remaining = remaining.slice(0, -1);
		powersOfX++;
	}
	// A repeated root is one solution, not several, so zero is recorded once
	// however many powers of `x` came out.
	if (powersOfX > 0) roots.push(RATIONAL_ZERO);

	while (remaining.length > 1) {
		const found = rationalRoots(remaining);
		if (found.length === 0) break;
		for (const root of found) {
			let multiplicity = 0;
			while (remaining.length > 1 && isRationalZero(evaluateRational(remaining, root))) {
				remaining = divideByRoot(remaining, root);
				multiplicity++;
			}
			// Guarded rather than assumed: a candidate that is no longer a root of
			// what is left must not be reported as one.
			if (multiplicity > 0) roots.push(root);
		}
	}

	// Ascending, so a row of roots reads low to high the way a reader expects.
	return { roots: roots.sort(rationalCompare), remaining };
}

/**
 * Solves a single-variable polynomial given its descending coefficients.
 *
 * Every path out of here goes through {@link finish}, and what it is told is
 * the degree of the factor still **unsolved**, read off the length of the
 * coefficient array that is left rather than accumulated in a counter as the
 * stages go. That distinction is the point. A counter is a promise each branch
 * has to keep, and the defect this replaces was exactly a branch that answered
 * for one root of five without anything downstream noticing; an array length is
 * a fact about the polynomial that no branch can misremember.
 *
 * Each leftover branch is therefore all-or-nothing: it either solves the whole
 * surviving factor or reports it whole as unsolved.
 */
function solveUnivariate(descending: readonly Rational[]): SolveOutcome {
	const { roots, remaining } = extractRationalRoots(descending);

	const exact: SymbolicNode[] = roots.map(constNode);
	const approximate: ApproximateRoot[] = [];
	const leftoverDegree = remaining.length - 1;
	const solvedDegree = descending.length - remaining.length;

	if (leftoverDegree <= 0) return finish(exact, approximate, solvedDegree, 0, "");
	if (leftoverDegree === 1) {
		// Unreachable in practice, since a linear factor's root is rational and so
		// was already extracted. Kept because the alternative to a cheap branch is
		// an unhandled degree.
		exact.push(constNode(rationalDiv(rationalNeg(remaining[1]), remaining[0])));
		return finish(exact, approximate, solvedDegree + 1, 0, "");
	}
	if (leftoverDegree === 2) {
		exact.push(...solveQuadratic(remaining[0], remaining[1], remaining[2]));
		return finish(exact, approximate, solvedDegree + 2, 0, "");
	}

	const closedForm = closedFormRoots(remaining);
	if (closedForm !== null) {
		exact.push(...closedForm.exact);
		approximate.push(...closedForm.approximate.map(realApproximation));
		return finish(exact, approximate, solvedDegree + leftoverDegree, 0, "");
	}

	// No closed form this module reaches: a quintic or beyond, or a quartic whose
	// radicals nest four deep. Every root of what is left is found at once in the
	// complex plane rather than one at a time by deflation.
	const numeric = approximateRoots(remaining);
	if (numeric !== null) {
		approximate.push(...numeric);
		return finish(exact, approximate, solvedDegree + leftoverDegree, 0, "");
	}
	return finish(
		exact,
		approximate,
		solvedDegree,
		leftoverDegree,
		`a degree-${leftoverDegree} factor of it has no exact solution here and the numerical method did not converge on that factor`,
	);
}

/**
 * The single exit from the univariate solver, where the answer is checked
 * against the question before it is handed back.
 *
 * This exists because of a specific failure that a message could not have
 * prevented. `solve(x^5-1=0, x)` returned `1`: a correct root, a fifth of the
 * answer, and indistinguishable from a complete one to anybody reading it. So
 * the relationship between what was asked and what was found is asserted here
 * rather than left to each branch to remember, and an answer that does not hold
 * up comes back as `incomplete` with the shortfall counted.
 *
 * Two things are checked, and both are cheap because both quantities are
 * already known:
 *
 * 1. **Coverage.** A factor of degree `unsolvedDegree` was not solved, so that
 *    many roots are missing however many were found.
 * 2. **Coherence.** A stage that claims to have solved a factor of degree one
 *    or more has to have produced at least one root for it and cannot have
 *    produced more than its degree. Neither is possible for a correct stage, so
 *    either would be a defect in the solver rather than a property of the
 *    equation, and handing back roots after seeing one would be trusting
 *    exactly what has just been shown to be untrustworthy.
 *
 * @param exact - Roots known exactly.
 * @param approximate - Roots found numerically.
 * @param solvedDegree - How much of the degree the stages above actually solved.
 * @param unsolvedDegree - The degree of the factor they did not.
 * @param reason - Why that factor was not solved, used only when one was not.
 * @returns `roots` when every root is accounted for, `incomplete` otherwise.
 */
function finish(
	exact: readonly SymbolicNode[],
	approximate: readonly ApproximateRoot[],
	solvedDegree: number,
	unsolvedDegree: number,
	reason: string,
): SolveOutcome {
	const found = exact.length + approximate.length;
	const incoherent = solvedDegree >= 1 && (found < 1 || found > solvedDegree);
	if (unsolvedDegree > 0 || incoherent) {
		return {
			kind: "incomplete",
			exact,
			approximate,
			// A distinct root can stand for several equal ones, so the count found
			// is a lower bound on what it covers. The degree left unsolved is not.
			missing: incoherent ? Math.max(1, solvedDegree + unsolvedDegree - found) : unsolvedDegree,
			reason: incoherent
				? `${found} root${found === 1 ? "" : "s"} were produced for a degree-${solvedDegree + unsolvedDegree} equation, which does not add up`
				: reason,
		};
	}
	return { kind: "roots", exact, approximate };
}
