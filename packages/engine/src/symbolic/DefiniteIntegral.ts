/**
 * The definite integral of an expression between two bounds.
 *
 * A definite integral is the signed area between a curve and the horizontal
 * axis, from one bound to the other: area above the axis counts as positive,
 * area below it as negative. It is a number, not an expression, which is the
 * difference from the indefinite `integral(f, x)`.
 *
 * ## Exactly, through the antiderivative
 *
 * When `Integral.ts` can find an antiderivative `F`, the fundamental theorem of
 * calculus says the area from `a` to `b` is `F(b) - F(a)`, and that is worked
 * out in exact arithmetic: `integral(x^2, x, 0, 3)` is `3^3/3 - 0`, exactly 9.
 * Where `F` involves a function whose value is irrational (`sin(1)`), the
 * difference is evaluated to double precision instead, which is the same
 * accuracy every other `sin(1)` in the engine has.
 *
 * The theorem only holds when the integrand is finite across the whole range.
 * `-1/x` is an antiderivative of `1/x^2`, and `F(1) - F(-1)` is `-2`, but the
 * area under `1/x^2` from -1 to 1 is infinite: the curve shoots up at zero.
 * So the antiderivative is trusted on its own only for an integrand that is
 * continuous everywhere by construction (see `isContinuousEverywhere`), and
 * otherwise only when a numeric estimate, made independently, agrees with it.
 *
 * ## Numerically, where there is no antiderivative
 *
 * `exp(x^2)` has no elementary antiderivative, but its area from 0 to 1 is a
 * perfectly good number, and adaptive Gauss-Kronrod quadrature (see
 * `Quadrature.ts`) finds it with an error bound that must fall within one part
 * in ten billion of the answer before the answer is given.
 *
 * ## What is refused
 *
 * An improper integral, one whose integrand has no finite value somewhere in the
 * range (`1/x` from 0 to 1), is refused by name, as is one whose estimate never
 * settles, which is what a diverging integral looks like to a numeric method.
 * Both are named outcomes rather than numbers. A bound that is infinite is
 * refused by the caller before this is reached. A point where the integrand is
 * `0/0` but tends to a finite value from both sides (`sin(x)/x` at zero) is not
 * a gap in the curve, only in the formula, and is filled with that value.
 */

import { type SymbolicNode, constNode, substitute, freeVariables } from "@solve-js/symbolic/SymbolicNode";
import { type Rational, RATIONAL_ZERO, rationalCompare, rationalToNumber } from "@solve-js/symbolic/Rational";
import { simplifySymbolic } from "@solve-js/symbolic/Simplify";
import { toPolynomial } from "@solve-js/symbolic/Polynomial";
import { integrate } from "@solve-js/symbolic/Integral";
import {
	type RealFunction,
	type BoundedFunction,
	compileRealFunction,
	compileBoundedFunction,
	evaluateConstant,
	isContinuousEverywhere,
	describeNumber,
} from "@solve-js/symbolic/NumericEvaluate";
import { integrateNumerically } from "@solve-js/symbolic/Quadrature";
import { oneSidedLimit, LIMIT_TOLERANCE } from "@solve-js/symbolic/Limit";

/**
 * How closely the antiderivative and the numeric estimate must agree, relative
 * to the size of the integral, for the antiderivative to be trusted over a
 * range the integrand might not be finite across.
 */
const CROSS_CHECK_TOLERANCE = 1e-8;

/** The outcome of a definite integral. */
export type DefiniteIntegralOutcome =
	/** Exact, through the antiderivative: a rational, or an expression in other unknowns. */
	| { readonly kind: "exact"; readonly value: SymbolicNode }
	/** Through the antiderivative, evaluated to double precision because it involves irrational values. */
	| { readonly kind: "evaluated"; readonly value: number }
	/** Numeric quadrature, with its error bound. Approximate. */
	| { readonly kind: "numeric"; readonly value: number; readonly error: number }
	/** The integrand has no finite value somewhere in the range. */
	| { readonly kind: "improper"; readonly reason: string }
	/** The numeric estimate did not settle, as for a diverging integral. */
	| { readonly kind: "unsettled"; readonly reason: string }
	/** The integrand cannot be evaluated, with the reason. */
	| { readonly kind: "unsupported"; readonly reason: string };

/**
 * Integrates `integrand` with respect to `variable` from `lower` to `upper`.
 *
 * @param integrand - The expression.
 * @param variable - The variable of integration.
 * @param lower - The lower bound, exactly. Finite.
 * @param upper - The upper bound, exactly. Finite. Below `lower` reverses the
 * sign, as the convention has it.
 * @returns The outcome. See {@link DefiniteIntegralOutcome}.
 */
export function definiteIntegral(integrand: SymbolicNode, variable: string, lower: Rational, upper: Rational): DefiniteIntegralOutcome {
	if (rationalCompare(lower, upper) === 0) return { kind: "exact", value: constNode(RATIONAL_ZERO) };

	// A polynomial has no pole or gap anywhere, so its antiderivative is always
	// good and needs no numeric cross-check.
	if (toPolynomial(integrand) !== null) {
		const antiderivative = integrate(integrand, variable);
		if (antiderivative.ok) {
			const exact = differenceAtBounds(antiderivative.value, variable, lower, upper);
			if (exact !== null) return exact;
		}
	}

	const compiled = compileRealFunction(integrand, variable);
	if (!compiled.ok) return { kind: "unsupported", reason: compiled.reason };
	const bounded = compileBoundedFunction(integrand, variable);
	if (!bounded.ok) return { kind: "unsupported", reason: bounded.reason };
	const f = compiled.fn;
	const a = rationalToNumber(lower);
	const b = rationalToNumber(upper);
	const resolution = boundResolution(f, a, b);

	const antiderivative = integrate(integrand, variable);
	const throughAntiderivative = antiderivative.ok ? differenceAtBounds(antiderivative.value, variable, lower, upper) : null;
	if (throughAntiderivative !== null && isContinuousEverywhere(integrand)) {
		return settledOnWhole(throughAntiderivative, resolution);
	}

	const improperEnd = unboundedEnd(f, bounded.fn, a, b, variable);
	if (improperEnd !== null) return { kind: "improper", reason: improperEnd };

	const estimate = integrateNumerically(f, a, b, { atNonFinite: x => removableValue(bounded.fn, x) });
	if (!estimate.ok) {
		if (estimate.kind === "nonfinite") {
			return { kind: "improper", reason: `the integrand has no finite value at ${variable} = ${describeLocation(estimate.at, a, b)}, inside the range, so this is an improper integral` };
		}
		return {
			kind: "unsettled",
			reason: `the numeric estimate does not settle on a value; the integrand may grow without bound near ${variable} = ${describeLocation(estimate.near, a, b)}, which would make the integral diverge`,
		};
	}

	if (throughAntiderivative !== null) {
		const candidate = throughAntiderivative.kind === "exact" ? evaluateConstant(throughAntiderivative.value) : throughAntiderivative.kind === "evaluated" ? throughAntiderivative.value : null;
		const tolerance = Math.max(8 * estimate.error, CROSS_CHECK_TOLERANCE * Math.max(Math.abs(estimate.value), estimate.magnitude));
		if (candidate !== null && Math.abs(candidate - estimate.value) <= tolerance) return settledOnWhole(throughAntiderivative, resolution);
	}

	return { kind: "numeric", value: settleEstimate(estimate.value, Math.max(estimate.error, resolution)), error: estimate.error };
}

/**
 * A numeric estimate, given as the whole number it is when that lies within its
 * own error. `integral(floor(x), x, 0, 3)` is 3 to within a few parts in ten
 * billion, and 3 is the more honest way to show that than 2.9999999999999996.
 */
function settleEstimate(value: number, uncertainty: number): number {
	const whole = Math.round(value);
	return Math.abs(value - whole) <= uncertainty ? whole + 0 : value;
}

/**
 * Where a numeric method ran into trouble, to the precision the range can
 * support. The adaptive division closes in on a pole from both sides, so the
 * point it last sampled is a hair from the pole rather than on it:
 * `-4.1e-155` for a pole at zero. Rounded to a ten-billionth of the range, that
 * is zero, which is what the reader needs to see.
 */
function describeLocation(x: number, a: number, b: number): string {
	const grain = Math.pow(10, Math.floor(Math.log10(Math.abs(b - a))) - 10);
	return describeNumber(Math.round(x / grain) * grain);
}

/**
 * `F(upper) - F(lower)`, exactly where it simplifies to a rational (or, for a
 * polynomial with other unknowns, to an expression in them), otherwise evaluated
 * to double precision.
 *
 * @returns The difference, or `null` when it has no finite value, as `log(x)`
 * does at a negative bound.
 */
function differenceAtBounds(antiderivative: SymbolicNode, variable: string, lower: Rational, upper: Rational): DefiniteIntegralOutcome | null {
	try {
		const difference = simplifySymbolic({
			kind: "sub",
			left: substitute(antiderivative, variable, constNode(upper)),
			right: substitute(antiderivative, variable, constNode(lower)),
		});
		if (difference.kind === "const" || freeVariables(difference).size > 0) return { kind: "exact", value: difference };
		const value = evaluateConstant(difference);
		return value !== null && Number.isFinite(value) ? { kind: "evaluated", value } : null;
	} catch {
		// An exact difference too large to hold (a high power at a bound with many
		// digits) is evaluated in doubles instead.
		const compiled = compileRealFunction(antiderivative, variable);
		if (!compiled.ok) return null;
		const value = compiled.fn(rationalToNumber(upper)) - compiled.fn(rationalToNumber(lower));
		return Number.isFinite(value) ? { kind: "evaluated", value } : null;
	}
}

/**
 * How much the answer can move because the bounds are doubles: the integrand's
 * size at each bound times that bound's rounding.
 *
 * `integral(cos(x), x, 0, pi)` is `sin(pi)`, and the double nearest pi is not
 * pi, so the difference comes out as 1.2e-16 rather than zero. That is below
 * what the bounds themselves can resolve, so it is zero.
 */
function boundResolution(f: RealFunction, a: number, b: number): number {
	const at = (x: number): number => {
		const y = Math.abs(f(x));
		return Number.isFinite(y) ? y * Number.EPSILON * Math.abs(x) : 0;
	};
	return 4 * (at(a) + at(b));
}

/** An antiderivative result evaluated in doubles, settled on the whole number (zero included) it is to within the bounds' resolution. */
function settledOnWhole(outcome: DefiniteIntegralOutcome, resolution: number): DefiniteIntegralOutcome {
	if (outcome.kind === "evaluated") return { kind: "evaluated", value: settleEstimate(outcome.value, resolution) };
	return outcome;
}

/**
 * The reason the integral is improper at one of its bounds, or `null` when both
 * are fine.
 *
 * A bound where the integrand has no value is fine when the integrand tends to a
 * finite value there from inside the range, as `sin(x)/x` does at zero.
 */
function unboundedEnd(f: RealFunction, bounded: BoundedFunction, a: number, b: number, variable: string): string | null {
	const low = Math.min(a, b);
	const high = Math.max(a, b);
	for (const [end, inward] of [[low, 1], [high, -1]] as const) {
		if (Number.isFinite(f(end))) continue;
		const approach = oneSidedLimit(bounded, end, inward);
		if (approach.kind !== "value") {
			return `the integrand has no finite value at ${variable} = ${describeNumber(end)}, the ${end === a ? "lower" : "upper"} bound, so this is an improper integral`;
		}
	}
	return null;
}

/**
 * The value the integrand tends to at a point where it has none, when both
 * sides agree on a finite one, or `null`.
 */
function removableValue(bounded: BoundedFunction, x: number): number | null {
	const left = oneSidedLimit(bounded, x, -1);
	const right = oneSidedLimit(bounded, x, 1);
	if (left.kind !== "value" || right.kind !== "value") return null;
	const tolerance = Math.max(LIMIT_TOLERANCE * Math.max(1, Math.abs(left.value)), 4 * (left.error + right.error));
	return Math.abs(left.value - right.value) <= tolerance ? (left.value + right.value) / 2 : null;
}
