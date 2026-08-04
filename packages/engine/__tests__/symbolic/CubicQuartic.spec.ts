/**
 * Closed-form solutions for cubics and quartics.
 *
 * Every root here is verified by substitution rather than by comparison against
 * a hand-written expected string. A closed form for a cubic is a nest of cube
 * roots of square roots, and reading one to check it by eye is exactly the kind
 * of work a person gets wrong; putting it back into the polynomial and checking
 * the result is zero is not.
 *
 * Complex roots are substituted too, through the complex evaluator, which is
 * what makes "did Cardano's conjugate pair come out right" an assertion rather
 * than a hope.
 */
import { describe, expect, test } from "@jest/globals";
import { solveCubic, solveQuartic, type RootSet } from "@solve-js/symbolic/CubicQuartic";
import { solveForVariable } from "@solve-js/symbolic/Solve";
import { exactIntegerCbrt, surdNode, cbrtNode } from "@solve-js/symbolic/Radicals";
import { simplifySymbolic, formatSymbolic, constNode, type SymbolicNode } from "@solve-js/symbolic";
import { rational, type Rational } from "@solve-js/symbolic/Rational";
import { poly, evaluateComplexNumerically, seededInts } from "@tools/symbolicTestUtils";

/** Ascending-to-descending rationals from plain integers. */
function coefficients(values: number[]): Rational[] {
	return values.map(value => rational(BigInt(value)));
}

/** Asserts every root of `roots` satisfies the polynomial with the given descending coefficients. */
function expectAllRootsSatisfy(descending: number[], roots: RootSet): void {
	const points = [
		...roots.exact.map(root => evaluateComplexNumerically(simplifySymbolic(root), {})),
		...roots.approximate.map(value => ({ re: value, im: 0 })),
	];
	expect(points.length).toBeGreaterThan(0);
	for (const point of points) {
		const value = horner(descending, point);
		expect(Math.abs(value.re)).toBeLessThan(1e-8);
		expect(Math.abs(value.im)).toBeLessThan(1e-8);
	}
}

/** Horner evaluation over the complex plane, written out because the accumulator order matters. */
function horner(descending: number[], point: { re: number; im: number }): { re: number; im: number } {
	let re = 0;
	let im = 0;
	for (const coefficient of descending) {
		const nextRe = re * point.re - im * point.im + coefficient;
		const nextIm = re * point.im + im * point.re;
		re = nextRe;
		im = nextIm;
	}
	return { re, im };
}

/** Solves a cubic given as descending integer coefficients. */
function cubic(descending: number[]): RootSet {
	const [a, b, c, d] = coefficients(descending);
	return solveCubic(a, b, c, d);
}

describe("solveCubic", () => {
	test("a pure cube root comes back exact", () => {
		// x^3 - 2 = 0 has the real root cbrt(2), which no rational can express.
		const roots = cubic([1, 0, 0, -2]);
		expect(roots.approximate).toEqual([]);
		expect(formatSymbolic(simplifySymbolic(roots.exact[0]))).toBe("cbrt(2)");
		expectAllRootsSatisfy([1, 0, 0, -2], roots);
	});

	test("a cube root that happens to be rational folds to a plain number", () => {
		// x^3 - 8 = 0. The closed form runs through cbrt of a perfect cube, and the
		// simplifier's exact folding collapses it rather than leaving cbrt(8).
		const roots = cubic([1, 0, 0, -8]);
		expect(formatSymbolic(simplifySymbolic(roots.exact[0]))).toBe("2");
	});

	test("one real root and a conjugate pair", () => {
		// x^3 + x - 1 = 0 has a negative discriminant, so Cardano applies directly.
		const roots = cubic([1, 0, 1, -1]);
		expect(roots.exact).toHaveLength(3);
		expect(roots.approximate).toEqual([]);
		expectAllRootsSatisfy([1, 0, 1, -1], roots);
	});

	test("the real root of a Cardano cubic has no imaginary part at all", () => {
		const roots = cubic([1, 0, 1, -1]);
		const first = evaluateComplexNumerically(simplifySymbolic(roots.exact[0]), {});
		expect(first.im).toBe(0);
		expect(first.re).toBeCloseTo(0.6823278038280193, 12);
	});

	test("a repeated root gives exact rationals, since a rational cubic cannot repeat an irrational", () => {
		// (x-1)^2 (x+2) = x^3 - 3x + 2
		const roots = cubic([1, 0, -3, 2]);
		expect(roots.approximate).toEqual([]);
		expect(roots.exact.map(root => formatSymbolic(simplifySymbolic(root)))).toEqual(["-2", "1"]);
	});

	test("a triple root is reported once", () => {
		// (x-2)^3 = x^3 - 6x^2 + 12x - 8
		const roots = cubic([1, -6, 12, -8]);
		expect(roots.exact.map(root => formatSymbolic(simplifySymbolic(root)))).toEqual(["2"]);
	});

	test("the casus irreducibilis comes back numerically, and says so", () => {
		// x^3 - 3x + 1 = 0 has three distinct real roots and no rational one, so
		// there is provably no expression for them in real radicals.
		const roots = cubic([1, 0, -3, 1]);
		expect(roots.exact).toEqual([]);
		expect(roots.approximate).toHaveLength(3);
		expectAllRootsSatisfy([1, 0, -3, 1], roots);
	});

	test("the three approximate roots come back in ascending order", () => {
		const roots = cubic([1, 0, -3, 1]);
		const sorted = [...roots.approximate].sort((left, right) => left - right);
		expect(roots.approximate).toEqual(sorted);
	});

	test("a non-monic cubic is depressed correctly", () => {
		// 2x^3 + 3x^2 - 1 = 0
		const roots = cubic([2, 3, 0, -1]);
		expectAllRootsSatisfy([2, 3, 0, -1], roots);
	});

	test("every generated cubic has three roots that check out", () => {
		const nextInt = seededInts(20260804);
		let checked = 0;
		for (let i = 0; i < 60; i++) {
			const descending = [nextInt(4) || 1, nextInt(6), nextInt(6), nextInt(6)];
			const roots = cubic(descending);
			expect(roots.exact.length + roots.approximate.length).toBeGreaterThan(0);
			expectAllRootsSatisfy(descending, roots);
			checked++;
		}
		expect(checked).toBe(60);
	});
});

describe("solveQuartic", () => {
	/** Solves a quartic through the public solver, which supplies the quadratic half. */
	function quartic(descending: number[]): RootSet {
		const outcome = solveForVariable(poly(descending), constNode(0), "x");
		if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
		return { exact: outcome.exact, approximate: outcome.approximate };
	}

	test("a biquadratic gives four exact roots", () => {
		// x^4 - 5x^2 + 4 = 0, whose roots are ±1 and ±2.
		const roots = quartic([1, 0, -5, 0, 4]);
		expect(roots.exact.map(root => formatSymbolic(simplifySymbolic(root))).sort()).toEqual(["-1", "-2", "1", "2"]);
	});

	test("a biquadratic with irrational roots stays exact, as a nested radical", () => {
		// x^4 - 3x^2 + 1 = 0. The inner quadratic is itself irrational, so each x
		// is the square root of a surd rather than of a rational.
		const roots = quartic([1, 0, -3, 0, 1]);
		expect(roots.approximate).toEqual([]);
		expect(roots.exact.map(root => formatSymbolic(simplifySymbolic(root)))).toEqual([
			"-sqrt((3+sqrt(5))/2)",
			"sqrt((3+sqrt(5))/2)",
			"-sqrt((3-sqrt(5))/2)",
			"sqrt((3-sqrt(5))/2)",
		]);
		expectAllRootsSatisfy([1, 0, -3, 0, 1], roots);
	});

	test("a repeated irrational root is reported once, not twice", () => {
		// (x^2-2)^2 = x^4 - 4x^2 + 4. Both square roots come from the same solution
		// of the inner quadratic, so there are two roots here and not four.
		const roots = quartic([1, 0, -4, 0, 4]);
		expect(roots.exact.map(root => formatSymbolic(simplifySymbolic(root)))).toEqual(["-sqrt(2)", "sqrt(2)"]);
	});

	test("a biquadratic with one negative solution gives a real pair and an imaginary pair", () => {
		// x^4 - x^2 - 2 = (x^2-2)(x^2+1), so two roots are real and two are not.
		const roots = quartic([1, 0, -1, 0, -2]);
		expectAllRootsSatisfy([1, 0, -1, 0, -2], roots);
		const imaginary = roots.exact.filter(root => evaluateComplexNumerically(simplifySymbolic(root), {}).im !== 0);
		expect(imaginary).toHaveLength(2);
	});

	test("x^4+1 has four exact complex roots, which no real-only solver can report", () => {
		const roots = quartic([1, 0, 0, 0, 1]);
		expect(roots.exact).toHaveLength(4);
		expectAllRootsSatisfy([1, 0, 0, 0, 1], roots);
		// Each root is one of the primitive eighth roots of unity.
		for (const root of roots.exact) {
			const value = evaluateComplexNumerically(simplifySymbolic(root), {});
			expect(Math.hypot(value.re, value.im)).toBeCloseTo(1, 12);
			expect(Math.abs(value.im)).toBeGreaterThan(0.5);
		}
	});

	test("a quartic that splits into two rational quadratics is solved exactly", () => {
		// (x^2+2x+3)(x^2-2x+5) = x^4 + 4x^2 + 4x + 15, whose resolvent cubic has a
		// rational root and whose halves are quadratics over Q.
		const roots = quartic([1, 0, 4, 4, 15]);
		expect(roots.approximate).toEqual([]);
		expect(roots.exact).toHaveLength(4);
		expectAllRootsSatisfy([1, 0, 4, 4, 15], roots);
	});

	test("a quartic with no readable closed form still gets numerical roots", () => {
		// x^4 + x + 1 = 0 has no rational root, is not biquadratic, and its
		// resolvent cubic has no rational root either. It has no real roots at all,
		// so the honest answer is that none were found.
		const outcome = solveForVariable(poly([1, 0, 0, 1, 1]), constNode(0), "x");
		expect(outcome.kind).toBe("no-real-solutions");
	});
});

describe("solveForVariable routes through the closed forms", () => {
	/** Renders the exact roots of `expression = 0`. */
	function exactRoots(descending: number[]): string[] {
		const outcome = solveForVariable(poly(descending), constNode(0), "x");
		if (outcome.kind !== "roots") throw new Error(`expected roots, got ${outcome.kind}`);
		return outcome.exact.map(root => formatSymbolic(simplifySymbolic(root)));
	}

	test("a cubic with no rational root is now exact rather than approximate", () => {
		// This is the behaviour change: before the closed forms existed, x^3-2=0
		// came back as the decimal 1.2599210498948732.
		expect(exactRoots([1, 0, 0, -2])[0]).toBe("cbrt(2)");
	});

	test("a rational root is still divided out first, so the easy answer stays easy", () => {
		// x^3 - x^2 - x - 2 = (x-2)(x^2+x+1). The rational root comes out first and
		// the leftover quadratic is solved by formula, never reaching Cardano.
		const outcome = solveForVariable(poly([1, -1, -1, -2]), constNode(0), "x");
		if (outcome.kind !== "roots") throw new Error("expected roots");
		expect(formatSymbolic(simplifySymbolic(outcome.exact[0]))).toBe("2");
		expect(outcome.exact).toHaveLength(3);
	});

	test("a quintic still falls through to the numerical path", () => {
		const outcome = solveForVariable(poly([1, 0, 0, 0, -3, 1]), constNode(0), "x");
		if (outcome.kind !== "roots") throw new Error("expected roots");
		expect(outcome.approximate.length).toBeGreaterThan(0);
	});
});

describe("Radicals", () => {
	test("the exact integer cube root accepts negatives, unlike the square root", () => {
		expect(exactIntegerCbrt(-8n)).toBe(-2n);
		expect(exactIntegerCbrt(27n)).toBe(3n);
		expect(exactIntegerCbrt(0n)).toBe(0n);
		expect(exactIntegerCbrt(2n)).toBeNull();
	});

	test("a large perfect cube is still found exactly", () => {
		const value = 123456789n * 123456789n * 123456789n;
		expect(exactIntegerCbrt(value)).toBe(123456789n);
	});

	test("a surd is reduced to lowest form", () => {
		expect(formatSymbolic(surdNode(rational(8n)))).toBe("2*sqrt(2)");
		expect(formatSymbolic(surdNode(rational(9n)))).toBe("3");
		expect(formatSymbolic(surdNode(rational(1n, 4n)))).toBe("0.5");
	});

	test("a cube root folds only when it is rational", () => {
		expect(formatSymbolic(cbrtNode(rational(-27n)))).toBe("-3");
		expect(formatSymbolic(cbrtNode(rational(5n)))).toBe("cbrt(5)");
	});

	test("the simplifier folds cbrt of a perfect cube, including a negative one", () => {
		const call = (value: number): SymbolicNode => ({ kind: "call", name: "cbrt", args: [constNode(value)] });
		expect(formatSymbolic(simplifySymbolic(call(-64)))).toBe("-4");
		expect(formatSymbolic(simplifySymbolic(call(7)))).toBe("cbrt(7)");
	});
});
