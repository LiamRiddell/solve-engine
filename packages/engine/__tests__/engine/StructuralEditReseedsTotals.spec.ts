/**
 * A running total is re-seeded after a line is inserted or deleted.
 *
 * `spent += 5` re-applies its delta over whatever the total currently holds, so
 * a pass has to reset each total to its seed and re-run every line that touches
 * it, or the second pass adds the same amounts again. `reseedAccumulators` does
 * that, and it asked the dependency graph which lines write an accumulator.
 *
 * A structural edit clears the graph and lets the next pass rebuild it, so on
 * the pass that follows an insert or a delete the graph answered nothing at all.
 * No line was marked, none re-ran, and the totals below the edit kept the
 * previous pass's sum:
 *
 * | document                                  | before | now |
 * | ---                                       | ---    | --- |
 * | `spent += 7`, then `spent += 2` inserted above | `7` | `9` |
 *
 * A line's own write set is recorded on the line and survives the edit, so that
 * is what it reads now.
 *
 * Found by a differential fuzz that drives random documents through random
 * editor actions and compares every line against a settled pass over the same
 * text.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";

/** The answers a settled pass over this text gives, with no editing history. */
function settled(lines: string[]): (number | undefined)[] {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return lines.map((_, i) => doc.getLineAt(i + 1)?.result?.toNumber());
}

function editorFor(lines: string[]) {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return { doc, evaluator };
}

const answers = (doc: DocumentModel, count: number) =>
	Array.from({ length: count }, (_, i) => doc.getLineAt(i + 1)?.result?.toNumber());

describe("a running total after a structural edit", () => {
	test("an accumulator inserted above another one is counted", () => {
		const { doc, evaluator } = editorFor(["# a heading", "spent += 7"]);
		expect(doc.getLineAt(2)!.result!.toNumber()).toBe(7);

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["spent += 2"] }]);
		evaluator.evaluate({ startLine: 1, endLine: 3 });

		const after = ["spent += 2", "# a heading", "spent += 7"];
		expect(answers(doc, 3)).toEqual(settled(after));
		expect(doc.getLineAt(3)!.result!.toNumber()).toBe(9);
	});

	test("an accumulator deleted from the middle stops counting", () => {
		const lines = ["spent += 1", "spent += 2", "spent += 4", "spent"];
		const { doc, evaluator } = editorFor(lines);
		expect(doc.getLineAt(4)!.result!.toNumber()).toBe(7);

		evaluator.applyTransaction([{ startLine: 2, deleteCount: 1, insertLines: [] }]);
		evaluator.evaluate({ startLine: 1, endLine: 3 });

		const after = ["spent += 1", "spent += 4", "spent"];
		expect(answers(doc, 3)).toEqual(settled(after));
		expect(doc.getLineAt(3)!.result!.toNumber()).toBe(5);
	});

	test("a total does not grow when the same text is evaluated again", () => {
		// The property the re-seed exists for, which the graph-based version
		// still had: without it a second pass adds every delta a second time.
		const { doc, evaluator } = editorFor(["spent += 3", "spent += 4", "spent"]);
		expect(doc.getLineAt(3)!.result!.toNumber()).toBe(7);

		evaluator.evaluate({ startLine: 1, endLine: 3 });
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		expect(doc.getLineAt(3)!.result!.toNumber()).toBe(7);
	});

	test("several edits in a row each leave the total right", () => {
		const lines = ["spent += 1", "spent"];
		const { doc, evaluator } = editorFor(lines);

		evaluator.applyTransaction([{ startLine: 2, deleteCount: 0, insertLines: ["spent += 10"] }]);
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		expect(doc.getLineAt(3)!.result!.toNumber()).toBe(11);

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["spent += 100"] }]);
		evaluator.evaluate({ startLine: 1, endLine: 4 });
		expect(doc.getLineAt(4)!.result!.toNumber()).toBe(111);

		evaluator.applyTransaction([{ startLine: 2, deleteCount: 1, insertLines: [] }]);
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		expect(doc.getLineAt(3)!.result!.toNumber()).toBe(110);
	});

	test("two totals kept apart", () => {
		const lines = ["spent += 5", "saved += 2", "spent", "saved"];
		const { doc, evaluator } = editorFor(lines);
		expect(answers(doc, 4)).toEqual([5, 2, 5, 2]);

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["spent += 20"] }]);
		evaluator.evaluate({ startLine: 1, endLine: 5 });

		const after = ["spent += 20", "spent += 5", "saved += 2", "spent", "saved"];
		expect(answers(doc, 5)).toEqual(settled(after));
		expect(doc.getLineAt(4)!.result!.toNumber()).toBe(25);
		expect(doc.getLineAt(5)!.result!.toNumber()).toBe(2);
	});
});
