/**
 * A cycle through a name, a total, or a function reports the cycle.
 *
 * The positional half of this was fixed first: `line 2 + 5` above `prev + 5`
 * reports the cycle however the text was reached. Three more ways to close one
 * were left, each found by the document fuzzer once its generator could write
 * a definition that reads a position, a total that reads a position, and a
 * user function:
 *
 * | document                                                     | how it went wrong                          |
 * | ---                                                          | ---                                        |
 * | `:v1 = v2 + 5` above `:v2 = v1 + 8`, after the pin above went | each read the other's last value, climbing |
 * | `:v0 = v2 + 8` / `:v2 = 18` / `:v2 = v0 + 8`                  | a cycle from the start, climbing once pinned |
 * | `spent += line 2` above `spent += 9`                         | the step above folded the step below's total |
 * | `f(x) = x + 4` / `f(9)`, definition edited away              | `f(9)` stayed 13: nothing could unbind `f`   |
 *
 * The rule that closes all of them is the batch pass's own, and it is not a
 * reset: a line that sits on a cycle runs the way a single fresh pass runs it,
 * with the names it reads holding what the lines above left and a line below
 * it counted as unevaluated. So no member ever computes a number for another
 * to read, and each reports the other in the same words `parseDocument` uses.
 * Which lines sit on a cycle is recomputed only when the graph changes.
 *
 * The prefix a name is put back to comes from the checkpoint chain, which is
 * also what a definition that failed, or a function whose defining line was
 * edited away, is put back to. See `ExpressionEngine.restoreToPrefix`.
 *
 * The boundary: a pinned cycle that *converges* on the incremental path used
 * to be allowed to (`:v3 = v2 + 7` / `:v2 = line 1 + 8` / `:v2 = 31` settled at
 * 38, 46, 31). It reports the cycle now, as the batch pass always did. That is
 * a change in what a reader sees, and it is the one this rule asks for: a line
 * that depends on itself has no answer of its own, whatever a pin lends it.
 *
 * The batch pass is the specification, but it is not consulted here: its
 * error text lives outside `result`, and for a definition that reads an
 * errored line the two paths word the error differently, which is older than
 * this and not what these tests are about.
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

type Action = ["edit", number, string] | ["delete", number] | ["insert", number, string] | ["view", number, number];

/**
 * Drive a session and compare every line with a settled pass after every
 * action, the way the fuzzer's oracle does.
 */
function session(start: string[], actions: Action[]): { editor: string[]; settled: string[]; lines: string[] }[] {
	const lines = [...start];
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 6; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
	const steps: { editor: string[]; settled: string[]; lines: string[] }[] = [];
	for (const action of actions) {
		if (action[0] === "edit") {
			doc.editLine(action[1], action[2]);
			lines[action[1] - 1] = action[2];
		} else if (action[0] === "delete") {
			evaluator.applyTransaction([{ startLine: action[1], deleteCount: 1, insertLines: [] }]);
			lines.splice(action[1] - 1, 1);
		} else if (action[0] === "insert") {
			evaluator.applyTransaction([{ startLine: action[1], deleteCount: 0, insertLines: [action[2]] }]);
			lines.splice(action[1] - 1, 0, action[2]);
		} else {
			evaluator.setViewport({ startLine: action[1], endLine: Math.max(action[1], Math.min(lines.length, action[2])) });
		}
		for (let pass = 0; pass < 8; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
		steps.push({ editor: answersOf(doc, lines.length), settled: settled(lines), lines: [...lines] });
	}
	evaluator.terminateWorker();
	return steps;
}

function agrees(start: string[], actions: Action[]): void {
	for (const step of session(start, actions)) expect(step.editor).toEqual(step.settled);
}

describe("a cycle through a name", () => {
	test("two definitions reading each other, once the pin above is edited away", () => {
		const steps = session([":v2 = 48", ":v1 = v2 + 5", ":v2 = v1 + 8"], [["edit", 1, "2020-01-18 + 36 days"]]);
		expect(steps[0].editor).toEqual(steps[0].settled);
		expect(steps[0].editor.slice(1)).toEqual(["Undefined variable: v2", "Undefined variable: v1"]);
	});

	test("a definition reading the name it defines, once the definition above goes", () => {
		agrees([":v3 = 44", ":v3 = v3 + 3", "v3"], [["edit", 1, "7 + 7"]]);
		agrees(["37% of 246", ":v3 = 44", ":v3 = v3 + 3"], [["delete", 2]]);
		agrees([":v0 = 49", ":v2 = 14", ":v0 = v0 + 6"], [["insert", 1, "# a heading"], ["edit", 2, ":v3 = v9 + 3"]]);
	});

	test("a pinned cycle reports the cycle rather than climbing", () => {
		// A cycle from the moment it is written, which only starts moving once
		// `:v2 = 18` lends it a number. Nothing keyed to an edit could catch it;
		// the members running the fresh way does.
		const text = [":v0 = v2 + 8", ":v2 = 18", ":v2 = v0 + 8"];
		expect(settled(text)).toEqual(["Undefined variable: v2", "18", "Undefined variable: v0"]);
	});

	test("a definition reading a position, closed by an edit below it", () => {
		agrees([":v3 = v2 + 7", ":v2 = line 1 + 8", ":v2 = 31"], [["edit", 3, "sum(line 3 : line 3)"]]);
	});

	test("survives a viewport pass", () => {
		agrees([":v2 = v0 + 2", ":v0 = v2 + 3", ":v2 = 47"], [["view", 3, 15]]);
	});

	test("a longer history of edits, inserts and a delete", () => {
		agrees(
			[":v2 = v9 + 9", ":v0 = v2 + 8", "v0", ""],
			[["edit", 3, ":v2 = v0 + 8"], ["insert", 3, ":v2 = 18"], ["insert", 5, "spent += 5"], ["delete", 1], ["edit", 5, "v3"]],
		);
		agrees([":v0 = v2 + 3", ":v2 = 42", "total of #food", ":v0 = v0 + 3"], [["insert", 1, ":v0 = v9 + 5"], ["edit", 3, "total of #food"]]);
	});
});

describe("a cycle through a running total", () => {
	test("a step that reads a line whose total it feeds", () => {
		agrees(["spent += 9", "9 #food"], [["insert", 1, "spent += line 2"]]);
		agrees(["spent += 8", "// note 1"], [["insert", 1, "spent += line 2"]]);
	});

	test("a step that reads the line showing the total", () => {
		agrees(["f(5)", "spent += 5", "spent += prev", "spent"], [["delete", 1], ["edit", 2, "spent += line 3"]]);
	});

	test("a range declared after the document grew", () => {
		// The span a range declares is cut to the document, and the document's
		// length is asked for each time: one context serves a document for as
		// long as it is open, and a count copied into it when it was built was
		// the count before the insert, so `sum(line 4 : line 5)` declared line
		// 4 alone and the cycle through line 5 was not known to the graph.
		agrees(["prev + 4", "spent += prev", "spent"], [["insert", 3, "total of #food"], ["insert", 1, "sum(line 4 : line 5)"]]);
	});

	test("a plain column of steps is not a cycle", () => {
		// The fold is ordered: a step depends on the steps above it, never on
		// those below, so a column of them has no cycle in it and every step
		// keeps its running answer.
		expect(settled(["spent += 3", "spent += 4", "spent"])).toEqual(["3", "7", "7"]);
	});
});

describe("a function whose defining line goes", () => {
	test("is unbound when the definition is edited away", () => {
		const steps = session(["f(x) = x + 4", "f(9)"], [["edit", 1, ""]]);
		expect(steps[0].editor).toEqual(steps[0].settled);
		expect(steps[0].editor[1]).toBe("Undefined function: f");
	});

	test("is unbound when the definition is deleted", () => {
		agrees(["13 #travel", "f(1)"], [["insert", 1, "f(x) = x + 3"], ["delete", 1]]);
	});

	test("comes back when the definition does", () => {
		const steps = session(["f(x) = x + 4", "f(9)"], [["edit", 1, ""], ["edit", 1, "f(x) = x + 5"]]);
		expect(steps[1].editor).toEqual(steps[1].settled);
		expect(steps[1].editor[1]).toBe("14");
	});
});

describe("the boundary", () => {
	test("a pinned cycle that used to converge now reports the cycle, as the batch pass does", () => {
		const text = [":v3 = v2 + 7", ":v2 = line 1 + 8", ":v2 = 31"];
		expect(settled(text)).toEqual(["Undefined variable: v2", "Line 1 has an error", "31"]);
	});

	test("a plain forward reference still resolves", () => {
		expect(settled(["line 2 + 1", "7"])).toEqual(["8", "7"]);
		expect(settled(["x + 1", ":x = 5"])).toEqual(["6", "5"]);
	});
});

describe("a name bound as both a function and a variable", () => {
	// `f(x) = x + 4` above `:f = 9` binds `f` in both of the VM's bags at
	// once, and each is put back to the prefix on its own: the function to
	// the last definition above, the variable to the last value above.
	// Stopping at the function left the variable holding what the edited
	// line wrote, and the graph, which keys both by the bare name, saw no
	// orphan while either was still produced.
	test("the variable goes back to the prefix under a function of the same name", () => {
		const steps = session(["f(x) = x + 4", ":f = 9", "f + 1", "f(2)"], [["edit", 2, ":f = zz"]]);
		expect(steps[0].editor).toEqual(steps[0].settled);
		expect(steps[0].editor.slice(2)).toEqual(["Undefined variable: f", "6"]);
		agrees(["f(x) = x + 4", ":f = 5", "f + 1", "f(2)"], [["edit", 2, ""]]);
		agrees(["f(x) = x + 4", ":f = 5", "f + 1", "f(2)"], [["delete", 2]]);
		agrees(["f(x) = x + 1", ":f = 4", "f"], [["edit", 2, "7"]]);
		agrees(["f(x) = x + 1", ":f = 4", "f"], [["edit", 2, "# heading"]]);
		agrees(["f(x) = x + 1", "f(1)", ":f = 4", "f"], [["edit", 3, "f(2)"]]);
	});

	test("the function is unbound under a variable of the same name", () => {
		const steps = session([":f = 5", "f(x) = x + 4", "f + 1", "f(2)"], [["edit", 2, ""]]);
		expect(steps[0].editor).toEqual(steps[0].settled);
		expect(steps[0].editor.slice(2)).toEqual(["6", "Undefined function: f"]);
		agrees([":f = 5", "f(x) = x + 4", "f + 1", "f(2)"], [["delete", 2]]);
		agrees([":f = 5", "f(x) = x + 4", "f + 1", "f(2)"], [["edit", 2, "7"]]);
		agrees(["f(x) = x + 4", ":f = 5", "f + 1", "f(2)"], [["edit", 1, ""]]);
	});
});

describe("a member that stops reading a line", () => {
	test("leaves the line it stopped reading on no phantom cycle", () => {
		// Line 1 totals the `#food` carriers, one of which reads line 1: a real
		// cycle through lines 1 and 3. Line 5 then stops carrying the tag and
		// reads line 1 instead. Keeping a member's forward edges regardless of
		// its run made {1, 5} a cycle nothing could break, and once the real
		// one was broken it was the only thing left reporting.
		const start = ["total of #food", "1", "line 1 + 1 #food", "1", "7 #food", "9"];
		const steps = session(start, [["edit", 5, "line 6 + line 1"], ["edit", 3, "4 #food"]]);
		for (const step of steps) expect(step.editor).toEqual(step.settled);
		expect(steps[1].editor).toEqual(["4", "1", "4", "1", "13", "9"]);
	});
});
