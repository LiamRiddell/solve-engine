/**
 * `limitOf` and `definiteIntegral` on symbolic trees, below the engine.
 *
 * Expected values are the classical ones, worked out by hand rather than read
 * off a run: sin(x)/x tends to 1 at zero, the area under x^2 from 0 to 3 is 9.
 */
import { describe, expect, test } from "@jest/globals";
import { limitOf, oneSidedLimit } from "@solve-js/symbolic/Limit";
import { definiteIntegral } from "@solve-js/symbolic/DefiniteIntegral";
import { compileBoundedFunction } from "@solve-js/symbolic/NumericEvaluate";
import { callNode, constNode, varNode, powNode, rational, formatSymbolic, type SymbolicNode, type Rational } from "@solve-js/symbolic";

const x = varNode("x");
const div = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "div", left, right });
const sub = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "sub", left, right });
const mul = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "mul", left, right });
const at = (n: number): Rational => rational(BigInt(n));

describe("limitOf", () => {
	test("a removable 0/0 is found numerically", () => {
		expect(limitOf(div(callNode("sin", [x]), x), "x", at(0))).toEqual({ kind: "numeric", value: 1 });
	});

	test("a rational function is reduced and evaluated exactly", () => {
		const outcome = limitOf(div(sub(powNode(x, constNode(2)), constNode(1)), sub(x, constNode(1))), "x", at(1));
		expect(outcome.kind).toBe("exact");
		if (outcome.kind === "exact") expect(formatSymbolic(outcome.value)).toBe("2");
	});

	test("cancellation near the point does not pull the answer to zero", () => {
		const outcome = limitOf(div(sub(constNode(1), callNode("cos", [x])), powNode(x, constNode(2))), "x", at(0));
		expect(outcome.kind).toBe("numeric");
		if (outcome.kind === "numeric") expect(outcome.value).toBeCloseTo(0.5, 8);
	});

	test("a fractional power is extrapolated, not stepped towards", () => {
		// (sqrt(1+x)-1)/x tends to 1/2, and sqrt(x) to 0 from the only side it has.
		const halves = limitOf(div(sub(callNode("sqrt", [{ kind: "add", left: constNode(1), right: x }]), constNode(1)), x), "x", at(0));
		expect(halves.kind).toBe("numeric");
		if (halves.kind === "numeric") expect(halves.value).toBeCloseTo(0.5, 8);
		expect(limitOf(callNode("sqrt", [x]), "x", at(0))).toEqual({ kind: "numeric", value: 0 });
	});

	test("disagreeing sides, divergence and oscillation are each their own refusal", () => {
		expect(limitOf(div(callNode("abs", [x]), x), "x", at(0)).kind).toBe("sidesDisagree");
		expect(limitOf(div(constNode(1), powNode(x, constNode(2))), "x", at(0)).kind).toBe("diverges");
		expect(limitOf(callNode("sin", [div(constNode(1), x)]), "x", at(0)).kind).toBe("unsettled");
		expect(limitOf(callNode("log", [x]), "x", at(0)).kind).toBe("diverges");
	});

	test("a bounded oscillation damped to zero has limit zero", () => {
		expect(limitOf(mul(x, callNode("sin", [div(constNode(1), x)])), "x", at(0))).toEqual({ kind: "numeric", value: 0 });
	});

	test("a divergent geometric sequence is not extrapolated to zero", () => {
		// Aitken's formula takes 1/x's doubling values to 0 if it is not stopped.
		const bounded = compileBoundedFunction(div(constNode(1), x), "x");
		if (!bounded.ok) throw new Error(bounded.reason);
		expect(oneSidedLimit(bounded.fn, 0, 1)).toEqual({ kind: "infinite", sign: 1 });
	});
});

describe("definiteIntegral", () => {
	test("a polynomial is exact through its antiderivative", () => {
		const outcome = definiteIntegral(powNode(x, constNode(2)), "x", at(0), at(3));
		expect(outcome.kind).toBe("exact");
		if (outcome.kind === "exact") expect(formatSymbolic(outcome.value)).toBe("9");
	});

	test("an antiderivative with irrational values is evaluated to double precision", () => {
		const outcome = definiteIntegral(callNode("cos", [x]), "x", at(0), at(1));
		expect(outcome).toEqual({ kind: "evaluated", value: Math.sin(1) });
	});

	test("the antiderivative is not trusted across a pole it steps over", () => {
		// -1/x is an antiderivative of 1/x^2, and F(1) - F(-1) is -2, but the area
		// is infinite. The numeric pass finds the pole.
		expect(definiteIntegral(div(constNode(1), powNode(x, constNode(2))), "x", at(-1), at(1)).kind).toBe("improper");
	});

	test("with no antiderivative the answer is numeric, with an error bound", () => {
		const outcome = definiteIntegral(callNode("exp", [powNode(x, constNode(2))]), "x", at(0), at(1));
		expect(outcome.kind).toBe("numeric");
		if (outcome.kind !== "numeric") return;
		expect(outcome.value).toBeCloseTo(1.4626517459071815, 12);
		expect(outcome.error).toBeLessThan(1e-9);
	});

	test("a removable 0/0 at a bound is filled rather than refused", () => {
		// Si(1), the sine integral at 1.
		const outcome = definiteIntegral(div(callNode("sin", [x]), x), "x", at(0), at(1));
		expect(outcome.kind).toBe("numeric");
		if (outcome.kind === "numeric") expect(outcome.value).toBeCloseTo(0.946083070367183, 12);
	});

	test("an infinite integrand at a bound is an improper integral", () => {
		expect(definiteIntegral(div(constNode(1), x), "x", at(0), at(1)).kind).toBe("improper");
	});

	test("equal bounds are zero, whatever the integrand", () => {
		const outcome = definiteIntegral(div(constNode(1), x), "x", at(0), at(0));
		expect(outcome.kind).toBe("exact");
		if (outcome.kind === "exact") expect(formatSymbolic(outcome.value)).toBe("0");
	});
});
