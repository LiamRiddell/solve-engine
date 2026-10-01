import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * A reference to a line further down disagreed between the passes. For
 * `a = line 3 * 2` / `a + 1` / `5`, parseDocument refused lines 1 and 2 as a
 * forward reference, and so did a live editor's first pass; from its second
 * pass on, the editor read the answer the previous pass had left line 3 and
 * showed 10 and 11. The docs (line-references.md) say a reference to a line
 * further down is refused, cycle or not, because a note is read from the top;
 * that is the one answer, and the incremental path now gives it on every pass.
 *
 * The context's `getLineResult` refuses a read of a line below the reader on
 * the incremental path unconditionally, where it used to refuse it only for a
 * line on a cycle, and goal seek's `getLineReads` does the same for a target
 * below the seek. The edge is still recorded, so a cycle through a forward
 * reference is still found.
 */

// ── Helpers ─────────────────────────────────────────────────────────────

function answers(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.isError() ? `ERROR ${text}` : text;
	});
}
const batch = (lines: readonly string[]) => answers(newTrackedEngine().parseDocument(lines.join("\n")));
const incremental = (lines: readonly string[]) => answers(evaluateDocument(newTrackedEngine(), lines.join("\n")));

/** A live editor over the text, and what it shows after each of `passes` passes. */
function passesOver(lines: readonly string[], passes: number): string[][] {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	const out: string[][] = [];
	try {
		for (let pass = 0; pass < passes; pass++) {
			out.push(
				evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map((line) => {
					if (line.error) return `ERROR ${line.error}`;
					if (!line.result) return "";
					const text = formatValue(line.result).replace(/^=\s*/, "");
					return line.result.isError() ? `ERROR ${text}` : text;
				}),
			);
		}
	} finally {
		evaluator.terminateWorker();
	}
	return out;
}

/** Every pass of a live editor, the batch pass and evaluateDocument give one answer. */
function expectOneAnswer(lines: readonly string[], passes = 4): string[] {
	const expected = batch(lines);
	expect(incremental(lines)).toEqual(expected);
	for (const [i, shown] of passesOver(lines, passes).entries()) expect({ pass: i + 1, shown }).toEqual({ pass: i + 1, shown: expected });
	return expected;
}

/** The engine's own per-line context for a line of a live document, for the closure on its own. */
function contextFor(lines: readonly string[], lineNumber: number): { context: LineExecutionContext; engine: ExpressionEngine; done: () => void } {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const engine = newTrackedEngine();
	const evaluator = new ThreeTierEvaluator(doc, engine);
	evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
	const context = (engine as unknown as { makeLineContext(n: number): LineExecutionContext }).makeLineContext(lineNumber);
	return { context, engine, done: () => evaluator.terminateWorker() };
}

const notEvaluated = (n: number) => `ERROR Line ${n} has not been evaluated yet (forward reference, or out of range)`;

// ── The closure ─────────────────────────────────────────────────────────

describe("the incremental path's getLineResult", () => {
	test("reads a line above, refuses the line itself and a line below, on any pass", () => {
		const { context, done } = contextFor(["10", "20", "30"], 2);
		try {
			expect(formatValue(context.getLineResult!(1)!)).toBe("= 10");
			expect(context.getLineResult!(2)).toBeUndefined();
			// Line 3 holds 30 from the pass that just ran; it is still below.
			expect(context.getLineResult!(3)).toBeUndefined();
			expect(context.getLineResult!(4)).toBeUndefined();
			expect(context.getLineResult!(0)).toBeUndefined();
			expect(context.getLineResult!(-1)).toBeUndefined();
			expect(context.getLineResult!(Number.NaN)).toBeUndefined();
		} finally {
			done();
		}
	});

	test("records the edge of a forward read, so a cycle through it is still found", () => {
		const { context, engine, done } = contextFor(["10", "20", "30"], 2);
		try {
			engine.getDag().forgetPositionReads(2);
			context.getLineResult!(3);
			expect(engine.getDag().positionsReadBy(2)).toEqual([3]);
		} finally {
			done();
		}
	});

	test("records nothing for a read the form declared", () => {
		const { context, engine, done } = contextFor(["10", "20", "30"], 3);
		try {
			engine.getDag().forgetPositionReads(3);
			expect(formatValue(context.getLineResult!(1, true)!)).toBe("= 10");
			expect(engine.getDag().positionsReadBy(3)).toEqual([]);
			context.getLineResult!(1, false);
			expect(engine.getDag().positionsReadBy(3)).toEqual([1]);
		} finally {
			done();
		}
	});

	test("a line explained on its own stands below the whole note, so it reads any line", () => {
		const { engine, done } = contextFor(["10", "20", "30"], 1);
		try {
			expect(formatValue(engine.explainLine("line 3 * 2").result)).toBe("= 60");
		} finally {
			done();
		}
	});

	test("goal seek's getLineReads refuses a target below the seek", () => {
		const { context, done } = contextFor([":x = 3", "x * 2", "x + 1"], 2);
		try {
			expect(context.getLineReads!(1)).toEqual(expect.any(Array));
			expect(context.getLineReads!(3)).toBeUndefined();
		} finally {
			done();
		}
	});
});

// ── Documents ───────────────────────────────────────────────────────────

describe("one answer for a forward reference", () => {
	test("the reported document", () => {
		expect(expectOneAnswer(["a = line 3 * 2", "a + 1", "5"])).toEqual([notEvaluated(3), notEvaluated(3), "5"]);
	});

	test("with a colon assignment and a plain line", () => {
		expect(expectOneAnswer([":a = line 3 * 2", "a + 1", "5"])).toEqual([notEvaluated(3), notEvaluated(3), "5"]);
		expect(expectOneAnswer(["line 3 * 2", "prev + 1", "5"])).toEqual([notEvaluated(3), "ERROR Line 1 has an error", "5"]);
	});

	test("the docs' own example", () => {
		expect(expectOneAnswer(["line 2 + 1", "7"])).toEqual([notEvaluated(2), "7"]);
	});

	test("every form that reads another line's answer", () => {
		expectOneAnswer(["sum(line 2 : line 3)", "1", "2"]);
		expectOneAnswer(["average(line 2 : line 3)", "1", "2"]);
		expectOneAnswer(["total of #a", "1 #a", "2 #a"]);
		expectOneAnswer(["count of #a", "1 #a", "2 #a"]);
		expectOneAnswer(["total by tag", "1 #a", "2 #b"]);
		expectOneAnswer(['total of section "Costs"', "# Costs", "1", "2"]);
		expectOneAnswer(["inputs of line 2", "5"]);
		expectOneAnswer(["line 2 with x = 1", "x = 5", "x * 2"]);
	});

	test("a goal seek above its target is refused on every pass", () => {
		const shown = passesOver(["x = 3", "solve line 3 for x = 10", "x * 2"], 4);
		for (const pass of shown) expect(pass[1]).toBe("ERROR Line 3 has no evaluated expression to solve (forward reference, out of range, or not an expression).");
	});

	test("a reference backwards is untouched", () => {
		expect(expectOneAnswer(["5", "line 1 * 2", "prev + 1", "total above"])).toEqual(["5", "10", "11", "26"]);
	});
});

// ── Adversarial ─────────────────────────────────────────────────────────

describe("adversarial: realistic breakage", () => {
	test("an insert that turns a backward reference into a forward one", () => {
		const doc = new DocumentModel();
		doc.setDocument(["7", "line 1 + 1"].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluate({ startLine: 1, endLine: 2 });
			// A new first line reads line 2, the 7 that has moved down to it.
			evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["line 2 + 1"] }]);
			for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: 3 });
			const shown = [1, 2, 3].map((n) => {
				const r = doc.getLineAt(n)!.result;
				return r ? formatValue(r).replace(/^=\s*/, "") : "";
			});
			expect(shown[0]).toBe("Line 2 has not been evaluated yet (forward reference, or out of range)");
			// `line 1 + 1` now names the new first line, which has no answer.
			expect(shown.slice(1)).toEqual(["7", "Line 1 has an error"]);
			expect(shown).toEqual(batch(["line 2 + 1", "7", "line 1 + 1"]).map((s) => s.replace(/^ERROR /, "")));
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("an edit that closes a cycle through a forward reference, and one that opens it again", () => {
		const doc = new DocumentModel();
		doc.setDocument(["line 2 + 5", "7"].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			const view = { startLine: 1, endLine: 2 };
			const shown = () => [1, 2].map((n) => formatValue(doc.getLineAt(n)!.result!).replace(/^=\s*/, ""));
			evaluator.evaluate(view);
			doc.editLine(2, "prev + 5");
			for (let pass = 0; pass < 3; pass++) evaluator.evaluate(view);
			expect(shown()).toEqual(batch(["line 2 + 5", "prev + 5"]).map((s) => s.replace(/^ERROR /, "")));
			doc.editLine(2, "7");
			for (let pass = 0; pass < 3; pass++) evaluator.evaluate(view);
			expect(shown()).toEqual(["Line 2 has not been evaluated yet (forward reference, or out of range)", "7"]);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a check and a what-if over a forward reference", () => {
		expectOneAnswer(["check line 2 == 7", "7"]);
		expectOneAnswer(["x = 5", "line 3 with x = 1", "x * 2"]);
	});
});

describe("adversarial: security", () => {
	test("prototype words as the name a forward reference assigns", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectOneAnswer([`${word} = line 3 * 2`, `${word} + 1`, "5"], 3);
		});
	});

	test("look-alike and markup-shaped text as the line below", () => {
		for (const text of TEXT_EDGES) expectHonestDocument(["line 2 + 1", text, "prev"].join("\n"));
	});

	test("two thousand forward references stay within budget and agree", () => {
		const lines = Array.from({ length: 2_000 }, (_, i) => `line ${i + 2} + 1`);
		lines.push("5");
		const { incremental: out } = expectHonestDocument(lines.join("\n"), { budgetMs: 30_000 });
		expect(out[0]).toBe("ERROR Line 2 has not been evaluated yet (forward reference, or out of range)");
	});
});

describe("adversarial: edge cases", () => {
	test("line 0, a negative line, a fraction and a line past the end", () => {
		for (const ref of ["line 0", "line -1", "line 1.5", "line 99", "line 2^53"]) expectHonestDocument([`${ref} + 1`, "5"].join("\n"));
	});

	test("a forward reference in a CRLF note with a trailing line break", () => {
		expectHonestDocument("a = line 3 * 2\r\na + 1\r\n5\r\n");
	});
});
