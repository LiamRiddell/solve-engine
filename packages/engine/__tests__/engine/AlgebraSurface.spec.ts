/**
 * The algebra and calculus verbs exercised through the real engine.
 *
 * `SymbolicSurfaceParity.spec.ts` checks the wiring of each verb listed in
 * `SYMBOLIC_FUNCTIONS`. This file covers what that table cannot: the spelling
 * alias that shares an entry, the error paths, and the composition of verbs with
 * the rest of the language.
 */
import { describe, expect, test } from "@jest/globals";
import { ValueType } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluates one line on a fresh engine and formats the result. */
function evaluate(line: string): string {
	const engine = newTrackedEngine("en");
	try {
		return formatValue(engine.evaluateLine(1, line)[0]);
	} finally {
		engine.clear();
	}
}

/** Evaluates one line and returns its raw Value, for inspecting error codes. */
function rawValue(line: string) {
	const engine = newTrackedEngine("en");
	try {
		return engine.evaluateLine(1, line)[0];
	} finally {
		engine.clear();
	}
}

describe("spelling aliases", () => {
	test("derivative is the same function as der", () => {
		// `derivative` shares der's builtin index, so it has no row of its own in
		// SYMBOLIC_FUNCTIONS and would otherwise go unchecked.
		expect(evaluate("derivative(x^3, x)")).toBe(evaluate("der(x^3, x)"));
		expect(evaluate("derivative(x^3, x)")).toBe("3x^2");
	});

	test("derivative accepts the optional order argument too", () => {
		expect(evaluate("derivative(x^3, x, 2)")).toBe("6x");
	});

	test("derivative also stays usable as an ordinary variable name", () => {
		const engine = newTrackedEngine("en");
		try {
			expect(engine.evaluateLine(1, ":derivative = 2.5")[0].toNumber()).toBe(2.5);
			expect(engine.evaluateLine(2, ":derivative * 2")[0].toNumber()).toBe(5);
		} finally {
			engine.clear();
		}
	});
});

describe("verbs compose with the rest of the language", () => {
	test("a verb's argument may itself contain an unknown and an exponent", () => {
		expect(evaluate("expand((x-1)*(x+1)*(x+2))")).toBe("x^3+2x^2-x-2");
	});

	test("factoring pulls out a common monomial and both linear factors", () => {
		expect(evaluate("factor(2x^3-2x)")).toBe("2x*(x-1)*(x+1)");
	});

	test("a cubic with three rational roots solves exactly", () => {
		expect(evaluate("solve(x^3-6x^2+11x-6=0, x)")).toBe("= [1, 2, 3]");
	});

	test("a Taylor series of cos has only even powers", () => {
		expect(evaluate("taylor(cos(x), x=0, 4)")).toBe("1/24x^4-0.5x^2+1");
	});

	test("a verb applied to a concrete value still evaluates numerically", () => {
		expect(evaluate("expand(2+3)")).toBe("= 5");
		expect(evaluate("factor(12)")).toBe("= 12");
	});
});

describe("error paths report rather than guess", () => {
	test("integrating something with no elementary antiderivative", () => {
		const value = rawValue("integral(exp(x^2), x)");
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe("SYMBOLIC_INTEGRAL_UNSUPPORTED");
	});

	test("solving a non-polynomial equation", () => {
		const value = rawValue("solve(sin(x)=0, x)");
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe("SYMBOLIC_SOLVE_UNSUPPORTED");
	});

	test("a derivative order beyond the ceiling", () => {
		expect(() => rawValue("der(x^2, x, 99)")).toThrow(/order/i);
	});

	test("a Taylor degree beyond the ceiling", () => {
		expect(() => rawValue("taylor(exp(x), x=0, 99)")).toThrow(/degree/i);
	});

	test("solve's second argument must be a bare name", () => {
		expect(() => rawValue("solve(x^2-4=0, 5)")).toThrow(/name of the unknown/i);
	});

	test("der's second argument must be a bare name", () => {
		expect(() => rawValue("der(x^2, 5)")).toThrow(/name of an unknown/i);
	});

	test("jacobian with no unknown to differentiate against", () => {
		const value = rawValue("jacobian(2+2)");
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe("SYMBOLIC_JACOBIAN_NO_VARIABLES");
	});

	test("a builtin with no symbolic reading, applied to an unknown", () => {
		const value = rawValue("random(x) =>");
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe("SYMBOLIC_UNSUPPORTED_FUNCTION");
	});
});

describe("documented limitations behave as documented", () => {
	test("irreducible over the rationals comes back unchanged", () => {
		expect(evaluate("factor(x^2-2)")).toBe("x^2-2");
		expect(evaluate("factor(x^2+1)")).toBe("x^2+1");
	});

	test("a negative discriminant returns the complex pair", () => {
		expect(evaluate("solve(x^2+1=0, x)")).toBe("= [-i, i]");
	});

	test("multivariate factoring stops after the shared parts", () => {
		// Not `(x+y)^2`. Beyond content and common-monomial extraction this does
		// not attempt multivariate factoring, and says so rather than guessing.
		expect(evaluate("factor(x^2+2x*y+y^2)")).toBe("x^2+2x*y+y^2");
	});

	test("a rational function is left alone by expand", () => {
		expect(evaluate("expand(x/y + 1)")).toBe("x/y+1");
	});
});
