import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { hasNoFigure } from "@solve-js/lexer/BlockBoundary";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #803, found by the cross-path fuzz generator: a form reading a line
 * below it asked whether that line had a figure. The batch pass answered from
 * its scan; the incremental pass answered from `isEmpty`, which is set only
 * when the evaluator reaches a line, so a comment below the reader read as a
 * figure still to come. `count of section "Home"` over a heading and a comment
 * below it was 0 through `parseDocument` and a forward-reference error through
 * `evaluateDocument`. A line not yet reached is now read from its text.
 */

const lexer = new ExpressionLexer();
const noFigure = (lines: string[], n: number) => hasNoFigure((k) => lines[k - 1], (text) => lexer.classifyLine(text), n);

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));
}
const both = (lines: string[]) => {
	const batch = read(newTrackedEngine().parseDocument(lines.join("\n"), { inputType: "markdown" }));
	expect(read(evaluateDocument(newTrackedEngine(), lines.join("\n"), { inputType: "markdown" }))).toEqual(batch);
	return batch;
};

describe("hasNoFigure", () => {
	test.each([
		["", true],
		["# Heading", true],
		["// a comment", true],
		["> a quote", true],
		["---", true],
		["```", true],
		["100", false],
		["rent: $500", false],
		["5 | 3", false],
	])("%j has no figure: %s", (text, expected) => {
		expect(noFigure([text], 1)).toBe(expected);
	});

	test("a table row has no figure, and a row holding an inline solve keeps its solve", () => {
		const table = ["| a | b |", "|---|---|", "| x | 1 |", "| y | s`2 + 2` |"];
		expect([1, 2, 3, 4].map((n) => noFigure(table, n))).toEqual([true, true, true, false]);
	});

	test("past either end there is no figure", () => {
		expect(noFigure(["1"], 0)).toBe(true);
		expect(noFigure(["1"], 2)).toBe(true);
	});
});

describe("forms that read below the reader agree on both passes", () => {
	test("a section below, holding only a comment", () => {
		expect(both(['count of section "Home"', "# Home", "// note 5"])[0]).toBe("= 0");
	});

	test("a section below, holding a comment and a figure, still reads the figure as not yet evaluated", () => {
		expect(both(['total of section "Home"', "# Home", "// note", "10"])[0]).toMatch(/Line 4 has not been evaluated yet/);
	});

	test("a range reaching down over a table", () => {
		both(["sum(line 2 : line 5)", "| a | b |", "|---|---|", "| x | 1 |", "20"]);
	});

	test("a live editor that has not scrolled to the comment yet gives the batch answer", () => {
		// A viewport of one line: the evaluator never reaches the comment below.
		const lines = ['count of section "Home"', "# Home", "// note 5"];
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			const pass = evaluator.evaluate({ startLine: 1, endLine: 1 });
			expect(formatValue(pass.lines[0].result!)).toBe("= 0");
		} finally {
			evaluator.terminateWorker();
		}
	});
});
