/**
 * The stored scalar-equation form: writing `x^2-4 = 0` on one line, then asking
 * for `x =>` on a later one.
 *
 * A bare `=` is already claimed by three shipped grammars, so most of this file
 * is not about the new feature at all. It is about proving the new pattern
 * match does not swallow a user-defined function definition, a bare assignment,
 * a colon-prefixed assignment, or the matrix product-chain equation. Those
 * non-regression tests are the point; the feature itself is the easy half.
 */
import { describe, expect, test } from "@jest/globals";
import { ValueType, type MatrixData } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Runs a document line by line and returns each formatted result. */
function run(lines: string[]): string[] {
	const engine = newTrackedEngine();
	try {
		return lines.map((line, i) => formatValue(engine.evaluateLine(i + 1, line)));
	} finally {
		engine.clear();
	}
}

/** The formatted result of the last line. */
function last(lines: string[]): string {
	const results = run(lines);
	return results[results.length - 1];
}

describe("storing a scalar equation, then solving it", () => {
	test("a quadratic", () => {
		expect(last(["x^2-4 = 0", "x =>"])).toBe("= [-2, 2]");
	});

	test("a linear equation", () => {
		expect(last(["2x+6 = 0", "x =>"])).toBe("= -3");
	});

	test("with a non-zero right-hand side", () => {
		expect(last(["x^2 = 9", "x =>"])).toBe("= [-3, 3]");
	});

	test("an unknown on both sides", () => {
		// 2x + 1 = x + 4  ->  x = 3
		expect(last(["2x+1 = x+4", "x =>"])).toBe("= 3");
	});

	test("storing reports what it did rather than looking like a result", () => {
		expect(run(["x^2-4 = 0"])[0]).toMatch(/stored as an equation/);
	});

	test("an irrational root keeps its exact form", () => {
		expect(last(["x^2-2 = 0", "x =>"])).toBe("= [-sqrt(2), sqrt(2)]");
	});

	test("a quadratic with complex roots returns them", () => {
		expect(last(["x^2+1 = 0", "x =>"])).toBe("= [-i, i]");
	});

	test("redefining the equation replaces it", () => {
		expect(last(["x^2-4 = 0", "x^2-9 = 0", "x =>"])).toBe("= [-3, 3]");
	});

	test("an equation reads through to the same answer as solve()", () => {
		const stored = last(["x^2-5x+6 = 0", "x =>"]);
		const direct = last(["solve(x^2-5x+6=0, x)"]);
		expect(stored).toBe(direct);
	});
});

describe("what the scalar-equation match must NOT swallow", () => {
	test("a user-defined function definition still defines a function", () => {
		// The most important case. `f(x) = 2*x` reaches the same code path,
		// because parseFactorChain declines it too, so without the LPAREN guard
		// this grammar would intercept it before the parser ever saw it.
		expect(last(["f(x) = 2*x", "f(5)"])).toBe("= 10");
	});

	test("a multi-parameter function definition likewise", () => {
		expect(last(["g(a, b) = a*b", "g(3, 4)"])).toBe("= 12");
	});

	test("a bare matrix assignment still assigns", () => {
		expect(last(["a = [1, 2; 3, 4]", "a[0,0] + a[1,1]"])).toBe("= 5");
	});

	test("a bare scalar assignment still assigns", () => {
		expect(last(["n = 7", "n + 1"])).toBe("= 8");
	});

	test("a colon-prefixed assignment still assigns", () => {
		expect(last([":y = 5", ":y + 1"])).toBe("= 6");
	});

	test("the matrix product-chain equation still solves through its own path", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "a = [1, 2; 3, 4]");
			engine.evaluateLine(2, "a*x = [60; 70]");
			const result = engine.evaluateLine(3, "x =>");
			expect(result.type).toBe(ValueType.Matrix);
			const matrix = result.value as MatrixData;
			expect(matrix.rows).toBe(2);
		} finally {
			engine.clear();
		}
	});

	test("an equation with no unknown is left alone, as it was before", () => {
		// `2+2 = 4` was the ordinary "unexpected token" parse error and stays
		// one. Turning it into an identity would change an unrelated line's
		// behaviour, which is not this feature's business.
		const engine = newTrackedEngine();
		try {
			expect(() => engine.evaluateLine(1, "2+2 = 4")).toThrow(/Unexpected token/);
		} finally {
			engine.clear();
		}
	});

	test("an already-assigned name is not treated as the unknown", () => {
		// `y` has a value, so only `x` is unknown and the equation solves for it.
		expect(last([":y = 2", "x+y = 5", "x =>"])).toBe("= 3");
	});

	test("two unknowns decline rather than guessing which to solve for", () => {
		// Declining means falling through to the pre-existing parse error, not
		// picking one of the two names arbitrarily. `solve(x+y=5, x)` remains
		// the way to say which unknown is meant.
		const engine = newTrackedEngine();
		try {
			expect(() => engine.evaluateLine(1, "x+y = 5")).toThrow(/Unexpected token/);
		} finally {
			engine.clear();
		}
	});

	test("an equality comparison is untouched, since == is a different token", () => {
		expect(last(["1 == 1"])).toBe("= true");
	});

	test("a plain expression with no equals sign is untouched", () => {
		expect(last(["2 + 3"])).toBe("= 5");
	});
});

describe("the matrix and scalar equation kinds coexist", () => {
	test("both can be stored at once, each solving through its own machinery", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "a = [1, 2; 3, 4]");
			engine.evaluateLine(2, "a*m = [60; 70]");
			engine.evaluateLine(3, "s^2-9 = 0");

			const matrixResult = engine.evaluateLine(4, "m =>");
			expect(matrixResult.type).toBe(ValueType.Matrix);

			const scalarResult = engine.evaluateLine(5, "s =>");
			expect(formatValue(scalarResult)).toBe("= [-3, 3]");
		} finally {
			engine.clear();
		}
	});

	test("a name with no equation of either kind still just simplifies", () => {
		expect(last(["q =>"])).toBe("q");
	});

	test("a product chain of plain numbers falls back to the scalar solver", () => {
		// `a*n = 10` matches the matrix product-chain shape on sight, because
		// whether `a` is a matrix is only knowable at solve time. When it turns
		// out to be an ordinary number this must still have an answer rather
		// than reporting "must be a Matrix".
		expect(last([":a = 2", "a*n = 10", "n =>"])).toBe("= 5");
	});

	test("the matrix path still wins when the factors really are matrices", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "a = [1, 2; 3, 4]");
			engine.evaluateLine(2, "a*x = [60; 70]");
			const result = engine.evaluateLine(3, "x =>");
			// A scalar fallback would have produced a number or a string here.
			expect(result.type).toBe(ValueType.Matrix);
		} finally {
			engine.clear();
		}
	});

	test("a genuinely missing factor still reports that, rather than falling through", () => {
		// EQUATION_FACTOR_UNDEFINED is not the not-a-matrix case, so the
		// fallback must not swallow it into a vaguer message.
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "undefinedFactor*z = [1; 2]");
			const result = engine.evaluateLine(2, "z =>");
			expect(result.type).toBe(ValueType.Error);
			expect(String(result.value)).toBe("EQUATION_FACTOR_UNDEFINED");
		} finally {
			engine.clear();
		}
	});
});
