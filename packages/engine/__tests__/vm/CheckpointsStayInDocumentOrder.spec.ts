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
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 2, 3]);
	});

	test("the lines below it are kept", () => {
		// Dropping them is sound only for a pass running from line 1, which
		// re-takes them as it continues. A pass limited to a viewport never
		// reaches them, and `restoreTo` would then RESET the VM and replay a
		// prefix that no longer mentions them, turning a number into
		// `Undefined variable` on a line further down that reads one.
		const { cp } = withLineTwoRerun();
		expect(cp.getCheckpointAt(3)?.variables.c?.toNumber()).toBe(3);
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
		const replaced = cp.getCheckpointAt(2);
		expect(replaced?.parent?.lineNumber).toBe(1);
		// And the entry after it now follows the replacement rather than the
		// object it displaced.
		expect(cp.getCheckpointAt(3)?.parent).toBe(replaced);
	});

	test("every entry's parent is the entry before it", () => {
		// The invariant `restoreTo` relies on to read the array as the chain.
		const { cp } = withLineTwoRerun();
		const all = cp.getAllCheckpoints();
		expect(all[0].parent).toBeNull();
		for (let i = 1; i < all.length; i++) expect(all[i].parent).toBe(all[i - 1]);
	});

	test("a forward pass is not truncated by any of this", () => {
		// The ordinary case: line numbers ascend, so nothing is dropped and the
		// chain is built exactly as before.
		const { cp } = checkpointer();
		for (let line = 1; line <= 5; line++) cp.snapshot(line, line, [`v${line}`]);
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 2, 3, 4, 5]);
		expect(cp.count).toBe(5);
	});

	test("re-running the first line leaves the rest of the chain standing", () => {
		const { vm, cp } = withLineTwoRerun();
		vm.setVar("a", numberValue(7));
		cp.snapshot(1, 1, ["a"]);
		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 2, 3]);

		cp.restoreTo(3);
		expect(vm.getVar("a")?.toNumber()).toBe(7);
		// The lines below still contribute what they defined, rather than
		// vanishing because the line above them ran again.
		expect(vm.getVar("b")?.toNumber()).toBe(99);
		expect(vm.getVar("c")?.toNumber()).toBe(3);
	});
});

describe("what a checkpoint holds", () => {
	// Each one holds only what its own line wrote and reaches the rest through
	// its parent. It used to reach it through the prototype chain instead,
	// which held the same entries at the same cost and made the chain as deep
	// as the document has definitions.
	test("a checkpoint's own bindings are only what its line wrote", () => {
		const { vm, cp } = checkpointer();
		vm.setVar("a", numberValue(1));
		cp.snapshot(1, 1, ["a"]);
		vm.setVar("b", numberValue(2));
		cp.snapshot(2, 2, ["b"]);

		expect(Object.keys(cp.getCheckpointAt(2)!.variables)).toEqual(["b"]);
	});

	test("a lookup finds a name defined several lines earlier", () => {
		const { vm, cp } = checkpointer();
		vm.setVar("a", numberValue(1));
		cp.snapshot(1, 1, ["a"]);
		for (let line = 2; line <= 20; line++) {
			vm.setVar(`v${line}`, numberValue(line));
			cp.snapshot(line, line, [`v${line}`]);
		}

		expect(cp.lookupVariable("a")?.toNumber()).toBe(1);
		expect(cp.lookupVariable("v10")?.toNumber()).toBe(10);
		expect(cp.lookupVariable("nothing")).toBeUndefined();
	});

	test("a later definition of a name shadows the earlier one", () => {
		const { vm, cp } = checkpointer();
		vm.setVar("x", numberValue(5));
		cp.snapshot(1, 1, ["x"]);
		vm.setVar("y", numberValue(8));
		cp.snapshot(2, 2, ["y"]);
		vm.setVar("x", numberValue(3));
		cp.snapshot(3, 3, ["x"]);

		expect(cp.lookupVariable("x")?.toNumber()).toBe(3);
		cp.restoreTo(3);
		expect(vm.getVar("x")?.toNumber()).toBe(3);
		cp.restoreTo(2);
		expect(vm.getVar("x")?.toNumber()).toBe(5);
	});

	test("a variable named after an inherited property is a key like any other", () => {
		// The bindings are null-prototyped, so `constructor` and `toString` are
		// names rather than things already on the object.
		const { vm, cp } = checkpointer();
		vm.setVar("constructor", numberValue(1));
		vm.setVar("toString", numberValue(2));
		cp.snapshot(1, 1, ["constructor", "toString"]);

		expect(cp.lookupVariable("constructor")?.toNumber()).toBe(1);
		expect(cp.lookupVariable("hasOwnProperty")).toBeUndefined();
		cp.restoreTo(1);
		expect(vm.getVar("toString")?.toNumber()).toBe(2);
	});
});

describe("updating a checkpoint in place", () => {
	test("it changes that line's value and keeps the chain after it", () => {
		// What the async sweep needs: `snapshot` drops the chain after the line,
		// and the sweep is about to walk through exactly those entries.
		const { vm, cp } = checkpointer();
		vm.setVar("x", numberValue(5));
		cp.snapshot(1, 1, ["x"]);
		vm.setVar("x", numberValue(99));
		cp.snapshot(3, 3, ["x"]);

		vm.setVar("x", numberValue(7));
		expect(cp.updateCheckpointAt(1, ["x"])).toBe(true);

		expect(cp.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([1, 3]);
		expect(cp.getCheckpointAt(1)?.variables.x?.toNumber()).toBe(7);
		expect(cp.getCheckpointAt(3)?.variables.x?.toNumber()).toBe(99);
	});

	test("it answers false for a line with no checkpoint", () => {
		const { cp } = checkpointer();
		expect(cp.updateCheckpointAt(4, ["x"])).toBe(false);
	});

	test("applying one line's bindings leaves the rest of the VM alone", () => {
		const { vm, cp } = checkpointer();
		vm.setVar("a", numberValue(1));
		cp.snapshot(1, 1, ["a"]);
		vm.setVar("b", numberValue(2));
		cp.snapshot(2, 2, ["b"]);

		vm.reset();
		vm.setVar("kept", numberValue(9));
		expect(cp.applyCheckpointAt(2)).toBe(true);
		expect(vm.getVar("b")?.toNumber()).toBe(2);
		expect(vm.getVar("kept")?.toNumber()).toBe(9);
		// Only line 2's own binding, so line 1's is not brought along.
		expect(vm.getVar("a")).toBeUndefined();
	});

	test("applying a line with no checkpoint answers false", () => {
		const { cp } = checkpointer();
		expect(cp.applyCheckpointAt(7)).toBe(false);
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
