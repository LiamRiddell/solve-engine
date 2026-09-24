/**
 * Compiling a symbolic tree into a numeric function, the step every numeric
 * method (root search, quadrature, limits) starts from.
 */
import { describe, expect, test } from "@jest/globals";
import {
	compileRealFunction,
	compileBoundedFunction,
	evaluateConstant,
	isContinuousEverywhere,
	describeNumber,
} from "@solve-js/symbolic/NumericEvaluate";
import { callNode, constNode, varNode, powNode, complexNode, complex, rational, type SymbolicNode } from "@solve-js/symbolic";

const x = varNode("x");
const div = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "div", left, right });
const sub = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "sub", left, right });

describe("compileRealFunction", () => {
	test("evaluates the way the engine's own functions do", () => {
		const compiled = compileRealFunction(sub(callNode("cos", [x]), x), "x");
		expect(compiled.ok).toBe(true);
		if (!compiled.ok) return;
		expect(compiled.fn(0.5)).toBe(Math.cos(0.5) - 0.5);
	});

	test("root(n, x) is the n-th root of x, in the builtin's argument order", () => {
		const compiled = compileRealFunction(callNode("root", [constNode(3), x]), "x");
		if (!compiled.ok) throw new Error(compiled.reason);
		expect(compiled.fn(27)).toBeCloseTo(3, 14);
	});

	test("a point with no real value is NaN, not a refusal", () => {
		const compiled = compileRealFunction(callNode("sqrt", [x]), "x");
		if (!compiled.ok) throw new Error(compiled.reason);
		expect(compiled.fn(-1)).toBeNaN();
	});

	test("a second unknown, an imaginary constant and an unknown function are each refused with a reason", () => {
		expect(compileRealFunction(sub(x, varNode("a")), "x")).toMatchObject({ ok: false, reason: expect.stringMatching(/"a"/) });
		expect(compileRealFunction(complexNode(complex(rational(0n), rational(1n))), "x")).toMatchObject({ ok: false, reason: expect.stringMatching(/imaginary/) });
		expect(compileRealFunction(callNode("mystery", [x]), "x")).toMatchObject({ ok: false, reason: expect.stringMatching(/mystery/) });
	});

	test("evaluateConstant reads a tree with no unknown as its number", () => {
		expect(evaluateConstant(callNode("sin", [constNode(1)]))).toBe(Math.sin(1));
		expect(evaluateConstant(x)).toBeNull();
	});
});

describe("compileBoundedFunction", () => {
	test("agrees with the plain compiler on the value", () => {
		const tree = div(callNode("sin", [x]), x);
		const plain = compileRealFunction(tree, "x");
		const bounded = compileBoundedFunction(tree, "x");
		if (!plain.ok || !bounded.ok) throw new Error("did not compile");
		for (const point of [0.1, 1, 3]) expect(bounded.fn(point).value).toBe(plain.fn(point));
	});

	test("says a cancelled difference is mostly noise", () => {
		// (1-cos(x))/x^2 near zero: cos(1e-9) is exactly 1 in doubles, so the value
		// is a confident 0 against a true 0.5. Its bound must be larger than that.
		const tree = div(sub(constNode(1), callNode("cos", [x])), powNode(x, constNode(2)));
		const bounded = compileBoundedFunction(tree, "x");
		if (!bounded.ok) throw new Error(bounded.reason);
		const near = bounded.fn(1e-9);
		expect(near.value).toBe(0);
		expect(near.error).toBeGreaterThan(0.5);
		// At a comfortable distance the same expression is almost all signal.
		const far = bounded.fn(0.1);
		expect(far.error).toBeLessThan(1e-12);
	});

	test("a quotient whose divisor rounding could make zero has an unbounded error", () => {
		const bounded = compileBoundedFunction(div(constNode(1), sub(x, constNode(0.1))), "x");
		if (!bounded.ok) throw new Error(bounded.reason);
		expect(bounded.fn(0.1).error).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("isContinuousEverywhere", () => {
	test("says yes only for shapes that cannot open a gap", () => {
		expect(isContinuousEverywhere(callNode("sin", [powNode(x, constNode(2))]))).toBe(true);
		expect(isContinuousEverywhere(powNode(constNode(2), x))).toBe(true);
		expect(isContinuousEverywhere(div(x, constNode(2)))).toBe(true);
	});

	test("says no for anything that divides by, logs, roots or rounds the unknown", () => {
		expect(isContinuousEverywhere(div(constNode(1), x))).toBe(false);
		expect(isContinuousEverywhere(callNode("log", [x]))).toBe(false);
		expect(isContinuousEverywhere(callNode("sqrt", [x]))).toBe(false);
		expect(isContinuousEverywhere(callNode("floor", [x]))).toBe(false);
		expect(isContinuousEverywhere(powNode(x, constNode(-1)))).toBe(false);
	});
});

describe("describeNumber", () => {
	test("shows ten significant figures and no exponent for ordinary sizes", () => {
		expect(describeNumber(1_000_000)).toBe("1000000");
		expect(describeNumber(1 / 3)).toBe("0.3333333333");
		expect(describeNumber(-0)).toBe("0");
		expect(describeNumber(Number.POSITIVE_INFINITY)).toBe("∞");
	});
});
