/**
 * Symbolic differentiation, integration and Taylor expansion.
 *
 * The differentiate-the-integral property test is the strongest check here:
 * whatever the integrator produces must differentiate back to what it was
 * given. That verifies the two independently-written modules against each other
 * rather than against a hand-written expectation that could be wrong in the
 * same way twice.
 */
import { describe, expect, test } from "@jest/globals";
import { differentiate, functionDerivative, DERIVATIVE_MAX_ORDER } from "@solve-js/symbolic/Derivative";
import { integrate } from "@solve-js/symbolic/Integral";
import { taylorSeries, jacobian, TAYLOR_MAX_DEGREE } from "@solve-js/symbolic/Taylor";
import { simplifySymbolic, formatSymbolic, symbolicKey, constNode, varNode, callNode, powNode, type SymbolicNode } from "@solve-js/symbolic";
import { RATIONAL_ZERO } from "@solve-js/symbolic/Rational";
import { poly, evaluateNumerically } from "@tools/symbolicTestUtils";

/** Numerically evaluates an expression with `x` bound to a value. */
function evaluateAt(node: SymbolicNode, value: number): number {
	return evaluateNumerically(node, { x: value });
}

/** Applies a named function numerically, for comparing the derivative table against finite differences. */
function applyNamed(name: string, value: number): number {
	return evaluateNumerically(callNode(name, [varNode("t")]), { t: value });
}

/** Differentiates and renders. */
function der(node: SymbolicNode, order = 1): string {
	return formatSymbolic(differentiate(node, "x", order));
}

const x = varNode("x");

/** `x^n` as a node. */
function pow(n: number): SymbolicNode {
	return powNode(x, constNode(n));
}

describe("differentiate — the rules", () => {
	test("a constant differentiates to zero", () => {
		expect(der(constNode(7))).toBe("0");
	});

	test("the variable itself differentiates to one, another variable to zero", () => {
		expect(der(x)).toBe("1");
		expect(der(varNode("y"))).toBe("0");
	});

	test("power rule", () => {
		expect(der(pow(3))).toBe("3x^2");
	});

	test("sum rule", () => {
		// x^3 + x
		expect(der({ kind: "add", left: pow(3), right: x })).toBe("3x^2+1");
	});

	test("product rule", () => {
		// x * x, whose derivative is 2x
		expect(der({ kind: "mul", left: x, right: x })).toBe("2x");
	});

	test("quotient rule", () => {
		// d/dx (1/x) = -1/x^2
		const result = differentiate({ kind: "div", left: constNode(1), right: x }, "x");
		// Rendered shape can vary; check it agrees numerically with -1/x^2 at a point.
		expect(evaluateAt(result, 2)).toBeCloseTo(-0.25, 12);
	});

	test("second and third derivatives", () => {
		expect(der(pow(3), 2)).toBe("6x");
		expect(der(pow(3), 3)).toBe("6");
	});

	test("chain rule through a function", () => {
		// d/dx sin(x^2) = cos(x^2) * 2x
		const result = differentiate(callNode("sin", [pow(2)]), "x");
		expect(evaluateAt(result, 1)).toBeCloseTo(Math.cos(1) * 2, 12);
	});

	test("the chain rule composed twice", () => {
		// d/dx sin(exp(x)) = cos(exp(x)) * exp(x)
		const result = differentiate(callNode("sin", [callNode("exp", [x])]), "x");
		expect(evaluateAt(result, 0.5)).toBeCloseTo(Math.cos(Math.exp(0.5)) * Math.exp(0.5), 12);
	});

	test("an order beyond the ceiling is refused", () => {
		expect(() => differentiate(pow(2), "x", DERIVATIVE_MAX_ORDER + 1)).toThrow(/order/i);
	});

	test("an unknown function is left as an unevaluated der call rather than guessed", () => {
		const result = differentiate(callNode("mystery", [x]), "x");
		expect(formatSymbolic(result)).toMatch(/^der\(/);
	});
});

describe("functionDerivative — the table", () => {
	const cases: [string, number][] = [
		["sin", 0.7], ["cos", 0.7], ["tan", 0.7], ["exp", 0.7], ["log", 1.7],
		["sqrt", 1.7], ["asin", 0.4], ["acos", 0.4], ["atan", 0.4],
		["sinh", 0.4], ["cosh", 0.4], ["tanh", 0.4],
	];

	test.each(cases)("%s matches a numerical derivative", (name, at) => {
		const symbolic = differentiate(callNode(name, [x]), "x");
		const h = 1e-6;
		const f = (v: number): number => applyNamed(name, v);
		const numerical = (f(at + h) - f(at - h)) / (2 * h);
		expect(evaluateAt(symbolic, at)).toBeCloseTo(numerical, 5);
	});

	test("an unknown name reports null rather than a guess", () => {
		expect(functionDerivative("mystery", x)).toBeNull();
	});
});

describe("integrate — what it can do", () => {
	test("the power rule, term by term", () => {
		expect(formatSymbolic(expectOk(integrate(pow(2), "x")))).toBe("1/3x^3");
	});

	test("a polynomial", () => {
		// 3x^2 + 2x + 1 integrates to x^3 + x^2 + x
		const node: SymbolicNode = {
			kind: "add",
			left: { kind: "add", left: { kind: "mul", left: constNode(3), right: pow(2) }, right: { kind: "mul", left: constNode(2), right: x } },
			right: constNode(1),
		};
		expect(formatSymbolic(expectOk(integrate(node, "x")))).toBe("x^3+x^2+x");
	});

	test("a constant", () => {
		expect(formatSymbolic(expectOk(integrate(constNode(5), "x")))).toBe("5x");
	});

	test("standard forms with a linear argument", () => {
		expect(formatSymbolic(expectOk(integrate(callNode("exp", [x]), "x")))).toBe("exp(x)");
		expect(formatSymbolic(expectOk(integrate(callNode("cos", [x]), "x")))).toBe("sin(x)");
		// integral sin(2x) dx = -cos(2x)/2
		const inner: SymbolicNode = { kind: "mul", left: constNode(2), right: x };
		expect(evaluateAt(expectOk(integrate(callNode("sin", [inner]), "x")), 1)).toBeCloseTo(-Math.cos(2) / 2, 12);
	});

	test("one over x becomes a logarithm", () => {
		expect(formatSymbolic(expectOk(integrate({ kind: "div", left: constNode(1), right: x }, "x")))).toBe("log(x)");
	});

	test("one over one plus x squared becomes an arctangent", () => {
		const denominator: SymbolicNode = { kind: "add", left: constNode(1), right: pow(2) };
		expect(formatSymbolic(expectOk(integrate({ kind: "div", left: constNode(1), right: denominator }, "x")))).toBe("atan(x)");
	});
});

describe("integrate — what it correctly refuses to do", () => {
	test("exp(x^2) has no elementary antiderivative, and that is reported", () => {
		const result = integrate(callNode("exp", [pow(2)]), "x");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/elementary antiderivative/i);
	});

	test("sin(x)/x likewise", () => {
		const result = integrate({ kind: "div", left: callNode("sin", [x]), right: x }, "x");
		expect(result.ok).toBe(false);
	});
});

describe("integrate — differentiating the result returns the input", () => {
	test("over generated polynomials", () => {
		let seed = 20260804;
		const nextInt = (span: number): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return (seed % (2 * span + 1)) - span;
		};

		for (let iteration = 0; iteration < 200; iteration++) {
			const degree = iteration % 5;
			let node: SymbolicNode = constNode(RATIONAL_ZERO);
			for (let power = 0; power <= degree; power++) {
				const coeff = nextInt(6);
				if (coeff === 0) continue;
				const term: SymbolicNode = power === 0
					? constNode(coeff)
					: { kind: "mul", left: constNode(coeff), right: power === 1 ? x : pow(power) };
				node = { kind: "add", left: node, right: term };
			}
			const original = simplifySymbolic(node);
			const integrated = integrate(original, "x");
			if (!integrated.ok) throw new Error("a polynomial should always integrate");
			expect(symbolicKey(differentiate(integrated.value, "x"))).toBe(symbolicKey(original));
		}
	});
});

describe("taylorSeries", () => {
	test("exp about zero, to degree four", () => {
		expect(formatSymbolic(taylorSeries(callNode("exp", [x]), "x", RATIONAL_ZERO, 4)))
			.toBe("1/24x^4+1/6x^3+0.5x^2+x+1");
	});

	test("sin about zero has only odd powers", () => {
		expect(formatSymbolic(taylorSeries(callNode("sin", [x]), "x", RATIONAL_ZERO, 5)))
			.toBe("1/120x^5-1/6x^3+x");
	});

	test("a polynomial's series at its own degree is the polynomial", () => {
		const node = simplifySymbolic({ kind: "add", left: pow(2), right: constNode(3) });
		expect(symbolicKey(taylorSeries(node, "x", RATIONAL_ZERO, 2))).toBe(symbolicKey(node));
	});

	test("a degree beyond the ceiling is refused", () => {
		expect(() => taylorSeries(callNode("exp", [x]), "x", RATIONAL_ZERO, TAYLOR_MAX_DEGREE + 1)).toThrow(/degree/i);
	});
});

describe("jacobian", () => {
	test("each row is one function's gradient", () => {
		const rows = jacobian([{ kind: "mul", left: x, right: varNode("y") }, { kind: "add", left: x, right: varNode("y") }], ["x", "y"]);
		expect(rows.map(row => row.map(formatSymbolic))).toEqual([["y", "x"], ["1", "1"]]);
	});
});

/** Unwraps a successful integral, failing the test with the reason otherwise. */
function expectOk(result: ReturnType<typeof integrate>): SymbolicNode {
	if (!result.ok) throw new Error(`expected an integral, got: ${result.reason}`);
	return result.value;
}


