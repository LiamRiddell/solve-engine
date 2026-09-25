import { describe, expect, test } from "@jest/globals";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import type { Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #669: `≤`, `≥`, `√` and `∞` joined the word beside them and `π` was an
 * undefined variable, while `×`, `÷`, `±` and `≠` were read. The four symbols are
 * lexer entries now, and `π` is pi when nothing in the note is named `π`.
 */

function one(text: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(text) as Value);
	} catch (error) {
		return `THROWS ${(error as { code?: string }).code}`;
	}
}
function read(result: ParsingResult): string[] {
	return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));
}
const both = (lines: string[]) => {
	const text = lines.join("\n");
	const batch = read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
	expect(read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }))).toEqual(batch);
	return batch;
};

describe("the comparisons", () => {
	test.each([
		["3 ≥ 2", "= true"],
		["3 ≤ 2", "= false"],
		["2 ≤ 2", "= true"],
		["3≥2", "= true"],
		["check 3 ≥ 2", "= ✓"],
	])("%s", (text, expected) => expect(one(text)).toBe(expected));

	test("between two names, with no spaces", () => {
		expect(both(["x = 5", "y = 3", "x≥y"])[2]).toBe("= true");
	});
});

describe("the square root", () => {
	test.each([
		["√16", "= 4"],
		["√16 + 9", "= 13"],
		["√(9 + 16)", "= 5"],
		["2√3", "= 3.46"],
		["√√16", "= 2"],
		["√(9 m^2)", "= 3.00 m"],
	])("%s", (text, expected) => expect(one(text)).toBe(expected));

	test("answers as sqrt does, including a negative number", () => {
		expect(one("√-4")).toBe(one("sqrt(-4)"));
	});

	test("on its own it is an incomplete line", () => {
		expect(one("√")).toBe("THROWS UNEXPECTED_END_OF_INPUT");
	});
});

describe("infinity and pi", () => {
	test.each([
		["∞", "= ∞"],
		["-∞", "= -∞"],
		["1/∞", "= 0"],
		["∞ > 5", "= true"],
		["π", "= 3.14"],
		["2π", "= 6.28"],
		["π * 2", "= 6.28"],
	])("%s", (text, expected) => expect(one(text)).toBe(expected));

	test("infinity meets the refusals the functions already give it", () => {
		expect(one("sin(∞)")).toMatch(/has no real value/);
		expect(one("∞ mod 3")).toMatch(/an infinite number has no remainder/);
	});

	test("a note that names a variable π keeps it, on both passes", () => {
		expect(both(["π = 3", "π * 2"])).toEqual(["= 3", "= 6"]);
		expect(both([":π = 4", "π"])).toEqual(["= 4", "= 4"]);
	});
});

describe("adversarial", () => {
	test("the word infinity is still an ordinary name", () => {
		expect(one("infinity")).toBe("THROWS UNDEFINED_VARIABLE");
	});

	test("a comparison with nothing on its right is incomplete", () => {
		expect(one("3 ≥")).toBe("THROWS UNEXPECTED_END_OF_INPUT");
	});

	test("the symbols highlight as their ASCII spellings do", () => {
		const ls = new LanguageService(newTrackedEngine());
		const categories = ls.getSemanticTokens("3 ≥ √16", 1).map((t) => t.category);
		expect(categories).toEqual(["number", "comparison", "operator", "number"]);
		expect(ls.getSemanticTokens("3 >= 2", 2).map((t) => t.category)[1]).toBe("comparison");
	});
});
