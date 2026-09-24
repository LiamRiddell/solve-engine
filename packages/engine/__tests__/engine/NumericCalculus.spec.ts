/**
 * Numeric solving, definite integrals and limits, through the real engine
 * (GitHub issue #516).
 *
 * The expected numbers are the textbook ones, computed here with JavaScript's
 * own functions: the root of `2^x = 10` is `Math.log2(10)`, the area under
 * `e^(-x^2)` is the square root of pi. Each answer must be one of those or a
 * named error; nothing in between.
 */
import { describe, expect, test } from "@jest/globals";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluates one line on a fresh engine. */
function evaluate(line: string): Value {
	const engine = newTrackedEngine();
	try {
		return engine.evaluateLine(1, line);
	} finally {
		engine.clear();
	}
}

/** The line's result as a number, failing when it is not one. */
function numberOf(line: string): number {
	const value = evaluate(line);
	if (value.type !== ValueType.Number && value.type !== ValueType.Symbolic) {
		throw new Error(`${line} gave ${ValueType[value.type]}: ${formatValue(value)}`);
	}
	return value.toNumber();
}

/** The line's error code, failing when it is not an error. */
function errorCodeOf(line: string): string {
	const value = evaluate(line);
	if (value.type !== ValueType.Error) throw new Error(`${line} gave ${formatValue(value)}, not an error`);
	return String(value.value);
}

/** The line's result as the reader sees it, without the display marker. */
function shown(line: string): string {
	return formatValue(evaluate(line)).replace(/^=\s*/, "");
}

describe("solve falls back to a numeric root", () => {
	test("the equations the exact algebra has no method for", () => {
		expect(numberOf("solve(cos(x) = x, x)")).toBeCloseTo(0.7390851332151607, 12);
		expect(numberOf("solve(2^x = 10, x)")).toBeCloseTo(Math.log2(10), 12);
		expect(numberOf("solve(e^x = 10, x)")).toBeCloseTo(Math.log(10), 12);
		expect(numberOf("solve(log(x) = 2, x)")).toBeCloseTo(Math.exp(2), 12);
	});

	test("reads as the ordinary rounded number, the way the other approximate roots do", () => {
		expect(shown("solve(cos(x) = x, x)")).toBe("0.74");
		expect(shown("solve(2^x = 10, x)")).toBe("3.32");
	});

	test("several roots are a row, ascending", () => {
		expect(shown("solve(exp(x) = x + 2, x)")).toBe("[-1.84, 1.15]");
	});

	test("a stated range searches there and nowhere else", () => {
		expect(shown("solve(sin(x) = 0.5, x, 0, 3)")).toBe("[0.52, 2.62]");
		expect(numberOf("solve(log(x) = 20, x, 0, 1e9)")).toBeCloseTo(Math.exp(20), 3);
	});

	test("a stated range keeps only the exact roots inside it", () => {
		expect(shown("solve(x^2 = 4, x, 0, 10)")).toBe("2");
		expect(shown("solve(x^2 - 2 = 0, x, 0, 2)")).toBe("sqrt(2)");
		// A polynomial's roots are all known, so none in the range is a true answer.
		expect(shown("solve(x^2 = 4, x, 5, 10)")).toBe("no solution between 5 and 10");
	});

	test("a root in another unknown cannot be placed in a range, and is not dropped", () => {
		// -b/a may or may not lie between 0 and 1; "no solution" would be a guess.
		expect(errorCodeOf("solve(a*x+b=0, x, 0, 1)")).toBe("SYMBOLIC_SOLVE_UNSUPPORTED");
	});

	test("a range ending at pi still finds the root at pi", () => {
		expect(shown("solve(sin(x) = 0, x, 0, pi)")).toBe("[0, 3.14]");
	});

	test("what the search cannot answer is a named error", () => {
		expect(errorCodeOf("solve(sin(x) = 0.5, x)")).toBe("SYMBOLIC_SOLVE_TOO_MANY_ROOTS");
		expect(errorCodeOf("solve(log(x) = 20, x)")).toBe("SYMBOLIC_SOLVE_NO_ROOT_FOUND");
		expect(errorCodeOf("solve(1/x = 0, x)")).toBe("SYMBOLIC_SOLVE_NO_ROOT_FOUND");
		expect(errorCodeOf("solve(cos(x) = a, x)")).toBe("SYMBOLIC_SOLVE_UNSUPPORTED");
	});

	test("finding nothing names the range and what the search cannot see", () => {
		const value = evaluate("solve(sin(x) = 2, x)");
		expect(formatValue(value)).toMatch(/between -1000000 and 1000000/);
		expect(formatValue(value)).toMatch(/only touch/);
	});

	test("a range must be two plain, different, finite numbers", () => {
		expect(errorCodeOf("solve(cos(x) = x, x, 0, 1 m)")).toBe("SYMBOLIC_BOUND_INVALID");
		expect(errorCodeOf("solve(cos(x) = x, x, 1, 1)")).toBe("SYMBOLIC_BOUND_INVALID");
		expect(() => evaluate("solve(cos(x) = x, x, 0)")).toThrow(/two numbers after the unknown/);
	});

	test("the named unknown shadows a document value of the same name", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, ":x = 5");
			expect(engine.evaluateLine(2, "solve(cos(x) = x, x)").toNumber()).toBeCloseTo(0.7390851332151607, 12);
		} finally {
			engine.clear();
		}
	});

	test("the stored-equation form reaches the same numeric search", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "2^x = 10");
			expect(engine.evaluateLine(2, "x =>").toNumber()).toBeCloseTo(Math.log2(10), 12);
		} finally {
			engine.clear();
		}
	});
});

describe("integral with bounds is the definite integral", () => {
	test("exact through the antiderivative", () => {
		expect(shown("integral(x^2, x, 0, 3)")).toBe("9");
		expect(evaluate("integral(x^2, x, 0, 3)").type).toBe(ValueType.Number);
		expect(shown("integral(x^2, x, 0, 1)")).toBe("1/3");
		// The bound 1/3 is a third, not the double nearest it.
		expect(shown("integral(x, x, 0, 1/3)")).toBe("1/18");
	});

	test("through the antiderivative where its values are irrational", () => {
		expect(numberOf("integral(sin(x), x, 0, pi)")).toBe(2);
		expect(numberOf("integral(cos(x), x, 0, pi)")).toBe(0);
		expect(numberOf("integral(cos(x), x, 0, 1)")).toBe(Math.sin(1));
	});

	test("numerically where there is no antiderivative", () => {
		expect(numberOf("integral(exp(x^2), x, 0, 1)")).toBeCloseTo(1.4626517459071815, 12);
		expect(numberOf("integral(exp(-(x^2)), x, -10, 10)")).toBeCloseTo(Math.sqrt(Math.PI), 12);
		expect(numberOf("integral(sin(x)/x, x, 0, 1)")).toBeCloseTo(0.946083070367183, 12);
	});

	test("reversed bounds reverse the sign", () => {
		expect(numberOf("integral(x^2, x, 3, 0)")).toBe(-9);
	});

	test("an improper or diverging integral is a named error, never a number", () => {
		expect(errorCodeOf("integral(1/x, x, 0, 1)")).toBe("SYMBOLIC_INTEGRAL_IMPROPER");
		expect(errorCodeOf("integral(1/x^2, x, -1, 1)")).toBe("SYMBOLIC_INTEGRAL_IMPROPER");
		expect(errorCodeOf("integral(x^2, x, 0, 1/0)")).toBe("SYMBOLIC_INTEGRAL_IMPROPER");
		expect(errorCodeOf("integral(tan(x), x, 0, 2)")).toBe("SYMBOLIC_INTEGRAL_UNSETTLED");
	});

	test("the improper point is named where the reader would write it", () => {
		expect(formatValue(evaluate("integral(1/x^2, x, -1, 1)"))).toMatch(/x = 0,/);
	});

	test("bounds must be plain numbers, and there must be two", () => {
		expect(errorCodeOf("integral(x^2, x, 0, 3 m)")).toBe("SYMBOLIC_BOUND_INVALID");
		expect(() => evaluate("integral(x^2, x, 0)")).toThrow(/two numbers after the unknown/);
	});

	test("the indefinite form is unchanged", () => {
		expect(shown("integral(x^2, x)")).toBe("1/3x^3");
	});
});

describe("limit", () => {
	test("the classic removable singularities", () => {
		expect(shown("limit(sin(x)/x, x, 0)")).toBe("1");
		expect(numberOf("limit((1-cos(x))/x^2, x, 0)")).toBeCloseTo(0.5, 8);
		expect(numberOf("limit((1+x)^(1/x), x, 0)")).toBeCloseTo(Math.E, 8);
		expect(numberOf("limit((exp(x)-1)/x, x, 0)")).toBe(1);
	});

	test("a rational function is exact", () => {
		expect(shown("limit((x^2-1)/(x-1), x, 1)")).toBe("2");
		expect(shown("limit(x, x, 1/3)")).toBe("1/3");
	});

	test("each way a limit can fail to exist is its own named error", () => {
		expect(errorCodeOf("limit(abs(x)/x, x, 0)")).toBe("SYMBOLIC_LIMIT_SIDES_DISAGREE");
		expect(errorCodeOf("limit(1/x^2, x, 0)")).toBe("SYMBOLIC_LIMIT_DIVERGES");
		expect(errorCodeOf("limit(sin(1/x), x, 0)")).toBe("SYMBOLIC_LIMIT_UNSETTLED");
		expect(errorCodeOf("limit(sqrt(-x^2-1), x, 0)")).toBe("SYMBOLIC_LIMIT_UNDEFINED");
		expect(errorCodeOf("limit(sin(x)/a, x, 0)")).toBe("SYMBOLIC_LIMIT_UNSUPPORTED");
	});

	test("disagreeing sides are both named", () => {
		expect(formatValue(evaluate("limit(abs(x)/x, x, 0)"))).toMatch(/from the left it approaches -1 and from the right 1/);
	});

	test("the point must be finite and present", () => {
		expect(errorCodeOf("limit(sin(x)/x, x, 1/0)")).toBe("SYMBOLIC_BOUND_INVALID");
		expect(() => evaluate("limit(sin(x)/x, x)")).toThrow(/point the unknown approaches/);
	});

	test("limit stays an ordinary word when it is not called", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "limit = 40");
			expect(engine.evaluateLine(2, "limit * 2").toNumber()).toBe(80);
		} finally {
			engine.clear();
		}
	});
});
