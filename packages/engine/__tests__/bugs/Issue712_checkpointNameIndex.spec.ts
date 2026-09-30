import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { VMCheckpointer, lastWriterAtOrBefore, type VMCheckpoint } from "@solve-js/vm/VMCheckpoints";
import type { VM } from "@solve-js/vm/OpRegistry";
import type { BytecodeProgram, UserFunctionDef } from "@solve-js/parser/BytecodeBuilder";
import { numberValue, type Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #712: a bare assignment (`price = 4`) re-runs through Tier 1 on every
 * pass, and before it runs each name it writes is put back to what the lines
 * above left it, by asking the checkpoint chain. The chain answered by
 * following `parent` one checkpoint at a time until one had written the name,
 * and a name no line above defines (every name in an ordinary list of
 * assignments) was followed to the root: line N cost N steps, and a repeat
 * pass cost the square of the document. On this spec's machine a second pass
 * over 10,000 bare assignments took 5,620 ms against 72 ms with a colon.
 *
 * `VMCheckpointer` now keeps a per-name index, the checkpoints whose own bag
 * holds each name in document order, and a lookup binary-searches it. The
 * answers are the walk's answers: every test below that compares the two uses
 * `walkBefore`, the old algorithm verbatim, as the reference.
 */

// ── The reference: the walk the index replaced ───────────────────────────

/** The old `lookupVariableBefore` / `lookupFunctionBefore`, over the chain. */
function walkBefore(checkpointer: VMCheckpointer, bag: "variables" | "functions", name: string, lineNumber: number): Value | UserFunctionDef | undefined {
	const all = checkpointer.getAllCheckpoints();
	let index = -1;
	for (let i = 0; i < all.length; i++) if (all[i].lineNumber <= lineNumber - 1) index = i;
	let checkpoint: VMCheckpoint | null = index < 0 ? null : all[index];
	while (checkpoint) {
		if (Object.prototype.hasOwnProperty.call(checkpoint[bag], name)) return checkpoint[bag][name];
		checkpoint = checkpoint.parent;
	}
	return undefined;
}

/** Every name and line agree between the index and the walk, and the index is exact. */
function expectIndexMatchesWalk(checkpointer: VMCheckpointer, names: readonly string[], lastLine: number): void {
	expect(checkpointer.indexAgreesWithChain()).toBe(true);
	const mismatches: string[] = [];
	for (const name of names) {
		for (let line = 0; line <= lastLine + 1; line++) {
			if (checkpointer.lookupVariableBefore(name, line) !== walkBefore(checkpointer, "variables", name, line)) mismatches.push(`variable ${name} before ${line}`);
			if (checkpointer.lookupFunctionBefore(name, line) !== walkBefore(checkpointer, "functions", name, line)) mismatches.push(`function ${name} before ${line}`);
		}
	}
	expect(mismatches).toEqual([]);
}

/** A deterministic generator, so a failing sequence can be replayed. */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const EMPTY_PROGRAM = { opcodes: new Uint8Array([]), numbers: new Float64Array([]), strings: [] } as unknown as BytecodeProgram;

/** A checkpointer over a real VM, and a way to write names into that VM. */
function rig(): { checkpointer: VMCheckpointer; vm: VM; set: (name: string, n: number) => void; define: (name: string) => void } {
	const vm = newTrackedEngine().getVM();
	return {
		checkpointer: new VMCheckpointer(vm),
		vm,
		set: (name, n) => vm.setVar(name, numberValue(n)),
		define: (name) => vm.defineUserFunction(name, ["x"], EMPTY_PROGRAM),
	};
}

// ── lastWriterAtOrBefore, the search itself ─────────────────────────────

describe("lastWriterAtOrBefore", () => {
	const at = (...lines: number[]) => lines.map((lineNumber) => ({ lineNumber, lineId: lineNumber, variables: {}, functions: {}, parent: null }) as VMCheckpoint);
	const writers = at(2, 5, 9);

	test.each([
		[1, undefined],
		[2, 2],
		[3, 2],
		[4, 2],
		[5, 5],
		[8, 5],
		[9, 9],
		[10_000, 9],
	])("before or at line %p it is the entry at %p", (line, expected) => {
		expect(lastWriterAtOrBefore(writers, line)?.lineNumber).toBe(expected);
	});

	test("no list and an empty list have no writer", () => {
		expect(lastWriterAtOrBefore(undefined, 5)).toBeUndefined();
		expect(lastWriterAtOrBefore([], 5)).toBeUndefined();
	});

	test("the boundaries of a line number", () => {
		expect(lastWriterAtOrBefore(writers, 0)).toBeUndefined();
		expect(lastWriterAtOrBefore(writers, -1)).toBeUndefined();
		expect(lastWriterAtOrBefore(writers, -0)).toBeUndefined();
		expect(lastWriterAtOrBefore(writers, -Infinity)).toBeUndefined();
		expect(lastWriterAtOrBefore(writers, Infinity)?.lineNumber).toBe(9);
		expect(lastWriterAtOrBefore(writers, Number.MAX_SAFE_INTEGER)?.lineNumber).toBe(9);
		// A fraction is between two lines, and the one at or before it answers.
		expect(lastWriterAtOrBefore(writers, 4.5)?.lineNumber).toBe(2);
		expect(lastWriterAtOrBefore(writers, 5.5)?.lineNumber).toBe(5);
	});

	test("NaN is no line at all, not the end of the document", () => {
		expect(lastWriterAtOrBefore(writers, Number.NaN)).toBeUndefined();
	});

	test("a single entry", () => {
		expect(lastWriterAtOrBefore(at(1), 0)).toBeUndefined();
		expect(lastWriterAtOrBefore(at(1), 1)?.lineNumber).toBe(1);
	});
});

// ── The index, method by method ──────────────────────────────────────────

describe("the index moves with every change to the chain", () => {
	test("snapshot, then a lookup from every line", () => {
		const { checkpointer, set } = rig();
		set("a", 1);
		checkpointer.snapshot(2, 2, ["a"]);
		set("b", 2);
		checkpointer.snapshot(4, 4, ["b"]);
		set("a", 3);
		checkpointer.snapshot(6, 6, ["a"]);
		expect(checkpointer.lookupVariableBefore("a", 2)).toBeUndefined();
		expect(checkpointer.lookupVariableBefore("a", 3)?.toNumber()).toBe(1);
		expect(checkpointer.lookupVariableBefore("a", 6)?.toNumber()).toBe(1);
		expect(checkpointer.lookupVariableBefore("a", 7)?.toNumber()).toBe(3);
		expect(checkpointer.lookupVariableBefore("b", 5)?.toNumber()).toBe(2);
		expect(checkpointer.lookupVariable("a")?.toNumber()).toBe(3);
		expect(checkpointer.lookupVariable("zz")).toBeUndefined();
		expectIndexMatchesWalk(checkpointer, ["a", "b", "zz"], 7);
	});

	test("a line snapshotted again replaces its own entry in the index", () => {
		const { checkpointer, set } = rig();
		set("a", 1);
		checkpointer.snapshot(3, 3, ["a"]);
		set("b", 2);
		checkpointer.snapshot(3, 3, ["b"]);
		expect(checkpointer.lookupVariableBefore("a", 10)).toBeUndefined();
		expect(checkpointer.lookupVariableBefore("b", 10)?.toNumber()).toBe(2);
		expectIndexMatchesWalk(checkpointer, ["a", "b"], 4);
	});

	test("a name written, dropped and written again", () => {
		const { checkpointer, set } = rig();
		set("x", 1);
		checkpointer.snapshot(2, 2, ["x"]);
		checkpointer.dropCheckpointAt(2);
		expect(checkpointer.lookupVariableBefore("x", 5)).toBeUndefined();
		expectIndexMatchesWalk(checkpointer, ["x"], 5);
		set("x", 7);
		checkpointer.snapshot(2, 2, ["x"]);
		expect(checkpointer.lookupVariableBefore("x", 5)?.toNumber()).toBe(7);
		expectIndexMatchesWalk(checkpointer, ["x"], 5);
	});

	test("a name bound as both a function and a variable (f(x) = x + 1 above :f = 4)", () => {
		const { checkpointer, set, define, vm } = rig();
		define("f");
		checkpointer.snapshot(1, 1, ["f"], new Set(["f"]));
		set("f", 4);
		checkpointer.snapshot(2, 2, ["f"], new Set());
		expect(checkpointer.lookupFunctionBefore("f", 2)).toBe(vm.getUserFunction("f"));
		expect(checkpointer.lookupVariableBefore("f", 2)).toBeUndefined();
		expect(checkpointer.lookupFunctionBefore("f", 3)).toBe(vm.getUserFunction("f"));
		expect(checkpointer.lookupVariableBefore("f", 3)?.toNumber()).toBe(4);
		expectIndexMatchesWalk(checkpointer, ["f"], 3);
	});

	test("updateCheckpointAt adds a name to an existing entry", () => {
		const { checkpointer, set } = rig();
		set("a", 1);
		checkpointer.snapshot(2, 2, ["a"]);
		set("late", 9);
		expect(checkpointer.updateCheckpointAt(2, ["late"])).toBe(true);
		expect(checkpointer.lookupVariableBefore("late", 3)?.toNumber()).toBe(9);
		// Twice is the same entry, not two.
		expect(checkpointer.updateCheckpointAt(2, ["late"])).toBe(true);
		expectIndexMatchesWalk(checkpointer, ["a", "late"], 3);
		expect(checkpointer.updateCheckpointAt(40, ["late"])).toBe(false);
	});

	test("a structural edit that moves and deletes entries", () => {
		const { checkpointer, set } = rig();
		for (let line = 1; line <= 6; line++) {
			set(`v${line % 3}`, line);
			checkpointer.snapshot(line, 100 + line, [`v${line % 3}`]);
		}
		// Line ids 102 and 105 are deleted; the rest move down by ten.
		checkpointer.renumber((id) => (id === 102 || id === 105 ? -1 : id - 100 + 10));
		expect(checkpointer.getAllCheckpoints().map((c) => c.lineNumber)).toEqual([11, 13, 14, 16]);
		expectIndexMatchesWalk(checkpointer, ["v0", "v1", "v2"], 17);
	});

	test("a structural edit that reorders entries", () => {
		// No edit a document makes reverses lines, but `renumber` sorts by the
		// positions it is given, and the index has to follow the same order.
		const { checkpointer, set } = rig();
		for (let line = 1; line <= 5; line++) {
			set("x", line);
			checkpointer.snapshot(line, line, ["x"]);
		}
		checkpointer.renumber((id) => 6 - id);
		expect(checkpointer.lookupVariableBefore("x", 2)?.toNumber()).toBe(5);
		expect(checkpointer.lookupVariable("x")?.toNumber()).toBe(1);
		expectIndexMatchesWalk(checkpointer, ["x"], 6);
	});

	test("forget withdraws the names from the index", () => {
		const { checkpointer, set } = rig();
		set("a", 1);
		set("b", 2);
		checkpointer.snapshot(1, 1, ["a", "b"]);
		checkpointer.forget(["a"]);
		expect(checkpointer.lookupVariableBefore("a", 5)).toBeUndefined();
		expect(checkpointer.lookupVariableBefore("b", 5)?.toNumber()).toBe(2);
		checkpointer.forget([]);
		expectIndexMatchesWalk(checkpointer, ["a", "b"], 2);
	});

	test("clear empties the index", () => {
		const { checkpointer, set } = rig();
		set("a", 1);
		checkpointer.snapshot(1, 1, ["a"]);
		checkpointer.clear();
		expect(checkpointer.lookupVariableBefore("a", 5)).toBeUndefined();
		expect(checkpointer.lookupVariable("a")).toBeUndefined();
		expect(checkpointer.indexAgreesWithChain()).toBe(true);
	});

	test("a long random run of every operation agrees with the walk throughout", () => {
		const random = seeded(712);
		const { checkpointer, set, define } = rig();
		const names = ["a", "b", "c", "f", "g"];
		let nextId = 1;
		const idAt = new Map<number, number>();
		for (let step = 0; step < 400; step++) {
			const roll = random();
			const line = 1 + Math.floor(random() * 30);
			if (roll < 0.55) {
				const written = names.filter(() => random() < 0.4);
				const asFunctions = new Set(written.filter(() => random() < 0.3));
				for (const name of written) {
					if (asFunctions.has(name)) define(name);
					else set(name, step);
				}
				const id = idAt.get(line) ?? nextId++;
				idAt.set(line, id);
				checkpointer.snapshot(line, id, written, asFunctions);
			} else if (roll < 0.7) {
				checkpointer.dropCheckpointAt(line);
			} else if (roll < 0.8) {
				const name = names[Math.floor(random() * names.length)];
				set(name, -step);
				checkpointer.updateCheckpointAt(line, [name]);
			} else if (roll < 0.9) {
				// An insertion or deletion at `line`: everything at or below it moves.
				const shift = random() < 0.5 ? 1 : -1;
				const moved = new Map<number, number>();
				for (const checkpoint of checkpointer.getAllCheckpoints()) {
					const from = checkpoint.lineNumber;
					if (from < line) moved.set(checkpoint.lineId, from);
					else if (shift < 0 && from === line) moved.set(checkpoint.lineId, -1);
					else moved.set(checkpoint.lineId, from + shift);
				}
				checkpointer.renumber((id) => moved.get(id) ?? -1);
				idAt.clear();
				for (const checkpoint of checkpointer.getAllCheckpoints()) idAt.set(checkpoint.lineNumber, checkpoint.lineId);
			} else if (roll < 0.97) {
				checkpointer.forget([names[Math.floor(random() * names.length)]]);
			} else {
				checkpointer.clear();
				idAt.clear();
			}
			if (step % 20 === 0) expectIndexMatchesWalk(checkpointer, names, 32);
		}
		expectIndexMatchesWalk(checkpointer, names, 32);
	});
});

// ── The cost: a repeat pass over bare assignments is linear ─────────────

/**
 * A checkpointer whose checkpoints count every read of `parent`, the link the
 * old lookup followed one step at a time. `restoreTo` reads the array rather
 * than the links, and `snapshot` only writes them, so what is counted is the
 * lookups' work.
 */
class CountingCheckpointer extends VMCheckpointer {
	parentReads = 0;

	override snapshot(lineNumber: number, lineId: number, variableNames: string[], functionNames?: ReadonlySet<string>): VMCheckpoint | null {
		const checkpoint = super.snapshot(lineNumber, lineId, variableNames, functionNames);
		if (checkpoint !== null) {
			let parent = checkpoint.parent;
			Object.defineProperty(checkpoint, "parent", {
				get: () => {
					this.parentReads++;
					return parent;
				},
				set: (value: VMCheckpoint | null) => {
					parent = value;
				},
				enumerable: true,
				configurable: true,
			});
		}
		return checkpoint;
	}
}

/** Parent reads made by one repeat pass over `count` bare assignments. */
function parentReadsOfRepeatPass(count: number): number {
	const engine = newTrackedEngine();
	const checkpointer = new CountingCheckpointer(engine.getVM());
	const doc = new DocumentModel();
	doc.setDocument(Array.from({ length: count }, (_, i) => `v${i} = ${i + 1}`).join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine, checkpointer);
	try {
		evaluator.evaluateAll();
		checkpointer.parentReads = 0;
		evaluator.evaluateAll();
		return checkpointer.parentReads;
	} finally {
		evaluator.terminateWorker();
	}
}

describe("a repeat pass over bare assignments", () => {
	test("follows no parent link per line (the walk followed one per line above)", () => {
		// The walk read 249,500 links on this pass at 500 lines (two lookups a
		// line, one per bag, each as long as the lines above), and 999,000 at
		// 1,000. The index reads none.
		expect(parentReadsOfRepeatPass(500)).toBeLessThan(500);
	});

	test("does work proportional to the document, not its square", () => {
		const small = parentReadsOfRepeatPass(250);
		const large = parentReadsOfRepeatPass(1_000);
		// Four times the lines: at most four times the reads, where the walk
		// made sixteen times.
		expect(large).toBeLessThanOrEqual(Math.max(4 * small, 1_000));
	});
});

// ── The answers do not change ────────────────────────────────────────────

const read = (line: EvalLineResult) => (line.error ? "ERROR" : line.result ? formatValue(line.result) : "");
const fresh = (text: string) =>
	newTrackedEngine()
		.parseDocument(text, { inputType: "markdown" })
		.lines.map((line) => (line.error ? "ERROR" : line.result ? formatValue(line.result) : ""));

/**
 * The incremental answers against a fresh parseDocument's, line by line. A
 * line the batch pass leaves unanswered (prose) is reported as an error value
 * by the incremental pass by design, so the two compare equal, the rule
 * `documentProblems` in the adversarial kit uses.
 */
function expectAgreement(incremental: string[], text: string): void {
	const batch = fresh(text);
	expect(incremental.length).toBe(batch.length);
	expect(incremental.map((answer, i) => (answer === "ERROR" && batch[i] === "" ? "" : answer))).toEqual(batch);
}

/** Every pass of a live evaluator, and after each edit, against a fresh parseDocument. */
function expectRepeatPassesAgree(lines: string[], edits: [number, string][] = []): void {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	const pass = () => evaluator.evaluateAll().lines.map(read);
	const current = () => doc.getAllLines().map((s) => s.text).join("\n");
	try {
		expectAgreement(pass(), current());
		expectAgreement(pass(), current());
		for (const [line, text] of edits) {
			doc.editLine(line, text);
			expectAgreement(pass(), current());
			expectAgreement(pass(), current());
			expect(evaluator.getCheckpointer()!.indexAgreesWithChain()).toBe(true);
		}
	} finally {
		evaluator.terminateWorker();
	}
}

describe("the answers of a repeat pass are a fresh pass's answers", () => {
	test("the issue's document", () => {
		const lines = Array.from({ length: 200 }, (_, i) => `v${i} = ${i === 199 ? 100 : i + 1}`);
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluateAll();
			const second = evaluator.evaluateAll().lines;
			expect(read(second[199])).toBe("= 100");
			expect(read(second[0])).toBe("= 1");
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a name redefined further down, and read between", () => {
		expectRepeatPassesAgree(["x = 1", "x + 100", "x = 99", "x + 1", "y = x * 2", "y"]);
	});

	test("a definition that fails keeps what the lines above left", () => {
		expectRepeatPassesAgree(["x = 1", "x = zz", "x + 1"], [[2, "x = 5"], [2, "x = zz"]]);
	});

	test("a definition edited to prose and back", () => {
		expectRepeatPassesAgree(["price = 4", "qty = 3", "price * qty"], [[1, "the price is unknown"], [1, "price = 6"]]);
	});

	test("a variable renamed under a line that reads it", () => {
		expectRepeatPassesAgree(["rate = 5", "rate * 2"], [[1, "rat = 5"], [1, "rate = 7"]]);
	});

	test("a function and a variable of the same name", () => {
		expectRepeatPassesAgree(["f(x) = x + 1", "f(2)", ":f = 4", "f * 2", "f(3)"]);
	});

	test("bare and colon assignments mixed, with a value from the line above", () => {
		expectRepeatPassesAgree(["a = 2", ":b = a * 3", "c = b + 1", "prev * 2", "c"], [[1, "a = 10"]]);
	});

	test("a running total among bare assignments", () => {
		expectRepeatPassesAgree(["spent = 0", "spent += 10", "spent += 20", "spent"]);
	});

	test("a unit that does not fit, and a typo", () => {
		expectRepeatPassesAgree(["d = 5 m", "w = 3 kg", "d + w", "dd + 1", "d * 2"]);
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: a prototype word as a name reaches the index as a name", () => {
		expectPrototypeUntouched(() => {
			const { checkpointer, set } = rig();
			PROTOTYPE_WORDS.forEach((word, i) => {
				set(word, i + 1);
				checkpointer.snapshot(i + 1, i + 1, [word]);
			});
			PROTOTYPE_WORDS.forEach((word, i) => {
				expect(checkpointer.lookupVariableBefore(word, i + 1)).toBeUndefined();
				expect(checkpointer.lookupVariableBefore(word, i + 2)?.toNumber()).toBe(i + 1);
				expect(checkpointer.lookupFunctionBefore(word, i + 2)).toBeUndefined();
			});
			// Not a name any line wrote: nothing inherited is found.
			expect(checkpointer.lookupVariableBefore("hasOwnProperty", 1)).toBeUndefined();
			expectIndexMatchesWalk(checkpointer, PROTOTYPE_WORDS, PROTOTYPE_WORDS.length + 1);
		});
	});

	test("security: a document assigning prototype words, passed twice", () => {
		expectPrototypeUntouched(() => {
			expectRepeatPassesAgree(["constructor = 5", "toString = 3", "valueOf = constructor + toString", "valueOf"]);
		});
	});

	test("security: look-alike and markup-shaped lines among the assignments", () => {
		const lines = ["a = 1", ...TEXT_EDGES.filter((t) => !t.includes("\n")), "a + 1"];
		expectPrototypeUntouched(() => expectRepeatPassesAgree(lines));
	});

	test("security: thousands of bare assignments, passed twice, within budget", () => {
		const doc = new DocumentModel();
		doc.setDocument(Array.from({ length: 3_000 }, (_, i) => `v${i} = ${i}`).join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluateAll();
			const started = performance.now();
			evaluator.evaluateAll();
			// The walk took over a second here; the budget is generous.
			expect(performance.now() - started).toBeLessThan(5_000);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("edge: empty, whitespace-only and CRLF-ended lines between assignments", () => {
		expectRepeatPassesAgree(["a = 1\r", "", "   ", "b = a + 1\r", "b"]);
	});

	test("edge: numbers at the edges as the assigned values", () => {
		expectRepeatPassesAgree(["z = 0", "n = -0", "big = 2^53", "tiny = 1e-320", "inf = 1/0", "z + n + big", "tiny", "inf"]);
	});

	test("realistic: an assignment edited over and over, then the document edited structurally", () => {
		const doc = new DocumentModel();
		doc.setDocument(["a = 1", "b = a + 1", "c = b + 1", "c"].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			for (let i = 0; i < 10; i++) {
				doc.editLine(1, `a = ${i}`);
				evaluator.evaluateAll();
			}
			evaluator.applyTransaction([{ startLine: 2, deleteCount: 0, insertLines: ["x = 5", "a = a + x"] }]);
			expectAgreement(evaluator.evaluateAll().lines.map(read), doc.getAllLines().map((s) => s.text).join("\n"));
			expect(evaluator.getCheckpointer()!.indexAgreesWithChain()).toBe(true);
		} finally {
			evaluator.terminateWorker();
		}
	});
});
