/**
 * Every root of a polynomial at once, found numerically in the complex plane.
 *
 * ## Why not sequential deflation
 *
 * The obvious way to find several roots is to find one, divide the polynomial
 * by `(x - root)`, and solve what is left. Each division carries the first
 * root's error into every coefficient of the quotient, so the second root is
 * found from a polynomial that is no longer quite the one that was asked
 * about, and the error compounds down the chain. That is not a theoretical
 * objection. Solving `x^5-x=0` that way answered with `-1` twice, once as `-1`
 * and once as `-1.0000000000004656`, and dropped both complex roots on the way,
 * because a real-only scan for sign changes cannot see them at all.
 *
 * Durand-Kerner (also called the Weierstrass method) moves every estimate at
 * once instead. Each one steps by `p(z_i)` over the product of its distances
 * from the others, which is Newton's method applied to the whole factorization
 * rather than to one factor of it. No coefficient is ever recomputed, so
 * nothing accumulates, and the arithmetic is complex from the first step, so a
 * conjugate pair is found rather than missed.
 *
 * ## Why the input is made square-free first
 *
 * A repeated root is where every simultaneous method loses precision. A double
 * root is only ever located to about the square root of machine epsilon, and
 * the two estimates converging on it arrive straddling the true value rather
 * than on top of it. The usual repair is to cluster the output and read a
 * multiplicity off the cluster size, which is a numerical answer to something
 * the exact arithmetic upstream can remove outright: `gcd(p, p')` is precisely
 * the repeated part, so `p` divided by it has the same roots with every one of
 * them simple. That division happens over the rationals, so what reaches the
 * iteration is a polynomial whose roots are as well separated as they can be.
 *
 * Near-equal output is still merged, but as a check that the iteration
 * separated what it was handed rather than as the mechanism for multiplicity.
 * Two estimates landing on the same value now means the run failed, and
 * {@link approximateRoots} says so by returning `null` instead of quietly
 * reporting one root fewer than the polynomial has.
 */

import { type Rational, rationalToNumber } from "@solve-js/symbolic/Rational";
import { squareFreePart } from "@solve-js/symbolic/Gcd";

/**
 * One numerically-found root.
 *
 * Complex because the roots of a real polynomial are, and reporting only the
 * real ones is how `x^5-1=0` came to answer with `1` and nothing else.
 */
export interface ApproximateRoot {
	/** Real part. */
	readonly re: number;
	/**
	 * Imaginary part.
	 *
	 * Exactly zero for a root on the real line rather than the rounding
	 * residue an iteration in complex arithmetic leaves behind, so a caller can
	 * test it without choosing a tolerance of its own.
	 */
	readonly im: number;
}

/**
 * Iteration ceiling for {@link approximateRoots}.
 *
 * Durand-Kerner converges quadratically once the estimates separate, so a run
 * that has not settled within this many passes is diverging rather than being
 * slow, and continuing would only spend time before failing anyway.
 */
export const DURAND_KERNER_MAX_ITERATIONS = 200;

/**
 * Relative step size below which the iteration is considered settled.
 *
 * Scaled by the largest estimate, so it means the same thing for roots near
 * zero and roots in the hundreds.
 */
export const DURAND_KERNER_TOLERANCE = 1e-14;

/**
 * How large a residual a root may leave and still be accepted, relative to the
 * magnitude Horner's method accumulated on the way to it.
 *
 * This is a backward-error test: it asks whether the value is a root of a
 * polynomial within rounding distance of the one given, which is the strongest
 * statement double precision can support. An absolute threshold cannot do the
 * job, since `p(z)` for a degree-eight polynomial with coefficients in the
 * thousands is numerically large even at a perfect root.
 */
export const ROOT_RESIDUAL_TOLERANCE = 1e-10;

/**
 * How close two estimates may come before they are treated as the same root.
 *
 * The polynomial handed to the iteration is square-free, so all of its roots
 * are simple and a converged pair should be separated by their true distance.
 * Two estimates this close have collapsed onto one root, leaving another
 * undiscovered, which is reported rather than hidden.
 */
export const ROOT_SEPARATION_TOLERANCE = 1e-10;

/**
 * How small a component must be, relative to the root's magnitude, to be
 * rounding residue rather than part of the answer.
 *
 * A simple root of a real polynomial is either on an axis or a bounded distance
 * from it, so there is no middle ground to get wrong here. The candidate is
 * confirmed by residual before the component is dropped, so this only decides
 * what is worth trying.
 */
const AXIS_SNAP_TOLERANCE = 1e-9;

/**
 * How far two estimates may be from being each other's conjugate and still be
 * averaged into an exact pair.
 *
 * Generous, because for a polynomial with real coefficients the root set is
 * closed under conjugation as a matter of algebra: every non-real root has an
 * exact partner in the set, and the iteration finds it to within its own
 * convergence. This only guards against pairing a root that has no partner.
 */
const CONJUGATE_PAIR_TOLERANCE = 1e-8;

/** How many Newton steps re-converge a root after a component is dropped. */
const NEWTON_POLISH_STEPS = 4;

/** A complex number as two doubles, the working type of the iteration. */
interface Cpx {
	readonly re: number;
	readonly im: number;
}

/** `a - b`. */
function subtract(a: Cpx, b: Cpx): Cpx {
	return { re: a.re - b.re, im: a.im - b.im };
}

/** `a * b`. */
function multiply(a: Cpx, b: Cpx): Cpx {
	return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

/**
 * `a / b`, by Smith's method.
 *
 * Dividing through by the larger component rather than by `|b|^2` keeps the
 * intermediate from overflowing when both components are large, which the
 * naive form does for magnitudes past about 1e154. The iteration divides by a
 * product of up to seven differences, so that is reachable rather than
 * hypothetical.
 */
function divide(a: Cpx, b: Cpx): Cpx {
	if (Math.abs(b.re) >= Math.abs(b.im)) {
		const ratio = b.im / b.re;
		const denominator = b.re + b.im * ratio;
		return { re: (a.re + a.im * ratio) / denominator, im: (a.im - a.re * ratio) / denominator };
	}
	const ratio = b.re / b.im;
	const denominator = b.re * ratio + b.im;
	return { re: (a.re * ratio + a.im) / denominator, im: (a.im * ratio - a.re) / denominator };
}

/** `|z|`. */
function magnitude(z: Cpx): number {
	return Math.hypot(z.re, z.im);
}

/** Evaluates real descending coefficients at a complex point, by Horner's method. */
function evaluateAt(descending: readonly number[], z: Cpx): Cpx {
	let re = 0;
	let im = 0;
	for (const coefficient of descending) {
		const nextRe = re * z.re - im * z.im + coefficient;
		im = re * z.im + im * z.re;
		re = nextRe;
	}
	return { re, im };
}

/**
 * The magnitude Horner's method accumulates on the way to `p(z)`.
 *
 * This is the scale a residual has to be judged against: it is what `|p(z)|`
 * would be if every rounding error in the evaluation happened to add rather
 * than cancel, so a residual below it says the value is a root as far as double
 * precision can distinguish.
 */
function evaluationScale(descending: readonly number[], z: Cpx): number {
	const radius = magnitude(z);
	let total = 0;
	for (const coefficient of descending) total = total * radius + Math.abs(coefficient);
	return total;
}

/** Descending coefficients of the derivative. */
function differentiate(descending: readonly number[]): number[] {
	const degree = descending.length - 1;
	const derivative: number[] = [];
	for (let i = 0; i < degree; i++) derivative.push(descending[i] * (degree - i));
	return derivative;
}

/**
 * The square-free part of a polynomial, as monic descending doubles.
 *
 * @param descending - Descending exact coefficients.
 * @returns The coefficients, or `null` when one of them has no finite double
 * value, which would make every comparison below meaningless.
 */
function squareFreeDoubles(descending: readonly Rational[]): number[] | null {
	// `Gcd.ts` works in ascending order and returns a monic result, which is
	// what the iteration wants anyway.
	const ascending = [...descending].reverse();
	const squareFree = [...squareFreePart(ascending)].reverse();

	const doubles = squareFree.map(rationalToNumber);
	if (doubles.some(value => !Number.isFinite(value))) return null;
	return doubles;
}

/**
 * Starting estimates spread around the circle the roots must lie inside.
 *
 * Two details are load-bearing. The circle is centred on `-a1/n`, the mean of
 * the roots, rather than on the origin, so the estimates start near their
 * targets for a polynomial whose roots are all off to one side. And every angle
 * is offset by half a step, which keeps all `n` of them off the real axis: a
 * real estimate of a real polynomial stays real forever, since every quantity
 * in its update is real, so a conjugate pair started on the axis would have no
 * way to leave it.
 */
function initialEstimates(monic: readonly number[]): Cpx[] {
	const degree = monic.length - 1;

	// Cauchy's bound: every root of a monic polynomial lies within 1 + max|a_k|.
	let largest = 0;
	for (let i = 1; i < monic.length; i++) largest = Math.max(largest, Math.abs(monic[i]));
	const radius = 1 + largest;
	const centre = -monic[1] / degree;

	const estimates: Cpx[] = [];
	for (let k = 0; k < degree; k++) {
		const angle = (2 * Math.PI * k) / degree + Math.PI / (2 * degree);
		estimates.push({ re: centre + radius * Math.cos(angle), im: radius * Math.sin(angle) });
	}
	return estimates;
}

/**
 * Runs the Durand-Kerner iteration to convergence.
 *
 * Estimates are updated in place as the sweep goes, so each one sees the
 * already-improved values of those before it. That is the Gauss-Seidel form of
 * the method and it converges in noticeably fewer sweeps than recomputing every
 * estimate from the previous round.
 *
 * @param monic - Monic descending coefficients of a square-free polynomial.
 * @returns The estimates, or `null` when the iteration did not settle.
 */
function durandKerner(monic: readonly number[]): Cpx[] | null {
	const degree = monic.length - 1;
	const estimates = initialEstimates(monic);

	for (let iteration = 0; iteration < DURAND_KERNER_MAX_ITERATIONS; iteration++) {
		let largestStep = 0;
		let largestRoot = 1;

		for (let i = 0; i < degree; i++) {
			let denominator: Cpx = { re: 1, im: 0 };
			for (let j = 0; j < degree; j++) {
				if (i !== j) denominator = multiply(denominator, subtract(estimates[i], estimates[j]));
			}

			// Two estimates have landed on each other. Nudging one apart lets the
			// sweep continue, where dividing by zero would poison every later
			// value with NaN and lose the roots that had already converged.
			if (denominator.re === 0 && denominator.im === 0) {
				estimates[i] = { re: estimates[i].re + 1e-6 * (i + 1), im: estimates[i].im + 1e-6 };
				continue;
			}

			const step = divide(evaluateAt(monic, estimates[i]), denominator);
			if (!Number.isFinite(step.re) || !Number.isFinite(step.im)) return null;

			estimates[i] = subtract(estimates[i], step);
			largestStep = Math.max(largestStep, magnitude(step));
			largestRoot = Math.max(largestRoot, magnitude(estimates[i]));
		}

		if (largestStep <= DURAND_KERNER_TOLERANCE * largestRoot) return estimates;
	}
	return null;
}

/** Re-converges a value with Newton's method, used after a component is dropped. */
function polish(monic: readonly number[], derivative: readonly number[], start: Cpx): Cpx {
	let candidate = start;
	for (let step = 0; step < NEWTON_POLISH_STEPS; step++) {
		const slope = evaluateAt(derivative, candidate);
		if (slope.re === 0 && slope.im === 0) break;
		const next = subtract(candidate, divide(evaluateAt(monic, candidate), slope));
		if (!Number.isFinite(next.re) || !Number.isFinite(next.im)) break;
		candidate = next;
	}
	return candidate;
}

/**
 * Drops a component that is rounding residue rather than part of the answer,
 * re-converging the value onto the axis.
 *
 * Two doubles either side of the same true root are equally correct as far as
 * arithmetic goes, so this is choosing between them on how they read: `i`
 * rather than `-0.0000000000000000122+i`, and `-0.7548776662` rather than the
 * same number with a stray imaginary trace on it. What makes that safe rather
 * than cosmetic is the residual test: the snapped value is kept only when it
 * still satisfies the polynomial to within {@link ROOT_RESIDUAL_TOLERANCE}, so
 * a root with a genuinely small component is never flattened onto an axis.
 *
 * @param monic - Monic descending coefficients.
 * @param derivative - Their derivative, so it is differentiated once per call rather than once per root.
 * @param z - The converged estimate.
 * @returns The estimate, with a negligible component replaced by an exact zero
 * where the polynomial allows it.
 */
function snapToAxes(monic: readonly number[], derivative: readonly number[], z: Cpx): Cpx {
	const scale = Math.max(1, magnitude(z));

	if (z.im !== 0 && Math.abs(z.im) <= AXIS_SNAP_TOLERANCE * scale) {
		// Every quantity is real from here, so Newton's method on a real starting
		// point stays on the real line by construction.
		const candidate = polish(monic, derivative, { re: z.re, im: 0 });
		if (isRootWithinTolerance(monic, candidate)) return { re: candidate.re, im: 0 };
	}
	if (z.re !== 0 && Math.abs(z.re) <= AXIS_SNAP_TOLERANCE * scale) {
		const candidate = polish(monic, derivative, { re: 0, im: z.im });
		if (isRootWithinTolerance(monic, candidate)) return { re: 0, im: candidate.im };
	}
	return z;
}

/** Whether a value satisfies the polynomial to within the backward error double precision allows. */
function isRootWithinTolerance(monic: readonly number[], z: Cpx): boolean {
	if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return false;
	return magnitude(evaluateAt(monic, z)) <= ROOT_RESIDUAL_TOLERANCE * evaluationScale(monic, z);
}

/**
 * Replaces each conjugate pair with an exactly-conjugate one.
 *
 * A polynomial with real coefficients has a root set closed under conjugation,
 * so the two estimates of a pair are two independent measurements of one
 * quantity and averaging them is strictly the better estimate of both. It also
 * removes an artefact worth removing on its own: without this the two halves of
 * a pair differ in their last bit, which is enough to order them by real part
 * and print `-0.7071067812+0.7071067812i` above its own conjugate rather than
 * below it.
 *
 * A root with no partner within {@link CONJUGATE_PAIR_TOLERANCE} is left as it
 * is, which is what keeps a real root, whose own conjugate is itself and so
 * lies nowhere near any other estimate, from being dragged into a pair it does
 * not belong to.
 */
function pairConjugates(roots: readonly Cpx[]): Cpx[] {
	const result = [...roots];
	const paired = result.map(root => root.im === 0);

	for (let i = 0; i < result.length; i++) {
		if (paired[i]) continue;
		const wanted: Cpx = { re: result[i].re, im: -result[i].im };

		let partner = -1;
		let closest = Number.POSITIVE_INFINITY;
		for (let j = i + 1; j < result.length; j++) {
			if (paired[j]) continue;
			const distance = magnitude(subtract(result[j], wanted));
			if (distance < closest) {
				closest = distance;
				partner = j;
			}
		}
		if (partner === -1 || closest > CONJUGATE_PAIR_TOLERANCE * Math.max(1, magnitude(result[i]))) continue;

		const re = (result[i].re + result[partner].re) / 2;
		const im = (Math.abs(result[i].im) + Math.abs(result[partner].im)) / 2;
		const sign = result[i].im < 0 ? -1 : 1;
		result[i] = { re, im: sign * im };
		result[partner] = { re, im: -sign * im };
		paired[i] = true;
		paired[partner] = true;
	}
	return result;
}

/**
 * Whether every estimate is far enough from every other to be a distinct root.
 *
 * See {@link ROOT_SEPARATION_TOLERANCE} for why a collision is a failure here
 * rather than a multiplicity.
 */
function allSeparated(roots: readonly Cpx[]): boolean {
	for (let i = 0; i < roots.length; i++) {
		for (let j = i + 1; j < roots.length; j++) {
			const scale = Math.max(1, magnitude(roots[i]), magnitude(roots[j]));
			if (magnitude(subtract(roots[i], roots[j])) <= ROOT_SEPARATION_TOLERANCE * scale) return false;
		}
	}
	return true;
}

/**
 * Every root of a polynomial, found numerically.
 *
 * Roots are returned in ascending order of real part, then imaginary part, so
 * two runs on the same input read identically and a conjugate pair reads
 * negative-first like every other pair the solver produces.
 *
 * @param descending - Descending exact coefficients, the leading one non-zero.
 * @returns One entry per **distinct** root, matching the solver's convention
 * that a repeated root is one solution rather than several. `null` when the
 * iteration did not converge, did not separate its estimates, or left a root
 * with too large a residual, so that a caller reports the shortfall rather than
 * presenting a partial list as a complete one.
 */
export function approximateRoots(descending: readonly Rational[]): ApproximateRoot[] | null {
	const monic = squareFreeDoubles(descending);
	if (monic === null) return null;
	if (monic.length < 2) return [];

	const converged = durandKerner(monic);
	if (converged === null) return null;

	// Pairing first, then snapping: the two halves of a pair come out of pairing
	// with the same real part and opposite imaginary ones, so any snap applies to
	// both alike and the pair stays exactly conjugate.
	const derivative = differentiate(monic);
	const roots = pairConjugates(converged).map(root => snapToAxes(monic, derivative, root));

	for (const root of roots) {
		if (!isRootWithinTolerance(monic, root)) return null;
	}
	if (!allSeparated(roots)) return null;

	return [...roots].sort((a, b) => a.re - b.re || a.im - b.im);
}
