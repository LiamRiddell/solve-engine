/**
 * The checkpoint list is a sequence of document positions, and stays one.
 *
 * `restoreTo` reads the list as a walk through the document: it finds the last
 * entry at or before a line, stopping at the first entry past it, and replays
 * that entry's parent chain from the root. Both halves assume the list ascends.
 *
 * Appending on a re-run broke both. A document whose lines 1, 2 and 3 each
 * define something, with line 2 edited and re-run, left the list as
 * `[1, 2, 3, 2]`:
 *
 * | after editing line 2 | before             | now  |
 * | ---                  | ---                | ---  |
 * | `restoreTo(2)` gives | the old value      | the new one |
 * | line 2's parent is   | line 3, which runs after it | line 1 |
 *
 * So a host restoring to a line got the value from before its own edit, and
 * the chain it walked defined a variable from a line that had not run yet.
 *
 * Nothing reaches this from inside the engine: `evaluateDocument` constructs
 * its evaluator without a checkpointer. It is a published constructor argument
 * though, so a host that passes one has been getting this.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { numberValue } from "@solve-js/vm/Value";
import { createVM } from "@solve-js/vm/VM";
import { VMCheckpointer } from "@solve-js/vm/VMCheckpoints";

function checkpointer() {
	const vm = createVM(sharedOpRegistry, 200, 50_000);
	return { vm, cp: new VMCheckpointer(vm) };
}

/** Three lines that each define something, then line 2 running again. */
function withLineTwoRerun() {
	const { vm, cp } = checkpointer();
	vm.setVar("a", numberValue(1));
	cp.snapshot(1, 1, ["a"]);
	vm.setVar("b", numberValue(2));
	cp.snapshot(2, 2, ["b"]);
	vm.setVar("c", numberValue(3));
	cp.snapshot(3, 3, ["c"]);
	vm.setVar("b", numberValue(99));
	cp.snapshot(2, 2, ["b"]);
	return { vm, cp };
}

describe("a line that is checkpointed again", () => {
	test("replaces its old entry rather than being appended after later lines", () => {
		const { cp } = withLineTwoRerun();
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 2]);
	});

	test("restoring to it gives the value from the re-run, not the one before", () => {
		const { vm, cp } = withLineTwoRerun();
		cp.restoreTo(2);
		expect(vm.getVar("b")?.toNumber()).toBe(99);
	});

	test("restoring to it does not define a variable from a later line", () => {
		const { vm, cp } = withLineTwoRerun();
		cp.restoreTo(2);
		expect(vm.getVar("a")?.toNumber()).toBe(1);
		expect(vm.getVar("c")).toBeUndefined();
	});

	test("its parent is the line before it in the document", () => {
		const { cp } = withLineTwoRerun();
		const newest = cp.getAllCheckpoints()[cp.getAllCheckpoints().length - 1];
		expect(newest.lineNumber).toBe(2);
		expect(newest.parent?.lineNumber).toBe(1);
	});

	test("a forward pass is not truncated by any of this", () => {
		// The ordinary case: line numbers ascend, so nothing is dropped and the
		// chain is built exactly as before.
		const { cp } = checkpointer();
		for (let line = 1; line <= 5; line++) cp.snapshot(line, line, [`v${line}`]);
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 2, 3, 4, 5]);
		expect(cp.count).toBe(5);
	});

	test("re-running the first line clears the chain behind it", () => {
		const { vm, cp } = withLineTwoRerun();
		vm.setVar("a", numberValue(7));
		cp.snapshot(1, 1, ["a"]);
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1]);

		cp.restoreTo(3);
		expect(vm.getVar("a")?.toNumber()).toBe(7);
		expect(vm.getVar("b")).toBeUndefined();
	});
});

describe("through the evaluator", () => {
	/** A document, its evaluator, and the checkpointer the evaluator writes to. */
	function build(lines: string[]) {
		const engine = createEngine() as unknown as ExpressionEngine;
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const cp = new VMCheckpointer(engine.getVM());
		const evaluator = new ThreeTierEvaluator(doc, engine, cp);
		return { doc, evaluator, cp, view: { startLine: 1, endLine: lines.length } };
	}

	test("a pass leaves one checkpoint per defining line, in order", () => {
		const { evaluator, cp, view } = build([":x = 1", "x + 1", ":y = 2", "y + 1"]);
		evaluator.evaluate(view);
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 3]);
	});

	test("a clean line that writes still checkpoints, so a later pass has no hole", () => {
		// Lines running from cache write the same names to the VM as the pass
		// that compiled them, so the chain has to record them too. Without it
		// the second pass below would leave only the line it recompiled.
		const { doc, evaluator, cp, view } = build([":x = 1", ":y = 2", ":z = 3"]);
		evaluator.evaluate(view);
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 2, 3]);

		doc.editLine(2, ":y = 20");
		evaluator.evaluate(view);
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 2, 3]);
	});

	test("the chain after an edit holds the edited value", () => {
		const { doc, evaluator, cp, view } = build([":x = 1", ":y = 2", ":z = 3"]);
		evaluator.evaluate(view);
		doc.editLine(2, ":y = 20");
		evaluator.evaluate(view);

		expect(cp.lookupVariable("y")?.toNumber()).toBe(20);
		expect(cp.lookupVariable("x")?.toNumber()).toBe(1);
		expect(cp.lookupVariable("z")?.toNumber()).toBe(3);
	});

	test("repeated passes do not grow the chain", () => {
		const { evaluator, cp, view } = build([":x = 1", ":y = 2", "x + y"]);
		evaluator.evaluate(view);
		const first = cp.count;
		evaluator.evaluate(view);
		evaluator.evaluate(view);
		expect(cp.count).toBe(first);
	});
});
