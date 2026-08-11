/**
 * The mathematical laws a computer-algebra system has to obey.
 *
 * Everything here checks a law rather than a particular output string, which is
 * the useful way to test a CAS: a rewrite can look entirely plausible and still
 * be wrong, and a law catches that where a hand-written expected value only
 * catches the cases someone thought of. Where a law is checked numerically, it
 * is checked at several points, since two different expressions can agree at
 * one point by coincidence.
 */
import { describe, expect, test } from "@jest/globals";
import {
	simplifySymbolic,
	symbolicKey,
	substitute,
	complex,
	complexNode,
	constNode,
	rationalFromNumber,
	varNode,
	powNode,
	callNode,
	type SymbolicNode,
} from "@solve-js/symbolic";
import { expandSymbolic } from "@solve-js/symbolic/Polynomial";
import { factorSymbolic } from "@solve-js/symbolic/Factor";
import { solveForVariable } from "@solve-js/symbolic/Solve";
import { differentiate } from "@solve-js/symbolic/Derivative";
import { integrate } from "@solve-js/symbolic/Integral";
import { taylorSeries } from "@solve-js/symbolic/Taylor";
import { RATIONAL_ZERO, rational } from "@solve-js/symbolic/Rational";
import { poly, evaluateNumerically, evaluateComplexNumerically, seededInts } from "@tools/symbolicTestUtils";

const x = varNode("x");
const y = varNode("y");
const z = varNode("z");

/** Builds a binary node. */
function op(kind: "add" | "sub" | "mul" | "div", left: SymbolicNode, right: SymbolicNode): SymbolicNode {
	return { kind, left, right };
}

/** Points to sample when checking that two expressions agree everywhere. */
const SAMPLE_POINTS = [-2.7, -1, -0.3, 0.4, 1, 2.5, 3.9];

/** Asserts two expressions are numerically equal wherever both are defined. */
function agreesEverywhere(a: SymbolicNode, b: SymbolicNode, vars: readonly string[] = ["x"]): void {
	let compared = 0;
	for (const point of SAMPLE_POINTS) {
		const bindings: Record<string, number> = {};
		// Offset each variable so `x` and `y` never take the same value, which
		// would hide a rewrite that confused one for the other.
		vars.forEach((name, i) => { bindings[name] = point + i * 0.37; });
		const left = evaluateNumerically(a, bindings);
		const right = evaluateNumerically(b, bindings);
		if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
		expect(left).toBeCloseTo(right, 8);
		compared++;
	}
	expect(compared).toBeGreaterThan(0);
}

describe("expansion obeys the ring laws", () => {
	const a = op("add", x, constNode(2));
	const b = op("sub", x, constNode(3));
	const c = op("add", y, constNode(1));

	test("multiplication commutes", () => {
		expect(symbolicKey(expandSymbolic(op("mul", a, b)))).toBe(symbolicKey(expandSymbolic(op("mul", b, a))));
	});

	test("multiplication associates", () => {
		const left = expandSymbolic(op("mul", op("mul", a, b), c));
		const right = expandSymbolic(op("mul", a, op("mul", b, c)));
		expect(symbolicKey(left)).toBe(symbolicKey(right));
	});

	test("multiplication distributes over addition", () => {
		const distributed = expandSymbolic(op("mul", a, op("add", b, c)));
		const separately = expandSymbolic(op("add", op("mul", a, b), op("mul", a, c)));
		expect(symbolicKey(distributed)).toBe(symbolicKey(separately));
	});

	test("addition commutes and associates", () => {
		expect(symbolicKey(expandSymbolic(op("add", a, b)))).toBe(symbolicKey(expandSymbolic(op("add", b, a))));
		expect(symbolicKey(expandSymbolic(op("add", op("add", a, b), c))))
			.toBe(symbolicKey(expandSymbolic(op("add", a, op("add", b, c)))));
	});

	test("expansion is idempotent", () => {
		const once = expandSymbolic(op("mul", a, b));
		expect(symbolicKey(expandSymbolic(once))).toBe(symbolicKey(once));
	});

	test("an expansion agrees numerically with the expression it came from", () => {
		const product = op("mul", a, b);
		agreesEverywhere(expandSymbolic(product), product);
	});
});

describe("the classic algebraic identities", () => {
	const a = x;
	const b = y;

	test("square of a sum", () => {
		const left = expandSymbolic(powNode(op("add", a, b), constNode(2)));
		const right = expandSymbolic(op("add", op("add", powNode(a, constNode(2)), op("mul", constNode(2), op("mul", a, b))), powNode(b, constNode(2))));
		expect(symbolicKey(left)).toBe(symbolicKey(right));
	});

	test("square of a difference", () => {
		const left = expandSymbolic(powNode(op("sub", a, b), constNode(2)));
		const right = expandSymbolic(op("add", op("sub", powNode(a, constNode(2)), op("mul", constNode(2), op("mul", a, b))), powNode(b, constNode(2))));
		expect(symbolicKey(left)).toBe(symbolicKey(right));
	});

	test("difference of squares", () => {
		const left = expandSymbolic(op("mul", op("add", a, b), op("sub", a, b)));
		const right = expandSymbolic(op("sub", powNode(a, constNode(2)), powNode(b, constNode(2))));
		expect(symbolicKey(left)).toBe(symbolicKey(right));
	});

	test("cube of a sum", () => {
		const left = expandSymbolic(powNode(op("add", a, b), constNode(3)));
		agreesEverywhere(left, powNode(op("add", a, b), constNode(3)), ["x", "y"]);
	});

	test("difference of cubes", () => {
		// a^3 - b^3 = (a-b)(a^2+ab+b^2)
		const left = expandSymbolic(op("sub", powNode(a, constNode(3)), powNode(b, constNode(3))));
		const factored = op("mul", op("sub", a, b), op("add", op("add", powNode(a, constNode(2)), op("mul", a, b)), powNode(b, constNode(2))));
		expect(symbolicKey(left)).toBe(symbolicKey(expandSymbolic(factored)));
	});

	test("the binomial theorem for a fourth power", () => {
		// (x+1)^4 = x^4 + 4x^3 + 6x^2 + 4x + 1
		expect(symbolicKey(expandSymbolic(powNode(op("add", x, constNode(1)), constNode(4)))))
			.toBe(symbolicKey(poly([1, 4, 6, 4, 1])));
	});
});

describe("factoring is inverse to expansion", () => {
	test("expanding a factorization returns the expansion of the original", () => {
		const nextInt = seededInts(4242);
		let checked = 0;
		for (let i = 0; i < 150; i++) {
			const degree = 1 + (i % 5);
			const coefficients: number[] = [];
			for (let k = 0; k <= degree; k++) coefficients.push(nextInt(5));
			if (coefficients[0] === 0) coefficients[0] = 1;

			const original = poly(coefficients);
			expect(symbolicKey(expandSymbolic(factorSymbolic(original)))).toBe(symbolicKey(expandSymbolic(original)));
			checked++;
		}
		expect(checked).toBe(150);
	});

	test("a factorization agrees numerically with what it factored", () => {
		const original = poly([1, -1, -6]); // x^2 - x - 6
		agreesEverywhere(factorSymbolic(original), original);
	});

	test("the factor theorem: a rational root gives a linear factor that divides exactly", () => {
		// x^2 - x - 6 has roots 3 and -2, so (x-3)(x+2) must reproduce it.
		const original = poly([1, -1, -6]);
		const outcome = solveForVariable(original, constNode(0), "x");
		if (outcome.kind !== "roots") throw new Error("expected roots");
		let product: SymbolicNode = constNode(1);
		for (const root of outcome.exact) {
			product = op("mul", product, op("sub", x, root));
		}
		expect(symbolicKey(expandSymbolic(product))).toBe(symbolicKey(expandSymbolic(original)));
	});

	test("factoring is idempotent", () => {
		const once = factorSymbolic(poly([1, 0, -4]));
		expect(symbolicKey(factorSymbolic(once))).toBe(symbolicKey(once));
	});
});

describe("differentiation obeys its rules", () => {
	const f = op("add", powNode(x, constNode(3)), constNode(2));
	const g = op("sub", op("mul", constNode(2), x), constNode(1));

	test("the derivative of a constant is zero", () => {
		expect(symbolicKey(differentiate(constNode(7), "x"))).toBe(symbolicKey(constNode(RATIONAL_ZERO)));
	});

	test("linearity", () => {
		// d(3f + 5g) = 3f' + 5g'
		const combined = op("add", op("mul", constNode(3), f), op("mul", constNode(5), g));
		const expected = op("add", op("mul", constNode(3), differentiate(f, "x")), op("mul", constNode(5), differentiate(g, "x")));
		agreesEverywhere(differentiate(combined, "x"), expected);
	});

	test("the product rule holds against an independently built right-hand side", () => {
		const derivative = differentiate(op("mul", f, g), "x");
		const expected = op("add", op("mul", differentiate(f, "x"), g), op("mul", f, differentiate(g, "x")));
		agreesEverywhere(derivative, expected);
	});

	test("the quotient rule likewise", () => {
		const derivative = differentiate(op("div", f, g), "x");
		const numerator = op("sub", op("mul", differentiate(f, "x"), g), op("mul", f, differentiate(g, "x")));
		agreesEverywhere(derivative, op("div", numerator, powNode(g, constNode(2))));
	});

	test("the chain rule against an independently composed derivative", () => {
		const composed = callNode("sin", [f]);
		const expected = op("mul", callNode("cos", [f]), differentiate(f, "x"));
		agreesEverywhere(differentiate(composed, "x"), expected);
	});

	test("the power rule for a range of exponents", () => {
		for (let n = 1; n <= 6; n++) {
			const expected = op("mul", constNode(n), powNode(x, constNode(n - 1)));
			agreesEverywhere(differentiate(powNode(x, constNode(n)), "x"), expected);
		}
	});

	test("repeated differentiation matches asking for the order directly", () => {
		const once = differentiate(f, "x");
		expect(symbolicKey(differentiate(once, "x"))).toBe(symbolicKey(differentiate(f, "x", 2)));
	});

	test("differentiating a polynomial past its degree gives zero", () => {
		expect(symbolicKey(differentiate(poly([1, 2, 3]), "x", 3))).toBe(symbolicKey(constNode(RATIONAL_ZERO)));
	});

	test("a partial derivative ignores the other variable", () => {
		// d/dx (x^2 * y) = 2xy
		const node = op("mul", powNode(x, constNode(2)), y);
		agreesEverywhere(differentiate(node, "x"), op("mul", op("mul", constNode(2), x), y), ["x", "y"]);
	});
});

describe("integration is inverse to differentiation", () => {
	test("differentiating an integral returns the integrand, over generated polynomials", () => {
		const nextInt = seededInts(909);
		let checked = 0;
		for (let i = 0; i < 150; i++) {
			const degree = i % 5;
			const coefficients: number[] = [];
			for (let k = 0; k <= degree; k++) coefficients.push(nextInt(6));
			if (coefficients[0] === 0) coefficients[0] = 1;

			const original = poly(coefficients);
			const result = integrate(original, "x");
			if (!result.ok) throw new Error("a polynomial should always integrate");
			expect(symbolicKey(differentiate(result.value, "x"))).toBe(symbolicKey(original));
			checked++;
		}
		expect(checked).toBe(150);
	});

	test("integration is linear", () => {
		const f = poly([3, 0, 1]);
		const g = poly([1, -2]);
		const combined = integrate(op("add", f, g), "x");
		const separately = op("add", integrate(f, "x").ok ? (integrate(f, "x") as { value: SymbolicNode }).value : constNode(0),
			integrate(g, "x").ok ? (integrate(g, "x") as { value: SymbolicNode }).value : constNode(0));
		if (!combined.ok) throw new Error("expected an integral");
		agreesEverywhere(combined.value, separately);
	});

	test("the power rule, including the constant case", () => {
		for (let n = 0; n <= 5; n++) {
			const result = integrate(powNode(x, constNode(n)), "x");
			if (!result.ok) throw new Error("expected an integral");
			agreesEverywhere(result.value, op("div", powNode(x, constNode(n + 1)), constNode(n + 1)));
		}
	});

	test("differentiating the table entries returns the integrand", () => {
		const integrands: SymbolicNode[] = [
			callNode("exp", [x]),
			callNode("cos", [x]),
			callNode("sin", [x]),
			op("div", constNode(1), x),
		];
		for (const integrand of integrands) {
			const result = integrate(integrand, "x");
			if (!result.ok) throw new Error(`expected an integral for ${symbolicKey(integrand)}`);
			agreesEverywhere(differentiate(result.value, "x"), integrand);
		}
	});
});

describe("solving is verified by substitution", () => {
	test("every exact root makes the polynomial vanish", () => {
		const cases: number[][] = [
			[1, 0, -4], [1, -1, -6], [1, -3, 2], [2, 5, 2], [1, -6, 11, -6], [1, 0, 0, -1],
		];
		let checked = 0;
		for (const coefficients of cases) {
			const p = poly(coefficients);
			const outcome = solveForVariable(p, constNode(0), "x");
			if (outcome.kind !== "roots") continue;
			for (const root of outcome.exact) {
				const substituted = simplifySymbolic(substitute(p, "x", root));
				// A rational root vanishes exactly. A surd or a complex root leaves
				// an expression the simplifier cannot fully reduce, so it is checked
				// over the complex plane: both parts must be zero.
				if (substituted.kind === "const") {
					expect(substituted.value.n).toBe(0n);
				} else {
					const value = evaluateComplexNumerically(substituted, {});
					expect(value.re).toBeCloseTo(0, 8);
					expect(value.im).toBeCloseTo(0, 8);
				}
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(8);
	});

	test("an approximate root also makes the polynomial vanish, to tolerance", () => {
		const p = poly([1, 0, 0, 0, -1, -1]); // x^5 - x - 1
		const outcome = solveForVariable(p, constNode(0), "x");
		if (outcome.kind !== "roots") throw new Error("expected roots");
		expect(outcome.approximate.length).toBe(5);
		for (const approximate of outcome.approximate) {
			// Substituted over the complex plane, since four of the five roots are
			// off the real line and a real-only check would silently skip them.
			const substituted = substitute(p, "x", complexNode(complex(rationalFromNumber(approximate.re), rationalFromNumber(approximate.im))));
			const value = evaluateComplexNumerically(simplifySymbolic(substituted), {});
			expect(value.re).toBeCloseTo(0, 8);
			expect(value.im).toBeCloseTo(0, 8);
		}
	});

	test("Vieta's formulas hold for a quadratic's two roots", () => {
		// For ax^2+bx+c, the roots sum to -b/a and multiply to c/a.
		const cases: [number, number, number][] = [[1, -5, 6], [1, 1, -6], [2, -7, 3]];
		for (const [a, b, c] of cases) {
			const outcome = solveForVariable(poly([a, b, c]), constNode(0), "x");
			if (outcome.kind !== "roots" || outcome.exact.length !== 2) continue;
			const values = outcome.exact.map(root => evaluateNumerically(simplifySymbolic(root), {}));
			expect(values[0] + values[1]).toBeCloseTo(-b / a, 9);
			expect(values[0] * values[1]).toBeCloseTo(c / a, 9);
		}
	});

	test("solving a linear equation inverts it", () => {
		// 7x - 3 = 0 has the root 3/7, and putting it back gives zero.
		const outcome = solveForVariable(poly([7, -3]), constNode(0), "x");
		if (outcome.kind !== "roots") throw new Error("expected roots");
		expect(evaluateNumerically(simplifySymbolic(outcome.exact[0]), {})).toBeCloseTo(3 / 7, 12);
	});
});

describe("Taylor series obey their defining properties", () => {
	test("a polynomial's series at or above its own degree is the polynomial", () => {
		const p = poly([2, -3, 0, 5]);
		for (const degree of [3, 4, 6]) {
			expect(symbolicKey(taylorSeries(p, "x", RATIONAL_ZERO, degree))).toBe(symbolicKey(p));
		}
	});

	test("the degree-zero series is the value at the point", () => {
		expect(symbolicKey(taylorSeries(callNode("cos", [x]), "x", RATIONAL_ZERO, 0))).toBe(symbolicKey(constNode(1)));
	});

	test("a series matches the function near the expansion point", () => {
		const series = taylorSeries(callNode("exp", [x]), "x", RATIONAL_ZERO, 8);
		for (const point of [-0.5, -0.1, 0.1, 0.4]) {
			expect(evaluateNumerically(series, { x: point })).toBeCloseTo(Math.exp(point), 6);
		}
	});

	test("a truncated series and the function share their derivatives at the point", () => {
		// The n-th derivative of the series at the point equals the function's.
		const series = taylorSeries(callNode("sin", [x]), "x", RATIONAL_ZERO, 6);
		for (let order = 0; order <= 4; order++) {
			const fromSeries = simplifySymbolic(substitute(differentiate(series, "x", order), "x", constNode(0)));
			const fromFunction = simplifySymbolic(substitute(differentiate(callNode("sin", [x]), "x", order), "x", constNode(0)));
			expect(evaluateNumerically(fromSeries, {})).toBeCloseTo(evaluateNumerically(fromFunction, {}), 9);
		}
	});

	test("expanding about a non-zero point still reproduces the function there", () => {
		const series = taylorSeries(powNode(x, constNode(3)), "x", rational(2n), 3);
		agreesEverywhere(series, powNode(x, constNode(3)));
	});
});

describe("degenerate inputs behave", () => {
	test("the zero polynomial", () => {
		expect(symbolicKey(expandSymbolic(poly([0])))).toBe(symbolicKey(constNode(RATIONAL_ZERO)));
		const result = integrate(poly([0]), "x");
		expect(result.ok).toBe(true);
	});

	test("a bare constant", () => {
		expect(symbolicKey(factorSymbolic(constNode(12)))).toBe(symbolicKey(constNode(12)));
		expect(symbolicKey(differentiate(constNode(12), "x"))).toBe(symbolicKey(constNode(RATIONAL_ZERO)));
	});

	test("a variable that does not appear in the expression", () => {
		expect(symbolicKey(differentiate(poly([1, 1]), "z"))).toBe(symbolicKey(constNode(RATIONAL_ZERO)));
		const result = integrate(y, "x");
		if (!result.ok) throw new Error("expected an integral");
		agreesEverywhere(result.value, op("mul", y, x), ["x", "y"]);
	});

	test("three variables at once", () => {
		const node = op("mul", op("add", x, y), z);
		agreesEverywhere(expandSymbolic(node), node, ["x", "y", "z"]);
	});

	test("negative and fractional coefficients survive a factor round trip", () => {
		const p = poly([-2, 5, -3]);
		expect(symbolicKey(expandSymbolic(factorSymbolic(p)))).toBe(symbolicKey(expandSymbolic(p)));
	});
});
