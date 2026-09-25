import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #585: a zero was written with its sign, `ceil(-0.5)` as -0. A double has
 * a negative zero, equal to zero in every comparison, and the formatter wrote
 * it out. It is now written as 0. The value keeps IEEE's sign, deliberately,
 * since `1 / (0 * -1)` is -∞ where `1 / 0` is ∞ (see vm/ExactDecimals.ts).
 */

const evaluate = (source: string) => newTrackedEngine().evaluateExpression(source);
const shown = (source: string) => formatValue(evaluate(source));

describe("a zero is written without a sign", () => {
	test.each([
		["ceil(-0.5)", "= 0"],
		["0 * -1", "= 0"],
		["-0", "= 0"],
		["-0.4 rounded", "= 0"],
		["-0%", "= 0.00%"],
		["[0 * -1, 1]", "= [0, 1]"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("a small negative that is not zero keeps its sign", () => {
		expect(shown("-0.001")).toBe("= -0.001");
		expect(shown("-0.5")).toBe("= -0.50");
		// A percentage follows the same rule since #637: not zero, so not shown as one.
		expect(shown("-0.001%")).toBe("= -0.001%");
	});

	test("the value keeps the sign that division can see", () => {
		expect(Object.is(evaluate("0 * -1").value, -0)).toBe(true);
		expect(shown("1 / (0 * -1)")).toBe("= -∞");
	});
});
