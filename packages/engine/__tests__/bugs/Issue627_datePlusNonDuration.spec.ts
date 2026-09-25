import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #627: a date plus something that is not a duration kept the date. The
 * duration was read by extractDurationMs, which made a unit that is not a time
 * contribute zero and read a bare number as milliseconds, so `1 Jan 2026 + 5
 * kg` was still 1 January and `1 Jan 2026 + 5` five milliseconds past
 * midnight. Both are now refused by name.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

const BARE = "A date or time moves by a length of time, and a plain number does not say whether it means days, hours or minutes. Write the unit, as in + 5 days.";

describe("a date moves only by a length of time", () => {
	test.each([
		["1 Jan 2026 + 5 kg", "a mass"],
		["1 Jan 2026 + 5 m", "a length"],
		["1 Jan 2026 + $5", "money"],
		["1 Jan 2026 + 10%", "a percentage"],
		["1 Jan 2026 - 5 kg", "a mass"],
		["1 Jan 2026 + true", "true or false"],
		["1 Jan 2026 + [1,2]", "a bracketed list"],
	])("%s is refused, naming %s", (line, what) => {
		expect(show(line)).toBe(`A date or time moves by a length of time, such as 5 days, 2 weeks or 3 hours, not by ${what}.`);
	});

	test.each(["1 Jan 2026 + 5", "5 + 1 Jan 2026", "1 Jan 2026 + 3600000", "today + 1", "9am + 2", "1 Jan 2026 - 5"])(
		"%s: a bare number names no unit",
		(line) => {
			expect(show(line)).toBe(BARE);
		},
	);
});

describe("the boundary: every duration still moves a date", () => {
	test.each([
		["1 Jan 2026 + 5 workdays", "= Thursday, January 8, 2026"],
		["1 Jan 2026 + 1 month", "= Sunday, February 1, 2026"],
		["1 Jan 2026 + 1h30m", "= Thursday, January 1, 2026, 1:30:00 AM"],
		["1 Jan 2026 + (9:30 - 8:30)", "= Thursday, January 1, 2026, 1:00:00 AM"],
		["1 Jan 2026 + 5 days", "= Tuesday, January 6, 2026"],
		["2 days + 1 Jan 2026", "= Saturday, January 3, 2026"],
		["5 days after 1 Jan 2026", "= Tuesday, January 6, 2026"],
		["1 Jan 2026 - 2 hours", "= Wednesday, December 31, 2025, 10:00:00 PM"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});
});

describe("adversarial: held in variables, through both passes", () => {
	test("a mass in a variable is refused, and a duration in a variable moves the date", () => {
		const text = "d = 1 Jan 2026\nw = 5 kg\ngap = 5 days\nd + w\nd + gap";
		const read = (lines: { result: unknown }[]) =>
			lines.map((l) => {
				const v = l.result as { type: ValueType; errorCode?: string } | null;
				return v === null ? "" : v.type === ValueType.Error ? String(v.errorCode) : formatValue(v as never);
			});
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch[3]).toBe("INVALID_DATETIME_OP");
		expect(batch[4]).toBe("= Tuesday, January 6, 2026");
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});
});
