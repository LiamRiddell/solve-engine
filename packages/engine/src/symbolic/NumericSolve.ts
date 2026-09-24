/**
 * Real roots of an equation the exact algebra has no method for.
 *
 * `cos(x) = x` and `2^x = 10` are not polynomial equations, so nothing in
 * `Solve.ts` applies to them, and most such equations have no closed-form answer
 * at all. What they do have is a place where the two sides cross, and that place
 * can be found to the full precision of a double by narrowing in on it: the
 * difference of the two sides is negative on one side of the crossing and
 * positive on the other, so halving the interval that straddles it, and keeping
 * the half that still straddles it, closes in on the root. That is bisection,
 * and it is slow by the standards of Newton's method but it cannot diverge and
 * it cannot be sent to a different root by a bad starting guess.
 *
 * ## Where it looks
 *
 * The line is first sampled, and every pair of neighbouring samples whose
 * differences have opposite signs brackets a crossing. Without a stated range
 * the samples run from minus a million to a million, packed densely near zero
 * and spreading out further away (evenly in `asinh(x)`), because that is where
 * the roots of everyday equations sit and a uniform grid wide enough to reach a
 * million would step right over them. A stated range is sampled evenly, and a
 * hair past each end (see `evenGrid` for why).
 *
 * Two neighbouring samples that come out exactly equal on both sides mean the
 * sides agree across a stretch rather than at a point, or have both rounded to
 * the same double, as `e^x` does to zero below -745. That is its own outcome,
 * `flat`, and never a list of roots.
 *
 * ## Why every candidate is checked
 *
 * A change of sign is also what a pole looks like: `1/x` changes sign at zero
 * without ever being zero. So each bisected candidate is substituted back into
 * both sides, and it is reported only when the two sides agree there to within a
 * few parts in a billion of their own size. A candidate that fails that is not a
 * root and is dropped, never reported.
 *
 * ## What it cannot see, and says
 *
 * A root where the two sides touch without crossing (`cos(x) = 1` at zero) has
 * no sign change to find, and neither does a pair of roots closer together than
 * the spacing of the samples. Such a root is reported only if a sample lands on
 * it exactly. Roots outside the range are not looked for. So finding nothing is
 * reported as having found nothing in that range, a named outcome, and never as
 * there being no solution, which is a stronger claim than a search can make.
 *
 * An equation with more than {@link NUMERIC_ROOTS_MAX} roots in the range is
 * declined rather than listed, since that is what an equation that repeats
 * forever (anything built on `sin` or `cos`) looks like, and a long list cut off
 * at the edge of the search would read as the whole answer.
 */

import type { SymbolicNode } from "@solve-js/symbolic/SymbolicNode";
import { compileRealFunction, type RealFunction } from "@solve-js/symbolic/NumericEvaluate";

/** How far either side of zero the search looks when no range is stated. */
export const NUMERIC_SEARCH_LIMIT = 1_000_000;

/** How many intervals the search range is divided into before bisecting. */
export const NUMERIC_SEARCH_INTERVALS = 4000;

/** The most roots a numeric search will list before declining as too many. */
export const NUMERIC_ROOTS_MAX = 10;

/**
 * How closely the two sides must agree at a candidate, relative to their size,
 * for it to count as a root.
 *
 * Bisection runs until the bracket is two neighbouring doubles, so at a genuine
 * crossing the sides agree to within rounding, far inside this. At a pole or a
 * jump they differ by as much as the sides themselves, far outside it.
 */
export const NUMERIC_ROOT_RESIDUAL_TOLERANCE = 1e-9;

/** Bisection steps before giving up on a bracket; halving a double's range to adjacent values never needs this many. */
const BISECTION_MAX_STEPS = 1100;

/** A closed interval of the real line to search. */
export interface SearchRange {
	readonly lower: number;
	readonly upper: number;
}

/** What a numeric root search found. */
export type NumericSolveOutcome =
	/** Every verified crossing in the range, ascending. */
	| { readonly kind: "roots"; readonly roots: readonly number[]; readonly range: SearchRange; readonly stated: boolean }
	/** No crossing in the range. Not a claim that the equation has no solution. */
	| { readonly kind: "none"; readonly range: SearchRange; readonly stated: boolean }
	/** More than {@link NUMERIC_ROOTS_MAX} crossings in the range. */
	| { readonly kind: "tooMany"; readonly range: SearchRange; readonly stated: boolean }
	/**
	 * The two sides come out exactly equal at neighbouring samples, from `from`
	 * to `to`: equal across a stretch, or too close there for a double to tell
	 * apart. There is no list of roots to give either way.
	 */
	| { readonly kind: "flat"; readonly from: number; readonly to: number; readonly range: SearchRange; readonly stated: boolean }
	/** The equation cannot be evaluated numerically, with the reason. */
	| { readonly kind: "unsupported"; readonly reason: string };

/**
 * Searches for the real roots of `lhs = rhs` in one unknown.
 *
 * @param lhs - Left-hand side.
 * @param rhs - Right-hand side.
 * @param variable - The unknown.
 * @param range - Where to look. Omitted, the search runs from
 * -{@link NUMERIC_SEARCH_LIMIT} to {@link NUMERIC_SEARCH_LIMIT}.
 * @returns The outcome. See {@link NumericSolveOutcome}.
 */
export function solveNumerically(lhs: SymbolicNode, rhs: SymbolicNode, variable: string, range?: SearchRange): NumericSolveOutcome {
	const left = compileRealFunction(lhs, variable);
	if (!left.ok) return { kind: "unsupported", reason: left.reason };
	const right = compileRealFunction(rhs, variable);
	if (!right.ok) return { kind: "unsupported", reason: right.reason };
	return findRealRoots(left.fn, right.fn, range);
}

/**
 * The search itself, over two already-compiled sides.
 *
 * @param left - The left-hand side as a function.
 * @param right - The right-hand side as a function.
 * @param range - Where to look, as for {@link solveNumerically}.
 * @returns The outcome.
 */
export function findRealRoots(left: RealFunction, right: RealFunction, range?: SearchRange): NumericSolveOutcome {
	const stated = range !== undefined;
	const searched: SearchRange = range ?? { lower: -NUMERIC_SEARCH_LIMIT, upper: NUMERIC_SEARCH_LIMIT };
	const difference: RealFunction = x => left(x) - right(x);

	const xs = stated ? evenGrid(searched) : spreadGrid();
	const ys = xs.map(difference);

	const roots: number[] = [];
	for (let i = 0; i < xs.length; i++) {
		const y = ys[i];
		let root: number | null = null;
		if (y === 0) {
			// Two neighbouring samples that both come out exactly equal mean the
			// sides agree across a whole stretch, not at a point: either they
			// really are equal there (`floor(x) = 0` on [0, 1)), or they have
			// both rounded to the same double (`e^x = 0`, whose left side
			// underflows to zero below -745 though it is never zero). Neither has
			// a list of roots to give, and the second has none at all.
			if (ys[i - 1] === 0 || ys[i + 1] === 0) {
				let end = i;
				while (end + 1 < xs.length && ys[end + 1] === 0) end++;
				return { kind: "flat", from: xs[i] + 0, to: xs[end] + 0, range: searched, stated };
			}
			// A lone sample that lands exactly on a root is one, whether or not
			// the curve crosses there. This is how a touching root can still be
			// found.
			root = xs[i] + 0;
		} else if (i > 0 && brackets(ys[i - 1], y)) {
			root = verifiedRoot(left, right, difference, xs[i - 1], ys[i - 1], xs[i], y);
		}
		if (root === null) continue;
		if (roots.length > 0 && roots[roots.length - 1] === root) continue;
		roots.push(root);
		if (roots.length > NUMERIC_ROOTS_MAX) return { kind: "tooMany", range: searched, stated };
	}

	if (roots.length === 0) return { kind: "none", range: searched, stated };
	return { kind: "roots", roots, range: searched, stated };
}

/** Whether two neighbouring samples straddle a crossing: both have a sign and the signs differ. Infinities count, `NaN` does not. */
function brackets(a: number, b: number): boolean {
	if (Number.isNaN(a) || Number.isNaN(b) || a === 0 || b === 0) return false;
	return (a < 0) !== (b < 0);
}

/**
 * A stated range, divided evenly, with both ends sampled exactly, and one more
 * sample a hair beyond each end.
 *
 * The extra two are for a root that sits on an end the reader could only write
 * approximately. `solve(sin(x) = 0, x, 0, pi)` means the root at pi, but the
 * double nearest pi is not pi, so the sine there is 1.2e-16 rather than zero and
 * no sample inside the range sees the curve cross. A sample a billionth of the
 * range further on does, and the root found between them is at pi to within
 * that billionth.
 */
function evenGrid(range: SearchRange): number[] {
	const xs: number[] = [];
	const width = range.upper - range.lower;
	const margin = width * RANGE_END_MARGIN;
	// A margin too small to move the end is left out rather than sampled twice.
	if (range.lower - margin < range.lower) xs.push(range.lower - margin);
	for (let i = 0; i < NUMERIC_SEARCH_INTERVALS; i++) xs.push(range.lower + width * (i / NUMERIC_SEARCH_INTERVALS));
	xs.push(range.upper);
	if (range.upper + margin > range.upper) xs.push(range.upper + margin);
	return xs;
}

/** How far past each end of a stated range, as a fraction of its width, the search also looks. */
const RANGE_END_MARGIN = 1e-9;

/**
 * The default range, spaced evenly in `asinh(x)`.
 *
 * About 0.007 apart near zero and about 7 apart near a thousand, so small roots
 * are resolved finely and large ones are still reached. Zero is sampled exactly,
 * and so are the two ends.
 */
function spreadGrid(): number[] {
	const reach = Math.asinh(NUMERIC_SEARCH_LIMIT);
	const xs: number[] = [];
	for (let i = 0; i <= NUMERIC_SEARCH_INTERVALS; i++) {
		xs.push(Math.sinh(-reach + (2 * reach * i) / NUMERIC_SEARCH_INTERVALS));
	}
	xs[0] = -NUMERIC_SEARCH_LIMIT;
	xs[NUMERIC_SEARCH_INTERVALS / 2] = 0;
	xs[NUMERIC_SEARCH_INTERVALS] = NUMERIC_SEARCH_LIMIT;
	return xs;
}

/**
 * Bisects one bracket and checks the result.
 *
 * @returns The root, or `null` when the bracket held a pole, a jump or a gap in
 * the domain rather than a crossing.
 */
function verifiedRoot(
	left: RealFunction,
	right: RealFunction,
	difference: RealFunction,
	lo: number,
	flo: number,
	hi: number,
	fhi: number,
): number | null {
	// Only a finite sample says anything about how large the sides are here.
	const bracketScale = Math.max(finiteMagnitude(flo), finiteMagnitude(fhi));
	const candidate = bisect(difference, lo, flo, hi, fhi);
	if (candidate === null) return null;
	if (!isResidualSmall(left, right, candidate, bracketScale, hi - lo)) return null;
	return tidy(left, right, candidate);
}

/** `|v|` for a finite value, zero otherwise. */
function finiteMagnitude(v: number): number {
	return Number.isFinite(v) ? Math.abs(v) : 0;
}

/**
 * Halves the bracket until it is two neighbouring doubles.
 *
 * @returns The end of the final bracket nearer to zero difference, or `null` when
 * the function has no value somewhere inside it.
 */
function bisect(f: RealFunction, lo: number, flo: number, hi: number, fhi: number): number | null {
	for (let step = 0; step < BISECTION_MAX_STEPS; step++) {
		const mid = lo + (hi - lo) / 2;
		if (mid <= lo || mid >= hi) break;
		const fmid = f(mid);
		if (Number.isNaN(fmid)) return null;
		if (fmid === 0) return mid;
		if ((fmid < 0) === (flo < 0)) {
			lo = mid;
			flo = fmid;
		} else {
			hi = mid;
			fhi = fmid;
		}
	}
	return Math.abs(flo) <= Math.abs(fhi) ? lo : hi;
}

/**
 * Substitutes a candidate back into both sides.
 *
 * The tolerance is relative to the larger of the two sides at the candidate and
 * the difference at the bracket's ends. The second matters where both sides
 * pass through zero together (`sin(x) = 0` at pi): the sides themselves are
 * then tiny, and only the size of the curve either side says what tiny means.
 *
 * Across a continuous crossing, the difference shrinks in proportion to the
 * bracket, so bisecting a bracket down to neighbouring doubles shrinks it by
 * the ratio of their spacing to the bracket's width. Across a jump or a pole it
 * does not shrink at all. The tolerance is therefore never tighter than that
 * ratio, with room to spare, which is what lets the narrow bracket just past
 * the end of a stated range (see `evenGrid`) be verified like any other while a
 * jump inside one is still refused. It is capped far below one, so a bracket
 * only a few doubles wide can never loosen it to the point of passing a jump.
 */
function isResidualSmall(left: RealFunction, right: RealFunction, x: number, bracketScale: number, bracketWidth: number): boolean {
	const l = left(x);
	const r = right(x);
	if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
	const scale = Math.max(Math.abs(l), Math.abs(r), bracketScale);
	const spacing = Math.abs(x) * Number.EPSILON;
	const tolerance = Math.min(NARROW_BRACKET_TOLERANCE_CAP, Math.max(NUMERIC_ROOT_RESIDUAL_TOLERANCE, (64 * spacing) / bracketWidth));
	return Math.abs(l - r) <= tolerance * scale;
}

/** The loosest the residual tolerance may become for a very narrow bracket; a jump leaves a residual near one. */
const NARROW_BRACKET_TOLERANCE_CAP = 1e-3;

/**
 * Settles a verified root on the nearest whole number when that is at least as
 * good a root, and never returns negative zero.
 *
 * `2^x = 8` bisects to 2.9999999999999996 or to 3 depending on rounding. Both
 * pass the residual check, and 3 passes it exactly, so 3 is the answer to give.
 */
function tidy(left: RealFunction, right: RealFunction, x: number): number {
	const whole = Math.round(x);
	if (whole !== x && Math.abs(x - whole) <= 1e-9 * Math.max(1, Math.abs(x))) {
		const atWhole = Math.abs(left(whole) - right(whole));
		if (Number.isFinite(atWhole) && atWhole <= Math.abs(left(x) - right(x))) return whole + 0;
	}
	return x + 0;
}
