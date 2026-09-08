/**
 * A line reference means a position, and a structural edit moves positions.
 *
 * `line 5` names wherever line five happens to be, so inserting a line above it
 * changes what it refers to without changing a character of the line doing the
 * referring. The same is true of `prev`, which names a different neighbour, and
 * of the `above` aggregates, which cover a different block. None of that reached
 * the invalidation a structural edit performs, which followed the names a
 * deleted line wrote and nothing else, so a positional reader kept the answer it
 * had computed about a position that now holds something else:
 *
 * | document                     | action           | before | now                             |
 * | ---                          | ---              | ---    | ---                             |
 * | `10` / `line 1 + 5`          | insert `20` at 1 | `15`   | `25`                            |
 * | `line 2 + 4` / `10`          | insert `5` at 1  | `14`   | `Line 2 has not been evaluated` |
 *
 * Every positional reader is re-run, not only the ones whose target moved. A
 * reader that shifted past its own target is the case that shows why: `line 5 +
 * 4` sitting at position 4 is an ordinary reference, and an insert above it
 * leaves the same text at position 5, referring to itself. Positional readers
 * are a small minority of a document's lines, so re-running all of them costs
 * almost nothing and cannot be wrong.
 *
 * Which leaves the second half. A line refuses to read its own position now,
 * rather than being handed its own previous result. From scratch that never came
 * up: a line's result is not there yet when it runs, so reading its own position
 * gave nothing and the line reported it. Only a structural edit could produce a
 * self-reference that already had a perfectly good value, from when it meant
 * something else.
 *
 * Refusing it also closed a disagreement between the entry points. A
 * self-reference used to report `Line 1 has an error` through
 * `evaluateDocument`, which is what a line says when the line it read holds an
 * error, and `Line 1 has not been evaluated yet` through `parseDocument`, which
 * is what the case actually is. Both give the second sentence now.
 *
 * The boundary: this is about a position's meaning changing, not about
 * evaluation order. A plain forward reference still resolves the way it always
 * has on the incremental path, which reaches its answer by running the document
 * again rather than in one sweep.
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
	for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
	const answers = answersOf(doc, lines.length);
	evaluator.terminateWorker();
	return answers;
}

function editorFor(lines: string[]) {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return { doc, evaluator };
}

describe("a line reference after a structural edit", () => {
	test("follows the position, not the line it used to name", () => {
		const { doc, evaluator } = editorFor(["10", "line 1 + 5"]);
		expect(shown(doc, 2)).toBe("15");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["20"] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		const text = ["20", "10", "line 1 + 5"];
		expect(answersOf(doc, 3)).toEqual(settled(text));
		expect(shown(doc, 3)).toBe("25");
	});

	test("follows the position after a delete too", () => {
		const { doc, evaluator } = editorFor(["10", "20", "line 2 + 1"]);
		expect(shown(doc, 3)).toBe("21");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled(["20", "line 2 + 1"]));
	});

	test("a reader shifted onto itself reports the self-reference", () => {
		// The shape the fuzzer shrank to. `line 2 + 4` at position 1 is an
		// ordinary reference; the insert leaves it at position 2, referring to
		// itself, holding the answer it had from when it did not.
		const { doc, evaluator } = editorFor(["line 2 + 4", "10"]);
		expect(shown(doc, 1)).toBe("14");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["5"] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		const text = ["5", "line 2 + 4", "10"];
		expect(answersOf(doc, 3)).toEqual(settled(text));
		expect(shown(doc, 2)).toContain("has not been evaluated yet");
	});

	test("a line written as a self-reference reports it, as it always did", () => {
		// The case that always worked, kept so the refusal above cannot be
		// mistaken for the whole of it. The wording moved: it used to read
		// "Line 1 has an error", which is what a line reports when the line it
		// read holds one, and a self-reference is not that. It is now the same
		// sentence the batch pass has always given, which the next test pins.
		const { doc } = editorFor(["line 1 + 1", "5"]);
		expect(shown(doc, 1)).toContain("has not been evaluated yet");
	});

	test("says the same thing the batch pass says", () => {
		// The cross-path rule: a whole-document form must not answer one way
		// through parseDocument and another through evaluateDocument. These
		// two disagreed on a self-reference, the incremental path reporting an
		// error on the line it read and the batch pass reporting the forward
		// reference. Refusing the self-read is what closed it.
		const engine = createEngine();
		const batch = engine.parseDocument(["line 1 + 1", "5"].join("\n"));
		const batchAnswer = batch.lines[0].result
			? formatValue(batch.lines[0].result).replace(/^=\s*/, "")
			: "";

		expect(batchAnswer).toBe(settled(["line 1 + 1", "5"])[0]);
		expect(batchAnswer).toContain("has not been evaluated yet");
	});

	test("a running total below an insert still follows its block", () => {
		// `prev` and the `above` aggregates read positions through the same
		// closure a line reference does, so they are invalidated by the same
		// rule and would silently share any gap in it.
		const { doc, evaluator } = editorFor(["10", "20", "total above"]);
		expect(shown(doc, 3)).toBe("30");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["5"] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 4 });

		expect(answersOf(doc, 4)).toEqual(settled(["5", "10", "20", "total above"]));
		expect(shown(doc, 4)).toBe("35");
	});

	test("prev follows its new neighbour", () => {
		const { doc, evaluator } = editorFor(["10", "prev + 1"]);
		expect(shown(doc, 2)).toBe("11");

		evaluator.applyTransaction([{ startLine: 2, deleteCount: 0, insertLines: ["40"] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(answersOf(doc, 3)).toEqual(settled(["10", "40", "prev + 1"]));
		expect(shown(doc, 3)).toBe("41");
	});

	test("a document with no positional reader is untouched", () => {
		// The rule re-runs every positional reader, so a document with none
		// must pay nothing and change nothing.
		const { doc, evaluator } = editorFor([":x = 2", "x + 1", "4 + 4"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["9 + 9"] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 4 });

		expect(answersOf(doc, 4)).toEqual(settled(["9 + 9", ":x = 2", "x + 1", "4 + 4"]));
	});
});
