/**
 * Changing a definition changes what reads it.
 *
 * `1 sprint = 2 weeks` is expanded while a line is being compiled, so the
 * compiled program for `3 sprints in weeks` has the ratio baked into it. The
 * engine already dropped its own caches when a definition ran, but the
 * incremental path keeps a compiled program per line on the document, and that
 * copy is the one it executes. Nothing dropped it, so the line stayed clean and
 * went on running bytecode compiled against the old definition:
 *
 * | step                              | `3 sprints in weeks` |
 * | ---                               | ---                  |
 * | `1 sprint = 2 weeks`              | `6 weeks`            |
 * | edited to `1 sprint = 3 weeks`    | `6 weeks` before, `9 weeks` now |
 *
 * The invalidation is deliberately conditional. The handler that defines a unit
 * runs every time its line is compiled, which on the incremental path is every
 * pass in which that line is dirty, so invalidating unconditionally would dirty
 * the document again on each of them and every pass would recompile every line
 * for ever. It fires only when the ratio or the base unit actually moved.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";

function build(lines: string[]) {
	const engine = createEngine() as unknown as ExpressionEngine;
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine);
	return { doc, evaluator, view: { startLine: 1, endLine: lines.length } };
}

/** One line's displayed answer. */
function answer(doc: DocumentModel, lineNumber: number): string {
	const result = doc.getLineAt(lineNumber)?.result;
	return result ? formatValue(result).replace(/^=\s*/, "") : "";
}

describe("editing a unit definition", () => {
	test("updates every line that converts with it", () => {
		const { doc, evaluator, view } = build([
			"1 sprint = 2 weeks",
			"3 sprints in weeks",
			"2 sprints in days",
		]);

		evaluator.evaluate(view);
		expect(answer(doc, 2)).toBe("6 weeks");
		expect(answer(doc, 3)).toBe("28 days");

		doc.editLine(1, "1 sprint = 3 weeks");
		evaluator.evaluate(view);
		expect(answer(doc, 2)).toBe("9 weeks");
		expect(answer(doc, 3)).toBe("42 days");
	});

	test("changing the base unit updates them too", () => {
		const { doc, evaluator, view } = build(["1 sprint = 2 weeks", "3 sprints in days"]);

		evaluator.evaluate(view);
		expect(answer(doc, 2)).toBe("42 days");

		doc.editLine(1, "1 sprint = 2 days");
		evaluator.evaluate(view);
		expect(answer(doc, 2)).toBe("6 days");
	});

	test("a reader below the viewport is updated when it is scrolled to", () => {
		const lines = ["1 sprint = 2 weeks", ...Array.from({ length: 40 }, () => "1 + 1"), "3 sprints in weeks"];
		const { doc, evaluator } = build(lines);
		evaluator.evaluate({ startLine: 1, endLine: lines.length });
		expect(answer(doc, 42)).toBe("6 weeks");

		doc.editLine(1, "1 sprint = 5 weeks");
		evaluator.evaluate({ startLine: 1, endLine: lines.length });
		expect(answer(doc, 42)).toBe("15 weeks");
	});

	test("a definition that has not moved does not re-dirty the document", () => {
		// The condition that stops it looping. Re-running the same definition
		// leaves the document clean, so a pass after it does no Tier 1 work.
		const { doc, evaluator, view } = build(["1 sprint = 2 weeks", "3 sprints in weeks"]);

		evaluator.evaluate(view);
		const settled = evaluator.evaluate(view);
		expect(settled.tierCounts.tier1).toBe(0);

		// Re-writing the identical text is not an edit, so nothing moves.
		expect(doc.editLine(1, "1 sprint = 2 weeks")).toBe(false);
		expect(evaluator.evaluate(view).tierCounts.tier1).toBe(0);
		expect(answer(doc, 2)).toBe("6 weeks");
	});

	test("repeated passes after a redefinition settle rather than recompiling for ever", () => {
		const { doc, evaluator, view } = build(["1 sprint = 2 weeks", "3 sprints in weeks"]);
		evaluator.evaluate(view);
		doc.editLine(1, "1 sprint = 3 weeks");
		evaluator.evaluate(view);

		// The pass after the redefinition has nothing left to compile.
		expect(evaluator.evaluate(view).tierCounts.tier1).toBe(0);
		expect(evaluator.evaluate(view).tierCounts.tier1).toBe(0);
		expect(answer(doc, 2)).toBe("9 weeks");
	});

	test("defining a second unit does not disturb the first", () => {
		const { doc, evaluator, view } = build([
			"1 sprint = 2 weeks",
			"3 sprints in weeks",
			"1 iteration = 4 weeks",
			"2 iterations in weeks",
		]);

		evaluator.evaluate(view);
		expect(answer(doc, 2)).toBe("6 weeks");
		expect(answer(doc, 4)).toBe("8 weeks");
	});
});

describe("the same edit through the batch pass", () => {
	test("both document paths agree after a redefinition", () => {
		// The batch pass clears its unit table and recompiles every line each
		// time, so it never had this fault; it is here so the two paths cannot
		// drift, which is what the cross-path rule is for.
		const before = ["1 sprint = 2 weeks", "3 sprints in weeks"].join("\n");
		const after = ["1 sprint = 3 weeks", "3 sprints in weeks"].join("\n");

		const batch = createEngine().parseDocument(after);
		expect(formatValue(batch.lines[1].result!).replace(/^=\s*/, "")).toBe("9 weeks");

		const incremental = evaluateDocument(createEngine(), after);
		expect(formatValue(incremental.lines[1].result!).replace(/^=\s*/, "")).toBe("9 weeks");

		// And the starting point agrees too, so the comparison above is real.
		expect(
			formatValue(createEngine().parseDocument(before).lines[1].result!).replace(/^=\s*/, ""),
		).toBe("6 weeks");
	});
});
