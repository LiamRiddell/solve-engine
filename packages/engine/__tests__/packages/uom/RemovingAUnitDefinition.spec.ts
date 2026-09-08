/**
 * A unit whose defining line is gone stops converting.
 *
 * `1 sprint = 2 weeks` registers a unit on the engine, and nothing removed it
 * when the line that said so was deleted or edited into something else. The
 * conversions below it went on working from a definition the document no longer
 * contained:
 *
 * | document                                    | action        | before    | now         |
 * | ---                                         | ---           | ---       | ---         |
 * | `1 sprint = 3 weeks` / `3 sprints in weeks` | delete line 1 | `9 weeks` | `Undefined` |
 * | the same                                    | line 1 to `:v = 47` | `9 weeks` | `Undefined` |
 *
 * A definition now belongs to the line that made it. A line drops its own
 * definitions on the way through being compiled again, so a line that has
 * stopped being a definition stops defining, and one that still says the same
 * thing puts it straight back.
 *
 * Losing a unit has to reach the lines that used it, because a unit is expanded
 * while a line is compiled and those lines hold bytecode built around it. That
 * invalidation is deliberately driven by comparing the units in scope before and
 * after a pass, rather than by counting removals: a line that redefines the same
 * unit on every pass removes and re-adds it every time, and invalidating on the
 * removal alone would recompile the document for ever.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";

function shown(doc: DocumentModel, lineNumber: number): string {
	const result = doc.getLineAt(lineNumber)?.result;
	return result ? formatValue(result).replace(/^=\s*/, "") : "";
}

/** What a settled pass over this text gives, with no editing history. */
function settled(lines: string[]): string[] {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return lines.map((_, i) => shown(doc, i + 1));
}

function editorFor(lines: string[]) {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return { doc, evaluator };
}

const answersOf = (doc: DocumentModel, count: number) =>
	Array.from({ length: count }, (_, i) => shown(doc, i + 1));

describe("removing the line that defines a unit", () => {
	test("editing it into something else stops the conversions", () => {
		const { doc, evaluator } = editorFor(["1 sprint = 3 weeks", "3 sprints in weeks"]);
		expect(shown(doc, 2)).toBe("9 weeks");

		doc.editLine(1, ":v0 = 47");
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled([":v0 = 47", "3 sprints in weeks"]));
		expect(shown(doc, 2)).toContain("Undefined");
	});

	test("deleting it stops the conversions", () => {
		const { doc, evaluator } = editorFor(["1 sprint = 3 weeks", "3 sprints in weeks"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 1 });

		expect(answersOf(doc, 1)).toEqual(settled(["3 sprints in weeks"]));
		expect(shown(doc, 1)).toContain("Undefined");
	});

	test("a definition that has not changed survives every pass", () => {
		// The property the before-and-after comparison protects. A line drops
		// its own definitions as it recompiles, so counting removals would
		// invalidate the document on every pass and never settle.
		const { doc, evaluator } = editorFor(["1 sprint = 3 weeks", "3 sprints in weeks"]);
		for (let pass = 0; pass < 5; pass++) {
			evaluator.evaluate({ startLine: 1, endLine: 2 });
			expect(shown(doc, 2)).toBe("9 weeks");
		}
	});

	test("re-adding the definition brings the unit back", () => {
		const { doc, evaluator } = editorFor(["1 sprint = 3 weeks", "3 sprints in weeks"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 1 });
		expect(shown(doc, 1)).toContain("Undefined");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["1 sprint = 5 weeks"] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(shown(doc, 2)).toBe("15 weeks");
	});

	test("one definition going leaves another standing", () => {
		const lines = ["1 sprint = 3 weeks", "1 cycle = 2 days", "3 sprints in weeks", "4 cycles in days"];
		const { doc, evaluator } = editorFor(lines);
		expect(answersOf(doc, 4)).toEqual(["sprint defined", "cycle defined", "9 weeks", "8 days"]);

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(shown(doc, 2)).toContain("Undefined");
		expect(shown(doc, 3)).toBe("8 days");
	});

	test("the batch pass is unaffected", () => {
		// It clears the unit table per pass and recompiles everything, so it
		// never had this fault; it is here so the two paths cannot drift.
		const engine = createEngine();
		const result = engine.parseDocument(["1 sprint = 3 weeks", "3 sprints in weeks"].join("\n"));
		expect(formatValue(result.lines[1].result!).replace(/^=\s*/, "")).toBe("9 weeks");
	});
});
