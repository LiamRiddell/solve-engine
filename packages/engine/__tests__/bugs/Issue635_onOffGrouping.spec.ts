import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #635: `on` and `off` bound below arithmetic on their left, so the rate
 * was whatever had been built there (`5 + 20% off 100` took 6 off 100 and gave
 * -500), and a chain grouped to the left (`10% off 20% off $100` took 18% off).
 * The rate is now the percentage just before the word, the base is everything
 * after it, and a chain groups to the right. The explainer follows the same
 * grouping.
 */

function show(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("the rate is the percentage before the word", () => {
	test.each([
		["5 + 20% off 100", "= 85"],
		["10% off 20% off $100", "= $72.00"],
		["10% on 10% on 100", "= 121"],
		["2 * 10% off 100", "= 180"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("each agrees with its bracketed spelling", () => {
		expect(show("5 + 20% off 100")).toBe(show("5 + (20% off 100)"));
		expect(show("10% off 20% off $100")).toBe(show("10% off (20% off $100)"));
		expect(show("10% on 10% on 100")).toBe(show("10% on (10% on 100)"));
	});

	test("both document passes agree", () => {
		const text = "price = $100\n10% off 20% off price\n5 + 20% off 100";
		const read = (lines: { result: unknown }[]) => lines.map((l) => (l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch.slice(1)).toEqual(["= $72.00", "= 85"]);
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});

	test("the explanation follows the grouping", () => {
		const explanation = newTrackedEngine().explainLine("5 + 20% off 100");
		expect(explanation.steps.map((s) => s.description)).toEqual(["100 less 20%", "5 plus 80"]);
	});
});

describe("the boundary: what does not change", () => {
	test.each([
		["10% off 100 + 100", "= 180"],
		["10% on 200", "= 220"],
		["10% off 200", "= 180"],
		["5% off what is 190", "= 200"],
		["(20% off 80) + 20%", "= 76.80"],
		["10% off 100 > 50", "= true"],
		["20% off 100 - 5", "= 76"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});
});
