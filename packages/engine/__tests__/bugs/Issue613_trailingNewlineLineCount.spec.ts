import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #613: the two document passes counted lines differently. parseDocument
 * dropped the empty line after a trailing line break and returned no lines for
 * an empty document; evaluateDocument, whose model counts lines as an editor
 * does, kept them. evaluateDocument also kept the "\r" of a CRLF line in its
 * text. Both now count as an editor does, and neither keeps the "\r".
 */

/** Each line's number, text, offsets and shown answer, the shape both passes must agree on. */
function shape(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		// The batch pass reports a failed line in `error`, the incremental pass
		// as an error value in `result`; both read as ERROR here.
		const failed = line.error ?? (line.result?.isError() ? String(line.result.errorMessage) : null);
		const shown = failed !== null ? `ERROR ${failed}` : line.result ? formatValue(line.result) : line.isEmpty ? "(empty)" : "";
		return `${line.lineNumber} ${JSON.stringify(line.text)} ${line.startPosition}-${line.endPosition} ${shown}`;
	});
}
const batch = (text: string) => newTrackedEngine().parseDocument(text);
const incremental = (text: string) => evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text);

describe("both passes count lines as an editor does", () => {
	test.each([
		["", 1],
		["\n", 2],
		["\n\n\n", 4],
		["1\n2\ntotal above\n", 4],
		["1\n2\ntotal above", 3],
		["1\r\n2\r\n", 3],
		["1\n\n", 3],
	])("%j has %d lines through both passes", (text, count) => {
		const b = batch(text);
		const i = incremental(text);
		expect(b.lines).toHaveLength(count);
		expect(b.totalLines).toBe(count);
		expect(i.totalLines).toBe(count);
		expect(shape(i)).toEqual(shape(b));
	});

	test("the empty last line is an empty line, and the answers above it are unchanged", () => {
		expect(shape(batch("1\n2\ntotal above\n"))).toEqual([
			'1 "1" 0-1 = 1',
			'2 "2" 2-3 = 2',
			'3 "total above" 4-15 = 3',
			'4 "" 16-16 (empty)',
		]);
	});

	test("a CRLF line's text stops before the \\r, through both passes, with the batch pass's offsets", () => {
		const expected = ['1 "1" 0-1 = 1', '2 "2" 3-4 = 2', '3 "" 6-6 (empty)'];
		expect(shape(batch("1\r\n2\r\n"))).toEqual(expected);
		expect(shape(incremental("1\r\n2\r\n"))).toEqual(expected);
	});
});

describe("adversarial: the line count at its edges", () => {
	test("evaluateLines of no lines is no lines, and of one empty line is one", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateLines([])).toHaveLength(0);
		expect(engine.evaluateLines([""])).toHaveLength(1);
		expect(engine.evaluateLines(["1", ""])).toHaveLength(2);
	});

	test("a trailing line break does not change any answer or error", () => {
		const text = "price = $5\nprice * 3\nnope +\n# Heading\ntotal above";
		const without = shape(batch(text));
		const withBreak = shape(batch(`${text}\n`));
		expect(withBreak.slice(0, -1)).toEqual(without);
		expect(withBreak[withBreak.length - 1]).toBe(`6 "" ${text.length + 1}-${text.length + 1} (empty)`);
		expect(shape(incremental(`${text}\n`))).toEqual(withBreak);
	});

	test("a what-if and a line reference to the new last line say it is not a calculation", () => {
		const out = shape(batch("x = 5\nx * 2\nline 4 with x = 1\n"));
		expect(out[2]).toContain("Line 4 is not a calculation");
		expect(shape(incremental("x = 5\nx * 2\nline 4 with x = 1\n"))).toEqual(out);
	});

	test("an inline solve on a CRLF line reads the same through both passes", () => {
		const text = "Cost `2 + 3` today\r\nand `4 * 5`\r\n";
		const read = (r: ParsingResult) => r.lines.map((l) => l.inlineSolves.map((s) => `${s.start}-${s.end} ${s.result ? formatValue(s.result) : s.error}`));
		expect(read(incremental(text))).toEqual(read(batch(text)));
	});

	test("a document of only line breaks of both kinds", () => {
		const text = "\r\n\n\r\n";
		expect(batch(text).totalLines).toBe(4);
		expect(shape(incremental(text))).toEqual(shape(batch(text)));
	});
});
