/**
 * A structural edit takes the positional answers with it.
 *
 * A line that reads a position (`prev`, `line 7`, a range, the `above`
 * aggregates, a table column) is marked dirty when an insert or a delete moves
 * what that position holds. That says it must run again. It does not stop
 * another line reading what it said in the meantime, and what it said was about
 * a document that no longer exists.
 *
 * That is how an edit into a cycle reached an answer no pass over the same text
 * reaches:
 *
 * | document                                   | action              | before  | now                   |
 * | ---                                        | ---                 | ---     | ---                   |
 * | `:v = 46` / `average above`                | insert `line 3 + 5` | `54.75` | `Line 3 has an error` |
 *
 * The inserted line reads line 3, and line 3 averages the block above it, which
 * now contains the inserted line. Given a value to start from, the two chased
 * each other by a smaller amount each pass, and the answer was wherever the
 * passes ran out: `54.75` was not an answer, it was a snapshot of an
 * unfinished iteration, and the same document left alone gave a different number
 * every pass. With the average's old answer gone, neither line has anything to
 * chase, both report the cycle, and the document is still.
 *
 * Only the lines that read a position, and only on a structural edit. An
 * ordinary edit leaves every position meaning what it meant, so a reader's
 * answer is still about this document and taking it away would show an error to
 * whoever asked before it ran again. Two wider rules were tried against the
 * differential fuzz and both made it worse: refusing to read a dirty line at all
 * traded this for `total of #food` reporting the line below it as unevaluated,
 * and forgetting the answers of every reader of every changed position produced
 * six times as many disagreements as it fixed.
 *
 * The boundary, and it is measured rather than assumed: a cycle an *ordinary*
 * edit creates is not covered, because the rule is keyed to the structural
 * change. It is the only shape the fuzz still reports, at roughly one session in
 * a thousand, and it is filed.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";

/** One line's answer, as a reader sees it. */
function shown(doc: DocumentModel, lineNumber: number): string {
	const result = doc.getLineAt(lineNumber)?.result;
	return result ? formatValue(result).replace(/^=\s*/, "") : "";
}

const answersOf = (doc: DocumentModel, count: number) =>
	Array.from({ length: count }, (_, i) => shown(doc, i + 1));

/** What a settled pass over this text gives, with no editing history. */
function settled(lines: string[]): string[] {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
	const answers = answersOf(doc, lines.length);
	evaluator.terminateWorker();
	return answers;
}

function editorFor(lines: string[]) {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return { doc, evaluator };
}

describe("an insert that creates a positional cycle", () => {
	test("reports the cycle rather than a number it chased", () => {
		// The shape the fuzzer shrank to: two lines and one insert.
		const { doc, evaluator } = editorFor([":v = 46", "average above"]);
		expect(shown(doc, 2)).toBe("46");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["line 3 + 5"] }]);
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(answersOf(doc, 3)).toEqual(settled(["line 3 + 5", ":v = 46", "average above"]));
		expect(shown(doc, 1)).toContain("error");
	});

	test("stops moving, where it used to answer differently every pass", () => {
		// The tell that the old answer was an unfinished iteration and not an
		// answer at all. A reader who stops typing is entitled to a still
		// document.
		const { doc, evaluator } = editorFor([":v = 46", "average above"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["line 3 + 5"] }]);
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		const settledAnswers = answersOf(doc, 3);
		for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });
		expect(answersOf(doc, 3)).toEqual(settledAnswers);
	});

	test("a delete reaches it the same way", () => {
		const lines = ["10", "line 3 + 5", ":v = 46", "total above"];
		const { doc, evaluator } = editorFor(lines);

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(answersOf(doc, 3)).toEqual(settled(["line 3 + 5", ":v = 46", "total above"]));
	});

	test("a cycle written from the start reported it all along", () => {
		// Kept so the fix cannot be mistaken for the whole behaviour: this case
		// never went wrong, which is what made the fault incremental only.
		expect(settled(["line 3 + 5", ":v = 46", "average above"])[0]).toContain("error");
	});
});

describe("what a structural edit leaves alone", () => {
	test("an aggregate below an insert still answers", () => {
		// The other half of the rule. Forgetting a reader's answer must not
		// stop it having one: it is dirty, so it runs again in the same pass.
		const { doc, evaluator } = editorFor(["10", "20", "total above"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["5"] }]);
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 4 });

		expect(answersOf(doc, 4)).toEqual(settled(["5", "10", "20", "total above"]));
		expect(shown(doc, 4)).toBe("35");
	});

	test("an ordinary edit keeps a reader's answer", () => {
		// Not forgotten on an ordinary edit, because every position still means
		// what it meant. Taking the answer away would show an error to whoever
		// asked before the line ran again.
		const { doc, evaluator } = editorFor(["10", "20", "total above", "line 3 + 1"]);
		expect(shown(doc, 4)).toBe("31");

		doc.editLine(1, "15");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 4 });

		expect(answersOf(doc, 4)).toEqual(settled(["15", "20", "total above", "line 3 + 1"]));
		expect(shown(doc, 4)).toBe("36");
	});

	test("a document with no positional reader is untouched", () => {
		const { doc, evaluator } = editorFor([":x = 2", "x + 1", "4 + 4"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["9 + 9"] }]);
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 4 });

		expect(answersOf(doc, 4)).toEqual(settled(["9 + 9", ":x = 2", "x + 1", "4 + 4"]));
	});
});
