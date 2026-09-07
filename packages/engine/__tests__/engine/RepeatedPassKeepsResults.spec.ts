/**
 * Evaluating the same document again changes none of its answers.
 *
 * A live document is evaluated over and over, not once, so this is the plainest
 * property the evaluator has and nothing pinned it. Two faults were sitting
 * underneath it, both on lines whose expression compiles to a program with no
 * opcodes: a unit definition (`1 sprint = 2 weeks`) and an equation stored for
 * later (`y + 3 = 10`) do their work while being compiled and have nothing left
 * to run.
 *
 * | line                 | pass 1           | pass 2 before | pass 2 now       |
 * | ---                  | ---              | ---           | ---              |
 * | `1 sprint = 2 weeks` | `sprint defined` | blank         | `sprint defined` |
 * | `y + 3 = 10`         | `y stored as an equation` | blank | unchanged     |
 *
 * Tier 2 skipped the empty programs, collected no results, and then assigned
 * that empty collection over the answer Tier 1 had computed.
 *
 * Keeping the old result was not enough on its own. A pass runs with the Value
 * arena on, and a result that never came back through the VM's `HALT` was
 * never cloned on the way out, so the line was holding an arena slot that a
 * later line is handed: the object read `sprint defined`, then read the number
 * from the line below it, in place. So the result is kept by value.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
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

/** Every line's displayed answer, as a reader would see it. */
function answers(doc: DocumentModel, count: number): string[] {
	const out: string[] = [];
	for (let n = 1; n <= count; n++) {
		const result = doc.getLineAt(n)?.result;
		out.push(result ? formatValue(result).replace(/^=\s*/, "") : "");
	}
	return out;
}

describe("a second pass over an unchanged document", () => {
	test("leaves every answer exactly as the first pass left it", () => {
		const lines = [
			"1 sprint = 2 weeks",
			":count = 10",
			"y + 3 = 10",
			"3 sprints in weeks",
			"count * 2",
			"2 + 2",
			"10 #food",
			"total of #food",
		];
		const { doc, evaluator, view } = build(lines);

		evaluator.evaluate(view);
		const first = answers(doc, lines.length);

		// Three more passes, with the document untouched between them.
		for (let pass = 0; pass < 3; pass++) {
			evaluator.evaluate(view);
			expect(answers(doc, lines.length)).toEqual(first);
		}

		// And the first pass really did produce answers, so the assertion above
		// is not comparing one set of blanks against another.
		expect(first[0]).toContain("sprint");
		expect(first[2]).toContain("y");
		expect(first[3]).toBe("6 weeks");
		expect(first[7]).toBe("10");
	});

	test("a definition line keeps its own answer, not the one below it", () => {
		// The arena half. The line under the definition is what its recycled
		// slot was handed to, so that number is what the definition displayed.
		const lines = ["1 sprint = 2 weeks", ":count = 10"];
		const { doc, evaluator, view } = build(lines);

		evaluator.evaluate(view);
		evaluator.evaluate(view);

		expect(formatValue(doc.getLineAt(1)!.result!)).toContain("sprint");
		expect(formatValue(doc.getLineAt(1)!.result!)).not.toContain("10");
	});

	test("the kept result is a copy, so a later line cannot overwrite it", () => {
		const lines = ["1 sprint = 2 weeks", ":count = 10"];
		const { doc, evaluator, view } = build(lines);

		evaluator.evaluate(view);
		evaluator.evaluate(view);
		// Held across another pass, the way a host holding a rendered result does.
		const held = doc.getLineAt(1)!.result!;
		evaluator.evaluate(view);

		expect(String(held.value)).toContain("sprint");
	});

	test("the unit the definition declares still works on every pass", () => {
		// The definition's own answer was the only casualty: the unit itself was
		// registered while compiling and went on working throughout.
		const lines = ["1 sprint = 2 weeks", "3 sprints in weeks"];
		const { doc, evaluator, view } = build(lines);

		for (let pass = 0; pass < 3; pass++) {
			evaluator.evaluate(view);
			expect(formatValue(doc.getLineAt(2)!.result!).replace(/^=\s*/, "")).toBe("6 weeks");
		}
	});

	test("a line that does run is still recomputed each pass", () => {
		// The fix keeps a result only when nothing executed. A line with real
		// opcodes must go on being evaluated, or an edit above it would not
		// reach it.
		const lines = [":x = 1", "x + 100"];
		const { doc, evaluator, view } = build(lines);

		evaluator.evaluate(view);
		expect(doc.getLineAt(2)!.result!.toNumber()).toBe(101);

		doc.editLine(1, ":x = 2");
		evaluator.evaluate(view);
		expect(doc.getLineAt(2)!.result!.toNumber()).toBe(102);
	});
});
