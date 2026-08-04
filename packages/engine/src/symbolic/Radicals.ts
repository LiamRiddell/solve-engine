/**
 * Exact integer roots, and the surd forms built on them.
 *
 * Two questions are asked constantly once a solver starts producing radicals:
 * "is this a perfect power?", which decides whether an answer is rational or
 * irrational, and "how do I write this root so a person can read it?". Both
 * answers live here so the quadratic, cubic and quartic paths give the same
 * shape rather than each inventing one.
 *
 * The reduction matters more than it looks. `sqrt(8)` and `2*sqrt(2)` are the
 * same number, but a solver that emits the first leaves the user to finish the
 * work, and two roots of the same equation can end up written in visibly
 * different styles depending on which one happened to cancel.
 */

import { type SymbolicNode, constNode } from "@solve-js/symbolic/SymbolicNode";
import { type Rational, rational } from "@solve-js/symbolic/Rational";

/**
 * The exact integer square root, or `null` when the input is not a perfect
 * square.
 *
 * This is the predicate that keeps `sqrt(2)` unfolded. Newton's method on
 * integers, so it stays exact at any size.
 *
 * @param value - A non-negative integer. Negative input gives `null`, since it
 * has no integer square root.
 * @returns The root, or `null`.
 */
export function exactIntegerSqrt(value: bigint): bigint | null {
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
 * The exact integer cube root, or `null` when the input is not a perfect cube.
 *
 * Unlike the square root this accepts negatives, because every real number has
 * a real cube root and `cbrt(-8)` is exactly `-2`.
 *
 * @param value - Any integer.
 * @returns The root, or `null`.
 */
export function exactIntegerCbrt(value: bigint): bigint | null {
	const negative = value < 0n;
	const magnitude = negative ? -value : value;
	if (magnitude < 2n) return negative ? -magnitude : magnitude;

	let low = 1n;
	let high = magnitude;
	while (low <= high) {
		const middle = (low + high) / 2n;
		const cube = middle * middle * middle;
		if (cube === magnitude) return negative ? -middle : middle;
		if (cube < magnitude) low = middle + 1n;
		else high = middle - 1n;
	}
	return null;
}

/**
 * The exact square root of a rational, or `null` when it is irrational.
 *
 * Both the numerator and the denominator have to be perfect squares, since the
 * root of a reduced fraction is taken componentwise.
 *
 * @param value - A non-negative rational.
 * @returns The exact root, or `null`.
 */
export function exactRationalSqrt(value: Rational): Rational | null {
	const numerator = exactIntegerSqrt(value.n);
	const denominator = exactIntegerSqrt(value.d);
	return numerator === null || denominator === null ? null : { n: numerator, d: denominator };
}

/**
 * The square root of a non-negative rational, in lowest surd form.
 *
 * `sqrt(8)` comes back as `2*sqrt(2)`, and a perfect square comes back as a
 * plain constant. Written as a `sqrt` call rather than a power of one half so it
 * reads the way it is normally written, and so the simplifier's own exact
 * folding collapses it when the radicand turns out to be a perfect square after
 * all.
 *
 * `sqrt(n/d)` is computed as `sqrt(n*d)/d`, which keeps the extraction of square
 * factors entirely in integers.
 *
 * @param value - A non-negative rational.
 * @returns The root as an expression, or as a constant when it is rational.
 */
export function surdNode(value: Rational): SymbolicNode {
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

	// Built through `rational` rather than as a literal: the extracted factor
	// comes from `n*d` and so can share a factor with `d`, and an unreduced pair
	// would surface as a coefficient written `6/108`.
	const scale = rational(extracted, value.d);
	if (remaining === 1n) return constNode(scale);

	const root: SymbolicNode = { kind: "call", name: "sqrt", args: [constNode({ n: remaining, d: 1n })] };
	return scale.n === 1n && scale.d === 1n ? root : { kind: "mul", left: constNode(scale), right: root };
}

/**
 * The square root of a rational of either sign, as a real surd or an imaginary
 * one.
 *
 * @param value - Any rational.
 * @returns `sqrt(value)` for a non-negative input, and `sqrt(-value)*i` for a
 * negative one. The simplifier's own complex handling produces the same shape,
 * so the two agree.
 */
export function signedSurdNode(value: Rational): SymbolicNode {
	if (value.n >= 0n) return surdNode(value);
	return { kind: "call", name: "sqrt", args: [constNode(value)] };
}

/**
 * The cube root of a rational, exact when the input is a perfect cube.
 *
 * @param value - Any rational.
 * @returns A constant when the root is rational, and a `cbrt` call otherwise.
 */
export function cbrtNode(value: Rational): SymbolicNode {
	const numerator = exactIntegerCbrt(value.n);
	const denominator = exactIntegerCbrt(value.d);
	if (numerator !== null && denominator !== null) return constNode({ n: numerator, d: denominator });
	return { kind: "call", name: "cbrt", args: [constNode(value)] };
}
