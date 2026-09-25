import { describe, expect, test } from "@jest/globals";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { endsFigureBlock } from "@solve-js/lexer/BlockBoundary";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #652: `total above` stopped at any line the classifier skips, so a
 * `// remember to check` comment inside a column cut the total short: rent
 * $500, the comment, food $200, `total above` gave $200.00. A comment, a
 * blockquote or a wiki link has no figure and is passed over, as a line range
 * already passed over it; a blank line, a heading, a rule, a fence and a table
 * still end the block.
 */

const lexer = new ExpressionLexer();
const classify = (text: string) => lexer.classifyLine(text);
const ends = (lines: string[], n: number) => endsFigureBlock((k) => lines[k - 1], classify, n);

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));
}
const batch = (engine: ExpressionEngine, lines: string[]) => read(engine.parseDocument(lines.join("\n"), { inputType: "markdown" }));
const both = (lines: string[]) => {
	const b = batch(newTrackedEngine(), lines);
	expect(read(evaluateDocument(newTrackedEngine(), lines.join("\n"), { inputType: "markdown" }))).toEqual(b);
	return b;
};

describe("endsFigureBlock", () => {
	test.each([
		["", true],
		["   ", true],
		["# Heading", true],
		["## Sub", true],
		["---", true],
		["```", true],
		["~~~", true],
		["$$", true],
		["// a comment", false],
		["> a quote", false],
		["[[Some note]]", false],
		["100", false],
		["rent: $500", false],
	])("%j ends the block: %s", (text, expected) => {
		expect(ends(["10", text], 2)).toBe(expected);
	});

	test("past either end of the document ends the block", () => {
		expect(ends(["10"], 0)).toBe(true);
		expect(ends(["10"], 2)).toBe(true);
	});

	test("a pipe row ends the block only when its block is a table", () => {
		const table = ["| a | b |", "|---|---|", "| x | 1 |"];
		expect([1, 2, 3].map((n) => ends(table, n))).toEqual([true, true, true]);
		expect(ends(["5 | 3", "6 | 1"], 1)).toBe(false);
	});
});

describe("adversarial", () => {
	test("a comment that holds a figure is still a comment", () => {
		expect(both(["10", "// 100", "20", "total above"])[3]).toBe("= 30");
	});

	test("a column of nothing but comments has nothing to total, and says so", () => {
		expect(both(["// one", "// two", "total above"])[2]).toMatch(/^No lines above to aggregate/);
	});

	test("a comment between a heading and the figures does not reach past the heading", () => {
		expect(both(["100", "# Bills", "// monthly", "10", "20", "total above"])[5]).toBe("= 30");
	});

	test("a line starting with a tag still ends the block, as it always did", () => {
		expect(both(["100", "#food", "10", "total above"])[3]).toBe("= 10");
	});

	test("ten thousand comment lines inside a column are passed over", () => {
		const lines = ["10", ...Array.from({ length: 10_000 }, (_, i) => `// note ${i}`), "20", "total above"];
		const out = both(lines);
		expect(out[out.length - 1]).toBe("= 30");
	});

	test("a failed prose line in the column still fails the total, as before", () => {
		// The two passes report the prose line itself differently (a line error
		// and an error value), which is not part of this; the total agrees.
		const lines = ["10", "some prose here", "20", "total above"];
		expect(batch(newTrackedEngine(), lines)[3]).toBe("Line 2 has an error");
		expect(read(evaluateDocument(newTrackedEngine(), lines.join("\n"), { inputType: "markdown" }))[3]).toBe("Line 2 has an error");
	});
});
