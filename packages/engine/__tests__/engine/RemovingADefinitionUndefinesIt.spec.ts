/**
 * A name whose defining line is gone reads as undefined.
 *
 * The VM's variable store only ever accumulated. Nothing removed a binding when
 * the line that created it was deleted or edited into something else, so the
 * value outlived the document:
 *
 * | document              | action        | reader showed | a settled pass says     |
 * | ---                   | ---           | ---           | ---                     |
 * | `:x = 12` / `x + 4`   | delete line 1 | `16`          | `Undefined variable: x` |
 * | `:x = 12` / `x + 4`   | line 1 to `5 + 5` | `16`      | `Undefined variable: x` |
 * | `:x = 12` / `x + 4`   | line 1 to `# a heading` | `16` | `Undefined variable: x` |
 *
 * The dependency graph already knew: it drops a line from the producers of a key
 * it no longer writes, so a key with no producers left is a name no line
 * defines. It reports those, and the engine acts on them.
 *
 * The decision is deliberately not made as each line registers, and both
 * reasons are ordering. A line holding several inline expressions registers once
 * per expression, so the one defining a name is followed by one that does not;
 * and the engine registers a line before the pass records that line's results,
 * so its recorded write set is a pass behind. Both would answer wrongly
 * mid-pass. So the question is asked once at the end of a pass, and asked of the
 * document rather than the graph: a name is defined if any line records writing
 * it, which survives a structural edit and a viewport where the graph does not.
 *
 * The consequence, and it is in the tests below: the name is forgotten at the
 * end of the pass that removed its definition, so the lines that READ it show
 * their new answer on the pass after that. An editor makes one anyway. Every way
 * of making it sooner answers the question before it can be answered.
 *
 * A line edited into a heading, a comment or a blank counts as removing the
 * definition, and it is the case that needed saying out loud. Such a line is
 * skipped before anything is compiled, so it never reached the registration that
 * says what it writes, and its old edges stood. It now registers writing
 * nothing, which is what withdraws them.
 *
 * The boundary: without a document there is no such authority.
 * `evaluateExpression` reuses line numbers across independent calls, and
 * variables accumulating across them is that path's whole contract.
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

describe("removing the line that defines a name", () => {
	test("deleting it leaves the readers undefined", () => {
		const { doc, evaluator } = editorFor([":x = 12", "x + 4"]);
		expect(shown(doc, 2)).toBe("16");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		// One pass forgets the name, the next shows the reader its new answer.
		evaluator.evaluate({ startLine: 1, endLine: 1 });
		evaluator.evaluate({ startLine: 1, endLine: 1 });

		expect(answersOf(doc, 1)).toEqual(settled(["x + 4"]));
		expect(shown(doc, 1)).toContain("Undefined variable: x");
	});

	test("editing it into something else leaves the readers undefined", () => {
		const { doc, evaluator } = editorFor([":x = 12", "x + 4"]);
		doc.editLine(1, "5 + 5");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled(["5 + 5", "x + 4"]));
		expect(shown(doc, 2)).toContain("Undefined variable: x");
	});

	test("editing it into a heading leaves the readers undefined", () => {
		// A heading is skipped before anything is compiled, so nothing here
		// reaches the tier that registers what a line writes. Withdrawing the
		// edges is the skipped path's own job.
		const { doc, evaluator } = editorFor([":x = 12", "x + 4"]);
		doc.editLine(1, "# a heading");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled(["# a heading", "x + 4"]));
		expect(shown(doc, 2)).toContain("Undefined variable: x");
	});

	test("it names the first undefined variable a settled pass would name", () => {
		// The shape the fuzzer found. With `v3` left standing, `v3 * v0` got
		// past its first name and blamed `v0`, where a pass over the same text
		// blames `v3`. Both are errors, so only the wording gave it away.
		const { doc, evaluator } = editorFor([":v3 = 19", "v3 * v0"]);
		doc.editLine(1, "# a heading");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled(["# a heading", "v3 * v0"]));
		expect(shown(doc, 2)).toContain("Undefined variable: v3");
	});

	test("emptying it leaves the readers undefined", () => {
		const { doc, evaluator } = editorFor([":x = 12", "x + 4"]);
		doc.editLine(1, "");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(shown(doc, 2)).toContain("Undefined variable: x");
	});

	test("a line that was already a heading withdraws nothing", () => {
		// Only a dirty line withdraws. A clean heading has nothing to take
		// back, and re-registering it every pass would cost a pass of work
		// per heading in the document.
		const { doc, evaluator } = editorFor(["# a heading", ":x = 12", "x + 4"]);
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });
		expect(shown(doc, 3)).toBe("16");
	});

	test("a name another line still defines is kept", () => {
		const { doc, evaluator } = editorFor([":x = 1", ":x = 2", "x + 4"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled([":x = 2", "x + 4"]));
		expect(shown(doc, 2)).toBe("6");
	});

	test("re-adding the definition brings the name back", () => {
		const { doc, evaluator } = editorFor([":x = 12", "x + 4"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		evaluator.evaluate({ startLine: 1, endLine: 1 });
		evaluator.evaluate({ startLine: 1, endLine: 1 });
		expect(shown(doc, 1)).toContain("Undefined");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: [":x = 20"] }]);
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(answersOf(doc, 2)).toEqual(settled([":x = 20", "x + 4"]));
		expect(shown(doc, 2)).toBe("24");
	});

	test("a line holding several expressions keeps what it defines", () => {
		// The reason the decision waits for the end of the pass. Such a line
		// registers once per expression, so the one that defines a name is
		// followed by one that does not, and deciding eagerly would drop it.
		const { doc } = editorFor(["s`:a = 5` and s`a + 5`"]);
		expect(shown(doc, 1)).not.toContain("Undefined");
	});

	test("the single-expression path keeps its variables across calls", () => {
		// No document, so no authority on what defines what, and accumulating
		// across calls is that path's contract.
		const engine = createEngine();
		expect(engine.evaluateExpression(":ways = 5")).toBeDefined();
		expect(engine.evaluateExpression("ways + 1").toNumber()).toBe(6);
		expect(engine.evaluateExpression("ways * 2").toNumber()).toBe(10);
	});
});

describe("the checkpoint chain agrees", () => {
	test("a restore does not put a removed name back", () => {
		// A checkpoint records what its line wrote, so an entry for a deleted
		// line would reinstate the name the moment the viewport moved.
		const { doc, evaluator } = editorFor([":x = 12", "1 + 1", "2 + 2", "x + 4"]);
		expect(shown(doc, 4)).toBe("16");

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		evaluator.setViewport({ startLine: 3, endLine: 3 });

		expect(shown(doc, 3)).toContain("Undefined variable: x");
		expect(evaluator.getCheckpointer()!.lookupVariable("x")).toBeUndefined();
	});
});
