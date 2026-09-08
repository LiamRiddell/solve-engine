/**
 * Issue #444: a line edited into a positional cycle chases a number.
 *
 * Two lines that read each other's positions have no settled value, because
 * each is computed from the other. Reached from scratch, neither has a value to
 * start from, so each reports the other and stays there. Reached by editing, one
 * of them already holds a number, and the pair then never settles at all: each
 * pass adds five to each line, so the answers grow by ten a pass, without bound,
 * for as long as the document is open. The number below is simply where one
 * measurement stopped:
 *
 * ```
 * line 2 + 5
 * prev + 5
 * ```
 *
 * | how the document was reached | line 1                |
 * | ---                          | ---                   |
 * | a pass over that text        | `Line 2 has an error` |
 * | that text reached by editing | a number, larger every pass |
 *
 * The insert and delete half of this is fixed (2.38.19): a structural edit takes
 * the answers off the lines that read a position, so neither has anything to
 * chase. An **ordinary** edit is not covered, because nothing moved, and every
 * rule tried for it made the engine disagree with itself somewhere else instead.
 *
 * Seven approaches are recorded on the issue with what each cost, measured
 * against 1,600 to 3,200 random editing sessions each. The short version: every
 * rule that changes what a positional read returns, or when an answer is thrown
 * away, trades this bug for a different disagreement of the same size. The
 * shipped fix works because it does neither, it removes one stale answer at the
 * one moment the document's shape provably changed.
 *
 * These are skipped rather than deleted because the reproduction is the valuable
 * part, and it is smaller than anything the fuzzer will shrink to again. Delete
 * the `.skip` when the fix lands; both should pass without any other change.
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
	for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
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

describe("Issue #444: an ordinary edit into a positional cycle", () => {
	test.skip("agrees with a pass over the same text", () => {
		const { doc, evaluator } = editorFor(["1 sprint = 2 weeks", "prev + 5"]);

		doc.editLine(1, "line 2 + 5");
		for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled(["line 2 + 5", "prev + 5"]));
	});

	test.skip("stops moving once the reader stops typing", () => {
		// The tell that the answer is not an answer: it is `40` and `45` after
		// four passes and `120` and `125` after twelve, growing by ten a pass
		// for as long as anyone leaves the document open.
		const { doc, evaluator } = editorFor(["1 sprint = 2 weeks", "prev + 5"]);
		doc.editLine(1, "line 2 + 5");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		const afterFour = answersOf(doc, 2);
		for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(answersOf(doc, 2)).toEqual(afterFour);
	});

	test("the structural half is fixed, and stays fixed", () => {
		// Not skipped. #445 covers this, and it is here so the skipped pair
		// above cannot be mistaken for the whole issue being open.
		const { doc, evaluator } = editorFor([":v = 46", "average above"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["line 3 + 5"] }]);
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(answersOf(doc, 3)).toEqual(settled(["line 3 + 5", ":v = 46", "average above"]));
	});

	test("a cycle written from the start was never affected", () => {
		// Which is what makes this incremental-only: the same text, read once,
		// has always reported the cycle.
		expect(settled(["line 2 + 5", "prev + 5"])[0]).toContain("error");
	});
});
