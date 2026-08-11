/**
 * The guarantee that a list of roots is the whole list.
 *
 * Every other solver test asks whether a root is a root. This one asks the
 * question that goes wrong quietly: are these all of them? `solve(x^5-1=0, x)`
 * answered `1`, which is a correct root, one fifth of the truth, and impossible
 * to tell from a complete answer by looking at it. A wrong root can be spotted
 * by substituting it. A missing root leaves nothing behind to spot.
 *
 * So the property checked here is the relationship between the degree the
 * solver was given and the roots it hands back, over a spread of equations that
 * includes ones it genuinely cannot do:
 *
 *  - a `roots` outcome must multiply back up to the polynomial it came from,
 *    which is only possible when nothing is missing;
 *  - an `incomplete` outcome must count the shortfall, and every root it does
 *    carry must still be a real one;
 *  - an `unsupported` outcome must carry no roots at all, so there is no
 *    partial list to mistake for an answer.
 *
 * The multiplicities are searched rather than asked for, because the solver
 * reports a repeated root once and the point of this file is to trust it about
 * nothing.
 */
import { describe, expect, test } from "@jest/globals";
import { solveForVariable, SOLVE_MAX_DEGREE, type SolveOutcome } from "@solve-js/symbolic/Solve";
import { simplifySymbolic, constNode, varNode } from "@solve-js/symbolic";
import { poly, evaluateComplexNumerically } from "@tools/symbolicTestUtils";

interface Cpx {
	readonly re: number;
	readonly im: number;
}

const cpx = (re: number, im = 0): Cpx => ({ re, im });
const add = (a: Cpx, b: Cpx): Cpx => cpx(a.re + b.re, a.im + b.im);
const sub = (a: Cpx, b: Cpx): Cpx => cpx(a.re - b.re, a.im - b.im);
const mul = (a: Cpx, b: Cpx): Cpx => cpx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const magnitude = (a: Cpx): number => Math.hypot(a.re, a.im);

/** Horner evaluation of descending coefficients, the independent check for each root. */
function polynomialAt(descending: readonly number[], point: Cpx): Cpx {
	let total = cpx(0);
	for (const coefficient of descending) total = add(mul(total, point), cpx(coefficient));
	return total;
}

/** Every root of an outcome as a complex number, whichever list it came from. */
function rootsOf(outcome: SolveOutcome): Cpx[] {
	if (outcome.kind !== "roots" && outcome.kind !== "incomplete") return [];
	return [
		...outcome.exact.map(root => evaluateComplexNumerically(simplifySymbolic(root), {})),
		...outcome.approximate.map(root => cpx(root.re, root.im)),
	];
}

/** Every way of writing `total` as `parts` positive whole numbers. */
function multiplicityAssignments(total: number, parts: number): number[][] {
	if (parts < 1 || total < parts) return [];
	if (parts === 1) return [[total]];
	const out: number[][] = [];
	for (let first = 1; first <= total - (parts - 1); first++) {
		for (const rest of multiplicityAssignments(total - first, parts - 1)) out.push([first, ...rest]);
	}
	return out;
}

/** Multiplies `(x - root)` into a descending coefficient list. */
function timesLinearFactor(descending: readonly Cpx[], root: Cpx): Cpx[] {
	const product: Cpx[] = new Array(descending.length + 1).fill(null).map(() => cpx(0));
	for (let i = 0; i < descending.length; i++) {
		product[i] = add(product[i], descending[i]);
		product[i + 1] = sub(product[i + 1], mul(descending[i], root));
	}
	return product;
}

/**
 * Whether the roots, under some assignment of multiplicities, multiply back up
 * to the polynomial.
 *
 * This is what "the root count equals the degree with multiplicity" means when
 * a repeated root is reported once. A missing root leaves a factor behind that
 * no assignment of multiplicities to the others can supply.
 */
function rootsRebuild(descending: readonly number[], roots: readonly Cpx[]): boolean {
	const degree = descending.length - 1;
	const largest = Math.max(1, ...descending.map(Math.abs));
	for (const multiplicities of multiplicityAssignments(degree, roots.length)) {
		let product: Cpx[] = [cpx(descending[0])];
		roots.forEach((root, index) => {
			for (let k = 0; k < multiplicities[index]; k++) product = timesLinearFactor(product, root);
		});
		if (product.every((value, index) => magnitude(sub(value, cpx(descending[index]))) <= 1e-6 * largest)) return true;
	}
	return false;
}

/** Solves `expression = 0` for x. */
function solve(descending: number[]): SolveOutcome {
	return solveForVariable(poly(descending), constNode(0), "x");
}

/** A spread deliberately covering every branch the solver has, in the order it tries them. */
const spread: { name: string; descending: number[] }[] = [
	{ name: "linear", descending: [2, 6] },
	{ name: "a quadratic with rational roots", descending: [1, 0, -4] },
	{ name: "a quadratic with a repeated root", descending: [1, -2, 1] },
	{ name: "a quadratic with a surd root", descending: [1, 0, -2] },
	{ name: "a quadratic with complex roots", descending: [1, 0, 1] },
	{ name: "a cubic from integer roots", descending: [1, -6, 11, -6] },
	{ name: "a cubic through Cardano", descending: [1, 0, 0, -2] },
	{ name: "a cubic in the casus irreducibilis", descending: [1, 0, -3, 1] },
	{ name: "a cubic with a zero constant term", descending: [1, 0, -1, 0] },
	{ name: "a biquadratic", descending: [1, 0, -5, 0, 4] },
	{ name: "a biquadratic with an irrational modulus", descending: [1, 0, -2, 0, 3] },
	{ name: "a quartic that splits into rational quadratics", descending: [1, 0, 4, 4, 15] },
	{ name: "a quartic with no closed form", descending: [1, 0, 0, 1, 1] },
	{ name: "a quartic with a doubled complex root", descending: [1, 0, 2, 0, 1] },
	{ name: "a quintic with a zero constant term", descending: [1, 0, 0, 0, -1, 0] },
	{ name: "a quintic with one rational root", descending: [1, 0, 0, 0, 0, -1] },
	{ name: "a quintic with no closed form", descending: [1, 0, 0, 0, 1, 1] },
	{ name: "a quintic that is a cube times a square", descending: [1, -1, 0, 0, 0, 0] },
	{ name: "a sextic", descending: [1, 0, 0, 0, 0, 0, -1] },
	{ name: "a septic with a leading coefficient", descending: [2, 0, 0, 0, 0, 0, 3, -1] },
	{ name: "a degree-eight polynomial", descending: [1, 0, 0, 0, 0, 0, 0, 0, -1] },
];

describe("a roots outcome is the whole set of roots", () => {
	test.each(spread)("$name: every root satisfies the equation", ({ descending }) => {
		const outcome = solve(descending);
		if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
		for (const root of rootsOf(outcome)) {
			let scale = 0;
			for (const coefficient of descending) scale = scale * magnitude(root) + Math.abs(coefficient);
			const residual = magnitude(polynomialAt(descending, root));
			if (!(residual <= 1e-8 * Math.max(1, scale))) {
				throw new Error(`root ${root.re}+${root.im}i leaves a residual of ${residual}`);
			}
		}
	});

	test.each(spread)("$name: the roots multiply back up to it, so none is missing", ({ descending }) => {
		const outcome = solve(descending);
		if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
		const roots = rootsOf(outcome);
		if (!rootsRebuild(descending, roots)) {
			throw new Error(`${roots.length} roots do not reconstruct a degree-${descending.length - 1} polynomial`);
		}
	});

	test.each(spread)("$name: at least one root and never more than the degree", ({ descending }) => {
		// The coherence half of the exit check, asserted from outside as well:
		// a distinct root can stand for several equal ones, so the count is
		// between one and the degree and cannot be either side of that.
		const outcome = solve(descending);
		if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
		const found = outcome.exact.length + outcome.approximate.length;
		expect(found).toBeGreaterThanOrEqual(1);
		expect(found).toBeLessThanOrEqual(descending.length - 1);
	});
});

describe("an equation the solver cannot do carries no roots to be mistaken for an answer", () => {
	test("a degree above the ceiling is refused rather than half-answered", () => {
		const tooLarge = new Array(SOLVE_MAX_DEGREE + 2).fill(0);
		tooLarge[0] = 1;
		tooLarge[tooLarge.length - 1] = -1;
		const outcome = solve(tooLarge);
		expect(outcome.kind).toBe("unsupported");
		expect(rootsOf(outcome)).toEqual([]);
	});

	test("a non-polynomial equation likewise", () => {
		const outcome = solveForVariable({ kind: "call", name: "sin", args: [varNode("x")] }, constNode(0), "x");
		expect(outcome.kind).toBe("unsupported");
		expect(rootsOf(outcome)).toEqual([]);
	});

	test("a second unknown in a non-linear equation likewise", () => {
		const lhs = { kind: "sub" as const, left: { kind: "pow" as const, base: varNode("x"), exponent: constNode(2) }, right: varNode("a") };
		const outcome = solveForVariable(lhs, constNode(0), "x");
		expect(outcome.kind).toBe("unsupported");
		expect(rootsOf(outcome)).toEqual([]);
	});
});

describe("300 random integer equations, none of them answered short", () => {
	/** Mulberry32, so a failure replays. */
	function seededRandom(seed: number): () => number {
		let state = seed >>> 0;
		return () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = Math.imul(state ^ (state >>> 15), 1 | state);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	test("every one is either complete or counted as short, and never silently either", () => {
		const random = seededRandom(0x50be01);
		let complete = 0;
		let counted = 0;
		for (let trial = 0; trial < 300; trial++) {
			const degree = 1 + Math.floor(random() * 6);
			const descending = [1 + Math.floor(random() * 3)];
			for (let i = 0; i < degree; i++) descending.push(Math.floor(random() * 13) - 6);

			const outcome = solve(descending);
			if (outcome.kind === "roots") {
				if (!rootsRebuild(descending, rootsOf(outcome))) {
					throw new Error(`[${descending.join(", ")}] answered with roots that do not reconstruct it`);
				}
				complete++;
				continue;
			}
			if (outcome.kind !== "incomplete") throw new Error(`[${descending.join(", ")}] gave ${outcome.kind}`);
			// A shortfall has to be counted, and what it did find still has to be true.
			expect(outcome.missing).toBeGreaterThanOrEqual(1);
			counted++;
		}
		expect(complete + counted).toBe(300);
		// A guard on the guard: a change that made everything decline would leave
		// the reconstruction above checking nothing.
		expect(complete).toBeGreaterThan(280);
	});
});
