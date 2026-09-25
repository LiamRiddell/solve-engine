import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { EvalTier, ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { DEFAULT_CONFIG } from "@solve-js/constants/Configuration";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { SPAN_READS_PER_LINE_RUN, spendSpanReads, passWorkRefusal } from "@solve-js/vm/PassWork";

/**
 * Issue #711: work that reaches across lines was capped one line at a time, so
 * twenty sweep lines each inside their own cap made one parseDocument re-run
 * 2,000,000 lines. One count per pass, in line runs, now bounds it: a what-if or
 * sweep charges the lines it re-runs, a goal-seek probe one, and a span
 * aggregate its reads at sixteen to a run. The line whose work would cross
 * `vm.maxLineRunsPerPass` is refused by name; the lines above keep their answers.
 */

const small = (limit: number) => ({ config: { vm: { maxLineRunsPerPass: limit } } });

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const shown = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${line.result.errorCode}` : shown;
	});
}

const batch = (lines: string[], limit: number) => read(newTrackedEngine(small(limit)).parseDocument(lines.join("\n"), { inputType: "markdown" }));
const incremental = (lines: string[], limit: number) => read(evaluateDocument(newTrackedEngine(small(limit)), lines.join("\n"), { inputType: "markdown" }));

/** Five lines, then `count` sweeps of line 5 over twenty values: 100 line runs each. */
function sweeps(count: number): string[] {
	return ["x = 1", "a = x + 1", "b = a + 1", "c = b + 1", "c * 2", ...Array.from({ length: count }, () => "line 5 for x from 1 to 20 step 1")];
}

describe("the default", () => {
	test("is a million line runs, and a span read costs a sixteenth of one", () => {
		expect(DEFAULT_CONFIG.vm.maxLineRunsPerPass).toBe(1_000_000);
		expect(SPAN_READS_PER_LINE_RUN).toBe(16);
	});
});

describe("the line that crosses the budget is refused, and the lines above keep their answers", () => {
	test("many light sweeps: the sixth crosses 500 line runs", () => {
		const answers = batch(sweeps(8), 500);
		expect(answers.slice(0, 5)).toEqual(["1", "2", "3", "4", "8"]);
		for (let i = 5; i < 10; i++) expect(answers[i]).toMatch(/^\[8, 10, 12/);
		expect(answers[10]).toBe("ERROR PASS_WORK_BUDGET_EXCEEDED");
		expect(answers[11]).toBe("ERROR PASS_WORK_BUDGET_EXCEEDED");
	});

	test("both passes refuse the same line", () => {
		expect(incremental(sweeps(8), 500)).toEqual(batch(sweeps(8), 500));
	});

	test("a budget so low that the first line to spend any crosses it", () => {
		const answers = batch(sweeps(1), 50);
		expect(answers[5]).toBe("ERROR PASS_WORK_BUDGET_EXCEEDED");
		expect(answers.slice(0, 5)).toEqual(["1", "2", "3", "4", "8"]);
	});

	test("the refusal names the budget and the setting", () => {
		const engine = newTrackedEngine(small(50));
		const result = engine.parseDocument(sweeps(1).join("\n"), { inputType: "markdown" });
		const refusal = result.lines[5].result!;
		expect(refusal.errorCode).toBe("PASS_WORK_BUDGET_EXCEEDED");
		expect(String(refusal.errorMessage)).toBe(
			"This sweep would take this pass over the note past 50 line runs, the most one pass does (vm.maxLineRunsPerPass), so it is not worked out. The lines above keep their answers; raise the setting or split the note to go further.",
		);
	});

	test("the default runs a sweep at its own cap untouched", () => {
		const header = ["x = 5", ...Array.from({ length: 98 }, (_, i) => `y${i + 1} = x + ${i + 1}`), "x * 2"];
		const answers = batch([...header, "line 100 for x from 1 to 1000 step 1"], DEFAULT_CONFIG.vm.maxLineRunsPerPass);
		expect(answers[100]).toMatch(/^\[2, 4, 6/);
	});
});

describe("every form that reaches across lines is charged", () => {
	test("a what-if charges the lines it re-runs", () => {
		const doc = ["x = 1", "y = x * 2", ...Array.from({ length: 30 }, () => "line 2 with x = 5")];
		const answers = batch(doc, 40);
		// Each what-if re-runs two lines: twenty fit in 40.
		expect(answers.slice(2, 22).every((a) => a === "10")).toBe(true);
		expect(answers[22]).toBe("ERROR PASS_WORK_BUDGET_EXCEEDED");
		expect(incremental(doc, 40)).toEqual(answers);
	});

	test("total above charges its reads", () => {
		const doc = Array.from({ length: 200 }, () => ["1", "total above"]).flat();
		const answers = batch(doc, 100);
		const refused = answers.indexOf("ERROR PASS_WORK_BUDGET_EXCEEDED");
		expect(refused).toBeGreaterThan(0);
		expect(answers[refused - 2]).toMatch(/^\d/);
		expect(incremental(doc, 100)).toEqual(answers);
	});

	test("a sweep that fits alone is refused after span aggregates have spent most of the budget", () => {
		// Forty entries with a total after each read about 1,600 lines, 100 line
		// runs; the sweep of line 5 re-runs 100 more.
		const header = sweeps(0);
		const spans = Array.from({ length: 40 }, () => ["1", "total above"]).flat();
		const sweep = "line 5 for x from 1 to 20 step 1";
		const alone = batch([...header, "", sweep], 150);
		expect(alone[6]).toMatch(/^\[8, 10, 12/);
		const spansAlone = batch([...header, "", ...spans], 150);
		expect(spansAlone).not.toContain("ERROR PASS_WORK_BUDGET_EXCEEDED");
		const after = batch([...header, "", ...spans, sweep], 150);
		expect(after[after.length - 1]).toBe("ERROR PASS_WORK_BUDGET_EXCEEDED");
		expect(after[after.length - 2]).toBe("40");
		expect(incremental([...header, "", ...spans, sweep], 150)).toEqual(after);
	});

	test("a section total, a tag total and a table column are charged too", () => {
		const note = [
			"# Rent", "500", "", "#bill 20", "| item | cost |", "|---|---|", "| a | 5 |", "",
			...Array.from({ length: 40 }, () => 'total of section "Rent"'),
		];
		const answers = batch(note, 60);
		expect(answers[8]).toBe("500");
		expect(answers).toContain("ERROR PASS_WORK_BUDGET_EXCEEDED");
		expect(incremental(note, 60)).toEqual(answers);
		const tags = batch([...note.slice(0, 8), ...Array.from({ length: 40 }, () => "total of #bill")], 60);
		expect(tags).toContain("ERROR PASS_WORK_BUDGET_EXCEEDED");
		const columns = batch([...note.slice(0, 8), ...Array.from({ length: 200 }, () => 'total of column "cost" above')], 60);
		expect(columns).toContain("ERROR PASS_WORK_BUDGET_EXCEEDED");
	});

	test("goal seek charges each probe", () => {
		const doc = ["x = 1", "x * 3", ...Array.from({ length: 10 }, () => "solve line 2 for x = 30")];
		const generous = incremental(doc, 100_000);
		expect(generous[2]).toBe("10");
		const tight = incremental(doc, 5);
		expect(tight).toContain("ERROR PASS_WORK_BUDGET_EXCEEDED");
		expect(tight[0]).toBe("1");
	});
});

describe("the incremental path agrees with a fresh pass", () => {
	function live(lines: string[], limit: number, edit?: (doc: DocumentModel) => void): { shown: string[]; text: string[] } {
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine(small(limit)));
		try {
			evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			edit?.(doc);
			const pass = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			const shown = pass.lines.map((l: EvalLineResult) => {
				if (l.error) return `ERROR ${l.error}`;
				if (!l.result) return "";
				return l.result.type === ValueType.Error ? `ERROR ${l.result.errorCode}` : formatValue(l.result).replace(/^=\s*/, "");
			});
			return { shown, text: doc.getAllLines().map((s) => s.text) };
		} finally {
			evaluator.terminateWorker();
		}
	}

	test("an edit that frees budget above lets the refused sweep run, as a fresh pass would", () => {
		const { shown, text } = live(sweeps(6), 500, (doc) => doc.editLine(6, "1"));
		expect(shown).toEqual(batch(text, 500));
		expect(shown[10]).toMatch(/^\[8, 10, 12/);
	});

	test("an edit that spends more above moves the crossing line up", () => {
		const start = [...sweeps(5), "1"];
		const { shown, text } = live(start, 500, (doc) => doc.editLine(11, "line 5 for x from 1 to 20 step 1"));
		expect(shown).toEqual(batch(text, 500));
		expect(shown[10]).toBe("ERROR PASS_WORK_BUDGET_EXCEEDED");
	});

	test("deleting and re-typing a heavy line returns the count to where it started", () => {
		const doc = new DocumentModel();
		doc.setDocument(sweeps(5).join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine(small(500)));
		try {
			const first = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			for (let i = 0; i < 20; i++) {
				evaluator.applyTransaction([{ startLine: 6, deleteCount: 1, insertLines: [] }]);
				evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
				evaluator.applyTransaction([{ startLine: 6, deleteCount: 0, insertLines: ["line 5 for x from 1 to 20 step 1"] }]);
				evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			}
			const last = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			const shownOf = (pass: typeof first) => pass.lines.map((l) => (l.result ? formatValue(l.result) : ""));
			expect(shownOf(last)).toEqual(shownOf(first));
			expect(shownOf(last)[9]).toMatch(/\[8, 10, 12/);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a sweep definition above the viewport, run out of view after an edit, is charged once", () => {
		// Tier 3 runs the edited definition and marks it clean as it goes, so
		// its old record must not be counted on top of its new work.
		const lines = [...sweeps(0), ":s = line 5 for x from 1 to 20 step 1", ":t = line 5 for x from 1 to 20 step 1", "line 5 for x from 1 to 20 step 1"];
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine(small(300)));
		try {
			evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			doc.editLine(6, ":s = line 5 for x from 2 to 21 step 1");
			const pass = evaluator.evaluate({ startLine: 8, endLine: 8 });
			expect(pass.lines.find((l) => l.lineNumber === 6)?.tier).toBe(EvalTier.Tier3);
			const last = pass.lines.find((l) => l.lineNumber === 8)!;
			const fresh = batch(doc.getAllLines().map((l) => l.text), 300);
			expect(last.result?.errorCode).toBeUndefined();
			expect(formatValue(last.result!).replace(/^=\s*/, "")).toBe(fresh[7]);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a viewport below the sweeps is charged the work the lines above recorded", () => {
		const doc = new DocumentModel();
		const lines = [...sweeps(6), ...Array.from({ length: 40 }, () => "1")];
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine(small(500)));
		try {
			evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			doc.editLine(11, "line 5 for x from 1 to 20 step 1");
			const pass = evaluator.setViewport({ startLine: 11, endLine: 20 });
			const line11 = pass.lines.find((l) => l.lineNumber === 11)!;
			expect(line11.result?.errorCode).toBe("PASS_WORK_BUDGET_EXCEEDED");
		} finally {
			evaluator.terminateWorker();
		}
	});
});

describe("the single-expression path", () => {
	test("has no document, so a sweep refuses as it always did and nothing is charged", () => {
		const value = newTrackedEngine(small(1)).evaluateExpression("line 5 for x from 1 to 20 step 1");
		expect(value.errorCode).not.toBe("PASS_WORK_BUDGET_EXCEEDED");
	});
});

describe("PassWork helpers", () => {
	test("spendSpanReads charges reads at the span rate, and nothing without a document", () => {
		const charged: number[] = [];
		const context = { lineIndex: 1, spendWork: (runs: number) => (charged.push(runs), null) };
		expect(spendSpanReads(context, 32, "x")).toBeNull();
		expect(charged).toEqual([2]);
		expect(spendSpanReads({ lineIndex: 1 }, 1000, "x")).toBeNull();
		expect(spendSpanReads(context, 0, "x")).toBeNull();
		expect(spendSpanReads(context, NaN, "x")).toBeNull();
		expect(charged).toEqual([2]);
	});

	test("passWorkRefusal is a structured error", () => {
		expect(passWorkRefusal("A thing", 10).errorCode).toBe("PASS_WORK_BUDGET_EXCEEDED");
	});
});
