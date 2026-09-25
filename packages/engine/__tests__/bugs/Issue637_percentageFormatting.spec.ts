import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { percentageValue } from "@solve-js/vm/Value";

/**
 * Issue #637: the percentage formatter used `toFixed` alone, so it skipped the
 * too-small rule (`0.001%` showed 0.00%), the grouping (`1234567%` showed
 * 1234567.00%) and the locale's decimal mark (12.50% under de-DE). It now
 * follows the rules every other figure does.
 */

const show = (line: string) => formatValue(newTrackedEngine().evaluateExpression(line));

describe("a percentage follows the rules every figure does", () => {
	test.each([
		["0.001%", "= 0.001%"],
		["0.004%", "= 0.004%"],
		["-0.001%", "= -0.001%"],
		["1234567%", "= 1,234,567.00%"],
		["1/8 as %", "= 12.50%"],
		["25%", "= 25.00%"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("the locale's decimal mark and grouping, under de-DE", () => {
		const settings = { ...DEFAULT_FORMATTING_SETTINGS, numberResult: { ...DEFAULT_FORMATTING_SETTINGS.numberResult, decimalSeparatorLocale: "de-DE" } };
		expect(formatValue(percentageValue(0.125), settings)).toBe("= 12,50%");
		expect(formatValue(percentageValue(12345.67), settings)).toBe("= 1.234.567,00%");
	});

	test("the #585 rule holds: a zero is written without a sign", () => {
		expect(show("-0%")).toBe("= 0.00%");
		expect(formatValue(percentageValue(-0))).toBe("= 0.00%");
	});
});
