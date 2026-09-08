/**
 * A line that answered with an error did not define a variable.
 *
 * The write set recorded on a line comes from its compiled form, which says
 * what the line *would* assign. Goal seek is where that parts company with what
 * happened: `solve line 5 for v1 = 22` compiles as a line that writes `v1`, and
 * when there is no line 5 it assigns nothing and reports so.
 *
 * The recorded write is what the end-of-pass settle asks when deciding whether
 * a name is still defined by anyone, so a line claiming a write it never made
 * held the name open, and the value from the definition that had been edited
 * away stayed in the VM:
 *
 * | document                                                       | before                  | now                     |
 * | ---                                                            | ---                     | ---                     |
 * | `v1 * v2` / `solve line 5 for v1 = 22` / `prev + 3` / `69 + 2` | `Undefined variable: v2` | `Undefined variable: v1` |
 *
 * Both are errors, which is what made it survive: the line was wrong about
 * *which* name was missing, because `v1` still held `44` from a definition no
 * line made any more. A pass over the same text has never seen that value, and
 * says `v1`.
 *
 * A pending value still counts as a definition. It has not failed, it has not
 * arrived, and forgetting the name while it loads would leave every reader of
 * it undefined in the meantime.
 *
 * Found by the differential fuzz of editing sessions, once its generator was
 * taught goal seek.
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
	for (let pass = 0; pass < 6; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
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

describe("a goal seek that could not run", () => {
	test("does not hold its variable open", () => {
		// The session the fuzzer shrank to: the definition is edited away while
		// a failing goal seek names the same variable.
		const { doc, evaluator } = editorFor([":v1 = 44", "solve line 9 for v1 = 22", "v1 * v2"]);

		doc.editLine(1, "prev + 3");
		for (let pass = 0; pass < 6; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		const text = ["prev + 3", "solve line 9 for v1 = 22", "v1 * v2"];
		expect(answersOf(doc, 3)).toEqual(settled(text));
		expect(shown(doc, 3)).toContain("Undefined variable: v1");
	});

	test("records no write for the name it could not solve", () => {
		// The mechanism, asserted directly. The write set is what the settle
		// reads, so this is the thing that has to be empty.
		const { doc } = editorFor(["1 + 1", "solve line 9 for v1 = 22"]);
		const state = doc.getLineAt(2) as unknown as { writes?: string[] };
		expect(state?.writes ?? []).not.toContain("v1");
	});
});

describe("what still counts as a definition", () => {
	test("a goal seek that runs defines its variable", () => {
		// The boundary. A goal seek that can do its work assigns the answer,
		// and the name must stay defined for the lines below it.
		const { doc } = editorFor([":deposit = 100000", "deposit * 2", "solve line 2 for deposit = 900"]);
		expect(shown(doc, 3)).not.toContain("Undefined");

		const state = doc.getLineAt(3) as unknown as { writes?: string[] };
		expect(state?.writes ?? []).toContain("deposit");
	});

	test("an ordinary definition is untouched", () => {
		const { doc } = editorFor([":x = 12", "x + 4"]);
		expect(shown(doc, 2)).toBe("16");
		const state = doc.getLineAt(1) as unknown as { writes?: string[] };
		expect(state?.writes ?? []).toContain("x");
	});

	test("a definition still standing is not forgotten because a later line failed", () => {
		// The failure has to be attributed to the line that failed, not to the
		// name. `:x = 12` defines `x` whatever the goal seek below it does.
		const { doc, evaluator } = editorFor([":x = 12", "solve line 9 for x = 5", "x + 4"]);
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(answersOf(doc, 3)).toEqual(settled([":x = 12", "solve line 9 for x = 5", "x + 4"]));
		expect(shown(doc, 3)).toBe("16");
	});
});
