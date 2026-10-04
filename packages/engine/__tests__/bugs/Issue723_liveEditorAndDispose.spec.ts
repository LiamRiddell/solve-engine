import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import { EngineError } from "@solve-js/errors/EngineError";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #723: the incremental path a live editor needs (`DocumentModel`,
 * `ThreeTierEvaluator`, `applyTransaction`, `setViewport`, `onLineResult`) was
 * on no docs page, and the call that retires an evaluator was named for a
 * worker (`terminateWorker`), so a host looking for `dispose()` found nothing.
 * An evaluator never retired stays subscribed to the shared `global :name`
 * store, and so reachable from it, for the life of the process.
 *
 * `dispose()` now retires an evaluator: it does what `terminateWorker()` does
 * (stops the compilation worker, drops the global-store subscription) and also
 * detaches the evaluator from the engine where the engine still points at it,
 * since an engine left wired to a closed document went on answering
 * `line 1 * 2` from it. The guide, `guide/live-editor.md`, walks the loop; the
 * tests under "the guide's examples" are its TypeScript, run, so the values
 * printed there are the ones below.
 */

/** How many listeners the shared global store holds, read through its private set. */
function globalListeners(): number {
	return (sharedGlobalVariableStore as unknown as { listeners: Set<unknown> }).listeners.size;
}

/** A model over `text` and an evaluator over it, on a fresh engine unless one is given. */
function open(text: string, engine: ExpressionEngine = newTrackedEngine()) {
	const doc = new DocumentModel();
	doc.setDocument(text);
	const evaluator = new ThreeTierEvaluator(doc, engine);
	return { engine, doc, evaluator };
}

/** A line of a pass, as a reader sees it. */
function shown(engine: ExpressionEngine, line: EvalLineResult): string {
	if (line.error) return `ERROR: ${line.error}`;
	if (!line.result) return "";
	const text = engine.formatValue(line.result);
	return line.result.type === ValueType.Error ? `ERROR: ${text}` : text;
}

// ── dispose, the part ────────────────────────────────────────────────────

describe("ThreeTierEvaluator.dispose", () => {
	test("drops the evaluator's subscription to the shared global store", () => {
		const before = globalListeners();
		const { evaluator } = open("1 + 1");
		expect(globalListeners()).toBe(before + 1);
		evaluator.dispose();
		expect(globalListeners()).toBe(before);
	});

	test("stops a compilation worker the evaluator started", () => {
		const { evaluator } = open("1 + 1");
		const terminate = jest.fn();
		(evaluator as unknown as { compilationWorker: { terminate: () => void } | null }).compilationWorker = { terminate };
		evaluator.dispose();
		expect(terminate).toHaveBeenCalledTimes(1);
		expect((evaluator as unknown as { compilationWorker: unknown }).compilationWorker).toBeNull();
	});

	test("is safe to call more than once", () => {
		const before = globalListeners();
		const { evaluator } = open("1 + 1");
		evaluator.dispose();
		expect(() => evaluator.dispose()).not.toThrow();
		expect(globalListeners()).toBe(before);
	});

	test("detaches the engine from the retired document", () => {
		const { engine, evaluator } = open("10\nline 1 * 2");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(engine.getDocumentModel()).not.toBeNull();
		evaluator.dispose();
		expect(engine.getDocumentModel()).toBeNull();
	});

	test("clears the batcher's checkpoint chain when it is this evaluator's", () => {
		const { engine, evaluator } = open(":x = 1\nx + 1");
		expect(engine.getBatcher().checkpointer).not.toBeNull();
		evaluator.dispose();
		expect(engine.getBatcher().checkpointer).toBeNull();
	});

	test("leaves an engine a newer evaluator has taken over alone", () => {
		const engine = newTrackedEngine();
		const first = open("1", engine);
		const second = open("2", engine);
		const chain = engine.getBatcher().checkpointer;
		first.evaluator.dispose();
		expect(engine.getDocumentModel()).toBe(second.doc);
		expect(engine.getBatcher().checkpointer).toBe(chain);
		second.evaluator.dispose();
		expect(engine.getDocumentModel()).toBeNull();
	});

	test("an engine a host set to another document by hand is left alone", () => {
		const { engine, evaluator } = open("1");
		const other = new DocumentModel();
		engine.setDocumentModel(other);
		evaluator.dispose();
		expect(engine.getDocumentModel()).toBe(other);
	});

	test("before any evaluation, it retires cleanly", () => {
		const before = globalListeners();
		const { engine, evaluator } = open("1 + 1");
		evaluator.dispose();
		expect(globalListeners()).toBe(before);
		expect(engine.getDocumentModel()).toBeNull();
	});

	test("the model and the engine stay usable, and a new evaluator over them answers", () => {
		const { engine, doc, evaluator } = open("10\nline 1 * 2");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.dispose();
		const again = new ThreeTierEvaluator(doc, engine);
		expect(again.evaluate({ startLine: 1, endLine: 2 }).lines.map((l) => shown(engine, l))).toEqual(["= 10", "= 20"]);
		again.dispose();
	});
});

describe("terminateWorker, kept", () => {
	test("still drops the global-store subscription", () => {
		const before = globalListeners();
		const { evaluator } = open("1 + 1");
		evaluator.terminateWorker();
		expect(globalListeners()).toBe(before);
	});

	test("does not detach the engine, which evaluateDocument restores itself", () => {
		const { engine, doc, evaluator } = open("1 + 1");
		evaluator.terminateWorker();
		expect(engine.getDocumentModel()).toBe(doc);
		evaluator.dispose();
	});
});

// ── What a retired document no longer reaches ────────────────────────────

describe("after dispose, the engine reads no retired document", () => {
	test("a line reference on its own refuses for want of a document", () => {
		const { engine, evaluator } = open("10\nline 1 * 2");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.dispose();
		const value = engine.evaluateLine(1, "line 1 * 2");
		expect(value.type).toBe(ValueType.Error);
		expect(value.errorCode).toBe("LINE_REF_NO_DOCUMENT");
	});

	test("a tag total and a goal seek refuse the same way", () => {
		const { engine, evaluator } = open("10 #food\n5 #food\n:price = 100\nprice * 1.25");
		evaluator.evaluate({ startLine: 1, endLine: 4 });
		evaluator.dispose();
		expect(engine.evaluateLine(1, "total of #food").errorCode).toBe("TAG_NO_DOCUMENT");
		expect(engine.evaluateLine(1, "solve line 4 for price = 150").errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
	});

	test("a trace with no document passed says there is none", () => {
		const { engine, evaluator } = open(":a = 1\na + 1");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(engine.traceLine(2).line).toBe(2);
		evaluator.dispose();
		expect(() => engine.traceLine(2)).toThrow(EngineError);
		try {
			engine.traceLine(2);
		} catch (e) {
			expect((e as EngineError).code).toBe("TRACE_NO_DOCUMENT");
		}
	});

	test("a global another document writes dirties a reader that is still open", () => {
		const reader = open("global :issue723_open + 1");
		const writer = open("global :issue723_open = 5");
		try {
			writer.evaluator.evaluate({ startLine: 1, endLine: 1 });
			reader.evaluator.evaluate({ startLine: 1, endLine: 1 });
			writer.doc.editLine(1, "global :issue723_open = 7");
			writer.evaluator.evaluate({ startLine: 1, endLine: 1 });
			expect(reader.doc.getLineAt(1)?.dirty).toBe(true);
		} finally {
			reader.evaluator.dispose();
			writer.evaluator.dispose();
		}
	});

	test("a global another document writes no longer dirties the retired one", () => {
		const reader = open("global :issue723_rate + 1");
		const writer = open("global :issue723_rate = 5");
		try {
			writer.evaluator.evaluate({ startLine: 1, endLine: 1 });
			reader.evaluator.evaluate({ startLine: 1, endLine: 1 });
			reader.evaluator.dispose();
			writer.doc.editLine(1, "global :issue723_rate = 7");
			writer.evaluator.evaluate({ startLine: 1, endLine: 1 });
			expect(reader.doc.getLineAt(1)?.dirty).toBe(false);
		} finally {
			writer.evaluator.dispose();
		}
	});
});

// ── The guide's examples, run ────────────────────────────────────────────

describe("the guide's examples (guide/live-editor.md)", () => {
	test("the loop: evaluate, an edit in place, a structural edit, a scroll, dispose", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(["# Groceries", ":apples = 3 * £0.40", ":bread = £1.20", "apples + bread"].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, engine);

		const first = evaluator.evaluate({ startLine: 1, endLine: 30 });
		expect(engine.formatValue(first.resultMap.get(4)![0])).toBe("= £2.40");
		expect(first.tierCounts).toEqual({ tier1: 3, tier2: 0, tier3: 0, skipped: 1 });

		expect(evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [":bread = £1.50"] }])).toEqual({ inserted: [], removed: [], edited: [3] });
		const next = evaluator.evaluate({ startLine: 1, endLine: 30 });
		expect(engine.formatValue(next.resultMap.get(4)![0])).toBe("= £2.70");
		expect(next.tierCounts).toEqual({ tier1: 1, tier2: 2, tier3: 0, skipped: 1 });

		expect(evaluator.applyTransaction([{ startLine: 4, deleteCount: 0, insertLines: [":milk = £0.95"] }])).toEqual({ inserted: [5], removed: [], edited: [] });
		evaluator.evaluate({ startLine: 1, endLine: 30 });

		const view = evaluator.setViewport({ startLine: 4, endLine: 5 });
		expect(view.lines.map((line) => line.lineNumber)).toEqual([4, 5]);
		expect(view.tierCounts).toEqual({ tier1: 0, tier2: 2, tier3: 0, skipped: 0 });
		expect(view.lines.map((l) => shown(engine, l))).toEqual(["= £0.95", "= £2.70"]);

		evaluator.dispose();
		expect(engine.getDocumentModel()).toBeNull();
	});

	describe("live data arriving", () => {
		let original: typeof global.fetch;
		beforeEach(() => {
			original = global.fetch;
			global.fetch = (() =>
				Promise.resolve({ ok: true, json: () => Promise.resolve([{ date: "2026-09-25", base: "USD", quote: "EUR", rate: 0.9 }]) })) as unknown as typeof global.fetch;
		});
		afterEach(() => {
			global.fetch = original;
			currencyExchangeService.clearRates();
		});

		test("onLineResult hears the arrival, and the next pass shows it", async () => {
			const liveEngine = newTrackedEngine();
			const liveDoc = new DocumentModel();
			liveDoc.setDocument("$100 in EUR");
			const live = new ThreeTierEvaluator(liveDoc, liveEngine);
			const rendered: Array<[number, string]> = [];
			liveEngine.getBatcher().onLineResult = (lineNumber: number, value: Value) => {
				rendered.push([lineNumber, liveEngine.formatValue(value)]);
			};

			const pending = live.evaluate({ startLine: 1, endLine: 30 });
			expect(liveEngine.formatValue(pending.resultMap.get(1)![0])).toBe("…");
			for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
			expect(rendered).toEqual([[1, "= €90.00"]]);
			expect(shown(liveEngine, live.evaluate({ startLine: 1, endLine: 30 }).lines[0])).toBe("= €90.00");
			live.dispose();
		});

		test("an arrival after dispose throws nothing", async () => {
			const liveEngine = newTrackedEngine();
			const { evaluator } = open("$100 in EUR", liveEngine);
			liveEngine.getBatcher().onLineResult = () => undefined;
			evaluator.evaluate({ startLine: 1, endLine: 1 });
			evaluator.dispose();
			for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
			expect(liveEngine.getDocumentModel()).toBeNull();
		});
	});

	test("the guide's advice for positional references: a pass from line 1 answers them, first and after an edit above", () => {
		const { engine, evaluator } = open("5\nprev * 2\nline 1 + 1\ntotal above");
		expect(evaluator.evaluate({ startLine: 1, endLine: 4 }).lines.map((l) => shown(engine, l))).toEqual(["= 5", "= 10", "= 6", "= 21"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: ["6"] }]);
		expect(evaluator.evaluate({ startLine: 1, endLine: 4 }).lines.map((l) => shown(engine, l))).toEqual(["= 6", "= 12", "= 7", "= 25"]);
		evaluator.dispose();
	});

	test("the boundary: two evaluators on one engine read each other's lines", () => {
		const engine = newTrackedEngine();
		const one = open("10\nline 1 * 2", engine);
		one.evaluator.evaluate({ startLine: 1, endLine: 2 });
		const two = open("99", engine);
		two.evaluator.evaluate({ startLine: 1, endLine: 1 });
		one.doc.editLine(1, "20");
		// The line reads the second document's line 1, which is why the guide
		// gives each open document an engine of its own.
		expect(one.evaluator.evaluate({ startLine: 1, endLine: 2 }).lines.map((l) => shown(engine, l))).toEqual(["= 20", "= 198"]);
		two.evaluator.dispose();
		one.evaluator.dispose();
	});

	test("one engine per document keeps them apart", () => {
		const one = open("10\nline 1 * 2");
		one.evaluator.evaluate({ startLine: 1, endLine: 2 });
		const two = open("99");
		two.evaluator.evaluate({ startLine: 1, endLine: 1 });
		one.doc.editLine(1, "20");
		expect(one.evaluator.evaluate({ startLine: 1, endLine: 2 }).lines.map((l) => shown(one.engine, l))).toEqual(["= 20", "= 40"]);
		two.evaluator.dispose();
		one.evaluator.dispose();
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a document of %s, evaluated and retired, leaves Object.prototype alone", (word) => {
		expectPrototypeUntouched(() => {
			const { engine, evaluator } = open(`:${word} = 5\n${word} + 1\nline 1 * 2\n${word}`);
			const pass = evaluator.evaluate({ startLine: 1, endLine: 4 });
			for (const line of pass.lines) expect(shown(engine, line)).not.toMatch(/\[object |is not a function|Cannot read/);
			evaluator.dispose();
			evaluator.dispose();
		});
	});

	test("three thousand lines, evaluated then retired, within budget", () => {
		const before = globalListeners();
		const started = performance.now();
		const { engine, evaluator } = open(RESOURCE_PROBES.manyLines(3_000));
		const pass = evaluator.evaluate({ startLine: 1, endLine: 3_001 });
		expect(shown(engine, pass.lines[pass.lines.length - 1])).toBe("= 3,001");
		evaluator.dispose();
		expect(performance.now() - started).toBeLessThan(10_000);
		expect(globalListeners()).toBe(before);
	});

	test("many evaluators built and retired leave no listener behind", () => {
		const before = globalListeners();
		const engine = newTrackedEngine();
		for (let i = 0; i < 200; i++) {
			const { evaluator } = open(`:x = ${i}\nx + 1`, engine);
			evaluator.evaluate({ startLine: 1, endLine: 2 });
			evaluator.dispose();
		}
		expect(globalListeners()).toBe(before);
		expect(engine.getDocumentModel()).toBeNull();
	});

	test.each(TEXT_EDGES.map((t) => [JSON.stringify(t), t]))("a line of %s through the loop is answered honestly", (_label, text) => {
		const { engine, evaluator } = open(`1\n${text}\nprev`);
		const pass = evaluator.evaluate({ startLine: 1, endLine: 3 });
		for (const line of pass.lines) expect(shown(engine, line)).not.toMatch(/\[object |is not a function|Cannot read|eval_failed/);
		evaluator.dispose();
	});
});

describe("adversarial: realistic breakage", () => {
	test("an edit that breaks a line, then one that fixes it", () => {
		const { engine, evaluator } = open(":a = 2\na * 3");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [":a = 2 +"] }]);
		const broken = evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(broken.lines[0].errorCode).toBe("UNEXPECTED_END_OF_INPUT");
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [":a = 4"] }]);
		expect(evaluator.evaluate({ startLine: 1, endLine: 2 }).lines.map((l) => shown(engine, l))).toEqual(["= 4", "= 12"]);
		evaluator.dispose();
	});

	test("the evaluator agrees with parseDocument on the guide's note after its edits", () => {
		const { engine, doc, evaluator } = open(["# Groceries", ":apples = 3 * £0.40", ":bread = £1.20", "apples + bread"].join("\n"));
		evaluator.evaluate({ startLine: 1, endLine: 30 });
		evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [":bread = £1.50"] }]);
		evaluator.applyTransaction([{ startLine: 4, deleteCount: 0, insertLines: [":milk = £0.95"] }]);
		const live = evaluator.evaluate({ startLine: 1, endLine: 30 }).lines.map((l) => (l.result ? engine.formatValue(l.result) : ""));
		const text = doc.getAllLines().map((l) => l.text).join("\n");
		evaluator.dispose();
		const batch = newTrackedEngine().parseDocument(text).lines.map((l) => (l.result ? engine.formatValue(l.result) : ""));
		expect(live).toEqual(batch);
	});

	test("a retired evaluator asked to evaluate again answers without a raw error", () => {
		const { engine, evaluator } = open("10\nline 1 * 2");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.dispose();
		const pass = evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(pass.lines.map((l) => shown(engine, l))).toEqual([
			"= 10",
			"ERROR: A line reference needs a document to read, and an expression evaluated on its own has none",
		]);
	});

	test("a snapshot taken after dispose restores the variables", () => {
		const { engine, evaluator } = open(":price = 100\nprice * 2");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.dispose();
		const state = JSON.parse(JSON.stringify(engine.toJSON()));
		expect(state.variables.price).toBeDefined();
	});
});

describe("adversarial: edge cases", () => {
	test.each(DOCUMENT_EDGES.map((t) => [JSON.stringify(t).slice(0, 40), t]))("the document %s through the loop and dispose", (_label, text) => {
		const { engine, doc, evaluator } = open(text);
		const pass = evaluator.evaluate({ startLine: 1, endLine: Math.max(1, doc.lineCount) });
		for (const line of pass.lines) expect(shown(engine, line)).not.toMatch(/\[object |is not a function|Cannot read|eval_failed/);
		expect(() => evaluator.dispose()).not.toThrow();
	});

	test("a viewport past the end of the document, and one of zero lines", () => {
		const { evaluator } = open("1\n2");
		expect(evaluator.evaluate({ startLine: 1, endLine: 1_000 }).lines).toHaveLength(2);
		expect(evaluator.evaluate({ startLine: 3, endLine: 2 }).resultMap.size).toBe(0);
		evaluator.dispose();
	});

	test("CRLF and a trailing newline", () => {
		const { engine, evaluator } = open("1\r\n2\r\ntotal above\n");
		const pass = evaluator.evaluate({ startLine: 1, endLine: 4 });
		expect(shown(engine, pass.lines[2])).toBe("= 3");
		evaluator.dispose();
	});

	test("the largest double and negative zero survive an edit in place", () => {
		const { engine, evaluator } = open(":x = 1e308\nx");
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [":x = -0"] }]);
		expect(shown(engine, evaluator.evaluate({ startLine: 1, endLine: 2 }).lines[1])).toBe("= 0");
		evaluator.dispose();
	});
});
