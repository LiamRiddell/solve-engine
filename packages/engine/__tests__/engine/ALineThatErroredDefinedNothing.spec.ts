/**
 * A definition that failed leaves its name as the lines above left it.
 *
 * A pass from scratch skips the store when a definition's right-hand side
 * errors, so the name keeps whatever the lines above had put there: undefined
 * if none set it, and the earlier value if one did. The incremental path skips
 * the store too, but its VM is not fresh, so what the name kept was the value
 * from the previous pass, and for the line that had just failed that was its
 * own old answer:
 *
 * | document                        | action                  | before | now                     |
 * | ---                             | ---                     | ---    | ---                     |
 * | `:x = 5` / `x + 1`              | line 1 to `:x = zz + 1` | `6`    | `Undefined variable: x` |
 * | `:x = 1` / `x` / `:x = 7` / `x` | line 3 to `:x = zz`     | `7`    | `1`                     |
 *
 * The checkpoint chain records what each line wrote, in document order, so
 * the value the prefix holds is the one it holds just before the failed line,
 * and that is what the VM is put back to, before the line's own checkpoint is
 * taken. Whether the right-hand side answered with an error, threw, or did not
 * compile makes no difference: the store did not happen in any of them.
 *
 * The write stays declared. An earlier version dropped it, reasoning that an
 * errored line defined nothing, and the fault that reasoning caused was worse
 * than the one it fixed: a running total whose step failed (`spent += line 1`
 * with line 1 in error) recorded no write, so the reseed that re-runs every
 * accumulator each pass never found it again, and it stayed on the error after
 * the line it read had been fixed. An accumulator is also the one definition
 * this never touches: every pass resets each total to its seed and re-runs its
 * steps in order, so by the time one fails the VM already holds exactly what a
 * pass from scratch holds there, seed included.
 *
 * Goal seek, which started all this, is handled where it belongs now. `solve
 * line 4 for v1 = 27` varies `v1` inside the seek's own call frame and stores
 * nothing, so its unknown is neither a read nor a write of the document; see
 * `extractReadsAndWrites`. The tests below that name a seek pin that.
 *
 * The same holds out of view. A definition scrolled out of the viewport is
 * run by Tier 3 so the VM is right for the lines below it, and it runs under
 * the same discipline: put back before it runs, put back if it fails. And
 * the checkpoint chain the prefix is read from follows the lines through a
 * structural edit rather than being cleared by one, since a clean line above
 * the viewport never runs again to put its entry back.
 *
 * The boundary: a later expression on the same line that fails does not undo
 * an earlier one that succeeded, since what the earlier expression set is
 * exactly what the lines above that point of the line left. And a pending
 * value is not a failure: it has not arrived yet.
 *
 * Found by the differential fuzz of editing sessions and by the adversarial
 * verification of the #444 fix, which is what exposed the accumulator strand.
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
	test("a goal seek that runs still defines nothing", () => {
		// A seek varies its unknown inside its own call frame and stores
		// nothing: `deposit` below this document is whatever `:deposit =` said,
		// not 450. So the line answers, and its write set is empty, the same as
		// a seek that could not run. It used to claim the write, which is the
		// shape `deposit =` has, and that claim held the name open after the
		// definition was edited away (the next test).
		const { doc } = editorFor([":deposit = 100000", "deposit * 2", "solve line 2 for deposit = 900"]);
		expect(shown(doc, 3)).toBe("450");
		expect(shown(doc, 2)).toBe("200,000");

		const state = doc.getLineAt(3) as unknown as { writes?: string[] };
		expect(state?.writes ?? []).not.toContain("deposit");
	});

	test("a seek that ran does not keep its unknown defined once the definition is edited away", () => {
		// The shape the differential fuzz shrank to (seed 24000051). Line 4
		// read `v1` from the definition on line 5; editing that line into a
		// seek over line 4 left `v1` in the VM, because the seek claimed to
		// write it, and line 4 went on answering 14 where a pass over the same
		// text has never had a `v1` to read.
		const lines = ["total above", ":v2 = 20", "6 sprints in weeks", "v1 + 7", ":v1 = 7"];
		const { doc, evaluator } = editorFor(lines);
		expect(shown(doc, 4)).toBe("14");

		doc.editLine(5, "solve line 4 for v1 = 27");
		for (let pass = 0; pass < 6; pass++) evaluator.evaluate({ startLine: 1, endLine: 5 });

		const text = [...lines.slice(0, 4), "solve line 4 for v1 = 27"];
		expect(answersOf(doc, 5)).toEqual(settled(text));
		expect(shown(doc, 4)).toContain("Undefined variable: v1");
		expect(shown(doc, 5)).toBe("20");
		evaluator.terminateWorker();
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

describe("a definition that failed", () => {
	test("is left as the lines above left it, which may be undefined", () => {
		const { doc, evaluator } = editorFor([":x = 5", "x + 1"]);
		expect(shown(doc, 2)).toBe("6");

		doc.editLine(1, ":x = zz + 1");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled([":x = zz + 1", "x + 1"]));
		expect(shown(doc, 2)).toContain("Undefined variable: x");
	});

	test("keeps an earlier definition of the same name", () => {
		// The value the lines above left is a value, not nothing. A pass from
		// scratch skips the store and reads on with the earlier one.
		const { doc, evaluator } = editorFor([":x = 1", "x", ":x = 7", "x"]);
		expect(shown(doc, 4)).toBe("7");

		doc.editLine(3, ":x = zz");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 4 });

		expect(answersOf(doc, 4)).toEqual(settled([":x = 1", "x", ":x = zz", "x"]));
		expect(shown(doc, 4)).toBe("1");
	});

	test("recovers once the right-hand side is fixed", () => {
		const { doc, evaluator } = editorFor([":x = zz + 1", "x + 1"]);
		doc.editLine(1, ":x = 5");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled([":x = 5", "x + 1"]));
	});

	test("a later expression on the same line does not undo an earlier one", () => {
		const { doc, evaluator } = editorFor(["s`:a = 5` and s`:a = zz`", "a"]);
		doc.editLine(1, "s`:a = 6` and s`:a = zz`");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled(["s`:a = 6` and s`:a = zz`", "a"]));
		expect(shown(doc, 2)).toBe("6");
	});
});

describe("a running total whose step failed", () => {
	test("is re-seeded again once the line it read is fixed", () => {
		// The strand the dropped write caused. `spent += line 1` with line 1 in
		// error recorded no write, the reseed never found it, and it stayed on
		// the error after line 1 became a number.
		const { doc, evaluator } = editorFor(["@@@", "spent += line 1", "spent"]);
		doc.editLine(1, "9");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(answersOf(doc, 3)).toEqual(settled(["9", "spent += line 1", "spent"]));
		expect(shown(doc, 3)).toBe("9");
	});

	test("keeps the total the steps above it built", () => {
		const { doc, evaluator } = editorFor(["spent += 3", "spent += 4", "spent"]);
		doc.editLine(2, "spent += zz");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(answersOf(doc, 3)).toEqual(settled(["spent += 3", "spent += zz", "spent"]));
		expect(shown(doc, 3)).toBe("3");
	});

	test("shows the seed when it is the first step", () => {
		// The seed is a value a pass from scratch also shows, which is why an
		// accumulator is the one definition the restore leaves alone.
		const { doc, evaluator } = editorFor(["spent += 3", "spent"]);
		doc.editLine(1, "spent += zz");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });

		expect(answersOf(doc, 2)).toEqual(settled(["spent += zz", "spent"]));
		expect(shown(doc, 2)).toBe("0");
	});

	test("a cycle through it, broken again, leaves it able to recover", () => {
		// The regression the #444 fix's own verifier found: a member reset to an
		// error must still be re-seeded when the cycle is edited away.
		const { doc, evaluator } = editorFor(["9", "spent += line 1"]);
		doc.editLine(1, "line 2 + 1");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(answersOf(doc, 2)).toEqual(settled(["line 2 + 1", "spent += line 1"]));

		doc.editLine(1, "9");
		for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(answersOf(doc, 2)).toEqual(settled(["9", "spent += line 1"]));
		expect(shown(doc, 2)).toBe("9");
	});
});

describe("out of view, and after a structural edit", () => {
	// Tier 3 runs a definition that is out of view so the VM is right for the
	// lines below it, under the same discipline as Tier 1: the names the line
	// wrote are put back to the prefix before it runs and again if it fails.
	// Without that a line scrolled out of view kept what it had stored before
	// the edit, and one that read its own name climbed by its step on every
	// pass, for as long as it stayed out of view.
	const passes = (evaluator: ThreeTierEvaluator, startLine: number, endLine: number, count: number) => {
		for (let pass = 0; pass < count; pass++) evaluator.evaluate({ startLine, endLine });
	};
	const open = (lines: string[]) => {
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		return { doc, evaluator: new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine) };
	};

	test("a self-reading definition that was only ever compiled out of view", () => {
		const { doc, evaluator } = open([":v3 = 44", ":v3 = v3 + 3", "v3"]);
		passes(evaluator, 3, 3, 6);
		expect(shown(doc, 3)).toBe("47");
		doc.editLine(1, "7 + 7");
		passes(evaluator, 3, 3, 6);
		passes(evaluator, 1, 3, 8);
		expect(answersOf(doc, 3)).toEqual(settled(["7 + 7", ":v3 = v3 + 3", "v3"]));
		expect(answersOf(doc, 3)).toEqual(["14", "Undefined variable: v3", "Undefined variable: v3"]);
		// And it stays there: this used to climb by three a pass with no edit.
		passes(evaluator, 1, 3, 8);
		expect(answersOf(doc, 3)).toEqual(["14", "Undefined variable: v3", "Undefined variable: v3"]);
		evaluator.terminateWorker();
	});

	test("a definition that fails out of view keeps nothing", () => {
		const { doc, evaluator } = open([":x = 5", ":x = 9", "x"]);
		passes(evaluator, 3, 3, 6);
		expect(shown(doc, 3)).toBe("9");
		doc.editLine(2, ":x = zz + 1");
		passes(evaluator, 3, 3, 6);
		// While still scrolled: the failed line put x back to what line 1 left.
		expect(shown(doc, 3)).toBe("5");
		passes(evaluator, 1, 3, 8);
		expect(answersOf(doc, 3)).toEqual(["5", "Undefined variable: zz", "5"]);
		evaluator.terminateWorker();
	});

	test("a definition above the viewport is still the prefix after a structural edit", () => {
		// The chain used to be cleared by a structural edit and rebuilt as lines
		// ran; a clean line above the viewport never runs, so its entry never
		// came back, and the line below it was told the prefix held nothing.
		const a = open([":x = 5", ":x = x + 1", "x"]);
		passes(a.evaluator, 1, 3, 6);
		a.evaluator.applyTransaction([{ startLine: 4, deleteCount: 0, insertLines: ["7"] }]);
		passes(a.evaluator, 2, 4, 6);
		expect(answersOf(a.doc, 4)).toEqual(["5", "6", "6", "7"]);
		a.evaluator.terminateWorker();

		const b = open([":a = 5", ":b = a + c", ":c = b + 1", "b"]);
		passes(b.evaluator, 1, 4, 6);
		b.evaluator.applyTransaction([{ startLine: 5, deleteCount: 0, insertLines: ["7"] }]);
		passes(b.evaluator, 2, 5, 6);
		// The right name is blamed: `a` is defined on the line above.
		expect(shown(b.doc, 2)).toBe("Undefined variable: c");
		b.evaluator.terminateWorker();

		const c = open([":x = 5", ":x = 9", "x"]);
		passes(c.evaluator, 1, 3, 6);
		c.evaluator.applyTransaction([{ startLine: 4, deleteCount: 0, insertLines: ["7"] }]);
		passes(c.evaluator, 2, 4, 6);
		c.doc.editLine(2, ":x = zz");
		passes(c.evaluator, 2, 4, 6);
		expect(shown(c.doc, 3)).toBe("5");
		c.evaluator.terminateWorker();
	});

	test("a deleted definition's name holds what the rest of the document leaves it", () => {
		const { doc, evaluator } = open([":x = 1", ":x = 2", "x"]);
		passes(evaluator, 1, 3, 4);
		expect(shown(doc, 3)).toBe("2");
		evaluator.applyTransaction([{ startLine: 2, deleteCount: 1, insertLines: [] }]);
		// Line 1 stays out of view, so nothing runs it again: the name has to
		// have been put back when the line that wrote it went.
		passes(evaluator, 2, 2, 4);
		expect(shown(doc, 2)).toBe("1");
		evaluator.terminateWorker();
	});
});
