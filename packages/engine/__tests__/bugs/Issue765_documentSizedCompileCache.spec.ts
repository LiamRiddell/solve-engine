import { describe, expect, jest, test } from "@jest/globals";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #765: the three compile caches (the programs, their front halves and
 * the remembered parse failures) were least-recently-used caches capped at
 * `performance.defaultCacheSize`, 2,000 by default. A document pass visits
 * its lines in the same order every time, and such a cache smaller than the
 * scan evicts each entry just before it is wanted again, so past 2,000
 * distinct lines a warm pass got no hits at all. A warm `parseDocument` over
 * 10,000 distinct lines measured 132 to 147 ms that way and 75 to 101 ms
 * sized to the document, on this spec's machine, busy with other work.
 *
 * The cap is now `defaultCacheSize` plus the open document's line count (the
 * attached document model's, else the last batch pass's), the line count
 * bounded by `maxDocumentLines`. With no document open, and after `clear()`,
 * it is `defaultCacheSize` alone, as before.
 */

/** The private cap, read from outside for the unit tests. */
const capOf = (engine: ExpressionEngine): number => (engine as unknown as { compiledCacheCap(): number }).compiledCacheCap();

/** `n` distinct lines that all evaluate: arithmetic, conversions, percentages and functions. */
function distinct(n: number, offset = 0): string {
	const out: string[] = [];
	for (let i = offset; out.length < n; i++) {
		out.push(`${i} + ${i + 1}`, `${i + 1} km in miles`, `${(i % 90) + 5}% of ${i + 200}`, `sqrt(${i + 4}) * 2`);
	}
	return out.slice(0, n).join("\n");
}

const answers = (lines: ReadonlyArray<{ result: unknown; error: string | null }>): string[] =>
	lines.map((l) => (l.result === null ? (l.error === null ? "" : "ERROR") : formatValue(l.result as never)));

describe("compiledCacheCap (unit)", () => {
	test("ordinary: defaultCacheSize with no document, plus the document's lines with one", () => {
		const engine = newTrackedEngine();
		expect(capOf(engine)).toBe(2_000);
		engine.parseDocument(distinct(500));
		expect(capOf(engine)).toBe(2_500);
	});

	test("boundary: the line count is bounded by maxDocumentLines, and an empty document adds one line", () => {
		const engine = newTrackedEngine({ config: { performance: { defaultCacheSize: 10, maxDocumentLines: 50 } } });
		engine.parseDocument(distinct(50));
		expect(capOf(engine)).toBe(60);
		engine.parseDocument("");
		// The scan of an empty document is one empty line.
		expect(capOf(engine)).toBe(11);
	});

	test("the attached document model's line count is used while one is attached", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(distinct(300));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		expect(capOf(engine)).toBe(2_300);
		doc.setDocument(distinct(40));
		expect(capOf(engine)).toBe(2_040);
		evaluator.terminateWorker();
	});

	test("clear() returns it to defaultCacheSize", () => {
		const engine = newTrackedEngine();
		engine.parseDocument(distinct(800));
		engine.clear();
		expect(capOf(engine)).toBe(2_000);
	});

	test("a nested pass does not resize it: a what-if inside a line is not the open document", () => {
		const engine = newTrackedEngine();
		const text = "price = 10\nqty = 3\ntotal = price * qty\nline 3 with price = 20";
		const result = engine.parseDocument(text);
		expect(answers(result.lines)).toEqual(["= 10", "= 3", "= 30", "= 60"]);
		expect(capOf(engine)).toBe(2_004);
	});
});

describe("a warm pass over a document past the old cap compiles nothing", () => {
	test("5,000 distinct lines: the second pass is all hits", () => {
		const engine = newTrackedEngine();
		const text = distinct(5_000);
		engine.parseDocument(text);
		expect(engine.getBytecodeCache().size).toBe(5_000);
		const lex = jest.spyOn(engine.getLexer(), "resetExpression");
		engine.parseDocument(text);
		// Before, every line was evicted just before the pass came back to it.
		expect(lex).not.toHaveBeenCalled();
	});

	test("the same through a long-lived evaluator", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(distinct(2_500));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		evaluator.evaluateAll();
		expect(engine.getBytecodeCache().size).toBe(2_500);
		evaluator.terminateWorker();
	});

	test("the failed-parse memory holds a whole document of lines that do not parse", () => {
		const engine = newTrackedEngine();
		const text = Array.from({ length: 2_500 }, (_, i) => `(${i} +`).join("\n");
		engine.parseDocument(text);
		const lex = jest.spyOn(engine.getLexer(), "resetExpression");
		engine.parseDocument(text);
		expect(lex).not.toHaveBeenCalled();
	});

	test("a smaller document after a larger one brings the cache down to its own cap", () => {
		const engine = newTrackedEngine({ config: { performance: { defaultCacheSize: 20 } } });
		engine.parseDocument(distinct(400));
		expect(engine.getBytecodeCache().size).toBe(400);
		engine.parseDocument(distinct(10, 5_000));
		// One insertion past the new cap of 30 evicts down to it.
		expect(engine.getBytecodeCache().size).toBeLessThanOrEqual(30);
	});
});

describe("adversarial: security", () => {
	test("prototype words as whole lines of a large document", () => {
		expectPrototypeUntouched(() => {
			const engine = newTrackedEngine({ config: { performance: { defaultCacheSize: 5 } } });
			const text = Array.from({ length: 200 }, (_, i) => `${PROTOTYPE_WORDS[i % PROTOTYPE_WORDS.length]} + ${i}`).join("\n");
			engine.parseDocument(text);
			engine.parseDocument(text);
			expect(capOf(engine)).toBe(205);
		});
	});

	test("the bound stays the document's size: maxDocumentLines refuses the document before it reaches the caches", () => {
		const engine = newTrackedEngine({ config: { performance: { maxDocumentLines: 100 } } });
		expect(() => engine.parseDocument(distinct(101))).toThrow();
		expect(capOf(engine)).toBe(2_000);
	});
});

describe("adversarial: realistic breakage", () => {
	test("the batch and incremental passes agree value for value on a document past the old cap", () => {
		const text = distinct(2_200);
		const batch = answers(newTrackedEngine().parseDocument(text).lines);
		const incremental = answers(evaluateDocument(newTrackedEngine(), text).lines);
		expect(batch).toEqual(incremental);
		expect(batch.filter((a) => a === "ERROR")).toEqual([]);
	});

	test("an edit to one line of a large open document recompiles only that line", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(distinct(3_000));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		evaluator.evaluateAll();
		const lex = jest.spyOn(engine.getLexer(), "resetExpression");
		doc.editLine(10, "41 + 1");
		evaluator.evaluateAll();
		expect(lex).toHaveBeenCalledTimes(1);
		evaluator.terminateWorker();
	});

	test("a host's own smaller cap still bounds the engine with no document open", () => {
		const engine = newTrackedEngine({ config: { performance: { defaultCacheSize: 3 } } });
		for (const e of ["1 + 1", "2 + 2", "3 + 3", "4 + 4", "5 + 5"]) engine.evaluateExpression(e);
		expect(engine.getBytecodeCache().size).toBe(3);
	});
});

describe("adversarial: edge cases", () => {
	test.each(DOCUMENT_EDGES.map((d) => [JSON.stringify(d), d]))("the document %s passes honestly with the cache sized to it", (_label, text) => {
		expectHonestDocument(text);
	});

	test("a cap of 1 with a document of one line", () => {
		const engine = newTrackedEngine({ config: { performance: { defaultCacheSize: 1 } } });
		expect(answers(engine.parseDocument("2 + 2").lines)).toEqual(["= 4"]);
		expect(answers(engine.parseDocument("2 + 2").lines)).toEqual(["= 4"]);
		expect(capOf(engine)).toBe(2);
	});
});
