import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { countLines, lineBreakLengthAt, splitLines } from "@solve-js/utilities/Strings";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * A line holding a lone carriage return (`5\r`, from TEXT_EDGES) was split into
 * two lines by parseDocument, whose scan ends a line at "\r", "\n" or "\r\n",
 * and kept as one by DocumentModel, which split on "\n" alone. The two paths
 * counted a note's lines differently, so every line after the first lone "\r"
 * sat at a different position in each: `5\r6` was `5` and `6` to one and a
 * parse error to the other.
 *
 * The model now splits where the scan splits (`splitLines`), and the line's
 * text no longer carries its break, so evaluateDocument reads each break's
 * length from the input to report the batch pass's offsets. The document-size
 * limit counts lines the same way (`countLines`), and so do the what-if
 * forms' check for a global and the random-seed scan.
 */

function answers(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		return formatValue(line.result).replace(/^=\s*/, "");
	});
}

/** The two passes over one text, with the line count the model holds. */
function bothPasses(text: string) {
	const batch = newTrackedEngine().parseDocument(text);
	const incremental = evaluateDocument(newTrackedEngine(), text);
	const doc = new DocumentModel();
	doc.setDocument(text);
	return { batch, incremental, modelLines: doc.lineCount };
}

// ── The parts ───────────────────────────────────────────────────────────

describe("splitLines", () => {
	test.each([
		["", [""]],
		["5", ["5"]],
		["5\n", ["5", ""]],
		["5\r", ["5", ""]],
		["5\r\n", ["5", ""]],
		["5\r6", ["5", "6"]],
		["1\r\n2\n3\r4", ["1", "2", "3", "4"]],
		["\r\r", ["", "", ""]],
		["\n\r", ["", "", ""]],
		["\r\n\r\n", ["", "", ""]],
		["\r\r\n", ["", "", ""]],
	])("%j", (text, lines) => {
		expect(splitLines(text)).toEqual(lines);
		expect(countLines(text)).toBe(lines.length);
	});

	test("a line separator from Unicode is not a line break, as the scan does not take it for one", () => {
		expect(splitLines("5 6")).toEqual(["5 6"]);
		expect(countLines("5  6")).toBe(1);
	});
});

describe("lineBreakLengthAt", () => {
	test("each break's length, and none elsewhere", () => {
		const text = "a\rb\r\nc\nd";
		expect([...text].map((_, i) => lineBreakLengthAt(text, i))).toEqual([0, 1, 0, 2, 1, 0, 1, 0]);
		expect(lineBreakLengthAt(text, text.length)).toBe(0);
		expect(lineBreakLengthAt(text, -1)).toBe(0);
		expect(lineBreakLengthAt("", 0)).toBe(0);
	});
});

describe("countLines", () => {
	test("stops counting past the ceiling, whichever break the note uses", () => {
		for (const brk of ["\n", "\r", "\r\n"]) {
			const text = Array.from({ length: 1_000 }, () => "1").join(brk);
			expect(countLines(text)).toBe(1_000);
			expect(countLines(text, 10)).toBe(11);
		}
	});

	test("a million carriage returns are counted without splitting them", () => {
		expect(countLines("\r".repeat(1_000_000), 50_000)).toBe(50_001);
	});
});

// ── Documents ───────────────────────────────────────────────────────────

describe("both passes hold the same lines", () => {
	test("the reported line, and a lone return between two figures", () => {
		for (const text of ["5\r", "5\r6", "1\r2\rtotal above"]) {
			const { batch, incremental, modelLines } = bothPasses(text);
			expect(answers(incremental)).toEqual(answers(batch));
			expect(modelLines).toBe(batch.lines.length);
		}
		expect(answers(newTrackedEngine().parseDocument("1\r2\rtotal above"))).toEqual(["1", "2", "3"]);
	});

	test("each line's text and offsets are the batch pass's", () => {
		for (const text of ["1\r22\r\n333\n4444\r", "\r\r5\r\n", "x = 4\rx * 2\r\n\rtotal above"]) {
			const { batch, incremental } = bothPasses(text);
			const shape = (r: ParsingResult) => r.lines.map((line) => ({ text: line.text, start: line.startPosition, end: line.endPosition, n: line.lineNumber }));
			expect(shape(incremental)).toEqual(shape(batch));
		}
	});

	test("every TEXT_EDGES line, and every DOCUMENT_EDGES note, counts alike", () => {
		for (const text of [...TEXT_EDGES.map((line) => `1\n${line}\n2\ntotal above`), ...DOCUMENT_EDGES]) {
			const { batch, incremental, modelLines } = bothPasses(text);
			expect({ text, lines: incremental.lines.length }).toEqual({ text, lines: batch.lines.length });
			expect(modelLines).toBe(batch.lines.length);
		}
	});
});

// ── Adversarial ─────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test("the size limit counts a note of lone returns as the lines it has", () => {
		const text = "1\r".repeat(100_001);
		expect(() => newTrackedEngine().parseDocument(text)).toThrow(/more than 100,000 lines/);
		expect(() => new DocumentModel().setDocument(text)).toThrow(/more than 100,000 lines/);
	});

	test("prototype words on lines ended by a lone return", () => {
		expectPrototypeUntouched(() => {
			expectHonestDocument(PROTOTYPE_WORDS.map((word) => `${word} = 1`).join("\r") + "\r" + PROTOTYPE_WORDS.join(" + "));
		});
	});

	test("markup-shaped text and look-alikes between lone returns", () => {
		expectHonestDocument(TEXT_EDGES.join("\r"));
	});
});

describe("adversarial: realistic breakage", () => {
	test("a what-if names the line that sets a global, counted the way the scan counts", () => {
		expect(() => newTrackedEngine().whatIf("x = 1\rglobal :g = 2\rx * 2", { x: "5" })).toThrow(/Line 2 sets a global variable/);
	});

	test("a random seed line after a lone return is still found", () => {
		const text = "1\rrandom seed 7\rroll d6";
		const first = answers(newTrackedEngine().parseDocument(text));
		expect(answers(newTrackedEngine().parseDocument(text))).toEqual(first);
		expect(answers(evaluateDocument(newTrackedEngine(), text))).toEqual(first);
	});

	test("a tag total, a section and a line reference across lone returns", () => {
		expectHonestDocument("# Costs\r10 #a\r20 #a\rtotal of #a\rtotal of section \"Costs\"\rline 2 * 2");
	});
});

describe("adversarial: edge cases", () => {
	test("a note of only returns, a return at each end, and mixed breaks", () => {
		for (const text of ["\r", "\r\r\r", "\r5\r", "5\r\r\n\n\r6", "\r\n\r"]) expectHonestDocument(text);
	});
});

describe("the fast path for a document with no carriage return reads it as the full rule does", () => {
	/** The full rule, the regular expression every path used before the fast path. */
	const reference = (text: string): string[] => text.split(/\r\n|\r|\n/);
	const texts = ["", "\n", "\n\n", "a", "a\nb", "a\nb\n", "\na", "a\r\nb", "a\rb", "a\r", "\r\n", "a\n\rb", "x\n".repeat(500)];

	test.each(texts.map((t) => [JSON.stringify(t).slice(0, 40), t]))("%s", (_label, text) => {
		expect(splitLines(text)).toEqual(reference(text));
		expect(countLines(text)).toBe(reference(text).length);
	});

	test("countLines stops as soon as it passes the ceiling, with or without a carriage return", () => {
		expect(countLines("a\nb\nc\nd", 2)).toBe(3);
		expect(countLines("a\rb\rc\rd", 2)).toBe(3);
		expect(countLines("a\nb", 5)).toBe(2);
	});
});
