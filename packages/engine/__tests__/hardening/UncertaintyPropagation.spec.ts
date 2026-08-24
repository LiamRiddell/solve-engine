/**
 * A measurement can carry a tolerance, and the tolerance travels through the
 * arithmetic instead of being tracked by hand on a second line.
 *
 * `12.3 ± 0.5` (or the ASCII `12.3 +/- 0.5`, since the symbol is awkward to
 * type) is the number 12.3 carrying a one-sigma uncertainty of 0.5. `+`, `-`,
 * `*` and `/` propagate it for independent errors combined in quadrature, the
 * common case: `(12.3 ± 0.5) * 4` is `49.2 ± 2.0` and `(10 ± 1) + (20 ± 2)` is
 * `30 ± 2.24`. A plain number is treated as an exact operand (uncertainty 0), so
 * a scalar multiply scales the spread by the factor.
 *
 * The boundary is deliberate and asserted at the bottom. Uncertainty is a
 * sidecar on a Number, so a value with no tolerance behaves exactly as a plain
 * number always did, and everything other than the four arithmetic ops (a
 * comparison, a transcendental function) reads the center and drops the
 * tolerance. Correlated errors are a much larger problem and out of scope.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/** The formatted, user-facing result of a single expression. */
function display(expr: string): string {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const value = engine.evaluateExpression(expr);
	return formatValue(value);
}

/** The evaluated Value, for asserting its center and uncertainty sidecar directly. */
function evaluate(expr: string) {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const value = engine.evaluateExpression(expr);
	return value;
}

describe("the headline cases propagate as documented", () => {
	test("a measurement shows its tolerance", () => {
		expect(display("12.3 +/- 0.5")).toBe("= 12.3 ± 0.5");
	});

	test("a scalar multiply scales the spread by the factor", () => {
		// sigma = 0.5 * 4 = 2.0, center = 49.2.
		expect(display("(12.3 +/- 0.5) * 4")).toBe("= 49.2 ± 2.0");
	});

	test("a sum combines the spreads in quadrature", () => {
		// sigma = sqrt(1^2 + 2^2) = sqrt(5) = 2.2360679..., shown to 2 dp.
		expect(display("(10 +/- 1) + (20 +/- 2)")).toBe("= 30 ± 2.24");
	});
});

describe("both spellings parse to the same value", () => {
	test.each<[string, string]>([
		["12.3 +/- 0.5", "12.3 ± 0.5"],
		["(12.3 +/- 0.5) * 4", "(12.3 ± 0.5) * 4"],
		["(10 +/- 1) + (20 +/- 2)", "(10 ± 1) + (20 ± 2)"],
	])("%s and %s agree", (ascii, symbol) => {
		expect(display(ascii)).toBe(display(symbol));
	});

	test("the ASCII form is not a division", () => {
		// `+/-` is fused before parsing; without that fusion `10 +/- 5` would be a
		// parse error (`/` has no prefix reading), never a value.
		expect(evaluate("10 +/- 5").uncertainty).toBe(5);
	});
});

describe("the quadrature values are exactly the propagation rules", () => {
	test("add: sigma = sqrt(sa^2 + sb^2)", () => {
		const v = evaluate("(10 +/- 1) + (20 +/- 2)");
		expect(v.toNumber()).toBe(30);
		expect(v.uncertainty).toBeCloseTo(Math.sqrt(5), 12);
	});

	test("sub: the difference combines spreads the same way a sum does", () => {
		const v = evaluate("(10 +/- 1) - (20 +/- 2)");
		expect(v.toNumber()).toBe(-10);
		expect(v.uncertainty).toBeCloseTo(Math.sqrt(5), 12);
	});

	test("mul: sigma = |result| * sqrt((sa/a)^2 + (sb/b)^2)", () => {
		const v = evaluate("(4 +/- 0.1) * (5 +/- 0.2)");
		// center 20; relative errors 0.025 and 0.04 combine to sigma ~= 0.9434.
		expect(v.toNumber()).toBe(20);
		expect(v.uncertainty).toBeCloseTo(Math.hypot(5 * 0.1, 4 * 0.2), 12);
	});

	test("scalar multiply: sigma = s * |k|, both operand orders", () => {
		expect(evaluate("(12.3 +/- 0.5) * 4").uncertainty).toBeCloseTo(2, 12);
		expect(evaluate("4 * (12.3 +/- 0.5)").uncertainty).toBeCloseTo(2, 12);
		expect(display("4 * (12.3 +/- 0.5)")).toBe("= 49.2 ± 2.0");
	});

	test("div: sigma follows the relative-error rule", () => {
		const v = evaluate("(10 +/- 1) / (20 +/- 2)");
		expect(v.toNumber()).toBeCloseTo(0.5, 12);
		// |0.5| * sqrt((1/10)^2 + (2/20)^2) = 0.5 * sqrt(0.02) ~= 0.0707.
		expect(v.uncertainty).toBeCloseTo(0.5 * Math.hypot(1 / 10, 2 / 20), 12);
	});

	test("a plain number is treated as zero-uncertainty on either side", () => {
		expect(evaluate("(10 +/- 1) + 5").toNumber()).toBe(15);
		expect(evaluate("(10 +/- 1) + 5").uncertainty).toBe(1);
		expect(evaluate("5 + (10 +/- 1)").uncertainty).toBe(1);
	});

	test("a negative spread is read as its magnitude", () => {
		expect(evaluate("5 +/- -2").uncertainty).toBe(2);
	});
});

describe("the tolerance travels across a stored variable", () => {
	test("a measurement assigned to a variable still propagates", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		engine.evaluateLine(1, ":a = 12.3 +/- 0.5");
		const value = engine.evaluateLine(2, "a * 4");
		expect(formatValue(value)).toBe("= 49.2 ± 2.0");
	});
});

describe("everything other than + - * / reads the center and drops the tolerance", () => {
	test("a comparison compares the centers", () => {
		expect(evaluate("(10 +/- 1) < (20 +/- 5)").value).toBe(true);
		expect(evaluate("(10 +/- 1) == 10").value).toBe(true);
	});

	test("a transcendental function drops the uncertainty", () => {
		const v = evaluate("sqrt(16 +/- 1)");
		expect(v.toNumber()).toBe(4);
		expect(v.uncertainty).toBeUndefined();
	});
});

describe("what must keep working: a value with no tolerance is a plain number", () => {
	test.each<[string, string]>([
		["2 + 2", "= 4"],
		["2 + 2 * 10", "= 22"],
		["0.1 + 0.2", "= 0.30"],
		["1/3 + 1/3 + 1/3", "= 1"],
		["10 / 4", "= 2.50"],
		["$0.10 + $0.20", "= $0.30"],
		["2^10", "= 1,024"],
	])("%s is still %s", (expr, expected) => {
		expect(display(expr)).toBe(expected);
	});

	test("a plain double keeps its full underlying precision, only the display rounds", () => {
		// The 2-dp display is unchanged; the value itself is the usual double.
		expect(evaluate("0.1 + 0.2").toNumber()).toBe(0.30000000000000004);
	});

	test("no plain result grows an uncertainty sidecar", () => {
		for (const expr of ["2 + 2", "0.1 + 0.2", "1/3 + 1/3", "10 / 4", "sqrt(2)"]) {
			expect(evaluate(expr).uncertainty).toBeUndefined();
		}
	});
});
