/**
 * The order cache behind `getLineAt` / `getLinePosition`.
 *
 * `getLineAt(position)` used to walk the order tree on every call. The
 * cross-line forms (`total above`, a line range, each boundary check) turn a
 * position into a line that way, once per line they scan, every pass, so in an
 * editing session it was the single largest cost in the evaluator. It now reads
 * a cached ordered-id array, built in the same pass as the lineId→position map
 * and invalidated with it.
 *
 * The cache is a pure speed-up, so the only thing to pin is that it never
 * disagrees with the document's real order: `getLineAt` and `getLinePosition`
 * round-trip, a text edit (which moves no line) leaves it standing, and a
 * structural edit rebuilds it.
 */
import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";

/** Every position round-trips through both lookups and shows the expected text. */
function check(doc: DocumentModel, expected: string[]): void {
	expect(doc.lineCount).toBe(expected.length);
	for (let pos = 1; pos <= expected.length; pos++) {
		const state = doc.getLineAt(pos);
		expect(state?.text).toBe(expected[pos - 1]);
		expect(doc.getLinePosition(state!.lineId)).toBe(pos);
	}
	// One past the end is nothing, as the tree would also report.
	expect(doc.getLineAt(expected.length + 1)).toBeUndefined();
	expect(doc.getLineAt(0)).toBeUndefined();
}

describe("the document order cache", () => {
	test("getLineAt and getLinePosition round-trip on a fresh document", () => {
		const doc = new DocumentModel();
		doc.setDocument(["1 + 1", ":x = 5", "x + 2", "total above"].join("\n"));
		// Prime getLinePosition first so the shared cache is built from that side.
		expect(doc.getLinePosition(doc.getLineAt(2)!.lineId)).toBe(2);
		check(doc, ["1 + 1", ":x = 5", "x + 2", "total above"]);
	});

	test("a text edit leaves the order standing (same lineId, same position)", () => {
		const doc = new DocumentModel();
		doc.setDocument(["10", "20", "30"].join("\n"));
		const idBefore = doc.getLineAt(2)!.lineId;
		doc.editLine(2, "2 + 2");
		check(doc, ["10", "2 + 2", "30"]);
		expect(doc.getLineAt(2)!.lineId).toBe(idBefore); // not a structural change
	});

	test("an insert rebuilds the order", () => {
		const doc = new DocumentModel();
		doc.setDocument(["a", "b", "c"].join("\n"));
		check(doc, ["a", "b", "c"]); // build the cache
		doc.applyChanges([{ startLine: 2, deleteCount: 0, insertLines: ["NEW"] }]);
		check(doc, ["a", "NEW", "b", "c"]);
	});

	test("a delete rebuilds the order", () => {
		const doc = new DocumentModel();
		doc.setDocument(["a", "b", "c", "d"].join("\n"));
		check(doc, ["a", "b", "c", "d"]);
		doc.applyChanges([{ startLine: 2, deleteCount: 1, insertLines: [] }]);
		check(doc, ["a", "c", "d"]);
	});

	test("a run of structural edits stays consistent throughout", () => {
		const doc = new DocumentModel();
		doc.setDocument(["1", "2", "3"].join("\n"));
		check(doc, ["1", "2", "3"]);
		doc.applyChanges([{ startLine: 1, deleteCount: 0, insertLines: ["0"] }]);
		check(doc, ["0", "1", "2", "3"]);
		doc.editLine(3, "two");
		check(doc, ["0", "1", "two", "3"]);
		doc.applyChanges([{ startLine: 4, deleteCount: 1, insertLines: ["three", "four"] }]);
		check(doc, ["0", "1", "two", "three", "four"]);
		doc.applyChanges([{ startLine: 1, deleteCount: 2, insertLines: [] }]);
		check(doc, ["two", "three", "four"]);
	});
});
