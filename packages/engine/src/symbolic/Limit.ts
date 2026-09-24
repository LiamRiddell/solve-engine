/**
 * The limit of an expression as its unknown approaches a point.
 *
 * A limit asks what value an expression settles towards as `x` gets closer and
 * closer to `a`, whether or not the expression has a value at `a` itself.
 * `sin(x)/x` is `0/0` at zero and has no value there, but it settles on 1 from
 * both sides, so its limit at zero is 1.
 *
 * ## Exactly, where the algebra can
 *
 * A quotient of polynomials is reduced to lowest terms first (see `Gcd.ts`), and
 * what is left is evaluated at the point exactly. `(x^2-1)/(x-1)` becomes `x+1`,
 * so its limit at 1 is exactly 2. This is correct rather than convenient: a
 * reduced rational function is continuous wherever its denominator is not zero,
 * and a continuous function's limit is its value.
 *
 * ## Numerically, everywhere else
 *
 * Each side is approached separately, by evaluating at `a + h` and `a - h` for
 * `h` halving from half the point's scale down past a millionth of a millionth.
 * Those values follow a trend in `h`, and extrapolating the trend to `h = 0`
 * reads off the limit long before `h` is small enough for rounding to swamp it.
 * Two extrapolations are used, because trends come in two shapes: Neville's
 * scheme (Richardson extrapolation) for a power series in `h`, which is what a
 * smooth expression gives, and Aitken's for a single power such as the
 * `h^(1/2)` of `sqrt(x)`, which no power series captures. An estimate counts only
 * when the next run of samples, one step closer, reproduces it; the one that
 * moved least is taken, provided every other estimate that settled agrees.
 *
 * Every value carries a bound on its own rounding error (see
 * `compileBoundedFunction`), and an estimate is never more certain than the
 * noise in the values it was built from. That is what stops `(1-cos(x))/x^2`
 * reporting 0: its values below `x = 1e-8` are a steady, exact, meaningless zero,
 * and their bound says so.
 *
 * The answer is numeric and so approximate, and a result within its own error of
 * a whole number is given as that whole number. Where the expression has a value
 * at `a` that both sides agree with, that value is the answer, since the
 * expression is then continuous there.
 *
 * ## What is refused, by name
 *
 * The two sides settling on different values (`abs(x)/x` at zero), the
 * expression growing without bound (`1/x^2` at zero), and the values never
 * settling at all (`sin(1/x)` at zero) are each their own outcome, never a
 * number. A side on which the expression has no real value near the point
 * (`sqrt(x)` left of zero) is left out, and the limit is taken from the other.
 */

import { type SymbolicNode, constNode, substitute } from "@solve-js/symbolic/SymbolicNode";
import { type Rational, rationalToNumber, isRationalZero } from "@solve-js/symbolic/Rational";
import { simplifySymbolic } from "@solve-js/symbolic/Simplify";
import { toPolynomial } from "@solve-js/symbolic/Polynomial";
import { cancelSymbolic } from "@solve-js/symbolic/Gcd";
import { compileBoundedFunction, type BoundedFunction, describeNumber } from "@solve-js/symbolic/NumericEvaluate";

/** How closely an estimate must be pinned down, relative to its size, to count as the limit. */
export const LIMIT_TOLERANCE = 1e-9;

/** The first step is the point's scale divided by two to this power. */
const FIRST_STEP_EXPONENT = 1;

/** How many halvings of the step are tried at most. */
const STEP_COUNT = 56;

/** How many of the smallest steps are read to decide whether the values grow without bound. */
const DIVERGENCE_TAIL = 8;

/** What one side of a limit settles on. */
export type SideLimit =
	| { readonly kind: "value"; readonly value: number; readonly error: number }
	| { readonly kind: "infinite"; readonly sign: 1 | -1 }
	| { readonly kind: "unsettled" }
	| { readonly kind: "undefined" };

/** The outcome of a limit. */
export type LimitOutcome =
	/** Found exactly, through the algebra. */
	| { readonly kind: "exact"; readonly value: SymbolicNode }
	/** Found numerically; approximate. */
	| { readonly kind: "numeric"; readonly value: number }
	/** The expression grows without bound near the point. */
	| { readonly kind: "diverges"; readonly reason: string }
	/** The two sides settle on different values. */
	| { readonly kind: "sidesDisagree"; readonly reason: string }
	/** The values near the point never settle. */
	| { readonly kind: "unsettled"; readonly reason: string }
	/** The expression has no real value near the point on either side. */
	| { readonly kind: "undefined"; readonly reason: string }
	/** The expression cannot be evaluated numerically, with the reason. */
	| { readonly kind: "unsupported"; readonly reason: string };

/**
 * The limit of `node` as `variable` approaches `point`, from both sides.
 *
 * @param node - The expression.
 * @param variable - The unknown that approaches the point.
 * @param point - The point, exactly.
 * @returns The outcome. See {@link LimitOutcome}.
 */
export function limitOf(node: SymbolicNode, variable: string, point: Rational): LimitOutcome {
	const exact = exactLimit(node, variable, point);
	if (exact !== null) return { kind: "exact", value: exact };

	const compiled = compileBoundedFunction(node, variable);
	if (!compiled.ok) return { kind: "unsupported", reason: compiled.reason };

	const a = rationalToNumber(point);
	const where = `${variable} approaches ${describeNumber(a)}`;
	const left = oneSidedLimit(compiled.fn, a, -1);
	const right = oneSidedLimit(compiled.fn, a, 1);

	if (left.kind === "undefined" && right.kind === "undefined") {
		return { kind: "undefined", reason: `the expression has no real value on either side as ${where}` };
	}
	if (left.kind === "unsettled" || right.kind === "unsettled") {
		return { kind: "unsettled", reason: `the values do not settle on one number as ${where}; they may oscillate, as sin(1/x) does at 0` };
	}

	// A side with no real value near the point is left out.
	const sides = [left, right].filter(side => side.kind !== "undefined");
	if (sides.length === 1) {
		const [only] = sides;
		if (only.kind === "infinite") return { kind: "diverges", reason: `it grows without bound, towards ${infinity(only.sign)}, as ${where}` };
		if (only.kind === "value") return { kind: "numeric", value: settle(compiled.fn, a, only.value, only.error) };
	}

	if (left.kind === "value" && right.kind === "value") {
		const tolerance = Math.max(LIMIT_TOLERANCE * Math.max(1, Math.abs(left.value), Math.abs(right.value)), 4 * (left.error + right.error));
		if (Math.abs(left.value - right.value) <= tolerance) {
			const better = left.error <= right.error ? left : right;
			return { kind: "numeric", value: settle(compiled.fn, a, better.value, Math.max(left.error, right.error)) };
		}
		return {
			kind: "sidesDisagree",
			reason: `from the left it approaches ${describeNumber(left.value)} and from the right ${describeNumber(right.value)} as ${where}`,
		};
	}
	if (left.kind === "infinite" && right.kind === "infinite") {
		const towards = left.sign === right.sign ? `towards ${infinity(left.sign)} from both sides` : `towards ${infinity(left.sign)} from the left and ${infinity(right.sign)} from the right`;
		return { kind: "diverges", reason: `it grows without bound, ${towards}, as ${where}` };
	}
	return { kind: "sidesDisagree", reason: `from the left it ${describeSide(left)} and from the right it ${describeSide(right)} as ${where}` };
}

/** `+∞` or `-∞`. */
function infinity(sign: 1 | -1): string {
	return sign > 0 ? "+∞" : "-∞";
}

/** One side's behaviour, as the end of a sentence. */
function describeSide(side: SideLimit): string {
	if (side.kind === "value") return `approaches ${describeNumber(side.value)}`;
	if (side.kind === "infinite") return `grows without bound towards ${infinity(side.sign)}`;
	return "has no settled value";
}

/**
 * The final numeric answer: the expression's own value when it is continuous at
 * the point, otherwise the estimate, as a whole number when it is one to within
 * its error.
 */
function settle(fn: BoundedFunction, a: number, estimate: number, error: number): number {
	const tolerance = Math.max(LIMIT_TOLERANCE * Math.max(1, Math.abs(estimate)), 4 * error);
	const at = fn(a).value;
	if (Number.isFinite(at) && Math.abs(at - estimate) <= tolerance) return at + 0;
	const whole = Math.round(estimate);
	if (Math.abs(estimate - whole) <= Math.max(4 * error, 64 * Number.EPSILON * Math.max(1, Math.abs(whole)))) return whole + 0;
	return estimate + 0;
}

/**
 * What one side of the limit settles on.
 *
 * @param fn - The expression, with rounding-error bounds.
 * @param a - The point.
 * @param side - `-1` for the left, `1` for the right.
 * @returns The side's behaviour.
 */
export function oneSidedLimit(fn: BoundedFunction, a: number, side: 1 | -1): SideLimit {
	const scale = Math.max(1, Math.abs(a));
	const samples: Sample[] = [];
	for (let k = 0; k < STEP_COUNT; k++) {
		const x = a + side * scale * Math.pow(2, -(k + FIRST_STEP_EXPONENT));
		if (x === a) break;
		const { value, error } = fn(x);
		// The distance actually stepped, which rounding in `a + h` can make
		// slightly different from `h`, and the extrapolation needs the real one.
		samples.push({ step: Math.abs(x - a), value, noise: error });
	}

	const tail = samples.slice(-DIVERGENCE_TAIL).map(s => s.value);
	if (tail.length === 0 || tail.every(Number.isNaN)) return { kind: "undefined" };

	const candidates = [...confirmedEstimates(samples, NEVILLE_WIDTH, neville), ...confirmedEstimates(samples, AITKEN_WIDTH, aitken)];
	const settled = (e: Estimate): boolean => e.error <= LIMIT_TOLERANCE * Math.max(1, Math.abs(e.value));
	let best: Estimate | null = null;
	for (const candidate of candidates) {
		if (best === null || candidate.error < best.error) best = candidate;
	}
	if (best !== null && settled(best)) {
		// A second estimate that settled on a different value means the trend
		// changes with scale, and neither can be trusted as the limit.
		for (const candidate of candidates) {
			if (!settled(candidate)) continue;
			const tolerance = Math.max(LIMIT_TOLERANCE * Math.max(1, Math.abs(best.value)), 4 * (candidate.error + best.error));
			if (Math.abs(candidate.value - best.value) > tolerance) return { kind: "unsettled" };
		}
		return { kind: "value", value: best.value, error: best.error };
	}

	const sign = divergenceSign(tail);
	if (sign !== null) return { kind: "infinite", sign };
	return { kind: "unsettled" };
}

/** One evaluation on the way to the point: how far away, the value, and its rounding-error bound. */
interface Sample {
	readonly step: number;
	readonly value: number;
	readonly noise: number;
}

/** An estimate of the limit and how far it may be from the truth. */
interface Estimate {
	readonly value: number;
	readonly error: number;
}

/** An estimator over a run of consecutive samples: the extrapolated value and the noise it inherited, or `null` when it does not apply. */
type Estimator = (window: readonly Sample[]) => { value: number; noise: number } | null;

/** How many samples a Neville extrapolation reads. */
const NEVILLE_WIDTH = 6;

/** How many samples an Aitken extrapolation reads. */
const AITKEN_WIDTH = 3;

/**
 * Applies an estimator to every run of `width` consecutive samples, and keeps
 * each estimate whose neighbouring run, one step closer, agrees with it.
 *
 * The error of an estimate is how far it moved when the run shifted, plus the
 * rounding noise both runs inherited. An estimate that no second set of samples
 * reproduces is a coincidence of those samples rather than a property of the
 * function, and this is what refuses it: `x*log(x)` has exactly equal values at
 * one half and one quarter, and a single run through them would read that as a
 * trend that had already stopped.
 */
function confirmedEstimates(samples: readonly Sample[], width: number, estimator: Estimator): Estimate[] {
	const runs: ({ value: number; noise: number } | null)[] = [];
	for (let start = 0; start + width <= samples.length; start++) runs.push(estimator(samples.slice(start, start + width)));
	const confirmed: Estimate[] = [];
	for (let i = 0; i + 1 < runs.length; i++) {
		const here = runs[i];
		const closer = runs[i + 1];
		if (here === null || closer === null) continue;
		const error = Math.abs(closer.value - here.value) + here.noise + closer.noise;
		if (Number.isFinite(error)) confirmed.push({ value: closer.value, error });
	}
	return confirmed;
}

/**
 * Neville's extrapolation to a zero step, for a value that follows a power
 * series in the step (`L + c1*h + c2*h^2 + ...`), as any expression that is
 * smooth on this side of the point does.
 *
 * Returns the full-order estimate and the noise it inherits: each column of the
 * scheme weighs its two inputs by `2^j/(2^j-1)` and `1/(2^j-1)` for a halving
 * step, which compounds to amplify rounding by at most about eight over five
 * columns.
 */
function neville(window: readonly Sample[]): { value: number; noise: number } | null {
	if (!window.every(s => Number.isFinite(s.value) && Number.isFinite(s.noise))) return null;
	const h = window.map(s => s.step);
	// Column by column in place: walking `i` downwards means `t[i - 1]` still
	// holds the previous column when `t[i]` is rewritten from it.
	const t = window.map(s => s.value);
	for (let j = 1; j < t.length; j++) {
		for (let i = t.length - 1; i >= j; i--) t[i] += ((t[i] - t[i - 1]) * h[i]) / (h[i - j] - h[i]);
	}
	const noise = Math.max(...window.map(s => s.noise));
	return { value: t[t.length - 1], noise: NEVILLE_NOISE_AMPLIFICATION * noise };
}

/** How much a five-column halving extrapolation can amplify rounding: the product of `(2^j+1)/(2^j-1)` for `j` from 1 to 5. */
const NEVILLE_NOISE_AMPLIFICATION = 7.76;

/**
 * Aitken's extrapolation, for a value approaching its limit geometrically as the
 * step halves (`L + c*h^p` for any power `p`, whole or not).
 *
 * `sqrt(x)` tends to zero as `h^(1/2)`, which no power series in `h` captures,
 * so Neville's scheme converges on it only as slowly as the values themselves.
 * Aitken's reads the ratio of successive differences and removes the geometric
 * part outright. It applies only while that ratio is below one: a ratio of one
 * or more is a sequence that is not converging, and Aitken's formula would
 * otherwise "extrapolate" the doubling values of `1/x` to zero.
 */
function aitken(window: readonly Sample[]): { value: number; noise: number } | null {
	const [y0, y1, y2] = window.map(s => s.value);
	if (![y0, y1, y2].every(Number.isFinite)) return null;
	const noise = Math.max(...window.map(s => s.noise));
	if (!Number.isFinite(noise)) return null;
	const d0 = y1 - y0;
	const d1 = y2 - y1;
	if (d1 === 0) return { value: y2, noise };
	if (d0 === 0 || Math.abs(d1 / d0) >= AITKEN_MAX_RATIO) return null;
	const gain = d1 / (d1 - d0);
	return { value: y2 - d1 * gain, noise: noise * (1 + 4 * Math.abs(gain) + 2 * gain * gain) };
}

/** The largest ratio of successive differences Aitken's extrapolation accepts as converging. */
const AITKEN_MAX_RATIO = 0.95;

/**
 * Whether the smallest steps' values grow without bound, and towards which sign.
 *
 * They do when every value has the same sign, each is larger in size than the
 * last, and the growth is not slowing down. A value converging on a limit grows
 * by less each step (by half, for a smooth approach); one heading off to
 * infinity grows by at least as much, whether by doubling (`1/x`) or by a steady
 * amount (`log(x)`, which does get there, slowly).
 */
function divergenceSign(tail: readonly number[]): 1 | -1 | null {
	if (tail.length < 3 || tail.some(Number.isNaN)) return null;
	const sign = Math.sign(tail[tail.length - 1]);
	if (sign === 0 || tail.some(v => Math.sign(v) !== sign)) return null;
	if (tail.every(v => !Number.isFinite(v))) return sign as 1 | -1;
	let lastGrowth = 0;
	for (let i = 1; i < tail.length; i++) {
		const growth = Math.abs(tail[i]) - Math.abs(tail[i - 1]);
		if (!(growth > 0)) return null;
		if (i > 1 && growth < 0.9 * lastGrowth) return null;
		lastGrowth = growth;
	}
	return sign as 1 | -1;
}

/**
 * The limit of a rational function, exactly, or `null` for anything else.
 *
 * The expression is reduced to lowest terms and evaluated at the point, which is
 * its limit whenever the reduced denominator is not zero there. A zero reduced
 * denominator is a pole, which the numeric path reports as such.
 */
function exactLimit(node: SymbolicNode, variable: string, point: Rational): SymbolicNode | null {
	try {
		const reduced = cancelSymbolic(node);
		const at = constNode(point);
		if (toPolynomial(reduced) !== null) return simplifySymbolic(substitute(reduced, variable, at));
		if (reduced.kind === "div" && toPolynomial(reduced.left) !== null && toPolynomial(reduced.right) !== null) {
			const denominator = simplifySymbolic(substitute(reduced.right, variable, at));
			if (denominator.kind !== "const" || isRationalZero(denominator.value)) return null;
			return simplifySymbolic(substitute(reduced, variable, at));
		}
	} catch {
		// An exact evaluation that overflows or divides by zero is left to the
		// numeric path, which reports what it finds.
	}
	return null;
}
