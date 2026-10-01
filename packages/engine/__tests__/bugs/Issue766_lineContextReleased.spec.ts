import { describe, expect, test } from "@jest/globals";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #766: `parseDocument` kept the last document's scan and its whole
 * array of results after it returned, and after `clear()`. The shared line
 * context was released at the end of the pass and in `clear()`, but the two
 * fields beside it that say which pass it was built over, `lineContextScan`
 * and `lineContextParsed`, still pointed at that pass's scan and results. An
 * engine given 20,000 lines held 40.8 MB after `clear()` against 15.3 MB with
 * both released, on this spec's machine.
 *
 * Both are now released wherever the context is: at the end of the batch
 * pass, and in `clear()`, which also releases `lineContextDoc`, the third
 * identity field.
 */

/** The three identity fields, read from outside, for the assertions. */
interface Held {
	lineContext: unknown;
	lineContextDoc: unknown;
	lineContextScan: unknown[] | null;
	lineContextParsed: unknown[] | null;
}
const held = (engine: ExpressionEngine): Held => engine as unknown as Held;

/** A document that reaches the shared context: assignments, prose and reads, with a line reference. */
function note(count: number): string {
	const lines: string[] = [];
	for (let i = 0; i < count; i++) {
		const k = i % 3;
		lines.push(k === 0 ? `a${i} = ${i} + 1` : k === 1 ? `Some prose about item ${i}` : `a${i - 2} * 2`);
	}
	lines.push("line 1 + 1");
	return lines.join("\n");
}

const answers = (engine: ExpressionEngine, text: string): string[] =>
	engine.parseDocument(text).lines.map((l) => (l.result === null ? "" : formatValue(l.result)));

describe("the batch pass releases the document when it returns", () => {
	test("neither identity field holds the scan or the results after parseDocument", () => {
		const engine = newTrackedEngine();
		engine.parseDocument(note(30));
		expect(held(engine).lineContext).toBeNull();
		expect(held(engine).lineContextScan).toBeNull();
		expect(held(engine).lineContextParsed).toBeNull();
	});

	test("clear() releases all three, the document model's too", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(note(12));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		evaluator.evaluateAll();
		// On the incremental path the context points at the attached model.
		expect(held(engine).lineContextDoc).toBe(doc);
		engine.clear();
		expect(held(engine).lineContext).toBeNull();
		expect(held(engine).lineContextDoc).toBeNull();
		expect(held(engine).lineContextScan).toBeNull();
		expect(held(engine).lineContextParsed).toBeNull();
		evaluator.terminateWorker();
	});

	test("a second document does not reuse the first one's context", () => {
		const engine = newTrackedEngine();
		expect(answers(engine, "10\n20\nline 1 + 1")).toEqual(["= 10", "= 20", "= 11"]);
		// Were the first pass's scan still current, `line 1` would read 10 again.
		expect(answers(engine, "7\nline 1 * 3")).toEqual(["= 7", "= 21"]);
	});

	test("a line reference still resolves against its own pass after the fields are released", () => {
		const engine = newTrackedEngine();
		for (let round = 0; round < 3; round++) {
			expect(answers(engine, `${round + 1}\nline 1 + 100\ntotal above`)).toEqual([`= ${round + 1}`, `= ${round + 101}`, `= ${2 * round + 102}`]);
		}
	});
});

describe("the document is not held after clear() (measured)", () => {
	test("20,000 lines leave neither the scan nor the results reachable from the engine", () => {
		const engine = newTrackedEngine();
		const text = note(20_000);
		const first = engine.parseDocument(text);
		expect(first.totalLines).toBe(20_001);
		engine.clear();
		// A WeakRef to the results array would say the same thing through the
		// collector; the fields are what held it, so they are what is checked.
		expect(held(engine).lineContextScan).toBeNull();
		expect(held(engine).lineContextParsed).toBeNull();
	});
});

describe("adversarial: security", () => {
	test("a document of prototype words releases its context and leaves Object.prototype alone", () => {
		expectPrototypeUntouched(() => {
			const engine = newTrackedEngine();
			const text = PROTOTYPE_WORDS.map((w, i) => (i % 2 === 0 ? `${w} = ${i}` : `${w} + 1`)).join("\n");
			engine.parseDocument(text);
			expect(held(engine).lineContextScan).toBeNull();
			engine.clear();
			expect(held(engine).lineContextParsed).toBeNull();
		});
	});

	test("thousands of lines, and markup- and look-alike-shaped lines, go through both passes honestly", () => {
		expectHonestDocument(RESOURCE_PROBES.manyLines(2_000));
		expectHonestDocument(TEXT_EDGES.join("\n"));
	});
});

describe("adversarial: realistic breakage", () => {
	test("the batch and incremental passes still agree after an engine has been reused", () => {
		const engine = newTrackedEngine();
		const text = "price = 40\nqty = 3\nprice * qty\nline 3 + 5\ntotal above";
		engine.parseDocument("other = 1\nline 1 + 1");
		const batch = answers(engine, text);
		const incremental = evaluateDocument(newTrackedEngine(), text).lines.map((l) => (l.result === null ? "" : formatValue(l.result)));
		expect(batch).toEqual(incremental);
		expect(batch).toEqual(["= 40", "= 3", "= 120", "= 125", "= 288"]);
	});

	test("an engine cleared between documents answers the second as a fresh engine does", () => {
		const reused = newTrackedEngine();
		reused.parseDocument(note(300));
		reused.clear();
		const text = "a = 2\nline 1 * 5";
		expect(answers(reused, text)).toEqual(answers(newTrackedEngine(), text));
	});

	test("a document refused for its size leaves nothing held", () => {
		const engine = newTrackedEngine({ config: { performance: { maxDocumentLines: 5 } } });
		expect(() => engine.parseDocument("1\n2\n3\n4\n5\n6")).toThrow();
		expect(held(engine).lineContextScan).toBeNull();
		expect(held(engine).lineContextParsed).toBeNull();
	});
});

describe("adversarial: edge cases", () => {
	test.each(DOCUMENT_EDGES.map((d) => [JSON.stringify(d), d]))("the document %s leaves nothing held", (_label, text) => {
		const engine = newTrackedEngine();
		engine.parseDocument(text);
		expect(held(engine).lineContextScan).toBeNull();
		expect(held(engine).lineContextParsed).toBeNull();
		expectHonestDocument(text);
	});

	test("clear() on an engine that never parsed, and twice in a row, is harmless", () => {
		const engine = newTrackedEngine();
		engine.clear();
		engine.clear();
		expect(held(engine).lineContextDoc).toBeNull();
		expect(answers(engine, "1\nline 1 + 1")).toEqual(["= 1", "= 2"]);
	});
});
