import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #537: with `m = 3` and `s = 2`, the line `m/s^2` failed with
 * "Undefined variable: mps2".
 *
 * The lexer reads every word the unit table knows as a unit, including the
 * single letters people use as variable names, and three normaliser rules fused
 * them regardless of where they stood: the acceleration rule made `m/s^2` the
 * unit `mps2`, the compound-unit rule made `m/s` a speed, and the
 * bare-denominator rule made `/ s` "per second". Each now leaves a unit-named
 * word alone when it stands where a value is expected: at the start of the line
 * or after an operator, bracket, comma or `=`. See normalizer/ValuePosition.ts.
 */

function results(text: string): string[] {
	return newTrackedEngine().parseDocument(text).lines.map((line) => (line.result ? formatValue(line.result) : `ERROR ${line.error}`));
}

describe("unit-named variables divide as variables", () => {
	test("the reported case: m/s^2 is 3 / 2 squared", () => {
		expect(results("m = 3\ns = 2\nm/s^2")[2]).toBe("= 0.75");
	});

	test("and the forms around it", () => {
		expect(results("m = 3\ns = 2\nm/s")[2]).toBe("= 1.50");
		expect(results("m = 3\ns = 2\n1 + m/s^2")[2]).toBe("= 1.75");
		expect(results("m = 3\ns = 2\nm / s * 2")[2]).toBe("= 3");
		expect(results("h = 4\nkm = 8\nkm/h")[2]).toBe("= 2");
	});

	test("without the variables the words are still not an acceleration, and the error names the variable", () => {
		expect(results("m/s^2")[0]).toContain("Undefined variable: m");
	});
});

describe("a unit written after a value is still fused", () => {
	test.each([
		["9.81 m/s^2", "= 9.81 m/s²"],
		["(2+3) m/s^2", "= 5.00 m/s²"],
		["70 kg * 9.81 m/s^2", "= 686.70 N"],
		["100 km/h", "= 100.00 km/h"],
		["100 km / h", "= 100.00 km/h"],
		["100 km/h in mph", "= 62.14 mph"],
		["60 mph in km/h", "= 96.56 km/h"],
		["$20 / hour", "= 20.00 USD/hour"],
		["3 hours / day", "= 3.00 hours/day"],
		["$50/week * 12 weeks", "= $600.00"],
	])("%s is %s", (source, shown) => {
		expect(formatValue(newTrackedEngine().evaluateExpression(source))).toBe(shown);
	});

	test("after a variable too, where the unit labels the value", () => {
		expect(results("x = 2\nx m/s^2")[1]).toBe("= 2.00 m/s²");
	});
});
