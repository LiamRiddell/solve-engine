import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #590: `m/s^2` is fused into the unit `mps2`, which has a dimension but
 * no measure in the tables, so a conversion to it was refused as `"mps2" is not
 * a unit`, even from an acceleration, and other refusals named `mps2` too. An
 * acceleration now converts to itself, and every refusal names it in words.
 */

const evaluate = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("an acceleration converts to itself", () => {
	test.each(["9.81 m/s^2 in m/s^2", "9.81 m/s² in m/s²"])("%s", (source) => {
		expect(formatValue(evaluate(source))).toBe("= 9.81 m/s²");
	});
});

describe("a refusal names the acceleration in words", () => {
	test.each([
		["5 kg in m/s^2", "a mass cannot be converted to an acceleration"],
		["1 m in m/s^2", "a length cannot be converted to an acceleration"],
		["9.81 m/s^2 in N", "an acceleration cannot be converted to a force"],
		["9.81 m/s^2 * 3 s", "acceleration and duration cannot be multiplied"],
	])("%s", (source, message) => {
		const value = evaluate(source);
		expect(value.errorCode).toBe("INCOMPATIBLE_UNITS");
		expect(value.errorMessage).toBe(message);
		expect(value.errorMessage).not.toContain("mps2");
	});

	test("a misspelt unit is still a misspelling", () => {
		expect(evaluate("5 km in mies").errorMessage).toBe('"mies" is not a unit. Did you mean miles?');
	});
});
