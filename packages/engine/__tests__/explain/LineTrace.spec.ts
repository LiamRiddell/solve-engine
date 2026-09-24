/**
 * Issue #522: which lines fed a result, followed upwards, for hosts.
 *
 * What was wrong: the dependency graph knew each line's direct reads, but only
 * on the incremental path and only one level deep, and nothing turned that into
 * "this answer came from these lines, which came from those". A host wanting a
 * "how was this worked out" disclosure, or to highlight the lines a result
 * depends on, had to rebuild it.
 *
 * What is pinned here: `traceLine` follows every way a line reads another (a
 * variable to its nearest definition above, `line N`, `prev`, `above`, a range,
 * a category tag), reads the same through a `parseDocument` result and an
 * attached document model, marks cycles and forward references rather than
 * looping or guessing, bounds its depth and size, and refuses clearly when
 * there is no document or no such line. `formatLineTrace` renders it as the
 * `inputs of line N` form does.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { VMCheckpointer } from "@solve-js/vm/VMCheckpoints";
import { formatLineTrace } from "@solve-js/explain/LineTracer";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors";
import type { LineTrace } from "@solve-js/explain/Explanation";

/** Trace a line of a document parsed in one batch pass. */
function trace(lines: string[], line: number, options: { maxDepth?: number; maxLines?: number } = {}): LineTrace {
	const engine = newTrackedEngine();
	const document = engine.parseDocument(lines.join("\n"));
	return engine.traceLine(line, { ...options, document });
}

/** A trace as `[line, via, value]` rows, depth first, for compact assertions. */
function rows(node: LineTrace, depth = 0): Array<[number, number, string, string]> {
	const value = node.value === null ? "" : formatValue(node.value).replace(/^=\s*/, "");
	return [[depth, node.line, node.via.join(", "), value], ...node.inputs.flatMap((input) => rows(input, depth + 1))];
}

const MORTGAGE = [":rate = 4%", ":deposit = 100000", "", ":payment = monthly repayment on deposit over 25 years at rate", "payment * 12"];

describe("the lines a result came from", () => {
	test("the issue's example: a payment from a deposit and a rate", () => {
		const t = trace(MORTGAGE, 4);
		expect(t.name).toBe("payment");
		expect(rows(t)).toEqual([
			[0, 4, "", "527.84"],
			[1, 2, "deposit", "100,000"],
			[1, 1, "rate", "4.00%"],
		]);
		expect(formatLineTrace(t)).toBe("payment 527.84 (line 4) <- deposit 100,000 (line 2), rate 4.00% (line 1)");
	});

	test("followed upwards, level by level", () => {
		expect(rows(trace(MORTGAGE, 5))).toEqual([
			[0, 5, "", "6,334.04"],
			[1, 4, "payment", "527.84"],
			[2, 2, "deposit", "100,000"],
			[2, 1, "rate", "4.00%"],
		]);
		expect(formatLineTrace(trace(MORTGAGE, 5))).toBe(
			"6,334.04 (line 5) <- payment 527.84 (line 4) <- [deposit 100,000 (line 2), rate 4.00% (line 1)]",
		);
	});

	test("the guide's highlight walk collects every line behind an answer", () => {
		// docs/src/content/docs/guide/tracing-lines.md
		function linesBehind(t: LineTrace): Set<number> {
			const lines = new Set<number>();
			const walk = (node: LineTrace) => {
				for (const input of node.inputs) {
					lines.add(input.line);
					walk(input);
				}
			};
			walk(t);
			return lines;
		}
		expect([...linesBehind(trace(MORTGAGE, 5))]).toEqual([4, 2, 1]);
	});

	test("a line that reads nothing says so", () => {
		expect(formatLineTrace(trace(MORTGAGE, 1))).toBe("rate 4.00% (line 1) reads no other line");
	});

	test("a variable resolves to the nearest definition above the reader", () => {
		const doc = [":x = 3", ":x = x + 1", "x * 2", ":x = 100"];
		expect(rows(trace(doc, 3))).toEqual([
			[0, 3, "", "8"],
			[1, 2, "x", "4"],
			[2, 1, "x", "3"],
		]);
	});

	test("a running total reads its own previous line", () => {
		expect(formatLineTrace(trace(["spent += 5", "spent += 9"], 2))).toBe("spent 14 (line 2) <- spent 5 (line 1)");
	});

	test("every positional form: line N, prev, above, a range", () => {
		expect(rows(trace(["120", "prev * 2"], 2)).map((r) => r[2])).toEqual(["", "prev"]);
		expect(rows(trace(["120", "line 1 + 1"], 2)).map((r) => r[2])).toEqual(["", "line 1"]);
		expect(rows(trace(["10", "20", "total above"], 3)).map((r) => [r[1], r[2]])).toEqual([
			[3, ""],
			[1, "above"],
			[2, "above"],
		]);
		expect(rows(trace(["10", "20", "30", "sum(line 1 : line 3)"], 4)).map((r) => [r[1], r[2]])).toEqual([
			[4, ""],
			[1, "line 1 : line 3"],
			[2, "line 1 : line 3"],
			[3, "line 1 : line 3"],
		]);
	});

	test("a what-if or a sweep reads the line it re-runs", () => {
		// The what-if and sweep rules fuse `line N` into one token carrying N;
		// the trace reads it as the reference it is.
		expect(rows(trace([":d = 100", "d * 2", "line 2 with d = 5"], 3)).map((r) => [r[1], r[2]])).toEqual([
			[3, ""],
			[2, "line 2"],
			[1, "d"],
		]);
		expect(rows(trace([":d = 100", "d * 2", "line 2 for d from 1 to 3 step 1"], 3)).map((r) => [r[1], r[2]])[1]).toEqual([2, "line 2"]);
	});

	test("a category tag reads every line carrying it", () => {
		expect(formatLineTrace(trace(["40 #food", "12 #fuel", "20 #food", "total of #food"], 4))).toBe(
			"60 (line 4) <- 40 (line 1), 20 (line 3)",
		);
	});

	test("a line read two ways is listed once, with both ways", () => {
		const t = trace([":a = 5", "a + line 1"], 2);
		expect(t.inputs).toHaveLength(1);
		expect(t.inputs[0].via).toEqual(["a", "line 1"]);
	});
});

describe("cycles, forward references and bounds", () => {
	test("two lines that read each other: the repeat is marked, not followed", () => {
		const t = trace(["line 2 + 5", "prev + 5"], 2);
		expect(t.inputs[0].line).toBe(1);
		const back = t.inputs[0].inputs[0];
		expect(back.line).toBe(2);
		expect(back.cycle).toBe(true);
		expect(back.forward).toBe(true);
		expect(back.inputs).toEqual([]);
	});

	test("a line reading itself is a cycle of one", () => {
		const t = trace(["5", "line 2 + 1"], 2);
		expect(t.inputs[0].line).toBe(2);
		expect(t.inputs[0].cycle).toBe(true);
	});

	test("a forward reference is marked", () => {
		const t = trace(["line 2 + 1", "7"], 1);
		expect(t.inputs[0].forward).toBe(true);
		expect(t.inputs[0].line).toBe(2);
	});

	test("the depth bound stops the trace and says so", () => {
		const chain = ["1", ...Array.from({ length: 30 }, () => "prev + 1")];
		const t = trace(chain, 31, { maxDepth: 3 });
		const deepest = t.inputs[0].inputs[0].inputs[0];
		expect(deepest.truncated).toBe(true);
		expect(deepest.inputs).toEqual([]);
		expect(formatLineTrace(t)).toBe("31 (line 31) <- 30 (line 30) <- [29 (line 29) <- [28 (line 28) <- [...]]]");
	});

	test("a wide document stops at the size bound", () => {
		// Line 6 reads five lines, four of which read the line above them. With
		// room for three lines, line 6 and line 1 are followed in full, and every
		// line after them is listed with its own inputs cut off.
		const wide = ["1", "prev + 1", "prev + 1", "prev + 1", "prev + 1", "total above"];
		const t = trace(wide, 6, { maxLines: 3 });
		expect(t.inputs.map((input) => [input.line, input.truncated])).toEqual([
			[1, false],
			[2, true],
			[3, true],
			[4, true],
			[5, true],
		]);
	});

	test("a default trace of a long chain is bounded at ten levels", () => {
		const chain = ["1", ...Array.from({ length: 40 }, () => "prev + 1")];
		let node = trace(chain, 41);
		let depth = 0;
		while (node.inputs.length > 0) {
			node = node.inputs[0];
			depth++;
		}
		expect(depth).toBe(10);
		expect(node.truncated).toBe(true);
	});
});

describe("where the trace reads from", () => {
	test("an attached document model traces the same as a parsed result", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(MORTGAGE.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, engine, new VMCheckpointer(engine.getVM()));
		try {
			evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			expect(formatLineTrace(engine.traceLine(5))).toBe(formatLineTrace(trace(MORTGAGE, 5)));
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("tracing changes nothing: the document evaluates the same afterwards", () => {
		const engine = newTrackedEngine();
		const document = engine.parseDocument(MORTGAGE.join("\n"));
		engine.traceLine(5, { document });
		const again = engine.parseDocument(MORTGAGE.join("\n"));
		expect(again.lines.map((l) => l.result?.toNumber())).toEqual(document.lines.map((l) => l.result?.toNumber()));
	});

	test("no document is a structured error", () => {
		const engine = newTrackedEngine();
		expect(() => engine.traceLine(1)).toThrow(EngineError);
		try {
			engine.traceLine(1);
		} catch (error) {
			expect((error as EngineError).code).toBe("TRACE_NO_DOCUMENT");
		}
	});

	test("a line outside the document is a structured error", () => {
		const engine = newTrackedEngine();
		const document = engine.parseDocument(MORTGAGE.join("\n"));
		for (const line of [0, 6, 2.5]) {
			try {
				engine.traceLine(line, { document });
				throw new Error("expected a throw");
			} catch (error) {
				expect((error as EngineError).code).toBe("TRACE_NO_SUCH_LINE");
			}
		}
	});
});
