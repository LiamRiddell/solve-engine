import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #584: a negative half rounded two ways. `round(-2.5)` and `-2.5
 * rounded` went through `Math.round`, which takes a half towards positive
 * infinity, so both answered -2, while `round(-2.5, 0)` and `-2.5 to 0 dp`
 * round a half away from zero and answered -3. Every form now takes a half
 * away from zero, the rule a spreadsheet's ROUND follows. `rounded up` and
 * `rounded down` name their own direction and are unchanged.
 */

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source));

describe("a half rounds away from zero, however rounding is written", () => {
	test.each([
		["round(-2.5)", "= -3"],
		["-2.5 rounded", "= -3"],
		["round(-0.5)", "= -1"],
		["round(-2.5, 0)", "= -3"],
		["-2.5 to 0 dp", "= -3"],
		["round(-5/2)", "= -3"],
		["-25 to nearest 10", "= -30"],
		["-35 rounded to nearest 10", "= -40"],
		["round(-2.5 m)", "= -3.00 m"],
		["round(-$2.50)", "= -$3.00"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("a positive half is unchanged, and so is anything that is not a half", () => {
		expect(shown("round(2.5)")).toBe("= 3");
		expect(shown("5.5 rounded")).toBe("= 6");
		expect(shown("round(-2.4)")).toBe("= -2");
		expect(shown("round(-2.6)")).toBe("= -3");
	});

	test("rounded up and rounded down keep their own direction", () => {
		expect(shown("-2.5 rounded up")).toBe("= -2");
		expect(shown("-2.5 rounded down")).toBe("= -3");
	});
});
