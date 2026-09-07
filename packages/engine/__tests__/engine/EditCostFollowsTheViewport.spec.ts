/**
 * An edit costs the viewport, not the distance from line 1.
 *
 * A pass runs from line 1 to the end of the viewport, so scrolling down used to
 * make every keystroke more expensive in proportion to how far down you had
 * scrolled, while the number of lines actually evaluated never changed. Measured
 * on the built package, a thirty-line viewport and one edit inside it:
 *
 * | lines  | at the bottom, before | after   | at the top |
 * | ---    | ---                   | ---     | ---        |
 * | 500    | 0.086 ms              | 0.056 ms | 0.045 ms  |
 * | 3,000  | 0.480 ms              | 0.173 ms | 0.072 ms  |
 * | 10,000 | 1.415 ms              | 0.389 ms | 0.083 ms  |
 * | 20,000 | 3.004 ms              | 0.847 ms | 0.083 ms  |
 *
 * Two changes, both of which leave the evaluated set and its order alone. A
 * clean line outside the viewport now returns before its text is scanned for
 * emptiness and its expressions extracted, neither of which can change what
 * happens to a line that is neither compiled nor executed. And the span is
 * walked once in order rather than descended into per position, which was a
 * third of the cost of an edit on a long document.
 *
 * The boundary: a pass still visits every position up to the viewport, so the
 * cost is still linear in that distance, just with a much smaller constant.
 * Not visiting them at all would change what `EvalResult.lines` contains, which
 * is a published shape.
 *
 * These assert the shape of the curve rather than a time, since a bound in
 * milliseconds measures the machine. The benchmark suite carries the timings.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";

function build(lineCount: number) {
	const engine = createEngine() as unknown as ExpressionEngine;
	const doc = new DocumentModel();
	doc.setDocument(Array.from({ length: lineCount }, (_, i) => `:v${i} = ${i} + 1`).join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine);
	evaluator.evaluate({ startLine: 1, endLine: lineCount });
	return { doc, evaluator };
}

describe("what a pass over a long document does", () => {
	test("a clean line before the viewport is skipped, whatever it says", () => {
		const { doc, evaluator } = build(200);
		doc.editLine(190, ":v189 = 99");
		const result = evaluator.evaluate({ startLine: 180, endLine: 200 });

		// One line recompiled, the viewport re-executed, everything above it left.
		expect(result.tierCounts.tier1).toBe(1);
		expect(result.tierCounts.tier2).toBe(20);
		expect(result.tierCounts.skipped).toBe(179);
		expect(result.tierCounts.tier3).toBe(0);
	});

	test("the returned lines still cover every position up to the viewport", () => {
		// The published shape: one entry per position from 1, including the
		// skipped ones. The short-circuit above must not change that.
		const { doc, evaluator } = build(200);
		doc.editLine(190, ":v189 = 98");
		const result = evaluator.evaluate({ startLine: 180, endLine: 200 });

		expect(result.lines.length).toBe(200);
		expect(result.lines.map((l) => l.lineNumber)).toEqual(
			Array.from({ length: 200 }, (_, i) => i + 1),
		);
	});

	test("a dirty line before the viewport is still compiled", () => {
		// The short-circuit is for CLEAN lines only. A dirty one below the fold
		// goes to Tier 3, which is what keeps a definition's value available to
		// the lines that can be seen.
		const { doc, evaluator } = build(200);
		doc.editLine(5, ":v4 = 12345");
		const result = evaluator.evaluate({ startLine: 180, endLine: 200 });

		expect(result.tierCounts.tier3).toBe(1);
	});

	test("a definition above the viewport still reaches a line inside it", () => {
		const engine = createEngine() as unknown as ExpressionEngine;
		const doc = new DocumentModel();
		doc.setDocument([":rate = 2", ...Array.from({ length: 60 }, () => "1 + 1"), "rate * 10"].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		const view = { startLine: 40, endLine: 62 };
		evaluator.evaluate({ startLine: 1, endLine: 62 });
		expect(doc.getLineAt(62)!.result!.toNumber()).toBe(20);

		// Edit the definition while it is scrolled out of sight.
		doc.editLine(1, ":rate = 5");
		evaluator.evaluate(view);
		expect(doc.getLineAt(62)!.result!.toNumber()).toBe(50);
	});

	test("the answers do not depend on where the viewport sits", () => {
		// The strongest statement of "this changed nothing": evaluate the same
		// document through a narrow viewport at the bottom and through a full
		// one, and every line that both passes evaluated must agree.
		const lines = [":base = 3", ...Array.from({ length: 80 }, (_, i) => `base * ${i + 1}`)];
		const engine = createEngine() as unknown as ExpressionEngine;

		const whole = new DocumentModel();
		whole.setDocument(lines.join("\n"));
		new ThreeTierEvaluator(whole, engine).evaluate({ startLine: 1, endLine: lines.length });

		const engine2 = createEngine() as unknown as ExpressionEngine;
		const narrow = new DocumentModel();
		narrow.setDocument(lines.join("\n"));
		const narrowEval = new ThreeTierEvaluator(narrow, engine2);
		narrowEval.evaluate({ startLine: 1, endLine: lines.length });
		narrow.editLine(1, ":base = 3");
		narrowEval.evaluate({ startLine: 60, endLine: lines.length });

		for (let n = 60; n <= lines.length; n++) {
			expect(narrow.getLineAt(n)!.result!.toNumber()).toBe(whole.getLineAt(n)!.result!.toNumber());
		}
	});

	test("the span is read in document order after lines are inserted", () => {
		// The walk reads the order tree in order rather than by position, so a
		// document whose line ids no longer ascend is the case that would catch
		// it reading the wrong line for a position.
		const { doc, evaluator } = build(20);
		doc.insertLines(5, [":inserted = 7", "inserted * 2"]);
		const result = evaluator.evaluate({ startLine: 1, endLine: 22 });

		expect(result.lines.map((l) => l.lineNumber)).toEqual(
			Array.from({ length: 22 }, (_, i) => i + 1),
		);
		expect(doc.getLineAt(5)!.text).toBe(":inserted = 7");
		expect(doc.getLineAt(6)!.result!.toNumber()).toBe(14);
	});
});
