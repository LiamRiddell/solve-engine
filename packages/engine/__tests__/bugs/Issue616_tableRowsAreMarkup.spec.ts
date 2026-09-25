import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { formatValue } from "@solve-js/format/FormatEngine";
import { isPipeRow, isSeparatorRowText, isTableRowAt, pipeBlockAround } from "@solve-js/lexer/TableBlocks";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";

/**
 * Issue #616: a markdown table's rows were reported as errors in a document.
 * The line classifier sees one line at a time and recognised only the `|---|`
 * separator row, so every other row fell to the expression path: `No prefix
 * parselet found for token: BIT_OR`, three entries in `errors`, and `total
 * above` under a table blamed on its last row. A pipe row is table markup now
 * when its block of pipe rows holds a separator with a header above it, on
 * both document paths.
 */

function lines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		const failed = line.error ?? (v?.isError() ? String(v.errorMessage) : null);
		if (failed !== null) return `ERROR ${failed}`;
		const solves = line.inlineSolves.map((s) => (s.result ? formatValue(s.result) : `ERROR ${s.error}`));
		if (solves.length > 0) return solves.join(" | ");
		return v ? formatValue(v) : "";
	});
}
const batch = (text: string) => newTrackedEngine().parseDocument(text);
const incremental = (text: string) => evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text);

describe("the table-block helpers", () => {
	test("isPipeRow reads past indentation", () => {
		expect(isPipeRow("| a |")).toBe(true);
		expect(isPipeRow("   | a |")).toBe(true);
		expect(isPipeRow("\t|")).toBe(true);
		expect(isPipeRow("a | b")).toBe(false);
		expect(isPipeRow("")).toBe(false);
		expect(isPipeRow(undefined)).toBe(false);
	});

	test("isSeparatorRowText needs a dash, and nothing but pipes, dashes, colons and spaces", () => {
		expect(isSeparatorRowText("|---|:--:|")).toBe(true);
		expect(isSeparatorRowText("| --- | --- |\r")).toBe(true);
		expect(isSeparatorRowText("|  |  |")).toBe(false);
		expect(isSeparatorRowText("|---| x |")).toBe(false);
		expect(isSeparatorRowText("---")).toBe(false);
	});

	test("isTableRowAt: a separator below the block's first line makes every row a table row", () => {
		const doc = ["intro", "| h |", "|---|", "| a |", "| b |", "after"];
		const at = (n: number) => doc[n - 1];
		expect([1, 2, 3, 4, 5, 6].map((n) => isTableRowAt(at, n))).toEqual([false, true, true, true, true, false]);
	});

	test("isTableRowAt: a separator as the block's first line has no header, so no table", () => {
		const doc = ["|---|", "| a |"];
		expect([1, 2].map((n) => isTableRowAt((k) => doc[k - 1], n))).toEqual([false, false]);
	});

	test("pipeBlockAround finds the block, and null off it", () => {
		const doc = ["x", "| a |", "| b |", "y"];
		const at = (n: number) => doc[n - 1];
		expect(pipeBlockAround(at, 3)).toEqual({ first: 2, last: 3 });
		expect(pipeBlockAround(at, 1)).toBeNull();
	});

	test("scanDocument marks the rows and keeps the separator's own type", () => {
		const scan = new ExpressionLexer().scanDocument("| h |\n|---|\n| 1 |\n5 | 3");
		expect(scan.map((r) => r.classification.type)).toEqual(["table", "table_separator", "table", "expression"]);
		expect(scan.slice(0, 3).every((r) => r.classification.skip && r.tokens.length === 0 && r.error === undefined)).toBe(true);
	});
});

describe("the survey's notes, through both passes", () => {
	test("a table then a column total: no row is an error", () => {
		const text = "| item | cost |\n|---|---|\n| rent | 500 |\n| food | 200 |\n\ntotal of column \"cost\" above";
		const b = batch(text);
		expect(lines(b)).toEqual(["", "", "", "", "", "= 700"]);
		expect(b.errors).toEqual([]);
		expect(lines(incremental(text))).toEqual(lines(b));
		expect(incremental(text).errors).toEqual([]);
	});

	test("a line under a table is not blamed on a row: the table ends the block", () => {
		const text = "10\n| item | cost |\n|---|---|\n| rent | 500 |\ntotal above";
		const out = lines(batch(text));
		expect(out[4]).toMatch(/^ERROR No lines above to aggregate/);
		expect(lines(incremental(text))).toEqual(out);
	});
});

describe("adversarial: what a table is, and what it is not", () => {
	test("an inline solve inside a table cell is still worked out", () => {
		const text = "| item | cost |\n|---|---|\n| rent | s`500 * 2` |";
		const out = lines(batch(text));
		expect(out[2]).toBe("= 1,000");
		expect(lines(incremental(text))).toEqual(out);
	});

	test("an indented table is a table", () => {
		const text = "  | a | b |\n  |---|---|\n  | 1 | 2 |";
		expect(batch(text).errors).toEqual([]);
		expect(incremental(text).errors).toEqual([]);
	});

	test("two tables, one after the other, each read on its own", () => {
		const text = "| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n\ntotal of column \"b\" above";
		const out = lines(batch(text));
		expect(out[8]).toBe("= 2");
		expect(lines(incremental(text))).toEqual(out);
	});

	test("a table that ends the note, with a trailing CRLF", () => {
		const text = "| a |\r\n|---|\r\n| 1 |\r\n";
		expect(batch(text).errors).toEqual([]);
		expect(incremental(text).errors).toEqual([]);
	});

	test("pipe rows with no separator stay expressions, and a lone separator is still skipped", () => {
		expect(lines(batch("| 5\n5 | 3"))[1]).toBe("= 7");
		expect(lines(batch("|---|\n5 | 3"))).toEqual(["", "= 7"]);
	});

	test("prototype-shaped cells are text, and change nothing", () => {
		const text = "| __proto__ | constructor |\n|---|---|\n| toString | 1 |";
		expect(batch(text).errors).toEqual([]);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	test("a 2,000-row table is classified in linear time on both passes", () => {
		const rows = Array.from({ length: 2000 }, (_, i) => `| r${i} | ${i} |`).join("\n");
		const text = `| item | n |\n|---|---|\n${rows}\n\ntotal of column "n" above`;
		const started = Date.now();
		const b = lines(batch(text));
		const i = lines(incremental(text));
		expect(b[b.length - 1]).toBe("= 1,999,000");
		expect(i).toEqual(b);
		expect(Date.now() - started).toBeLessThan(10_000);
	});

	test("the live evaluator reads a long table's lines a bounded number of times each, not once per row above", () => {
		// Counted rather than timed. Classifying row by row walked from each row
		// back to the separator, so 130,000 rows took seven minutes, and the
		// 2,000-row timing above was too short to show it.
		const count = 20_000;
		const rows = Array.from({ length: count }, (_, i) => `| r${i} | ${i} |`);
		const doc = new DocumentModel(count + 10);
		doc.setDocument(["| item | n |", "|---|---|", ...rows, "", 'total of column "n" above'].join("\n"));
		let reads = 0;
		const getLineAt = doc.getLineAt.bind(doc);
		doc.getLineAt = (n: number) => {
			reads++;
			return getLineAt(n);
		};
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			const pass = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			expect(formatValue(pass.lines[pass.lines.length - 1].result!)).toBe("= 199,990,000");
			expect(reads).toBeLessThan(20 * (count + 4));
		} finally {
			evaluator.terminateWorker();
		}
	});
});
