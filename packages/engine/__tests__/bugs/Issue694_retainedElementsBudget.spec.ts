import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { EvalTier, ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { DEFAULT_CONFIG } from "@solve-js/constants/Configuration";
import { formatValue } from "@solve-js/format/FormatEngine";
import { errorValue, numberValue, stringValue, ValueType, type Value } from "@solve-js/vm/Value";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import {
	DOCUMENT_ELEMENT_LIMIT_EXCEEDED,
	TEXT_CHARACTERS_PER_ELEMENT,
	keptElements,
	keptElementsRefusal,
} from "@solve-js/vm/PassWork";

/**
 * Issue #694: `maxAllocatedElements` bounds what one evaluation may create, and
 * nothing bounded what a document keeps across its lines, so 499 lines each
 * inside every per-line limit kept 50,000,000 elements. One count per pass, in
 * elements (a list or matrix its cells, text one to eight characters, anything
 * else one), now bounds it: the line whose answer would take the note past
 * `vm.maxRetainedElements` is refused, and a name it assigned is let go. A line
 * the batcher re-runs when its live value lands is bounded the same way.
 */

const HEAVY = "map(x + 1, 0:99)";
const ceiling = (limit: number) => ({ config: { vm: { maxRetainedElements: limit } } });
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A line as a reader sees it. The batch pass reports a thrown failure in
 * `error` and the incremental pass as an error value, so both read as the
 * message; this issue's refusal reads as its code.
 */
function show(value: Value | null | undefined, error?: string | null): string {
	if (error) return `ERROR ${error}`;
	if (!value) return "";
	if (value.type !== ValueType.Error) return formatValue(value).replace(/^=\s*/, "");
	return `ERROR ${value.errorCode === DOCUMENT_ELEMENT_LIMIT_EXCEEDED ? value.errorCode : value.errorMessage}`;
}

const read = (result: ParsingResult) => result.lines.map((line) => show(line.result, line.error));
const batch = (lines: string[], limit: number) => read(newTrackedEngine(ceiling(limit)).parseDocument(lines.join("\n"), { inputType: "markdown" }));
const incremental = (lines: string[], limit: number) => read(evaluateDocument(newTrackedEngine(ceiling(limit)), lines.join("\n"), { inputType: "markdown" }));
const shownOf = (lines: readonly EvalLineResult[]) => lines.map((l) => show(l.result, l.error));

/** Three definitions of 100 elements each, then lines that read them. */
const THREE = [`:a = ${HEAVY}`, `:b = ${HEAVY}`, `:c = ${HEAVY}`, "c * 2", "7"];

afterEach(() => {
	sharedGlobalVariableStore.clear();
});

describe("the default and the sizes", () => {
	test("the default is ten million elements, and text counts one to eight characters", () => {
		expect(DEFAULT_CONFIG.vm.maxRetainedElements).toBe(10_000_000);
		expect(TEXT_CHARACTERS_PER_ELEMENT).toBe(8);
	});

	test("a list counts its cells, text its length in eights, anything else one", () => {
		const engine = newTrackedEngine();
		expect(keptElements(engine.evaluateExpression(HEAVY))).toBe(100);
		expect(keptElements(engine.evaluateExpression("[1, 2, 3; 4, 5, 6]"))).toBe(6);
		expect(keptElements(numberValue(5))).toBe(1);
		expect(keptElements(stringValue(""))).toBe(1);
		expect(keptElements(stringValue("abcdefgh"))).toBe(1);
		expect(keptElements(stringValue("abcdefghi"))).toBe(2);
		expect(keptElements(errorValue("X", "y"))).toBe(1);
	});

	test("the refusal is a structured error naming the line, its size and the setting", () => {
		const refusal = keptElementsRefusal(3, 100, 250);
		expect(refusal.errorCode).toBe(DOCUMENT_ELEMENT_LIMIT_EXCEEDED);
		expect(refusal.errorMessage).toBe(
			"Line 3's answer holds 100 elements, which would take what this note keeps past 250, the most one note keeps (vm.maxRetainedElements), so it is not kept. The lines above keep their answers; raise the setting or split the note to go further.",
		);
	});
});

describe("the line whose answer crosses the ceiling is refused", () => {
	test("the third 100-element list crosses 250, and the lines above keep their answers", () => {
		const answers = batch(THREE, 250);
		expect(answers[0]).toMatch(/^\[1, 2, 3/);
		expect(answers[1]).toMatch(/^\[1, 2, 3/);
		expect(answers[2]).toBe("ERROR DOCUMENT_ELEMENT_LIMIT_EXCEEDED");
		// The refused line's name is let go, so its value is not kept that way either.
		expect(answers[3]).toBe("ERROR Undefined variable: c");
		// A small answer below still fits.
		expect(answers[4]).toBe("7");
	});

	test("the refused name is gone from the VM, and the kept ones are not", () => {
		const engine = newTrackedEngine(ceiling(250));
		engine.parseDocument(THREE.join("\n"), { inputType: "markdown" });
		expect(engine.getVM().getVar("a")).toBeDefined();
		expect(engine.getVM().getVar("b")).toBeDefined();
		expect(engine.getVM().getVar("c")).toBeUndefined();
	});

	test("an answer that reaches the ceiling exactly is kept; one element more is refused", () => {
		expect(batch(THREE.slice(0, 2), 200)[1]).toMatch(/^\[1, 2, 3/);
		expect(batch(THREE.slice(0, 2), 199)[1]).toBe("ERROR DOCUMENT_ELEMENT_LIMIT_EXCEEDED");
	});

	test("text counts one element to eight characters", () => {
		const text = ['repeat("abcdefgh", 3)', 'repeat("abcdefgh", 3)'];
		expect(batch(text, 6)).toEqual(["abcdefghabcdefghabcdefgh", "abcdefghabcdefghabcdefgh"]);
		expect(batch(text, 5)).toEqual(["abcdefghabcdefghabcdefgh", "ERROR DOCUMENT_ELEMENT_LIMIT_EXCEEDED"]);
	});

	test("every answer counts, so a ceiling of three refuses the fourth number", () => {
		expect(batch(["1", "2", "3", "4"], 3)).toEqual(["1", "2", "3", "ERROR DOCUMENT_ELEMENT_LIMIT_EXCEEDED"]);
	});

	test("the count starts again on every pass, so re-parsing a note many times refuses nothing new", () => {
		const engine = newTrackedEngine(ceiling(250));
		const first = read(engine.parseDocument(THREE.join("\n"), { inputType: "markdown" }));
		for (let i = 0; i < 25; i++) engine.parseDocument(THREE.join("\n"), { inputType: "markdown" });
		expect(read(engine.parseDocument(THREE.join("\n"), { inputType: "markdown" }))).toEqual(first);
	});

	test("the default answers a long ordinary note in full", () => {
		const lines = Array.from({ length: 2_000 }, (_, i) => `${i} + 1`);
		const answers = batch(lines, DEFAULT_CONFIG.vm.maxRetainedElements);
		expect(answers.filter((a) => a.startsWith("ERROR"))).toEqual([]);
		expect(answers[1_999]).toBe("2,000");
	});

	test("adversarial: a refused line assigning a prototype word lets go of that name only", () => {
		for (const word of PROTOTYPE_WORDS) {
			const engine = newTrackedEngine(ceiling(150));
			const result = engine.parseDocument([`:keep = ${HEAVY}`, `:${word} = ${HEAVY}`, "1 + 1"].join("\n"), { inputType: "markdown" });
			const answers = read(result);
			expect(answers[0]).toMatch(/^\[1, 2, 3/);
			expect(answers[1]).toMatch(/^ERROR/);
			expect(answers[2]).toBe("2");
			expect(engine.getVM().getVar("keep")).toBeDefined();
		}
		expect(Object.prototype.hasOwnProperty.call(Object.prototype, "keep")).toBe(false);
		expect(typeof ({} as { toString: unknown }).toString).toBe("function");
	});
});

describe("the incremental path agrees with a fresh pass", () => {
	function withEvaluator<T>(lines: string[], limit: number, work: (evaluator: ThreeTierEvaluator, doc: DocumentModel, engine: ExpressionEngine) => T): T {
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const engine = newTrackedEngine(ceiling(limit));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		try {
			return work(evaluator, doc, engine);
		} finally {
			evaluator.terminateWorker();
		}
	}
	const all = (doc: DocumentModel) => ({ startLine: 1, endLine: doc.lineCount });
	const text = (doc: DocumentModel) => doc.getAllLines().map((s) => s.text);

	test("both passes refuse the same line", () => {
		expect(incremental(THREE, 250)).toEqual(batch(THREE, 250));
	});

	test("an edit that shrinks a line above lets the refused line in, as a fresh pass would", () => {
		withEvaluator(THREE, 250, (evaluator, doc) => {
			evaluator.evaluate(all(doc));
			doc.editLine(1, ":a = map(x + 1, 0:9)");
			const pass = evaluator.evaluate(all(doc));
			expect(shownOf(pass.lines)).toEqual(batch(text(doc), 250));
			expect(shownOf(pass.lines)[2]).toMatch(/^\[1, 2, 3/);
		});
	});

	test("a heavy line edited back and forth twenty times returns the count to where it started", () => {
		withEvaluator(THREE, 250, (evaluator, doc) => {
			const first = shownOf(evaluator.evaluate(all(doc)).lines);
			for (let i = 0; i < 20; i++) {
				doc.editLine(2, ":b = map(x + 1, 0:9)");
				evaluator.evaluate(all(doc));
				doc.editLine(2, `:b = ${HEAVY}`);
				evaluator.evaluate(all(doc));
			}
			expect(shownOf(evaluator.evaluate(all(doc)).lines)).toEqual(first);
		});
	});

	test("deleting and re-inserting a heavy line twenty times returns the count to where it started", () => {
		withEvaluator(THREE, 250, (evaluator, doc) => {
			const first = shownOf(evaluator.evaluate(all(doc)).lines);
			for (let i = 0; i < 20; i++) {
				evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
				evaluator.evaluate(all(doc));
				evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: [`:a = ${HEAVY}`] }]);
				evaluator.evaluate(all(doc));
			}
			expect(shownOf(evaluator.evaluate(all(doc)).lines)).toEqual(first);
		});
	});

	test("moving the refused line above the others moves the refusal, as a fresh pass would", () => {
		withEvaluator(THREE, 250, (evaluator, doc) => {
			evaluator.evaluate(all(doc));
			evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [] }]);
			evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: [`:c = ${HEAVY}`] }]);
			const pass = evaluator.evaluate(all(doc));
			expect(shownOf(pass.lines)).toEqual(batch(text(doc), 250));
			expect(shownOf(pass.lines)[0]).toMatch(/^\[1, 2, 3/);
			expect(shownOf(pass.lines)[2]).toBe("ERROR DOCUMENT_ELEMENT_LIMIT_EXCEEDED");
		});
	});

	test("a viewport below the heavy lines is charged what the lines above recorded", () => {
		const lines = [...THREE.slice(0, 2), ...Array.from({ length: 30 }, () => "1"), `:c = ${HEAVY}`];
		withEvaluator(lines, 250, (evaluator, doc) => {
			evaluator.evaluate(all(doc));
			doc.editLine(33, `:c = map(x + 2, 0:99)`);
			const pass = evaluator.setViewport({ startLine: 30, endLine: 33 });
			const last = pass.lines.find((l) => l.lineNumber === 33)!;
			expect(show(last.result, last.error)).toBe(batch(text(doc), 250)[32]);
			expect(last.result?.errorCode).toBe(DOCUMENT_ELEMENT_LIMIT_EXCEEDED);
		});
	});

	test("a definition above the viewport, run out of view after an edit, is counted once", () => {
		// Line 3, edited while out of view, runs in Tier 3, which marks it clean
		// as it goes; counting its old record on top of its new answer once
		// refused line 4 here, where a fresh pass keeps it.
		const lines = ["7", `:a = ${HEAVY}`, `:b = ${HEAVY}`, `:c = ${HEAVY}`];
		withEvaluator(lines, 350, (evaluator, doc, engine) => {
			evaluator.evaluate(all(doc));
			doc.editLine(3, ":b = map(x + 2, 0:99)");
			const pass = evaluator.evaluate({ startLine: 4, endLine: 4 });
			expect(pass.lines.find((l) => l.lineNumber === 3)?.tier).toBe(EvalTier.Tier3);
			const line4 = pass.lines.find((l) => l.lineNumber === 4)!;
			expect(show(line4.result, line4.error)).toBe(batch(text(doc), 350)[3]);
			expect(line4.result?.type).toBe(ValueType.Matrix);
			expect(engine.getVM().getVar("c")).toBeDefined();
			expect(shownOf(evaluator.evaluate(all(doc)).lines)).toEqual(batch(text(doc), 350));
		});
	});
});

describe("a line re-run when its live value lands", () => {
	// `global :k694` waits until some note declares it, then the batcher re-runs
	// the lines that read it: the in-process stand-in for a live value.
	const WAITING = [`:a = ${HEAVY}`, `:b = global :k694 * ${HEAVY}`, `:c = global :k694 * ${HEAVY}`, "7"];

	async function land(value: number): Promise<void> {
		newTrackedEngine().evaluateExpression(`global :k694 = ${value}`);
		await later(20);
	}

	test("is refused past the ceiling, the same line a fresh pass refuses, and its name let go", async () => {
		const engine = newTrackedEngine(ceiling(250));
		const reRuns = new Map<number, string>();
		engine.getBatcher().onLineResult = (line, value) => reRuns.set(line, show(value));
		const first = read(engine.parseDocument(WAITING.join("\n"), { inputType: "markdown" }));
		expect(first[1]).toBe("…");
		await land(1);
		expect(reRuns.get(2)).toMatch(/^\[1, 2, 3/);
		expect(reRuns.get(3)).toBe("ERROR DOCUMENT_ELEMENT_LIMIT_EXCEEDED");
		expect(engine.getVM().getVar("c")).toBeUndefined();
		const fresh = read(engine.parseDocument(WAITING.join("\n"), { inputType: "markdown" }));
		expect(fresh[1]).toBe(reRuns.get(2));
		expect(fresh[2]).toBe(reRuns.get(3));
		engine.clear();
	});

	test("an answer no larger than the one it replaces is always kept, however often the line re-runs", () => {
		// A background refresh re-runs a line whose answer is already counted:
		// swapped for its new one, never added on top.
		const engine = newTrackedEngine(ceiling(200));
		engine.parseDocument([`:a = ${HEAVY}`, `:b = ${HEAVY}`].join("\n"), { inputType: "markdown" });
		const keep = engine.getBatcher().keepResult!;
		const list = engine.evaluateExpression(HEAVY);
		for (let i = 0; i < 50; i++) expect(keep(2, list, "b")).toBe(list);
		// Growing past the ceiling is refused, and a smaller answer after it is kept.
		const bigger = engine.evaluateExpression("map(x + 1, 0:100)");
		expect(keep(2, bigger, "b").errorCode).toBe(DOCUMENT_ELEMENT_LIMIT_EXCEEDED);
		expect(engine.getVM().getVar("b")).toBeUndefined();
		expect(keep(2, list, "b")).toBe(list);
		// A line that was never counted is charged against the whole note.
		expect(keep(9, numberValue(1), null).errorCode).toBe(DOCUMENT_ELEMENT_LIMIT_EXCEEDED);
		// A new pass starts the count again.
		engine.parseDocument([`:a = ${HEAVY}`, "1"].join("\n"), { inputType: "markdown" });
		expect(keep(9, list, null).errorCode).toBe(DOCUMENT_ELEMENT_LIMIT_EXCEEDED);
		expect(keep(9, engine.evaluateExpression("map(x + 1, 0:98)"), null).type).toBe(ValueType.Matrix);
	});

	test("before any pass, and for a line with no number, a re-run keeps its answer", () => {
		const engine = newTrackedEngine(ceiling(1));
		const list = engine.evaluateExpression(HEAVY);
		expect(engine.getBatcher().keepResult!(1, list, null)).toBe(list);
		engine.parseDocument("1", { inputType: "markdown" });
		expect(engine.getBatcher().keepResult!(-1, list, null)).toBe(list);
		expect(engine.getBatcher().keepResult!(0, list, null)).toBe(list);
	});
});

describe("the single-expression path", () => {
	test("has no document, so its answer is kept whatever the ceiling", () => {
		const value = newTrackedEngine(ceiling(1)).evaluateExpression(HEAVY);
		expect(value.type).toBe(ValueType.Matrix);
	});
});
