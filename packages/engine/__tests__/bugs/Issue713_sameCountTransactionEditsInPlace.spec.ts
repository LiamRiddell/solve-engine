import { describe, expect, jest, test } from "@jest/globals";
import { DocumentModel, type LineChange } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, inPlaceEdits, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { djb2Hash } from "@solve-js/utilities/Hash";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, NUMERIC_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #713: a host that reports each keystroke as a line change sends
 * `{ startLine, deleteCount: 1, insertLines: [newText] }` to
 * `applyTransaction`, and that was handled as a structural edit although no
 * line had moved: a new line id (the compiled programs and recorded edges went
 * with the old one), a renumbered checkpoint chain, a cleared dependency graph,
 * and every line from the edit down recorded as moved, so the next pass forgot
 * the answers below the viewport. At 20,000 lines a keystroke cost 33.8 ms
 * that way against 2.1 ms through `editLine` on this spec's machine, and line
 * 1500, which does not read the edited line, lost its answer.
 *
 * A transaction whose every change deletes as many lines as it inserts is now
 * applied line by line through `DocumentModel.editLine`: the ids are kept and
 * the lines are only marked dirty. Any change that alters the line count sends
 * the whole transaction down the structural path, as before.
 */

// ── inPlaceEdits, the decision ───────────────────────────────────────────

describe("inPlaceEdits", () => {
	const change = (startLine: number, deleteCount: number, insertLines: string[]): LineChange => ({ startLine, deleteCount, insertLines });

	test("a keystroke is one edit", () => {
		expect(inPlaceEdits([change(3, 1, [":v2 = 8"])], 10)).toEqual([[3, ":v2 = 8"]]);
	});

	test("a multi-line same-count paste is one edit per line", () => {
		expect(inPlaceEdits([change(2, 3, ["a", "b", "c"])], 10)).toEqual([[2, "a"], [3, "b"], [4, "c"]]);
	});

	test("several changes come back highest first, the order the structural path applies them", () => {
		expect(inPlaceEdits([change(2, 1, ["X"]), change(4, 1, ["Y"])], 5)).toEqual([[4, "Y"], [2, "X"]]);
	});

	test("the first and the last line of the document", () => {
		expect(inPlaceEdits([change(1, 1, ["first"])], 1)).toEqual([[1, "first"]]);
		expect(inPlaceEdits([change(5, 1, ["last"])], 5)).toEqual([[5, "last"]]);
		expect(inPlaceEdits([change(1, 5, ["a", "b", "c", "d", "e"])], 5)).toHaveLength(5);
	});

	test("no changes, and a change of nothing, are no edits", () => {
		expect(inPlaceEdits([], 5)).toEqual([]);
		expect(inPlaceEdits([change(3, 0, [])], 5)).toEqual([]);
		// A change of nothing places no line, so where it points does not matter.
		expect(inPlaceEdits([change(99, 0, [])], 5)).toEqual([]);
	});

	test("a change that alters the line count is structural", () => {
		expect(inPlaceEdits([change(2, 1, [])], 5)).toBeNull();
		expect(inPlaceEdits([change(2, 0, ["new"])], 5)).toBeNull();
		expect(inPlaceEdits([change(2, 1, ["a", "b"])], 5)).toBeNull();
	});

	test("one structural change sends the whole transaction down the structural path", () => {
		expect(inPlaceEdits([change(1, 1, ["same count"]), change(4, 0, ["insert"])], 5)).toBeNull();
	});

	test("a change reaching past the end of the document is structural", () => {
		expect(inPlaceEdits([change(6, 1, ["x"])], 5)).toBeNull();
		expect(inPlaceEdits([change(5, 2, ["x", "y"])], 5)).toBeNull();
		expect(inPlaceEdits([change(1, 1, ["x"])], 0)).toBeNull();
	});

	test.each([
		["zero", 0],
		["negative", -1],
		["negative zero", -0],
		["a fraction", 1.5],
		["NaN", Number.NaN],
		["Infinity", Infinity],
		["past 2^53", 2 ** 53 + 2],
	])("a first line that is %s is structural", (_label, startLine) => {
		expect(inPlaceEdits([change(startLine, 1, ["x"])], 10)).toBeNull();
	});

	test("hostile shapes from a host are structural, never a throw", () => {
		const hostile = [
			{ startLine: 1, deleteCount: 1, insertLines: [5 as unknown as string] },
			{ startLine: 1, deleteCount: 1, insertLines: null as unknown as string[] },
			{ startLine: 1, deleteCount: 1, insertLines: "x" as unknown as string[] },
			{ startLine: "1" as unknown as number, deleteCount: 1, insertLines: ["x"] },
			{ startLine: 1, deleteCount: "1" as unknown as number, insertLines: ["x"] },
		];
		for (const shape of hostile) expect(inPlaceEdits([shape], 10)).toBeNull();
	});

	test("prototype words as line text are text", () => {
		expectPrototypeUntouched(() => {
			expect(inPlaceEdits([change(1, PROTOTYPE_WORDS.length, [...PROTOTYPE_WORDS])], 20)).toEqual(PROTOTYPE_WORDS.map((word, i) => [i + 1, word]));
		});
	});
});

// ── The document: a keystroke edits in place ─────────────────────────────

/** `:v0 = 1`, `v0 * 2`, `:v1 = 2`, ...: the issue's document. */
function alternating(count: number): string[] {
	const lines: string[] = [];
	for (let i = 0; lines.length < count; i++) {
		lines.push(`:v${i} = ${i + 1}`);
		lines.push(`v${i} * 2`);
	}
	return lines.slice(0, count);
}

const read = (line: EvalLineResult | undefined) => (line === undefined ? "(no line)" : line.error ? "ERROR" : line.result ? formatValue(line.result) : "");

function live(lines: string[]) {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const engine = newTrackedEngine();
	const evaluator = new ThreeTierEvaluator(doc, engine);
	return { doc, engine, evaluator, done: () => evaluator.terminateWorker() };
}

describe("a same-count transaction is an edit in place", () => {
	test("the issue's document: the edited line keeps its id and line 1500 keeps its answer", () => {
		const { doc, evaluator, done } = live(alternating(2_000));
		try {
			evaluator.evaluateAll();
			const id = doc.getLineAt(3)!.lineId;
			expect(formatValue(doc.getLineAt(1500)!.result!)).toBe("= 1,500");
			const result = evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [":v1 = 7"] }]);
			expect(result).toEqual({ inserted: [], removed: [], edited: [id] });
			expect(doc.getLineAt(3)!.lineId).toBe(id);
			const answers = evaluator.evaluate({ startLine: 1, endLine: 40 }).lines;
			expect(read(answers[3])).toBe("= 14");
			// Below the viewport, reading nothing that changed: kept.
			expect(formatValue(doc.getLineAt(1500)!.result!)).toBe("= 1,500");
		} finally {
			done();
		}
	});

	test("nothing structural runs: no renumbered chain and no cleared graph", () => {
		const { engine, evaluator, done } = live(alternating(200));
		try {
			evaluator.evaluateAll();
			const renumber = jest.spyOn(evaluator.getCheckpointer()!, "renumber");
			const clear = jest.spyOn(engine.getDag(), "clear");
			evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [":v1 = 7"] }]);
			evaluator.evaluate({ startLine: 1, endLine: 40 });
			expect(renumber).not.toHaveBeenCalled();
			expect(clear).not.toHaveBeenCalled();
			// The structural path still does both.
			evaluator.applyTransaction([{ startLine: 3, deleteCount: 0, insertLines: ["1 + 1"] }]);
			expect(renumber).toHaveBeenCalledTimes(1);
			expect(clear).toHaveBeenCalledTimes(1);
		} finally {
			done();
		}
	});

	test("the only line that runs in full is the edited one and its reader", () => {
		const { evaluator, done } = live(alternating(200));
		try {
			evaluator.evaluateAll();
			evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [":v1 = 7"] }]);
			const counts = evaluator.evaluate({ startLine: 1, endLine: 40 }).tierCounts;
			expect(counts.tier1).toBeLessThanOrEqual(2);
		} finally {
			done();
		}
	});

	test("the same text again is no edit", () => {
		const { evaluator, done } = live(["a = 1", "a + 1"]);
		try {
			evaluator.evaluateAll();
			expect(evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: ["a = 1"] }]).edited).toEqual([]);
		} finally {
			done();
		}
	});
});

// ── The answers agree with a fresh pass ──────────────────────────────────

const fresh = (text: string) =>
	newTrackedEngine()
		.parseDocument(text, { inputType: "markdown" })
		.lines.map((line) => (line.error ? "ERROR" : line.result ? formatValue(line.result) : ""));

/** After each transaction, the whole document against a fresh parseDocument. */
function expectTransactionsAgree(lines: string[], transactions: LineChange[][], viewport?: { startLine: number; endLine: number }): void {
	const { doc, evaluator, done } = live(lines);
	const current = () => doc.getAllLines().map((s) => s.text).join("\n");
	const check = () => {
		evaluator.evaluate(viewport ?? { startLine: 1, endLine: doc.lineCount });
		const all = evaluator.evaluateAll().lines.map(read);
		const batch = fresh(current());
		expect({ text: current(), answers: all.map((a, i) => (a === "ERROR" && batch[i] === "" ? "" : a)) }).toEqual({ text: current(), answers: batch });
	};
	try {
		check();
		for (const transaction of transactions) {
			evaluator.applyTransaction(transaction);
			check();
		}
	} finally {
		done();
	}
}

const one = (startLine: number, text: string): LineChange[] => [{ startLine, deleteCount: 1, insertLines: [text] }];

describe("after a same-count transaction every line agrees with a fresh pass", () => {
	test("a definition turned into prose and back", () => {
		expectTransactionsAgree(["price = 4", "qty = 3", "price * qty"], [one(1, "the price is not known yet"), one(1, "price = 6")]);
	});

	test("a colon definition turned into prose and back", () => {
		expectTransactionsAgree([":price = 4", "price * 2"], [one(1, "no price"), one(1, ":price = 9")]);
	});

	test("the variable a later line reads, renamed and renamed back", () => {
		expectTransactionsAgree([":rate = 5", ":base = 10", "rate * base"], [one(1, ":rat = 5"), one(1, ":rate = 7")]);
	});

	test("a multi-line same-count paste", () => {
		expectTransactionsAgree(["a = 1", "b = 2", "c = 3", "a + b + c"], [[{ startLine: 1, deleteCount: 3, insertLines: ["a = 10", "b = a * 2", "c = b + 1"] }]]);
	});

	test("two separate same-count changes in one transaction", () => {
		expectTransactionsAgree(["x = 1", "x + 1", "y = 2", "y + x"], [[{ startLine: 1, deleteCount: 1, insertLines: ["x = 5"] }, { startLine: 3, deleteCount: 1, insertLines: ["y = 7"] }]]);
	});

	test("a transaction mixing a same-count and a structural change takes the structural path, and is right", () => {
		expectTransactionsAgree(["x = 1", "x + 1", "y = 2"], [[{ startLine: 1, deleteCount: 1, insertLines: ["x = 5"] }, { startLine: 3, deleteCount: 0, insertLines: ["x * 10"] }]]);
	});

	test("a line reading a position, and a total above, across an in-place edit", () => {
		expectTransactionsAgree(["10", "20", "total above", "line 1 + 1", "prev * 2"], [one(1, "15"), one(2, "prose")]);
	});

	test("a category tag and its total", () => {
		expectTransactionsAgree(["rent 500 #bills", "power 80 #bills", "total of #bills"], [one(2, "power 90 #bills"), one(2, "power 90")]);
	});

	test("a table cell edited in place, and the separator removed and restored", () => {
		expectTransactionsAgree(["| item | cost |", "| --- | --- |", "| food | 10 |", "| rent | 20 |"], [one(3, "| food | 15 |"), one(2, "just prose"), one(2, "| --- | --- |")]);
	});

	test("a hash-colliding edit through a transaction is taken, not dropped (#664)", () => {
		expect(djb2Hash("total = bA * 2")).toBe(djb2Hash("total = ab * 2"));
		expectTransactionsAgree(["ab = 3", "bA = 100", "total = ab * 2"], [one(3, "total = bA * 2")]);
	});

	test("a user function redefined in place", () => {
		expectTransactionsAgree(["f(x) = x + 1", "f(2)"], [one(1, "f(x) = x * 10"), one(1, "f is gone")]);
	});

	test("a running total edited in place", () => {
		expectTransactionsAgree(["spent = 0", "spent += 10", "spent += 20", "spent"], [one(2, "spent += 15")]);
	});

	test("a keystroke above a viewport near the bottom", () => {
		const lines = alternating(300);
		expectTransactionsAgree(lines, [one(3, ":v1 = 50"), one(3, ":v1 = 2")], { startLine: 261, endLine: 300 });
	});

	test("then a structural edit after in-place ones", () => {
		expectTransactionsAgree(["a = 1", "b = a + 1", "b * 2"], [one(1, "a = 4"), [{ startLine: 2, deleteCount: 0, insertLines: ["a = a + 1"] }], one(1, "a = 0")]);
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words written into lines through a transaction", () => {
		expectPrototypeUntouched(() => {
			expectTransactionsAgree(["a = 1", "a + 1"], PROTOTYPE_WORDS.map((word) => one(1, `${word} = 3`)));
			expectTransactionsAgree(["x = 1", "x"], PROTOTYPE_WORDS.map((word) => one(2, word)));
		});
	});

	test("security: look-alike and markup-shaped text typed into a line", () => {
		// A lone carriage return inside one line's text is left out: the batch
		// pass reads it as a line break and the document model does not, on
		// either path, before this change as after it.
		const texts = TEXT_EDGES.filter((text) => !text.includes("\r"));
		expectPrototypeUntouched(() => {
			expectTransactionsAgree(["a = 1", "a + 1"], texts.map((text) => one(2, text)));
		});
	});

	test("security: thousands of keystrokes in a row stay within budget", () => {
		const { evaluator, done } = live(alternating(2_000));
		try {
			evaluator.evaluateAll();
			const started = performance.now();
			for (let i = 0; i < 1_000; i++) {
				evaluator.applyTransaction(one(3, `:v1 = ${i}`));
				evaluator.evaluate({ startLine: 1, endLine: 40 });
			}
			expect(performance.now() - started).toBeLessThan(20_000);
		} finally {
			done();
		}
	});

	test("security: a whole-document same-count replacement", () => {
		const lines = Array.from({ length: 500 }, (_, i) => `v${i} = ${i}`);
		expectTransactionsAgree(lines, [[{ startLine: 1, deleteCount: 500, insertLines: lines.map((_, i) => `v${i} = ${i * 2}`) }]]);
	});

	test("edge: numbers at the edges typed into a definition", () => {
		expectTransactionsAgree(["n = 1", "n * 2"], NUMERIC_EDGES.map((value) => one(1, `n = ${value}`)));
	});

	test("edge: an empty line, whitespace, and a tab", () => {
		expectTransactionsAgree(["a = 1", "a + 1"], [one(1, ""), one(1, "   "), one(1, "\ta = 2"), one(1, "a = 3")]);
	});

	test("edge: the only line of a one-line document", () => {
		expectTransactionsAgree(["5"], [one(1, "6"), one(1, ""), one(1, "7 + 1")]);
	});

	test("realistic: a keystroke that does not change the text, then one that does", () => {
		expectTransactionsAgree(["a = 1", "a + 1"], [one(1, "a = 1"), one(1, "a = 12")]);
	});
});
