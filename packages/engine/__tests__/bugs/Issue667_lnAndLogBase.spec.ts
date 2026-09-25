import { describe, expect, test } from "@jest/globals";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import type { Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #667: `ln` was an undefined function, and nothing said `log` is the
 * natural logarithm. `ln(x)` is now the natural logarithm, a call only where a
 * bracket follows it so `ln` stays free as a variable name, with its own
 * builtin index so a refusal names `ln` as written.
 */

function one(text: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(text) as Value);
	} catch (error) {
		return `THROWS ${(error as Error).message}`;
	}
}

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));
}

describe("ln is the natural logarithm", () => {
	test.each([
		["ln(e)", "= 1"],
		["LN(e)", "= 1"],
		["ln(1)", "= 0"],
		["ln(100)", "= 4.61"],
		["ln(100) == log(100)", "= true"],
		["log(100)", "= 4.61"],
		["log10(100)", "= 2"],
		["log2(8)", "= 3"],
		["log 8 base 2", "= 3"],
		["map(ln, [1, e])", "= [0, 1]"],
	])("%s", (text, expected) => {
		expect(one(text)).toBe(expected);
	});

	test("explains as the natural logarithm", () => {
		expect(newTrackedEngine().explainLine("ln(e)").steps[0].description).toBe("the natural logarithm of 2.71828");
	});

	test("completion offers ln as a function", () => {
		const items = new LanguageService(newTrackedEngine()).getCompletions("ln", 2);
		expect(items).toContainEqual({ label: "ln", category: "function", detail: "natural logarithm" });
	});
});

describe("log x base n is exact at a power", () => {
	test.each([
		["log 1000 base 10", "= 3"],
		["log 8 base 2", "= 3"],
		["log 81 base 3", "= 4"],
		["log 2 base 10", "= 0.30"],
	])("%s", (text, expected) => {
		expect(one(text)).toBe(expected);
	});

	test("refuses as log does, and the algebra still sees the change of base", () => {
		expect(one("log 0 base 2")).toBe("log(0) has no real value: log is only defined for positive numbers.");
		expect(one("log 10 kg base 2")).toBe("log takes a plain number, not a mass");
		expect(one("log x base 2 =>")).toBe("log(x)/log(2)");
	});

	test("explains with its base", () => {
		expect(newTrackedEngine().explainLine("log 1000 base 10").steps.map((s) => s.description)).toEqual(["the base-10 logarithm of 1,000"]);
	});
});

describe("adversarial", () => {
	test.each([
		["ln(0)", "ln(0) has no real value: ln is only defined for positive numbers."],
		["ln(-1)", "ln(-1) has no real value: ln is only defined for positive numbers."],
		["ln(10 kg)", "ln takes a plain number, not a mass"],
		["ln()", "THROWS ln() takes 1 argument, but was given none"],
		["ln(1, 2)", "THROWS ln() takes 1 argument, but was given 2 arguments"],
	])("%s is refused under the name it was written with", (text, expected) => {
		expect(one(text)).toBe(expected);
	});

	test("ln stays a variable name wherever no bracket follows, on both passes", () => {
		const text = ["ln = 4", "ln * 2", "ln(e)", ":ln = 3", "ln + ln(1)"].join("\n");
		const expected = ["= 4", "= 8", "= 1", "= 3", "= 3"];
		expect(read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }))).toEqual(expected);
		expect(read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }))).toEqual(expected);
	});

	test("the algebra reads ln as the logarithm it is", () => {
		expect(one("derivative of ln(x)")).toBe(one("derivative of log(x)"));
	});
});
