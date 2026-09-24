import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #586: the engine writes an acceleration as `m/s²`, but `9.81 m/s²`
 * typed back was "Undefined variable: s²". The lexer reads `s²` as one word,
 * and no unit is spelled that way, so the acceleration rule, which fused only
 * `m / s ^ 2`, never saw it. It now fuses `m / s²` too, under the same guard
 * (#537), so a variable `m` at the start of a line is still a variable.
 */

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source));

describe("m/s² reads as the acceleration it is written as", () => {
	test.each([
		["9.81 m/s²", "= 9.81 m/s²"],
		["10 kg * 9.81 m/s²", "= 98.10 N"],
		["9.81 m/s^2", "= 9.81 m/s²"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("the answer typed back is the same answer", () => {
		expect(shown(shown("9.81 m/s^2").replace(/^=\s*/, ""))).toBe("= 9.81 m/s²");
	});
});
