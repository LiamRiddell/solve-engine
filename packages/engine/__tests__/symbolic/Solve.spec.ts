/**
 * Solving polynomial equations over the reals.
 *
 * The verification-by-substitution property test at the bottom is the one that
 * carries the weight: every exact root is put back into the polynomial and must
 * evaluate to exactly zero. That catches a wrong root far more reliably than
 * comparing against hand-written expected lists, and it is only possible
 * because the coefficients are exact.
 */
import { describe, expect, test } from "@jest/globals";
import { solveForVariable, SOLVE_MAX_DEGREE } from "@solve-js/symbolic/Solve";
import { toPolynomial, polyCoefficients } from "@solve-js/symbolic/Polynomial";
import { simplifySymbolic, formatSymbolic, constNode, varNode, type SymbolicNode } from "@solve-js/symbolic";
import { RATIONAL_ZERO, rationalAdd, rationalMul, isRationalZero, type Rational } from "@solve-js/symbolic/Rational";
import { poly, evaluateNumerically } from "@tools/symbolicTestUtils";

/** Numerically evaluates a closed-form root, for checking a surd denotes the value it should. */
function rootValue(node: SymbolicNode): number {
	return evaluateNumerically(node, {});
}

/** Solves `expression = 0` for x. */
function solve(descending: number[]) {
	return solveForVariable(poly(descending), constNode(0), "x");
}

/** Renders the exact roots for comparison. */
function exactRoots(descending: number[]): string[] {
	const outcome = solve(descending);
	if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
	return outcome.exact.map(root => formatSymbolic(simplifySymbolic(root))).sort();
}

describe("solveForVariable — by degree", () => {
	test("linear", () => {
		// 2x + 6 = 0
		expect(exactRoots([2, 6])).toEqual(["-3"]);
	});

	test("linear with a fractional root", () => {
		// 3x - 1 = 0
		expect(exactRoots([3, -1])).toEqual(["1/3"]);
	});

	test("quadratic with two rational roots", () => {
		expect(exactRoots([1, 0, -4])).toEqual(["-2", "2"]);
	});

	test("quadratic with a repeated root reports it once", () => {
		expect(exactRoots([1, -2, 1])).toEqual(["1"]);
	});

	test("cubic with three rational roots", () => {
		// (x-1)(x-2)(x-3) = x^3 - 6x^2 + 11x - 6
		expect(exactRoots([1, -6, 11, -6])).toEqual(["1", "2", "3"]);
	});
});

describe("solveForVariable — exactness over convenience", () => {
	test("an irrational root comes back as a surd in lowest form, not a decimal", () => {
		// x^2 - 2 = 0. Returning 1.41421356 from a system that advertises exact
		// arithmetic would be quietly abandoning the claim. The discriminant is
		// 8, so the unreduced answer would be the equal but unreadable
		// sqrt(8)/2; extracting the square factor gives sqrt(2).
		expect(exactRoots([1, 0, -2])).toEqual(["-sqrt(2)", "sqrt(2)"]);
	});

	test("a surd root is numerically the right value", () => {
		// The symbolic form is exact; this checks it denotes what it should.
		const outcome = solve([1, 0, -2]);
		if (outcome.kind !== "roots") throw new Error("expected roots");
		const magnitudes = outcome.exact.map(root => Math.abs(rootValue(simplifySymbolic(root))));
		for (const magnitude of magnitudes) expect(magnitude).toBeCloseTo(Math.SQRT2, 12);
	});

	test("a discriminant that is a perfect square stays rational rather than becoming a surd", () => {
		expect(exactRoots([1, -3, 2])).toEqual(["1", "2"]);
	});
});

describe("solveForVariable — answers that are not roots", () => {
	test("a negative discriminant reports no real solutions and invents no complex root", () => {
		const outcome = solve([1, 0, 1]);
		expect(outcome.kind).toBe("no-real-solutions");
	});

	test("an identity is recognised as one", () => {
		// x + 1 = x + 1
		const side = poly([1, 1]);
		expect(solveForVariable(side, side, "x").kind).toBe("identity");
	});

	test("a contradiction is recognised as one", () => {
		// 1 = 2, with no variable at all
		expect(solveForVariable(constNode(1), constNode(2), "x").kind).toBe("contradiction");
	});

	test("a non-polynomial equation is declined with a reason", () => {
		const outcome = solveForVariable({ kind: "call", name: "sin", args: [varNode("x")] }, constNode(0), "x");
		expect(outcome.kind).toBe("unsupported");
		if (outcome.kind === "unsupported") expect(outcome.reason).toMatch(/polynomial/i);
	});

	test("beyond the degree ceiling it declines rather than guessing", () => {
		const tooLarge = new Array(SOLVE_MAX_DEGREE + 2).fill(0);
		tooLarge[0] = 1;
		tooLarge[tooLarge.length - 1] = -1;
		const outcome = solve(tooLarge);
		expect(outcome.kind).toBe("unsupported");
	});
});

describe("solveForVariable — the numerical fallback", () => {
	test("a quintic with no rational root is approximated and marked as such", () => {
		// x^5 - x - 1 = 0 has one real root near 1.1673, and no rational one.
		const outcome = solve([1, 0, 0, 0, -1, -1]);
		if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
		expect(outcome.exact).toHaveLength(0);
		expect(outcome.approximate).toHaveLength(1);
		expect(outcome.approximate[0]).toBeCloseTo(1.1673039783, 8);
	});

	test("an exact root found alongside an approximate one stays in the exact list", () => {
		// (x-1)(x^5 - x - 1): one rational root, one irrational.
		const outcome = solveForVariable(
			{ kind: "mul", left: poly([1, -1]), right: poly([1, 0, 0, 0, -1, -1]) },
			constNode(0),
			"x",
		);
		if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
		expect(outcome.exact.map(r => formatSymbolic(simplifySymbolic(r)))).toContain("1");
		expect(outcome.approximate.length).toBeGreaterThan(0);
	});
});

describe("solveForVariable — other unknowns present", () => {
	test("a linear equation solves symbolically in terms of the other unknown", () => {
		// a*x + b = 0  ->  x = -b/a
		const lhs: SymbolicNode = {
			kind: "add",
			left: { kind: "mul", left: varNode("a"), right: varNode("x") },
			right: varNode("b"),
		};
		const outcome = solveForVariable(lhs, constNode(0), "x");
		if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
		expect(formatSymbolic(simplifySymbolic(outcome.exact[0]))).toBe("-b/a");
	});

	test("a non-linear equation with another unknown is declined rather than guessed", () => {
		const lhs: SymbolicNode = {
			kind: "sub",
			left: { kind: "pow", base: varNode("x"), exponent: constNode(2) },
			right: varNode("a"),
		};
		expect(solveForVariable(lhs, constNode(0), "x").kind).toBe("unsupported");
	});
});

describe("solveForVariable — verification by substitution", () => {
	test("every exact rational root evaluates the polynomial to exactly zero", () => {
		let seed = 20260804;
		const nextInt = (span: number): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return (seed % (2 * span + 1)) - span;
		};

		let checked = 0;
		for (let iteration = 0; iteration < 200; iteration++) {
			const degree = 1 + (iteration % 4);
			const coefficients: number[] = [];
			for (let i = 0; i <= degree; i++) coefficients.push(nextInt(5));
			if (coefficients[0] === 0) coefficients[0] = 1;

			const outcome = solve(coefficients);
			if (outcome.kind !== "roots") continue;

			const polynomial = toPolynomial(poly(coefficients));
			if (polynomial === null) continue;
			const ascending = polyCoefficients(polynomial, "x");

			for (const root of outcome.exact) {
				const simplified = simplifySymbolic(root);
				// Only the plain rational roots are checked here; a surd is
				// verified separately above, since evaluating it needs a square
				// root the polynomial evaluator does not do.
				if (simplified.kind !== "const") continue;
				expect(isRationalZero(evaluateAscending(ascending, simplified.value))).toBe(true);
				checked++;
			}
		}
		// Guard against the loop silently checking nothing.
		expect(checked).toBeGreaterThan(20);
	});
});

/** Evaluates ascending coefficients at a rational point. */
function evaluateAscending(ascending: readonly Rational[], x: Rational): Rational {
	let total = RATIONAL_ZERO;
	for (let i = ascending.length - 1; i >= 0; i--) total = rationalAdd(rationalMul(total, x), ascending[i]);
	return total;
}

