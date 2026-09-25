import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #626: the pace rule needed the slash straight after the seconds, so a
 * minute unit between them (`5:30 min/km`) or `per` in place of the slash made
 * it decline; the literal became a time of day and its epoch was divided by the
 * kilometre. Both spellings are now a pace, as `5:30 /km` is.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

describe("a pace written with its minute unit, or with per", () => {
	test.each([
		["5:30 min/km", "= 5:30 /km"],
		["5:30 min/mi", "= 5:30 /mi"],
		["5:30 min per km", "= 5:30 /km"],
		["5:30 per km", "= 5:30 /km"],
		["5:30 minutes/km", "= 5:30 /km"],
		["5:30 mins/mi", "= 5:30 /mi"],
		["5:30 min / km", "= 5:30 /km"],
		["10 km at 5:30 min/km", "= 3,300 seconds"],
		["1:30 min/100m", "= 0.90 seconds/m"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("converts as the slash spelling does", () => {
		expect(show("5:30 min/km in min/mi")).toBe(show("5:30/km in min/mi"));
		expect(show("5:30 min/km in min/mi")).toBe("= 8:51 /mi");
	});

	test("held in a variable and multiplied out, through both passes", () => {
		const text = "p = 5:30 min/km\n10 km * p";
		const read = (lines: { result: unknown }[]) => lines.map((l) => (l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch).toEqual(["= 5:30 /km", "= 3,300 seconds"]);
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});
});

describe("adversarial: what is not a pace stays out", () => {
	test("seconds out of range are no time at all", () => {
		expect(show("5:60 min/km")).toMatch(/^THROW "5:60" is not a valid time/);
	});

	test.each(["5:30 min/kg", "5:30 h/km"])("%s is a clock time with a unit, refused", (line) => {
		expect(show(line)).toMatch(/^A date or time cannot take a unit/);
	});

	test("a time over a time is not a pace", () => {
		expect(show("12:00/day")).not.toMatch(/\/day$/);
	});

	test("a three-part literal keeps its duration reading", () => {
		expect(show("1:30:00/km")).not.toMatch(/^THROW/);
	});
});
