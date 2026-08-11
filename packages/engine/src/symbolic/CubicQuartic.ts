/**
 * Exact solutions for cubics and quartics.
 *
 * These were the two degrees that fell through to numerical root finding
 * whenever no rational root could be extracted. Both have closed forms, and both
 * of those forms need complex intermediates, which is why this could not exist
 * before `Complex.ts` did.
 *
 * ## The case that forced the order of work
 *
 * A cubic with three distinct **real** roots has a positive discriminant, and
 * Cardano's formula reaches those real roots through the cube roots of a complex
 * number. There is no way around that: it is a theorem that the real roots of
 * such a cubic cannot be written using real radicals alone. That is the *casus
 * irreducibilis*, and it is the reason "add complex numbers" was a prerequisite
 * for "solve cubics exactly" rather than an unrelated feature.
 *
 * ## What comes back, and what does not
 *
 * A closed form is returned whenever one exists in radicals: the single real
 * root and the conjugate pair of a cubic with a negative discriminant, the
 * repeated roots of a cubic with a zero one, both square roots of a
 * biquadratic, and a quartic that splits into two quadratics over the
 * rationals.
 *
 * The *casus irreducibilis* comes back numerically, from the trigonometric
 * form. That is not a gap in effort. Those three roots provably have no
 * expression in real radicals, and writing them as `cos` of an `arccos` of an
 * irrational would produce something exact on paper that nothing else in the
 * system can evaluate, factor or differentiate. Reporting three accurate
 * numbers and saying they are approximate is the more honest answer.
 *
 * Everything else declines by returning `null`, which sends the caller to its
 * own numerical fallback rather than to a guess made here.
 */

import { type SymbolicNode, constNode, complexNode, symbolicKey } from "@solve-js/symbolic/SymbolicNode";
import { simplifySymbolic } from "@solve-js/symbolic/Simplify";
import {
	type Rational,
	RATIONAL_ZERO,
	rationalAdd,
	rationalSub,
	rationalMul,
	rationalDiv,
	rationalNeg,
	rationalToNumber,
	rationalCompare,
	isRationalZero,
} from "@solve-js/symbolic/Rational";
import { rationalRoots } from "@solve-js/symbolic/Factor";
import { surdNode, signedSurdNode, exactRationalSqrt } from "@solve-js/symbolic/Radicals";
import { COMPLEX_I } from "@solve-js/symbolic/Complex";

/** Roots split by how exactly they are known, so a caller can label the approximate ones as such. */
export interface RootSet {
	readonly exact: readonly SymbolicNode[];
	readonly approximate: readonly number[];
}

/** Small rational literals, named so the formulas below read as formulas. */
const TWO: Rational = { n: 2n, d: 1n };
const THREE: Rational = { n: 3n, d: 1n };
const FOUR: Rational = { n: 4n, d: 1n };

/** A cubic reduced to `t^3 + pt + q` by the substitution `x = t + shift`. */
interface DepressedCubic {
	readonly p: Rational;
	readonly q: Rational;
	readonly shift: Rational;
}

/**
 * Removes the quadratic term from a cubic.
 *
 * Every cubic `ax^3+bx^2+cx+d` becomes `t^3+pt+q` under `x = t - b/3a`, and that
 * reduction is what makes a closed form possible at all.
 */
function depressCubic(a: Rational, b: Rational, c: Rational, d: Rational): DepressedCubic {
	const shift = rationalNeg(rationalDiv(b, rationalMul(THREE, a)));
	// p = (3ac - b^2) / 3a^2
	const p = rationalDiv(
		rationalSub(rationalMul(THREE, rationalMul(a, c)), rationalMul(b, b)),
		rationalMul(THREE, rationalMul(a, a)),
	);
	// q = (2b^3 - 9abc + 27a^2 d) / 27a^3
	const twoBCubed = rationalMul(TWO, rationalMul(b, rationalMul(b, b)));
	const nineABC = rationalMul({ n: 9n, d: 1n }, rationalMul(a, rationalMul(b, c)));
	const twentySevenAAD = rationalMul({ n: 27n, d: 1n }, rationalMul(rationalMul(a, a), d));
	const q = rationalDiv(
		rationalAdd(rationalSub(twoBCubed, nineABC), twentySevenAAD),
		rationalMul({ n: 27n, d: 1n }, rationalMul(a, rationalMul(a, a))),
	);
	return { p, q, shift };
}

/**
 * The roots of a cubic in closed form.
 *
 * @param a - Leading coefficient, which must be non-zero.
 * @param b - Quadratic coefficient.
 * @param c - Linear coefficient.
 * @param d - Constant coefficient.
 * @returns All three roots, exact where radicals can express them and
 * approximate in the *casus irreducibilis*. Never `null`: every cubic is
 * covered by one of the three discriminant cases.
 */
export function solveCubic(a: Rational, b: Rational, c: Rational, d: Rational): RootSet {
	const { p, q, shift } = depressCubic(a, b, c, d);

	// discriminant = -(4p^3 + 27q^2), whose sign decides the shape of the answer.
	const discriminant = rationalNeg(
		rationalAdd(
			rationalMul(FOUR, rationalMul(p, rationalMul(p, p))),
			rationalMul({ n: 27n, d: 1n }, rationalMul(q, q)),
		),
	);

	if (rationalCompare(discriminant, RATIONAL_ZERO) > 0) {
		return { exact: [], approximate: trigonometricRoots(p, q, shift) };
	}
	if (isRationalZero(discriminant)) return { exact: repeatedCubicRoots(p, q, shift), approximate: [] };
	return { exact: cardanoRoots(p, q, shift), approximate: [] };
}

/**
 * The roots of a depressed cubic whose discriminant is zero.
 *
 * Both roots are rational here, which is worth stating: a cubic over the
 * rationals with a repeated root has all of its roots rational, so nothing
 * irrational can appear in this branch.
 */
function repeatedCubicRoots(p: Rational, q: Rational, shift: Rational): SymbolicNode[] {
	// p and q both zero is a triple root at the shift itself.
	if (isRationalZero(p)) return [constNode(shift)];

	const simple = rationalAdd(rationalDiv(rationalMul(THREE, q), p), shift);
	const repeated = rationalAdd(rationalNeg(rationalDiv(rationalMul(THREE, q), rationalMul(TWO, p))), shift);
	const ordered = [simple, repeated].sort(rationalCompare);
	return ordered.map(constNode);
}

/**
 * The three roots of a depressed cubic with a negative discriminant, by
 * Cardano's formula.
 *
 * With `u` and `v` the two real cube roots below, the roots are `u+v` and
 * `u*w + v*w^2` for the two primitive cube roots of unity `w`. Multiplying that
 * out gives one real root and a conjugate pair, which is what this builds.
 *
 * Both cube roots are of real numbers here, because a negative discriminant is
 * exactly the condition that puts the radicand of the inner square root above
 * zero. That is what keeps this branch expressible in radicals while the
 * *casus irreducibilis* is not.
 */
function cardanoRoots(p: Rational, q: Rational, shift: Rational): SymbolicNode[] {
	const half = rationalNeg(rationalDiv(q, TWO));
	// (q/2)^2 + (p/3)^3, positive whenever the discriminant is negative.
	const radicand = rationalAdd(
		rationalMul(rationalDiv(q, TWO), rationalDiv(q, TWO)),
		rationalMul(rationalDiv(p, THREE), rationalMul(rationalDiv(p, THREE), rationalDiv(p, THREE))),
	);
	const inner = surdNode(radicand);

	// Emitted as `cbrt` calls so the simplifier folds them when the radicand is
	// a perfect square and the result a perfect cube, which is how `x^3 = 8`
	// still comes back as a plain `2`.
	const u: SymbolicNode = { kind: "call", name: "cbrt", args: [{ kind: "add", left: constNode(half), right: inner }] };
	const v: SymbolicNode = { kind: "call", name: "cbrt", args: [{ kind: "sub", left: constNode(half), right: inner }] };

	const sum: SymbolicNode = { kind: "add", left: u, right: v };
	const difference: SymbolicNode = { kind: "sub", left: u, right: v };
	const real: SymbolicNode = { kind: "add", left: constNode(shift), right: { kind: "div", left: { kind: "neg", operand: sum }, right: constNode(TWO) } };
	// (u-v) * sqrt(3)/2 * i
	const imaginary: SymbolicNode = {
		kind: "mul",
		left: { kind: "div", left: { kind: "mul", left: difference, right: surdNode(THREE) }, right: constNode(TWO) },
		right: complexNode(COMPLEX_I),
	};

	return [
		{ kind: "add", left: constNode(shift), right: sum },
		{ kind: "sub", left: real, right: imaginary },
		{ kind: "add", left: real, right: imaginary },
	];
}

/**
 * The three real roots of a depressed cubic in the *casus irreducibilis*, by the
 * trigonometric form.
 *
 * These are returned as numbers on purpose. See this module's header: no
 * expression in real radicals exists for them, and the trigonometric expression
 * that does exist is not something the rest of the system could evaluate
 * exactly anyway.
 */
function trigonometricRoots(p: Rational, q: Rational, shift: Rational): number[] {
	const pNumber = rationalToNumber(p);
	const qNumber = rationalToNumber(q);
	const shiftNumber = rationalToNumber(shift);

	// t_k = 2 sqrt(-p/3) cos( arccos( (3q)/(2p) sqrt(-3/p) )/3 - 2*pi*k/3 )
	const magnitude = 2 * Math.sqrt(-pNumber / 3);
	const ratio = ((3 * qNumber) / (2 * pNumber)) * Math.sqrt(-3 / pNumber);
	// Clamped against the rounding that can push the value a hair outside
	// arccos's domain, which would turn a genuine root into a NaN.
	const angle = Math.acos(Math.min(1, Math.max(-1, ratio))) / 3;

	return [0, 1, 2]
		.map(k => magnitude * Math.cos(angle - (2 * Math.PI * k) / 3) + shiftNumber)
		.sort((left, right) => left - right);
}

/** A quartic reduced to `t^4 + pt^2 + qt + r` by the substitution `x = t + shift`. */
interface DepressedQuartic {
	readonly p: Rational;
	readonly q: Rational;
	readonly r: Rational;
	readonly shift: Rational;
}

/** Removes the cubic term from a monic quartic `x^4 + bx^3 + cx^2 + dx + e`. */
function depressQuartic(b: Rational, c: Rational, d: Rational, e: Rational): DepressedQuartic {
	const shift = rationalNeg(rationalDiv(b, FOUR));
	const bb = rationalMul(b, b);
	// p = c - 3b^2/8
	const p = rationalSub(c, rationalDiv(rationalMul(THREE, bb), { n: 8n, d: 1n }));
	// q = d - bc/2 + b^3/8
	const q = rationalAdd(
		rationalSub(d, rationalDiv(rationalMul(b, c), TWO)),
		rationalDiv(rationalMul(bb, b), { n: 8n, d: 1n }),
	);
	// r = e - bd/4 + b^2 c/16 - 3b^4/256
	const r = rationalSub(
		rationalAdd(
			rationalSub(e, rationalDiv(rationalMul(b, d), FOUR)),
			rationalDiv(rationalMul(bb, c), { n: 16n, d: 1n }),
		),
		rationalDiv(rationalMul(THREE, rationalMul(bb, bb)), { n: 256n, d: 1n }),
	);
	return { p, q, r, shift };
}

/**
 * The roots of a quartic in closed form, where one exists.
 *
 * Two families are covered. A **biquadratic**, which has no odd-power term once
 * depressed, is a quadratic in `t^2` and its roots are square roots of the two
 * solutions of that quadratic. A general quartic is covered when its resolvent
 * cubic has a rational root that splits it into two quadratics over the
 * rationals, which are then solved exactly, complex roots included.
 *
 * Every other quartic returns `null`. Ferrari's method does produce a closed
 * form for those, but it is a radical nested four deep whose printed form
 * nobody can read and nothing downstream can use, so the caller's numerical
 * fallback is the better answer.
 *
 * @param a - Leading coefficient, which must be non-zero.
 * @param b - Cubic coefficient.
 * @param c - Quadratic coefficient.
 * @param d - Linear coefficient.
 * @param e - Constant coefficient.
 * @param solveQuadratic - The quadratic solver to use for each half of a split.
 * Passed in rather than imported so this module stays independent of `Solve.ts`.
 * @returns The roots, or `null` when no readable closed form exists.
 */
export function solveQuartic(
	a: Rational,
	b: Rational,
	c: Rational,
	d: Rational,
	e: Rational,
	solveQuadratic: (a: Rational, b: Rational, c: Rational) => readonly SymbolicNode[],
): RootSet | null {
	const monic = (value: Rational): Rational => rationalDiv(value, a);
	const { p, q, r, shift } = depressQuartic(monic(b), monic(c), monic(d), monic(e));

	const roots = isRationalZero(q) ? biquadraticRoots(p, r) : splitQuarticRoots(p, q, r, solveQuadratic);
	if (roots === null) return null;

	// Undo the depression. A zero shift is left off rather than added as `+0`,
	// which the simplifier would drop anyway but which reads better in a trace.
	const shifted: SymbolicNode[] = isRationalZero(shift)
		? roots
		: roots.map(root => ({ kind: "add", left: constNode(shift), right: root }));
	return { exact: distinct(shifted), approximate: [] };
}

/**
 * Drops repeated roots.
 *
 * A quartic that splits into two quadratics sharing a factor produces the same
 * root from both halves, and a repeated root is one solution rather than
 * several. Comparison is on the simplified structural key, so two roots written
 * differently but equal in structure count once.
 */
function distinct(roots: readonly SymbolicNode[]): SymbolicNode[] {
	const seen = new Set<string>();
	const unique: SymbolicNode[] = [];
	for (const root of roots) {
		const key = symbolicKey(simplifySymbolic(root));
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(root);
	}
	return unique;
}

/**
 * The four roots of `t^4 + pt^2 + r`, as the square roots of the two solutions
 * of `y^2 + py + r`.
 *
 * The sign of each `y` decides whether its square roots are real or imaginary,
 * and that sign is determined exactly rather than by evaluating the surd: `y`
 * is `(-p ± sqrt(D))/2`, so the comparison reduces to the signs of `p` and `r`
 * alone. Deciding it numerically would be one rounding error away from claiming
 * a real root where there is a complex one.
 */
function biquadraticRoots(p: Rational, r: Rational): SymbolicNode[] {
	const discriminant = rationalSub(rationalMul(p, p), rationalMul(FOUR, r));
	if (rationalCompare(discriminant, RATIONAL_ZERO) < 0) return complexBiquadraticRoots(p, r);

	const root = exactRationalSqrt(discriminant);
	if (root !== null) return rationalSquareRoots(rationalNeg(p), root, isRationalZero(discriminant));
	return nestedSquareRoots(p, r, discriminant);
}

/** The four roots when both solutions of the inner quadratic are rational, so each square root is an ordinary surd. */
function rationalSquareRoots(negatedP: Rational, root: Rational, repeated: boolean): SymbolicNode[] {
	const values = repeated
		// A zero discriminant makes the two solutions the same one, and emitting it
		// twice would report `x^4-4x^2+4=0` as having four roots rather than two.
		? [rationalDiv(negatedP, TWO)]
		: [rationalDiv(rationalAdd(negatedP, root), TWO), rationalDiv(rationalSub(negatedP, root), TWO)];

	const roots: SymbolicNode[] = [];
	for (const value of values) {
		if (isRationalZero(value)) {
			roots.push(constNode(RATIONAL_ZERO));
			continue;
		}
		const square = signedSurdNode(value);
		roots.push({ kind: "neg", operand: square }, square);
	}
	return roots;
}

/**
 * The four roots when the inner quadratic is itself irrational, so each root is
 * a square root of a surd.
 *
 * `x^4-3x^2+1=0` comes out as `±sqrt((3+sqrt(5))/2)` and `±sqrt((3-sqrt(5))/2)`.
 * Nested, but exact and still readable, which is better than four decimals.
 *
 * Whether each solution is positive decides whether its square roots are real
 * or imaginary, and that is settled exactly rather than by evaluating the surd:
 * with `y = (-p ± sqrt(D))/2` the comparison reduces to the signs of `p` and
 * `r` alone. Deciding it numerically would be one rounding error away from
 * claiming a real root where there is a complex one.
 */
function nestedSquareRoots(p: Rational, r: Rational, discriminant: Rational): SymbolicNode[] {
	const negatedP = constNode(rationalNeg(p));
	const surd = surdNode(discriminant);
	const negativeP = rationalCompare(p, RATIONAL_ZERO) <= 0;
	const solutions = [
		{ node: halved({ kind: "add", left: negatedP, right: surd }), positive: negativeP || rationalCompare(r, RATIONAL_ZERO) <= 0 },
		{ node: halved({ kind: "sub", left: negatedP, right: surd }), positive: negativeP && rationalCompare(r, RATIONAL_ZERO) >= 0 },
	];

	const roots: SymbolicNode[] = [];
	for (const { node, positive } of solutions) {
		const radicand = positive ? node : { kind: "neg" as const, operand: node };
		const magnitude: SymbolicNode = { kind: "call", name: "sqrt", args: [radicand] };
		const square: SymbolicNode = positive ? magnitude : { kind: "mul", left: magnitude, right: complexNode(COMPLEX_I) };
		roots.push({ kind: "neg", operand: square }, square);
	}
	return roots;
}

/** Halves an expression, which the biquadratic formula needs twice. */
function halved(node: SymbolicNode): SymbolicNode {
	return { kind: "div", left: node, right: constNode(TWO) };
}

/**
 * The four roots of a biquadratic whose inner quadratic has no real solution.
 *
 * `y` is then `-p/2 ± i*sqrt(|D|)/2`, whose modulus is `sqrt(r)`, and
 * `sqrt(a+bi)` has real part `sqrt((|y|+a)/2)` and imaginary part
 * `sqrt((|y|-a)/2)`. Both of those radicands are non-negative here rather than
 * needing to be checked: `|y|` is `sqrt(r)` and `a` is `-p/2`, and a negative
 * discriminant is exactly the statement that `p^2 < 4r`, so `|y| > |a|`.
 *
 * When `sqrt(r)` is itself rational every component is a square root of a
 * rational and all four roots come out as ordinary surds. `x^4+1=0` is the case
 * worth having: its roots are `±sqrt(2)/2 ± sqrt(2)/2 i`, which no real-only
 * solver can report at all.
 *
 * When `sqrt(r)` is irrational the components nest one level, exactly as
 * {@link nestedSquareRoots} does for the real case. This used to decline
 * instead, which is how `x^4-2x^2+3=0` came to answer "no real solutions" while
 * its siblings `x^4+1`, `x^4+4` and `x^4-x^2+1` all returned four complex
 * roots. Same family, same shape of answer, and the difference was only whether
 * a `3` happened to be a perfect square.
 */
function complexBiquadraticRoots(p: Rational, r: Rational): SymbolicNode[] {
	const centre = rationalDiv(rationalNeg(p), TWO);
	const modulus = exactRationalSqrt(r);

	const re = modulus === null
		? nestedSurd(surdNode(r), centre)
		: surdNode(rationalDiv(rationalAdd(modulus, centre), TWO));
	const imaginaryMagnitude = modulus === null
		? nestedSurd(surdNode(r), rationalNeg(centre))
		: surdNode(rationalDiv(rationalSub(modulus, centre), TWO));

	const im: SymbolicNode = { kind: "mul", left: imaginaryMagnitude, right: complexNode(COMPLEX_I) };
	const first: SymbolicNode = { kind: "add", left: re, right: im };
	const second: SymbolicNode = { kind: "sub", left: re, right: im };
	return [
		{ kind: "neg", operand: first },
		{ kind: "neg", operand: second },
		second,
		first,
	];
}

/**
 * `sqrt((surd + offset)/2)`, written so the offset's sign reads naturally.
 *
 * A negative offset becomes a subtraction rather than the addition of a
 * negative, so the radicand prints as `(sqrt(3)-1)/2` rather than
 * `(sqrt(3)+-1)/2`.
 */
function nestedSurd(surd: SymbolicNode, offset: Rational): SymbolicNode {
	const shifted: SymbolicNode = offset.n >= 0n
		? { kind: "add", left: surd, right: constNode(offset) }
		: { kind: "sub", left: surd, right: constNode(rationalNeg(offset)) };
	return { kind: "call", name: "sqrt", args: [halved(shifted)] };
}

/**
 * The roots of a general depressed quartic, when its resolvent cubic splits it
 * into two quadratics over the rationals.
 *
 * `t^4+pt^2+qt+r` factors as `(t^2+at+B)(t^2-at+C)` exactly when `a^2` is a root
 * of the resolvent `z^3 + 2pz^2 + (p^2-4r)z - q^2`. A rational `z` whose square
 * root is also rational gives a factorization over the rationals, and each half
 * is then an ordinary quadratic with exact roots.
 *
 * @returns The four roots, or `null` when no such split exists.
 */
function splitQuarticRoots(
	p: Rational,
	q: Rational,
	r: Rational,
	solveQuadratic: (a: Rational, b: Rational, c: Rational) => readonly SymbolicNode[],
): SymbolicNode[] | null {
	const resolvent: Rational[] = [
		{ n: 1n, d: 1n },
		rationalMul(TWO, p),
		rationalSub(rationalMul(p, p), rationalMul(FOUR, r)),
		rationalNeg(rationalMul(q, q)),
	];

	for (const z of rationalRoots(resolvent)) {
		if (rationalCompare(z, RATIONAL_ZERO) <= 0) continue;
		const alpha = exactRationalSqrt(z);
		if (alpha === null) continue;

		// beta + gamma = p + alpha^2 and gamma - beta = q/alpha.
		const sum = rationalAdd(p, z);
		const difference = rationalDiv(q, alpha);
		const beta = rationalDiv(rationalSub(sum, difference), TWO);
		const gamma = rationalDiv(rationalAdd(sum, difference), TWO);

		const one: Rational = { n: 1n, d: 1n };
		return [
			...solveQuadratic(one, alpha, beta),
			...solveQuadratic(one, rationalNeg(alpha), gamma),
		];
	}
	return null;
}
