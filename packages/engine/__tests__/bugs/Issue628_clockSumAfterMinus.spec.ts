import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #628: the clock-sum rule fused a run of bare clock times joined by `+`
 * without looking at the token before it, so in `17:30 - 9:00 + 0:45` it fused
 * `9:00 + 0:45` into 585 minutes and the line read as `17:30 - 585 minutes`, a
 * time of day: 7:45 AM. A run is fused only where a sum can start now, and a
 * run added to a clock subtraction is a length of time, so the shift stays a
 * span: 9:15.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}
const lines = (r: ParsingResult) => r.lines.map((l) => (l.result ? formatValue(l.result) : l.error ? `ERROR ${l.error}` : ""));

describe("a shift plus or minus more time, read left to right", () => {
	test.each([
		["17:30 - 9:00 + 0:45", "= 9:15"],
		["18:00 - 12:55 + 1:00 + 0:30", "= 6:35"],
		["(9:30 - 8:30) + 1:00", "= 2:00"],
		["(17:30 - 9:00) + 0:45", "= 9:15"],
		["17:30 - 9:00 + 30 minutes", "= 9:00"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("a column of such lines totals as a span, through both passes", () => {
		const text = "17:30 - 9:00 + 0:45\n18:00 - 12:55 + 1:00 + 0:30\ntotal above";
		const b = lines(newTrackedEngine().parseDocument(text));
		expect(b).toEqual(["= 9:15", "= 6:35", "= 15:50"]);
		expect(lines(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text))).toEqual(b);
	});
});

describe("the boundary: what the sum rule already read is unchanged", () => {
	test.each([
		["8:15 + 7:45 + 8:30", "= 1,470 minutes"],
		["total = 8:15 + 7:45", "= 960 minutes"],
		["(8:15 + 7:45) in hours", "= 16 hours"],
		["8:15 + 7:45 at $15/hour", "= $240.00"],
		["17:30 - 9:00", "= 8:30"],
		["9am + 5:30pm", "Cannot add two datetimes together"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("brackets keep their reading: a time of day 9:45 before half past five", () => {
		const value = newTrackedEngine().evaluateExpression("17:30 - (9:00 + 0:45)");
		expect(value.type).toBe(ValueType.Datetime);
		const d = new Date(value.toNumber());
		expect(`${d.getHours()}:${d.getMinutes()}`).toBe("7:45");
	});

	test("a clock time plus a typed duration stays a point in the day", () => {
		expect(newTrackedEngine().evaluateExpression("8:15 + 30 minutes").type).toBe(ValueType.Datetime);
	});
});

describe("adversarial: every operator in front of a run", () => {
	test.each([
		["2 * 1:00 + 0:30", /^A date or time cannot be multiplied/],
		["1:00 / 2 + 0:30", /^A date or time cannot be divided/],
	])("%s is left to precedence, and the moment is refused", (line, pattern) => {
		expect(show(line)).toMatch(pattern);
	});

	test("a run after an assignment, a bracket and a comma still sums", () => {
		const text = "week = 8:15 + 7:45\n(1:00 + 0:30) in minutes\nmax(1, 1:00 + 0:30)";
		const b = lines(newTrackedEngine().parseDocument(text));
		expect(b[0]).toBe("= 960 minutes");
		expect(b[1]).toBe("= 90 minutes");
		expect(lines(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text))).toEqual(b);
	});
});
