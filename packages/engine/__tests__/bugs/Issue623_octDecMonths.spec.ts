import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #623: `oct` and `dec` are also the names of the octal and decimal
 * conversions, so they lex as converter names, and the month-name date rule
 * took only words and units. `1 Oct 2026` and `25 Dec` threw while `1 Nov 2026`
 * was a date. The rule now takes the converter token too, except straight
 * after `as`, `in` or `to`, where it is the conversion.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

describe("oct and dec read as months", () => {
	test.each([
		["1 Oct 2026", "= Thursday, October 1, 2026"],
		["Oct 1 2026", "= Thursday, October 1, 2026"],
		["25 Dec 2026", "= Friday, December 25, 2026"],
		["25 dec 2026", "= Friday, December 25, 2026"],
		["Dec 25, 2026", "= Friday, December 25, 2026"],
		["Oct 2026", "= Thursday, October 1, 2026"],
		["5 working days after 20 Dec 2026", "= Friday, December 25, 2026"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("both document passes agree", () => {
		const text = "start = 1 Oct 2026\nend = 25 Dec 2026\nend - start in days";
		const read = (lines: { result: unknown }[]) => lines.map((l) => (l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch[0]).toBe("= Thursday, October 1, 2026");
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});
});

describe("adversarial: the conversions keep their names", () => {
	test.each([
		["255 as dec", "= 255"],
		["255 in oct", "= 0o377"],
		["255 to dec", "= 255"],
	])("%s is still a conversion", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("a hex literal before dec is not a day of the month", () => {
		expect(show("0x1F dec")).toMatch(/^THROW /);
	});

	test("a day that no month has is still not a date", () => {
		expect(show("32 Dec 2026")).not.toMatch(/December 32/);
	});
});
