import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #629: a span from subtracting two clock times lost its mark when a
 * typed length of time was added or taken away, so it fell back to
 * milliseconds: `(9:30 - 8:30) + 30 minutes` answered 5,400,000.00 ms. A span
 * plus or minus a time quantity is still a span, and shows on a clock. A typed
 * quantity in milliseconds is the exception, since a clock would drop them.
 */

function show(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("a span plus or minus a length of time is still a span", () => {
	test.each([
		["(9:30 - 8:30) + 30 minutes", "= 1:30"],
		["(9:30 - 8:30) - 15 minutes", "= 0:45"],
		["(9:30 - 8:30) + 30 s", "= 1:00:30"],
		["(9:30 - 8:30) + 2 h", "= 3:00"],
		["(9:30 - 8:30) + 1 day", "= 25:00"],
		["30 minutes + (9:30 - 8:30)", "= 1:30"],
		["(9:30 - 8:30) - 2 h", "= -1:00"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("a length held in a variable keeps the span too, through both passes", () => {
		const text = "q = 30 minutes\n(9:30 - 8:30) + q\nq + (9:30 - 8:30)";
		const read = (lines: { result: unknown }[]) => lines.map((l) => (l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch).toEqual(["= 30 minutes", "= 1:30", "= 1:30"]);
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});

	test("a column of spans and lengths totals as a span, through both passes", () => {
		const text = "9:30 - 8:30\n12:00 - 11:00\ntotal above + 30 minutes";
		const read = (lines: { result: unknown }[]) => lines.map((l) => (l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch).toEqual(["= 1:00", "= 1:00", "= 2:30"]);
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});
});

describe("the boundary", () => {
	test("typed milliseconds keep their milliseconds", () => {
		expect(show("(9:30 - 8:30) + 40ms")).toBe("= 3,600,040.00 ms");
		expect(show("40ms + 120ms + 30ms")).toBe("= 190.00 ms");
	});

	test("asking for a unit gives that unit", () => {
		expect(show("(9:30 - 8:30) in minutes")).toBe("= 60 minutes");
	});

	test("adversarial: a span times a duration is not a span", () => {
		expect(show("(9:30 - 8:30) * 30 minutes")).not.toMatch(/^= \d+:\d\d$/);
	});
});
