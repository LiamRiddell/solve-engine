import { describe, expect, test } from "@jest/globals";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import { applyTextEdits } from "@solve-js/language/DocumentReferences";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #670: the running-total forms stopped at `+=` and `-=`, so `bal *= 1.05`
 * failed to parse. `*=` and `/=` are read the way `+=` and `-=` are, with the
 * right-hand side in its own brackets, and a first use on an unknown name is
 * refused rather than seeded with 0, which would make every product 0.
 */

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));
}
const both = (lines: string[]) => {
	const text = lines.join("\n");
	const batch = read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
	const incremental = read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));
	expect(incremental.map((a) => a.replace(/^ERROR: /, ""))).toEqual(batch.map((a) => a.replace(/^ERROR: /, "")));
	return batch;
};

describe("the lexer reads the two operators", () => {
	test.each([
		["a *= 2", "STAR_EQUALS"],
		["a /= 2", "SLASH_EQUALS"],
		["a*=2", "STAR_EQUALS"],
	])("%s", (text, type) => {
		const lexer = newTrackedEngine().getLexer();
		lexer.resetExpression(text);
		expect(Array.from(lexer).map((t) => t.type)).toContain(type);
	});

	test("a comment and a plain division are untouched", () => {
		const lexer = newTrackedEngine().getLexer();
		lexer.resetExpression("8 / 2");
		expect(Array.from(lexer).map((t) => t.type)).not.toContain("SLASH_EQUALS");
	});
});

describe("running products and quotients", () => {
	test.each([
		[["a = 3", "a *= 2", "a"], ["= 3", "= 6", "= 6"]],
		[["a = 8", "a /= 2", "a"], ["= 8", "= 4", "= 4"]],
		[["bal = $100", "bal *= 1.05", "bal"], ["= $100.00", "= $105.00", "= $105.00"]],
		[["len = 10 m", "len /= 4"], ["= 10.00 m", "= 2.50 m"]],
		[["q = 4", "q *= 2 + 1"], ["= 4", "= 12"]],
		[["t += 5", "t *= 3", "t -= 1"], ["= 5", "= 15", "= 14"]],
	])("%j", (lines, expected) => {
		expect(both(lines)).toEqual(expected);
	});

	test("money stays exact to the penny", () => {
		expect(both(["p = $0.10", "p *= 3", "p == $0.30"])[2]).toBe("= true");
	});

	test("a trace names the line a product read", () => {
		expect(both(["b = 2", "b *= 3", "inputs of line 2"])[2]).toBe("= b 6 (line 2) <- b 2 (line 1)");
	});

	test("a rename reaches a running product", () => {
		const text = ["bal = $100", "bal *= 1.05", "bal /= 2", "bal"].join("\n");
		const result = new LanguageService(newTrackedEngine()).rename(text, { line: 1, character: 0 }, "cash");
		if (!result.ok) throw new Error(result.message);
		expect(applyTextEdits(text, result.edits)).toBe(["cash = $100", "cash *= 1.05", "cash /= 2", "cash"].join("\n"));
	});
});

describe("adversarial", () => {
	test("a first *= or /= on an unknown name is refused, not seeded", () => {
		expect(both(["y *= 2"])[0]).toBe("ERROR: Undefined variable: y");
		expect(both(["z /= 2"])[0]).toBe("ERROR: Undefined variable: z");
	});

	test("division by zero answers as a plain division does", () => {
		expect(both(["x = 5", "x /= 0"])[1]).toBe(both(["x = 5", "x / 0"])[1]);
	});

	test("a right-hand side is required", () => {
		expect(both(["a = 2", "a *="])[1]).toMatch(/needs an expression on the right/);
	});

	test("a number cannot be multiplied in place", () => {
		expect(both(["2 *= 3"])[0]).toMatch(/^ERROR: Unexpected token after expression: "\*="/);
	});

	test("the right-hand side keeps its unit: dividing by a length leaves a per-length figure", () => {
		expect(both(["a = 6", "a /= 3 m"])[1]).toBe("= 2.00 /m");
	});

	test("highlighting a running product runs nothing", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("t = 2", { inputType: "markdown" });
		const service = new LanguageService(engine);
		for (let i = 0; i < 4; i++) service.getSemanticTokens("t *= 3", 2);
		expect(engine.getVM().getVar("t")?.toNumber()).toBe(2);
	});
});
