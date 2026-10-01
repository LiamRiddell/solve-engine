import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";
import { DocumentModel, splitInsertedLines, type LineChange } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, inPlaceEdits, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { hasLineBreak, splitLines } from "@solve-js/utilities/Strings";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a text holding a carriage return stayed one line when it arrived
 * through `editLine` or `applyTransaction`. `setDocument` and `parseDocument`
 * split a lone CR as a line break, as they split LF and CRLF, so `5\r6` was two
 * lines loaded and one line edited in, and the live evaluator then answered a
 * different document from the one `parseDocument` read. A line feed inside an
 * edit did the same.
 *
 * An inserted text is now split at its line breaks wherever it arrives
 * (`splitInsertedLines`, in `applyChanges` and in the evaluator's
 * `applyTransaction`), and an `editLine` whose text holds one replaces the line
 * with the lines it holds, through the evaluator when one owns the model
 * (`DocumentModel.setStructuralEditor`), so the graph and the chain follow the
 * lines that moved.
 */

function shownLine(line: EvalLineResult): string {
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	const text = formatValue(line.result).replace(/^=\s*/, "");
	return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
}

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
	});
}

const texts = (doc: DocumentModel): string[] => doc.getAllLines().map((l) => l.text);

/** A live note, edited by `edit`, then evaluated; with what a fresh batch pass over the resulting text answers. */
function live(start: string, edit: (doc: DocumentModel, evaluator: ThreeTierEvaluator) => void): { lines: string[]; editor: string[]; settled: string[] } {
	const doc = new DocumentModel();
	doc.setDocument(start);
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	try {
		evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		edit(doc, evaluator);
		const editor = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(shownLine);
		return { lines: texts(doc), editor, settled: read(newTrackedEngine().parseDocument(texts(doc).join("\n"))) };
	} finally {
		evaluator.dispose();
	}
}

describe("the reported case: a line break inside an edit is a line break", () => {
	test.each([["\r"], ["\n"], ["\r\n"]])("editLine with %j between two figures makes two lines", (brk) => {
		const out = live("1\n2\ntotal above", (doc) => doc.editLine(1, `5${brk}6`));
		expect(out.lines).toEqual(["5", "6", "2", "total above"]);
		expect(out.editor).toEqual(out.settled);
		expect(out.editor).toEqual(["5", "6", "2", "13"]);
	});

	test.each([["\r"], ["\n"], ["\r\n"]])("a transaction inserting %j splits it, in place and structurally", (brk) => {
		const inPlace = live("1\n2\nprev * 10", (_doc, evaluator) => evaluator.applyTransaction([{ startLine: 2, deleteCount: 1, insertLines: [`7${brk}8`] }]));
		expect(inPlace.lines).toEqual(["1", "7", "8", "prev * 10"]);
		expect(inPlace.editor).toEqual(inPlace.settled);
		const structural = live("1\n2", (_doc, evaluator) => evaluator.applyTransaction([{ startLine: 2, deleteCount: 0, insertLines: [`7${brk}8`] }]));
		expect(structural.lines).toEqual(["1", "7", "8", "2"]);
		expect(structural.editor).toEqual(structural.settled);
	});

	test("the same text loaded, edited in, and parsed reads as the same lines", () => {
		const text = "1\r2\r\n3\ntotal above";
		const loaded = new DocumentModel();
		loaded.setDocument(text);
		const edited = new DocumentModel();
		edited.setDocument("x");
		edited.editLine(1, text);
		expect(texts(edited)).toEqual(texts(loaded));
		expect(texts(loaded)).toEqual(splitLines(text));
	});
});

describe("the three entry points", () => {
	test("a line reference below a split edit reads the line now at its number, as the batch pass does", () => {
		const out = live("10\nline 2 + 1\n30", (doc) => doc.editLine(1, "10\r20"));
		expect(out.lines).toEqual(["10", "20", "line 2 + 1", "30"]);
		expect(out.editor).toEqual(out.settled);
		expect(out.editor[2]).toBe("21");
	});
});

describe("the parts", () => {
	test("hasLineBreak: ordinary, boundary and hostile text", () => {
		expect(hasLineBreak("5")).toBe(false);
		expect(hasLineBreak("")).toBe(false);
		expect(hasLineBreak("\r")).toBe(true);
		expect(hasLineBreak("\n")).toBe(true);
		expect(hasLineBreak("a\r\nb")).toBe(true);
		// Look-alikes that are not line breaks as the engine splits them.
		expect(hasLineBreak("a b")).toBe(false);
		expect(hasLineBreak("a\u0085b")).toBe(false);
		expect(hasLineBreak("a\\nb")).toBe(false);
	});

	test("splitInsertedLines: a transaction with no break comes back as it was", () => {
		const changes: LineChange[] = [{ startLine: 1, deleteCount: 1, insertLines: ["a", "b"] }];
		expect(splitInsertedLines(changes)).toBe(changes);
		expect(splitInsertedLines([])).toEqual([]);
	});

	test("splitInsertedLines: each text is split where splitLines splits it, and the other changes kept", () => {
		const changes: LineChange[] = [
			{ startLine: 5, deleteCount: 0, insertLines: ["x"] },
			{ startLine: 1, deleteCount: 1, insertLines: ["a\rb", "c\r\n", "\n"] },
		];
		expect(splitInsertedLines(changes)).toEqual([
			{ startLine: 5, deleteCount: 0, insertLines: ["x"] },
			{ startLine: 1, deleteCount: 1, insertLines: ["a", "b", "c", "", "", ""] },
		]);
		// The caller's changes are not changed.
		expect(changes[1].insertLines).toEqual(["a\rb", "c\r\n", "\n"]);
	});

	test("splitInsertedLines: hostile shapes pass through for the caller to refuse", () => {
		const odd = [{ startLine: 1, deleteCount: 1, insertLines: [5 as unknown as string, "a\nb"] }];
		expect(splitInsertedLines(odd)[0].insertLines).toEqual([5, "a", "b"]);
		const missing = [{ startLine: 1, deleteCount: 1 } as unknown as LineChange];
		expect(splitInsertedLines(missing)).toBe(missing);
	});

	test("inPlaceEdits reads the split counts: a break turns an in-place edit into a structural one", () => {
		const change: LineChange = { startLine: 1, deleteCount: 1, insertLines: ["1\r2"] };
		expect(inPlaceEdits([change], 3)).toEqual([[1, "1\r2"]]);
		expect(inPlaceEdits(splitInsertedLines([change]), 3)).toBeNull();
	});

	test("setStructuralEditor: editLine hands a split edit to the editor, and applies it itself without one", () => {
		const doc = new DocumentModel();
		doc.setDocument("a\nb");
		const seen: LineChange[][] = [];
		const editor = (changes: LineChange[]) => {
			seen.push(changes);
			doc.applyChanges(changes);
		};
		doc.setStructuralEditor(editor);
		expect(doc.getStructuralEditor()).toBe(editor);
		expect(doc.editLine(1, "x\ry")).toBe(true);
		expect(seen).toEqual([[{ startLine: 1, deleteCount: 1, insertLines: ["x", "y"] }]]);
		doc.setStructuralEditor(null);
		expect(doc.editLine(3, "p\nq")).toBe(true);
		expect(texts(doc)).toEqual(["x", "y", "p", "q"]);
		expect(seen.length).toBe(1);
	});

	test("an evaluator installs itself as the editor and takes itself off when retired", () => {
		const doc = new DocumentModel();
		doc.setDocument("1");
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		expect(doc.getStructuralEditor()).not.toBeNull();
		evaluator.dispose();
		expect(doc.getStructuralEditor()).toBeNull();
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a split edit defining %s", (word) => {
		expectPrototypeUntouched(() => {
			const out = live("0", (doc) => doc.editLine(1, `:${word} = 2\r${word} * 3`));
			expect(out.editor).toEqual(out.settled);
		});
	});

	test("a pasted text of two thousand lines inside one edit is split and answered within budget", () => {
		const paste = Array.from({ length: 2_000 }, (_, i) => String(i)).join("\r");
		const started = performance.now();
		const out = live("0\ntotal above", (doc) => doc.editLine(1, paste));
		expect(performance.now() - started).toBeLessThan(20_000);
		expect(out.lines.length).toBe(2_001);
		expect(out.editor[out.editor.length - 1]).toBe(out.settled[out.settled.length - 1]);
	});

	test("a paste past the model's line ceiling is refused by name and leaves the model as it was", () => {
		const doc = new DocumentModel(5);
		doc.setDocument("1\n2");
		expect(() => doc.editLine(1, "a\nb\nc\nd\ne\nf")).toThrow(/more than 5 lines/);
		expect(texts(doc)).toEqual(["1", "2"]);
	});

	test.each(TEXT_EDGES.map((text) => [JSON.stringify(text), text]))("an edit of %s agrees with the batch pass", (_label, text) => {
		const out = live("1\n2", (doc) => doc.editLine(1, text));
		expect(out.editor).toEqual(out.settled);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a definition split off below a reader: the reader stays undefined, the line below reads it", () => {
		const out = live("x * 2\n0\nx * 3", (doc) => doc.editLine(2, "7\rx = 4"));
		expect(out.editor).toEqual(out.settled);
		expect(out.editor).toEqual(["ERROR Undefined variable: x", "7", "4", "12"]);
	});

	test("an in-place keystroke after a split edit is still in place", () => {
		const doc = new DocumentModel();
		doc.setDocument("1\n2");
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluate({ startLine: 1, endLine: 2 });
			doc.editLine(1, "1\r5");
			const moved = doc.getLineAt(3)!.lineId;
			expect(evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: ["3"] }])).toEqual({ inserted: [], removed: [], edited: [moved] });
			expect(evaluator.evaluate({ startLine: 1, endLine: 3 }).lines.map(shownLine)).toEqual(["1", "5", "3"]);
		} finally {
			evaluator.dispose();
		}
	});
});

describe("adversarial: edge cases", () => {
	test("a text that is only a break makes two blank lines", () => {
		const out = live("5\nprev", (doc) => doc.editLine(1, "\r"));
		expect(out.lines).toEqual(["", "", "prev"]);
		expect(out.editor).toEqual(out.settled);
	});

	test("a trailing break adds a blank line, as it does in a loaded document", () => {
		const doc = new DocumentModel();
		doc.setDocument("1");
		doc.editLine(1, "1\r\n");
		const loaded = new DocumentModel();
		loaded.setDocument("1\r\n");
		expect(texts(doc)).toEqual(texts(loaded));
	});

	test("an edit to a line past the end changes nothing", () => {
		const doc = new DocumentModel();
		doc.setDocument("1");
		expect(doc.editLine(4, "a\rb")).toBe(false);
		expect(texts(doc)).toEqual(["1"]);
	});
});
