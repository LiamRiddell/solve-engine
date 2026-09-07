/**
 * `total of #tag` reads its own members, not the whole document.
 *
 * The aggregate used to walk every line of the document asking each one whether
 * it carried the tag, so a document of D aggregates over N lines cost D x N a
 * pass: twenty thousand lines of tagged amounts and totals took over four
 * minutes, synchronously, and the incremental path paid it again per keystroke.
 * Both document paths now keep a tag to lines index and the aggregate reads it.
 *
 * An index is only worth having if it says exactly what the walk said, so these
 * pin the readings that could drift between the two: which lines are members,
 * in which order they are visited, and that the index still says so after the
 * document has been edited underneath it.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";

/** The engine's answer for one line of a document, through the batch pass. */
function batchLine(text: string, lineNumber: number): string {
	const result = createEngine().parseDocument(text);
	const line = result.lines[lineNumber - 1];
	return line.error ?? (line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

/** The same, through the incremental pass. */
function incrementalLine(text: string, lineNumber: number): string {
	const result = evaluateDocument(createEngine(), text);
	const line = result.lines[lineNumber - 1];
	return line.error ?? (line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

describe("the lines a tag aggregate reads", () => {
	test("a member written in another case is still in the group", () => {
		// `lineCarriesTag` has always read a tag case-insensitively, so the
		// index has to fold case too or `#Food` would fall out of `#food`.
		const doc = ["10 #Food", "20 #FOOD", "5 #food", "total of #food"].join("\n");
		expect(batchLine(doc, 4)).toBe("35");
		expect(incrementalLine(doc, 4)).toBe("35");
	});

	test("a heading is not a member of its own name", () => {
		const doc = ["# food", "10 #food", "total of #food"].join("\n");
		expect(batchLine(doc, 3)).toBe("10");
		expect(incrementalLine(doc, 3)).toBe("10");
	});

	test("another aggregate over the same tag is not a member of it", () => {
		// Two totals over one tag each named the other as an unevaluated line
		// before #382. The index is built from the same reading, so it holds.
		const doc = ["10 #food", "20 #food", "total of #food", "average of #food"].join("\n");
		expect(batchLine(doc, 3)).toBe("30");
		expect(batchLine(doc, 4)).toBe("15");
		expect(incrementalLine(doc, 3)).toBe("30");
		expect(incrementalLine(doc, 4)).toBe("15");
	});

	test("a line that asks about one group and joins another is in the second only", () => {
		const doc = ["10 #food", "total of #food #reviewed", "3 #reviewed", "total of #reviewed"].join("\n");
		// Line 2 asks about #food (10) and joins #reviewed.
		expect(batchLine(doc, 2)).toBe("10");
		// So #reviewed holds line 2's own result and line 3's.
		expect(batchLine(doc, 4)).toBe("13");
		expect(incrementalLine(doc, 2)).toBe("10");
		expect(incrementalLine(doc, 4)).toBe("13");
	});

	test("a longer tag is not read as a shorter one", () => {
		const doc = ["10 #housingcost", "3 #housing", "total of #housing"].join("\n");
		expect(batchLine(doc, 3)).toBe("3");
		expect(incrementalLine(doc, 3)).toBe("3");
	});

	test("a member below the aggregate is named, not silently skipped", () => {
		// The walk read line text, which exists for the whole document before
		// any of it runs, so an aggregate above its members reported the first
		// one it could not read rather than a short answer. A member set that
		// filled in as the pass went would have quietly under-counted instead,
		// which is why the index is built from text and not from what has run.
		const doc = ["total of #food", "10 #food"].join("\n");
		expect(batchLine(doc, 1)).toContain("has not been evaluated yet");
		expect(incrementalLine(doc, 1)).toContain("has not been evaluated yet");
	});

	test("the line named is the first unreadable member in the document", () => {
		// Ascending order is the visible half of the index: report line 2, the
		// first member the aggregate cannot read, not whichever was indexed first.
		const doc = ["total of #food", "1 #food", "2 #food", "3 #food"].join("\n");
		expect(batchLine(doc, 1)).toContain("Line 2");
		expect(incrementalLine(doc, 1)).toContain("Line 2");
	});
});

describe("the index after the document changes underneath it", () => {
	test("a line edited into the group joins it", () => {
		const doc = new DocumentModel();
		doc.setDocument("10 #food\n20\n");
		expect(doc.linesCarryingTag("food")).toEqual([1]);
		doc.editLine(2, "20 #food");
		expect(doc.linesCarryingTag("food")).toEqual([1, 2]);
	});

	test("a line edited out of the group leaves it", () => {
		const doc = new DocumentModel();
		doc.setDocument("10 #food\n20 #food\n");
		expect(doc.linesCarryingTag("food")).toEqual([1, 2]);
		doc.editLine(1, "10");
		expect(doc.linesCarryingTag("food")).toEqual([2]);
	});

	test("a line edited from one group to another moves between them", () => {
		const doc = new DocumentModel();
		doc.setDocument("10 #food\n");
		doc.linesCarryingTag("food"); // build the index before the edit
		doc.editLine(1, "10 #travel");
		expect(doc.linesCarryingTag("food")).toEqual([]);
		expect(doc.linesCarryingTag("travel")).toEqual([1]);
	});

	test("inserting above a member moves it rather than losing it", () => {
		// The index is keyed by line id, so a line that only shifted position
		// is not re-scanned, and reads back at its new position.
		const doc = new DocumentModel();
		doc.setDocument("10 #food\n");
		expect(doc.linesCarryingTag("food")).toEqual([1]);
		doc.insertLines(1, ["a note", "another"]);
		expect(doc.linesCarryingTag("food")).toEqual([3]);
	});

	test("deleting a member drops it from the group", () => {
		const doc = new DocumentModel();
		doc.setDocument("10 #food\n20 #food\n30 #food\n");
		expect(doc.linesCarryingTag("food")).toEqual([1, 2, 3]);
		doc.deleteLines(2, 2);
		expect(doc.linesCarryingTag("food")).toEqual([1, 2]);
	});

	test("replacing the document forgets the previous one's groups", () => {
		const doc = new DocumentModel();
		doc.setDocument("10 #food\n");
		expect(doc.linesCarryingTag("food")).toEqual([1]);
		doc.setDocument("10 #travel\n");
		expect(doc.linesCarryingTag("food")).toEqual([]);
		expect(doc.linesCarryingTag("travel")).toEqual([1]);
	});

	test("an index built before an edit and one built after agree", () => {
		// The maintained index and a freshly scanned one have to say the same
		// thing, or an editing session drifts from a reload of the same text.
		const text = "1 #a\n2 #b\n3 #a\n";
		const maintained = new DocumentModel();
		maintained.setDocument("1 #a\n2 #a\n");
		maintained.linesCarryingTag("a");
		maintained.editLine(2, "2 #b");
		maintained.insertLines(3, ["3 #a"]);

		const fresh = new DocumentModel();
		fresh.setDocument(text);
		expect(maintained.linesCarryingTag("a")).toEqual(fresh.linesCarryingTag("a"));
		expect(maintained.linesCarryingTag("b")).toEqual(fresh.linesCarryingTag("b"));
	});

	test("an edit that does not change the text leaves the group alone", () => {
		const doc = new DocumentModel();
		doc.setDocument("10 #food\n");
		expect(doc.linesCarryingTag("food")).toEqual([1]);
		expect(doc.editLine(1, "10 #food")).toBe(false);
		expect(doc.linesCarryingTag("food")).toEqual([1]);
	});
});
