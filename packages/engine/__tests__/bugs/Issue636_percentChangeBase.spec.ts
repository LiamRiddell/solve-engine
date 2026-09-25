import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { percentageNotFinite } from "@solve-js/vm/VMConversion";

/**
 * Issue #636: a percentage change from a zero base divided by zero and printed
 * Infinity% or NaN%, and one from a negative base picked a sign for a question
 * with two conventional answers. Both are refused now, each with its own code
 * and reason, and a percentage of any value that is not finite (`40 is what %
 * of 0`, `1/0 as %`) is refused the same way.
 */

function value(line: string) {
	return newTrackedEngine().evaluateExpression(line);
}

describe("a change needs a base with a size and a sign", () => {
	test.each(["0 to 10", "0 to -10", "0 to 0", "$0 to $10", "0 to 10 is what %"])("%s: from zero", (line) => {
		expect(value(line).errorCode).toBe("PERCENT_CHANGE_FROM_ZERO");
	});

	test.each(["-100 to -50", "-50 to -100", "-100 to 50", "-$10 to $5"])("%s: from a negative base", (line) => {
		const v = value(line);
		expect(v.errorCode).toBe("PERCENT_CHANGE_NEGATIVE_BASE");
		expect(formatValue(v)).toMatch(/two readings/);
	});

	test("the refusals agree through both document passes", () => {
		const text = "start = 0\nlow = -100\nstart to 10\nlow to -50";
		const codes = (lines: { result: { errorCode?: string } | null }[]) => lines.map((l) => l.result?.errorCode ?? "");
		const batch = codes(newTrackedEngine().parseDocument(text).lines as never);
		expect(batch.slice(2)).toEqual(["PERCENT_CHANGE_FROM_ZERO", "PERCENT_CHANGE_NEGATIVE_BASE"]);
		expect(codes(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines as never)).toEqual(batch);
	});
});

describe("a percentage of a value that is not finite", () => {
	test("percentageNotFinite", () => {
		expect(percentageNotFinite().errorCode).toBe("PERCENTAGE_NOT_FINITE");
	});

	test.each(["40 is what % of 0", "1/0 as %", "(0/0) as %", "40 as % of 0"])("%s is refused", (line) => {
		expect(value(line).errorCode).toBe("PERCENTAGE_NOT_FINITE");
	});
});

describe("the boundary: well-defined changes answer as before", () => {
	test.each([
		["100 to 150", "= 50.00%"],
		["800 to 1000", "= 25.00%"],
		["10 to 0", "= -100.00%"],
		["100 to -50", "= -150.00%"],
		["40 to 90 as %", "= 125.00%"],
		["1/0", "= ∞"],
	])("%s", (line, expected) => {
		expect(formatValue(value(line))).toBe(expected);
	});
});
