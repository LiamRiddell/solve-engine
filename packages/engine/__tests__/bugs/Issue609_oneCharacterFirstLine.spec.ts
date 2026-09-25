import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #609: a one-character first line swallowed the whole document. The
 * lexer's one-character fast path built its token from the whole input, and a
 * document scan narrows only the line's end, so `e` above `5` was "Undefined
 * variable: e" followed by the rest of the document through parseDocument while
 * evaluateDocument answered 2.72, and the bad program was then reused for a
 * later `e` on the same engine. The token is now built from the one character.
 */

function lines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		if (v == null) return line.error ? `ERROR ${line.error}` : "";
		return v.isError() ? `ERROR ${String(v.errorMessage)}` : formatValue(v);
	});
}
const batch = (text: string) => lines(newTrackedEngine().parseDocument(text));
const incremental = (text: string) => lines(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text));

describe("a one-character first line is its own line", () => {
	test.each([
		["e\n5", ["= 2.72", "= 5"]],
		["e\ntotal above", ["= 2.72", "= 2.72"]],
		["e\r\n5", ["= 2.72", "= 5"]],
		["7\n1 + 1", ["= 7", "= 2"]],
	])("%j, both passes", (text, expected) => {
		expect(batch(text)).toEqual(expected);
		expect(incremental(text)).toEqual(expected);
	});

	test("an unknown one-letter name names only itself", () => {
		expect(batch("x\n5")[0]).toBe("ERROR Undefined variable: x");
		expect(batch("m\n5")[0]).toBe("ERROR Undefined variable: m");
	});
});

describe("adversarial: every kind of one character, and what the engine remembers", () => {
	test.each(["+", ".", "\"", "#", "$", "π", "é", "5", "a", "(", "`"])("the first line %j does not read the next line", (first) => {
		const [line1] = batch(`${first}\n12345`);
		expect(line1).not.toContain("12345");
		expect(batch(`${first}\n12345`)[1]).toBe("= 12,345");
	});

	test("a later one-character line on the same engine is not poisoned by the document", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("e\n5");
		expect(formatValue(engine.evaluateExpression("e"))).toBe("= 2.72");
		engine.parseDocument("m\n5");
		expect(() => engine.evaluateExpression("m")).toThrow(/^Undefined variable: m$/);
	});

	test("the answer does not depend on what the engine did before", () => {
		const fresh = batch("e\n5");
		const engine = newTrackedEngine();
		engine.evaluateExpression("e");
		expect(lines(engine.parseDocument("e\n5"))).toEqual(fresh);
	});
});
