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
 * The insert and delete half of this was fixed first (2.38.19): a structural
 * edit takes the answers off the lines that read a position, so neither has
 * anything to chase. The **ordinary** edit took longer, because nothing moved,
 * and every rule tried for it made the engine disagree with itself somewhere
 * else instead. Seven approaches are recorded on the issue with what each cost,
 * measured against 1,600 to 3,200 random editing sessions each. The short
 * version: every rule that changes what a positional read returns, or when an
 * answer is thrown away, trades this bug for a different disagreement of the
 * same size.
 *
 * The fix does neither. It corrects the graph: a line's positional edges now
 * follow its text (an edited line's go before it runs, and a run cuts them back
 * to what it read), and at the end of a pass in which a line recorded a
 * position it had not recorded, the cycles through those lines are found once
 * and each member holding a number, which a settled pass never holds, is
 * forgotten and marked to run again. See
 * `AnOrdinaryEditIntoAPositionalCycle.spec.ts` for the shapes and the
 * boundaries. The two reproductions below pass without any other change.
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
	test("agrees with a pass over the same text", () => {
		const { doc, evaluator } = editorFor(["1 sprint = 2 weeks", "prev + 5"]);

		doc.editLine(1, "line 2 + 5");
		for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled(["line 2 + 5", "prev + 5"]));
	});

	test("stops moving once the reader stops typing", () => {
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
		// #445 covers this; it is here so the two halves of the issue are seen
		// to hold together.
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
