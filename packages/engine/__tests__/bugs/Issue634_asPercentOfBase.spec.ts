import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #634: `40 as % of 50` converted 40 to 4000% at once and then took that
 * of 50, answering 2,000, while `40 is what % of 50` answers 80%. `as %`,
 * `as percent` and NumPad's `as a %` with a base now ask what `is what %` asks,
 * through the same code (emitRateAgainstBase), so the two cannot drift.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

describe("as % with a base is the rate", () => {
	test.each([
		["40 as % of 50", "= 80.00%"],
		["$40 as % of $50", "= 80.00%"],
		["$60 as % on $50", "= 20.00%"],
		["$40 as % off $50", "= 20.00%"],
		["40 as percent of 50", "= 80.00%"],
		["$40 as a % of $50", "= 80.00%"],
		["$60 as a % on $50", "= 20.00%"],
		["$40 as a % off $50", "= 20.00%"],
		["$60 as percentage on $50", "= 20.00%"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("each spelling agrees with is what %", () => {
		for (const [asForm, isForm] of [
			["40 as % of 50", "40 is what % of 50"],
			["180 as % off 200", "180 is what % off 200"],
			["180 as % on 150", "180 is what % on 150"],
		]) {
			expect(show(asForm)).toBe(show(isForm));
		}
	});

	test("both document passes agree, with the part and the base in variables", () => {
		const text = "part = 40\nwhole = 50\npart as % of whole\npart as a % of whole";
		const read = (lines: { result: unknown }[]) => lines.map((l) => (l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch.slice(2)).toEqual(["= 80.00%", "= 80.00%"]);
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});
});

describe("the boundary and the edges", () => {
	test("with nothing after it, as % converts as it always has", () => {
		expect(show("0.5 as %")).toBe("= 50.00%");
		expect(show("0.5 as percent")).toBe("= 50.00%");
		expect(show("0.5 as a %")).toBe("= 50.00%");
		expect(show("40 to 90 as %")).toBe("= 125.00%");
	});

	test("the multiplier converter keeps its own base", () => {
		expect(show("50 as x of 5")).toBe("= 10x");
	});

	test("adversarial: a base of zero is refused, not an infinite percentage", () => {
		expect(show("40 as % of 0")).toMatch(/^This has no percentage/);
	});

	test("adversarial: a converter named a that is not followed by a percent is still an unknown converter", () => {
		expect(show("5 as a")).toMatch(/Unknown converter "as a"/);
	});
});
