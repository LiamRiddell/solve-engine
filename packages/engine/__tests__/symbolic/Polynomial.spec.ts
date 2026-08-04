/**
 * The canonical polynomial form.
 *
 * Most of this file is about `toPolynomial` returning `null`. A wrong
 * polynomial is far worse than no polynomial, because the caller silently gets
 * an answer to a different question, so every case outside the representation
 * has to decline rather than approximate. The `null` for `vx/sx` in particular
 * is load-bearing: it is what makes the simplifier fall back to its tree walk
 * and keeps symbolic matrix inverses rendering as they always have.
 */
import { describe, expect, test } from "@jest/globals";
import {
	toPolynomial,
	fromPolynomial,
	expandSymbolic,
	polyDegree,
	polyUnivariateVar,
	polyCoefficients,
	POLYNOMIAL_MAX_DEGREE,
	EXPAND_MAX_POW_EXPONENT,
} from "@solve-js/symbolic/Polynomial";
import { simplifySymbolic, formatSymbolic, symbolicKey, constNode, varNode, powNode, callNode, type SymbolicNode } from "@solve-js/symbolic";
import { rational } from "@solve-js/symbolic/Rational";

const x = varNode("x");
const y = varNode("y");

/** Builds `a op b`. */
function op(kind: "add" | "sub" | "mul" | "div", left: SymbolicNode, right: SymbolicNode): SymbolicNode {
	return { kind, left, right };
}

describe("toPolynomial — what converts", () => {
	test("a constant, a variable, and a sum", () => {
		expect(toPolynomial(constNode(5))!.terms.get("")).toEqual(rational(5n));
		expect(toPolynomial(x)!.terms.get("x")).toEqual(rational(1n));
		expect(toPolynomial(op("add", x, constNode(1)))!.terms.size).toBe(2);
	});

	test("division by a non-zero constant scales the coefficients", () => {
		const p = toPolynomial(op("div", x, constNode(3)))!;
		expect(p.terms.get("x")).toEqual(rational(1n, 3n));
	});

	test("a product of sums, and a power of a sum", () => {
		const product = op("mul", op("add", x, constNode(1)), op("add", x, constNode(2)));
		expect(formatSymbolic(fromPolynomial(toPolynomial(product)!))).toBe("x^2+3x+2");
		expect(formatSymbolic(fromPolynomial(toPolynomial(powNode(op("add", x, constNode(1)), constNode(2)))!))).toBe("x^2+2x+1");
	});

	test("several variables", () => {
		const p = toPolynomial(op("mul", op("add", x, y), op("sub", x, y)))!;
		expect(formatSymbolic(fromPolynomial(p))).toBe("x^2-y^2");
		expect(p.vars).toEqual(["x", "y"]);
	});
});

describe("toPolynomial — what correctly declines", () => {
	test("a non-constant denominator, which is a rational function rather than a polynomial", () => {
		expect(toPolynomial(op("div", varNode("vx"), varNode("sx")))).toBeNull();
	});

	test("division by zero", () => {
		expect(toPolynomial(op("div", x, constNode(0)))).toBeNull();
	});

	test("a symbolic exponent", () => {
		expect(toPolynomial(powNode(x, y))).toBeNull();
	});

	test("a fractional exponent", () => {
		expect(toPolynomial(powNode(x, constNode(rational(1n, 2n))))).toBeNull();
	});

	test("any function call", () => {
		expect(toPolynomial(callNode("sin", [x]))).toBeNull();
		expect(toPolynomial(op("add", callNode("sqrt", [x]), constNode(1)))).toBeNull();
	});

	test("past the exponent ceiling", () => {
		expect(toPolynomial(powNode(op("add", x, constNode(1)), constNode(EXPAND_MAX_POW_EXPONENT + 1)))).toBeNull();
	});

	test("past the degree ceiling", () => {
		expect(toPolynomial(powNode(x, constNode(POLYNOMIAL_MAX_DEGREE + 1)))).toBeNull();
	});
});

describe("toPolynomial — the no-distribution mode the simplifier uses", () => {
	test("a product of single terms still converts, which is what collecting like terms needs", () => {
		expect(toPolynomial(op("mul", constNode(2), varNode("b")), false)).not.toBeNull();
		expect(toPolynomial(op("mul", x, y), false)).not.toBeNull();
	});

	test("a product reaching into a sum declines, because distributing it is expansion", () => {
		expect(toPolynomial(op("mul", op("add", x, constNode(1)), op("add", x, constNode(2))), false)).toBeNull();
		expect(toPolynomial(op("mul", constNode(2), op("add", x, constNode(1))), false)).toBeNull();
	});

	test("a power of a sum declines for the same reason", () => {
		expect(toPolynomial(powNode(op("add", x, constNode(1)), constNode(2)), false)).toBeNull();
	});

	test("a power of a single term still converts", () => {
		expect(toPolynomial(powNode(x, constNode(3)), false)).not.toBeNull();
	});
});

describe("fromPolynomial — canonical, deterministic output", () => {
	test("terms come out in descending degree", () => {
		const p = toPolynomial(op("add", op("add", constNode(2), op("mul", constNode(3), x)), powNode(x, constNode(2))))!;
		expect(formatSymbolic(fromPolynomial(p))).toBe("x^2+3x+2");
	});

	test("a multivariate tie orders by exponent vector, not by key text", () => {
		// `x*y` and `x^2` are both degree two. Sorting the key strings would put
		// `x*y` first, since `*` sorts before `^` in character order.
		expect(formatSymbolic(expandSymbolic(powNode(op("add", x, y), constNode(2))))).toBe("x^2+2x*y+y^2");
	});

	test("two equal polynomials written differently render identically", () => {
		const a = expandSymbolic(op("mul", op("add", x, constNode(1)), op("add", x, constNode(2))));
		const b = expandSymbolic(op("add", op("add", powNode(x, constNode(2)), op("mul", constNode(3), x)), constNode(2)));
		expect(symbolicKey(a)).toBe(symbolicKey(b));
	});

	test("the zero polynomial is the constant zero", () => {
		expect(formatSymbolic(fromPolynomial(toPolynomial(op("sub", x, x))!))).toBe("0");
	});

	test("a round trip through the polynomial form preserves value", () => {
		const original = op("add", op("mul", constNode(3), powNode(x, constNode(2))), constNode(-4));
		const roundTripped = fromPolynomial(toPolynomial(original)!);
		expect(symbolicKey(simplifySymbolic(roundTripped))).toBe(symbolicKey(simplifySymbolic(original)));
	});
});

describe("the polynomial accessors", () => {
	test("degree, overall and per variable", () => {
		const p = toPolynomial(op("add", powNode(x, constNode(3)), op("mul", powNode(y, constNode(2)), x)))!;
		expect(polyDegree(p)).toBe(3);
		expect(polyDegree(p, "x")).toBe(3);
		expect(polyDegree(p, "y")).toBe(2);
	});

	test("the univariate variable, or null when there is not exactly one", () => {
		expect(polyUnivariateVar(toPolynomial(op("add", x, constNode(1)))!)).toBe("x");
		expect(polyUnivariateVar(toPolynomial(op("add", x, y))!)).toBeNull();
		expect(polyUnivariateVar(toPolynomial(constNode(5))!)).toBeNull();
	});

	test("dense ascending coefficients, with explicit zeros for absent powers", () => {
		// x^3 - 4 has no x^2 or x term.
		const p = toPolynomial(op("sub", powNode(x, constNode(3)), constNode(4)))!;
		expect(polyCoefficients(p, "x").map(c => `${c.n}/${c.d}`)).toEqual(["-4/1", "0/1", "0/1", "1/1"]);
	});
});

describe("expandSymbolic", () => {
	test("multiplies out", () => {
		expect(formatSymbolic(expandSymbolic(powNode(op("add", x, constNode(1)), constNode(3))))).toBe("x^3+3x^2+3x+1");
	});

	test("returns a non-polynomial unchanged rather than erroring", () => {
		const node = callNode("sin", [x]);
		expect(symbolicKey(expandSymbolic(node))).toBe(symbolicKey(node));
	});

	test("returns a rational function unchanged", () => {
		const node = op("add", op("div", x, y), constNode(1));
		expect(symbolicKey(expandSymbolic(node))).toBe(symbolicKey(node));
	});
});
