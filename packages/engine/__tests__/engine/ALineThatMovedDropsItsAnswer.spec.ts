/**
 * A line that moved in a structural edit drops its answer until it runs again.
 *
 * The incremental evaluator keeps a line's last answer so a scroll back to it
 * costs nothing. An insert or a delete moves every line below it to a new
 * position, and the answer such a line still holds was computed for where it
 * used to sit. While the moved line is below the viewport it is not re-run, so
 * it went on showing that answer, and a line that reads its position read it
 * back as a real value: `:x = line 4 + x` above a line that had moved to
 * position 4 reported `Line 4 has an error` where a fresh pass driven to the
 * same viewport reports `Line 4 has not been evaluated yet`, because that pass
 * never reached position 4 at all. See #458.
 *
 * The rule is the one the rest of the incremental path already follows: a
 * line's state should equal what a fresh pass driven to the same viewport
 * holds at that point. A moved line's answer is forgotten on the edit; a
 * visible line re-runs from its cached bytecode on the next pass and gets its
 * answer straight back, so nothing a reader can see flickers, and a line below
 * the viewport stays blank until it is scrolled to, exactly as a fresh pass
 * driven to that viewport leaves it.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";

function shown(doc: DocumentModel, n: number): string {
	const r = doc.getLineAt(n)?.result;
	return r ? formatValue(r).replace(/^=\s*/, "") : "";
}
const answersOf = (doc: DocumentModel, count: number) => Array.from({ length: count }, (_, i) => shown(doc, i + 1));

type View = { s: number; e: number };
type Action = ["edit", number, string] | ["insert", number, string] | ["delete", number];

/** A fresh session driven to the same viewport, run to stability. */
function freshAt(lines: string[], view: View): string[] {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: view.s, endLine: view.e });
	const out = answersOf(doc, lines.length);
	evaluator.terminateWorker();
	return out;
}

/** Drive a session to `view`, apply the actions, and return editor vs fresh. */
function session(start: string[], view: View, actions: Action[]): { editor: string[]; fresh: string[] } {
	const lines = [...start];
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: view.s, endLine: view.e });
	for (const action of actions) {
		if (action[0] === "edit") { doc.editLine(action[1], action[2]); lines[action[1] - 1] = action[2]; }
		else if (action[0] === "insert") { evaluator.applyTransaction([{ startLine: action[1], deleteCount: 0, insertLines: [action[2]] }]); lines.splice(action[1] - 1, 0, action[2]); }
		else { evaluator.applyTransaction([{ startLine: action[1], deleteCount: 1, insertLines: [] }]); lines.splice(action[1] - 1, 1); }
	}
	for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: view.s, endLine: view.e });
	const editor = answersOf(doc, lines.length);
	evaluator.terminateWorker();
	return { editor, fresh: freshAt(lines, view) };
}

const agrees = (start: string[], view: View, actions: Action[]) => {
	const { editor, fresh } = session(start, view, actions);
	expect(editor).toEqual(fresh);
};

describe("a moved line and the fresh pass agree", () => {
	test("the reported case: a reader above the viewport, the moved line below it", () => {
		const { editor } = session([":x = 1", ":x = line 4 + x", "x + 1"], { s: 1, e: 3 }, [["insert", 3, ":x = 3"]]);
		// Line 2 reads position 4, which the pass never reached, so it says so
		// rather than reporting the answer the line used to hold at position 3.
		expect(editor).toEqual([
			"1",
			"Line 4 has not been evaluated yet (forward reference, or out of range)",
			"3",
			"",
		]);
	});

	test("it heals as soon as the viewport covers the moved line", () => {
		agrees([":x = 1", ":x = line 4 + x", "x + 1"], { s: 1, e: 4 }, [["insert", 3, ":x = 3"]]);
	});

	test("a position-independent line just below the viewport", () => {
		agrees(["10", "20", "30", "40"], { s: 1, e: 2 }, [["insert", 1, "99"]]);
	});

	test("a positional reader in the viewport reads a line that moved out of it", () => {
		agrees(["line 3 + 1", "5", "7"], { s: 1, e: 1 }, [["insert", 2, "100"]]);
	});

	test("a delete, with a reader above the removed line", () => {
		agrees(["line 3 + 1", "2", "9", "4"], { s: 1, e: 2 }, [["delete", 2]]);
	});

	test("a scrolled viewport, edited above, with a moved line just below it", () => {
		agrees(["1", "2", "3", "4", "5", "6", "7", "8"], { s: 5, e: 8 }, [["insert", 2, "99"]]);
	});

	test("a definition above a scrolled viewport is not over-forgotten", () => {
		// The clearing is below the viewport only. A definition that moved ABOVE
		// it is one a fresh pass still shows (its answer reaches through the
		// checkpoint chain and the pass re-runs it), so blanking it would be a
		// divergence of its own: these guard that the fix stays below the line.
		agrees(["# note", ":a = 5", "3", "4", "5", "a + 1"], { s: 5, e: 6 }, [["insert", 1, "99"]]);
		agrees([":a = 5", "2", "3", "4", "a + 1", "6"], { s: 5, e: 6 }, [["insert", 1, "99"]]);
	});
});

/**
 * The boundary. A line that moved ABOVE the viewport keeps its answer, and that
 * is not this bug. The incremental path shows a line scrolled off the top the
 * answer it last computed, where a fresh pass driven straight to that viewport
 * would not have reached it; that difference is the scroll cache doing its job,
 * it predates this change, and it is the same with or without a structural edit
 * in the way. This fix is only about the answer a moved line holds BELOW the
 * viewport, which a fresh pass genuinely never has and which a line reading that
 * position read back as real.
 */

