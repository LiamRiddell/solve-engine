import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel, type LineChange } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { EngineError } from "@solve-js/errors/EngineError";

/**
 * Found bug: `evaluateDocument` ignored `performance.maxDocumentLines`.
 * `parseDocument` refuses a document past the ceiling before scanning any of
 * it, with `DOCUMENT_TOO_LARGE`; the incremental pass built its model with the
 * default ceiling and ran a document of any length the engine was configured
 * to refuse. It now asks the engine the same question first
 * (`assertDocumentSize`), so the two passes refuse the same documents with the
 * same error. Found beside it: a structural edit grew a `DocumentModel` past
 * its own ceiling, since only a whole document was counted; the changes are
 * now counted before any is applied (`DocumentModel.assertChangesFit`).
 */

/** What a pass threw, as its code and message, or null when it answered. */
function refusal(run: () => unknown): { code: string; message: string } | null {
	try {
		run();
		return null;
	} catch (e) {
		expect(e).toBeInstanceOf(EngineError);
		return { code: (e as EngineError).code, message: (e as EngineError).message };
	}
}

const ceiling = (maxDocumentLines: number) => newTrackedEngine({ config: { performance: { maxDocumentLines } } });
const lines = (n: number, line = "1"): string => Array.from({ length: n }, () => line).join("\n");

describe("the reported case", () => {
	test("both passes refuse a document past the configured ceiling, with the same error", () => {
		const text = lines(5);
		const batch = refusal(() => ceiling(3).parseDocument(text));
		const incremental = refusal(() => evaluateDocument(ceiling(3), text));
		expect(batch).toEqual({ code: "DOCUMENT_TOO_LARGE", message: "This document has more than 3 lines, which is the most the engine will process in one pass" });
		expect(incremental).toEqual(batch);
	});

	test("both answer a document at the ceiling", () => {
		const text = lines(3, "prev + 1").replace(/^prev \+ 1/, "1");
		expect(refusal(() => ceiling(3).parseDocument(text))).toBeNull();
		const result = evaluateDocument(ceiling(3), text);
		expect(result.totalLines).toBe(3);
		expect(result.lines[2].result?.toNumber()).toBe(3);
	});

	test("a refused pass leaves a live evaluator on the same engine as it was", () => {
		const engine = ceiling(3);
		const doc = new DocumentModel();
		doc.setDocument("5\nprev * 2");
		const evaluator = new ThreeTierEvaluator(doc, engine);
		try {
			evaluator.evaluate({ startLine: 1, endLine: 2 });
			expect(refusal(() => evaluateDocument(engine, lines(9)))?.code).toBe("DOCUMENT_TOO_LARGE");
			expect(engine.getDocumentModel()).toBe(doc);
			expect(evaluator.evaluate({ startLine: 1, endLine: 2 }).lines[1].result?.toNumber()).toBe(10);
		} finally {
			evaluator.dispose();
		}
	});
});

describe("the three entry points", () => {
	test("a single expression is not a document and is not counted", () => {
		expect(ceiling(1).evaluateExpression("1 + 1").toNumber()).toBe(2);
	});

	test("under the ceiling the passes agree", () => {
		for (const text of ["10\n20\ntotal above", "1 #a\n2 #a\ntotal of #a"]) expectHonestDocument(text);
	});
});

describe("the parts", () => {
	test("assertDocumentSize: ordinary, boundary and hostile documents", () => {
		const engine = ceiling(3);
		expect(() => engine.assertDocumentSize("")).not.toThrow();
		expect(() => engine.assertDocumentSize("1\n2\n3")).not.toThrow();
		expect(() => engine.assertDocumentSize("1\n2\n3\n")).toThrow(EngineError);
		// A lone carriage return is a line break too.
		expect(() => engine.assertDocumentSize("1\r2\r3\r4")).toThrow(/more than 3 lines/);
		// CRLF is one break, not two.
		expect(() => engine.assertDocumentSize("1\r\n2\r\n3")).not.toThrow();
	});

	test("assertChangesFit: counts what the changes leave", () => {
		const doc = new DocumentModel(4);
		doc.setDocument("a\nb\nc");
		const insert = (n: number): LineChange => ({ startLine: 1, deleteCount: 0, insertLines: Array.from({ length: n }, () => "x") });
		expect(() => doc.assertChangesFit([insert(1)])).not.toThrow();
		expect(() => doc.assertChangesFit([insert(2)])).toThrow(/more than 4 lines/);
		expect(() => doc.assertChangesFit([{ startLine: 1, deleteCount: 2, insertLines: ["p", "q", "r"] }])).not.toThrow();
		// A delete count past the end of the document deletes what is there.
		expect(() => doc.assertChangesFit([{ startLine: 3, deleteCount: 99, insertLines: ["p", "q"] }])).not.toThrow();
		expect(() => doc.assertChangesFit([{ startLine: 3, deleteCount: 99, insertLines: ["p", "q", "r"] }])).toThrow(EngineError);
	});

	test("assertChangesFit: hostile counts do not let a change through", () => {
		const doc = new DocumentModel(2);
		doc.setDocument("a");
		expect(() => doc.assertChangesFit([{ startLine: 1, deleteCount: Number.NaN, insertLines: ["b", "c"] }])).toThrow(EngineError);
		expect(() => doc.assertChangesFit([{ startLine: 1, deleteCount: -5, insertLines: ["b", "c"] }])).toThrow(EngineError);
		expect(() => doc.assertChangesFit([{ startLine: 1, deleteCount: 0 } as unknown as LineChange])).not.toThrow();
	});

	test("a structural edit past the ceiling is refused before anything changes, on the model and through an evaluator", () => {
		const doc = new DocumentModel(3);
		doc.setDocument("1\n2");
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluate({ startLine: 1, endLine: 2 });
			expect(() => evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["a", "b"] }])).toThrow(/more than 3 lines/);
			expect(() => doc.insertLines(1, ["a", "b"])).toThrow(EngineError);
			expect(doc.getAllLines().map((l) => l.text)).toEqual(["1", "2"]);
			expect(evaluator.evaluate({ startLine: 1, endLine: 2 }).lines.map((l) => l.result?.toNumber())).toEqual([1, 2]);
		} finally {
			evaluator.dispose();
		}
	});
});

describe("adversarial: security", () => {
	test("a document of a hundred thousand and one lines is refused by both passes, quickly", () => {
		const text = "\n".repeat(100_000);
		const started = performance.now();
		expect(refusal(() => newTrackedEngine().parseDocument(text))?.code).toBe("DOCUMENT_TOO_LARGE");
		expect(refusal(() => evaluateDocument(newTrackedEngine(), text))?.code).toBe("DOCUMENT_TOO_LARGE");
		expect(performance.now() - started).toBeLessThan(5_000);
	});

	test.each(PROTOTYPE_WORDS)("a refused document of %s leaves Object.prototype alone", (word) => {
		expectPrototypeUntouched(() => {
			expect(refusal(() => evaluateDocument(ceiling(2), `:${word} = 1\n${word}\n${word}`))?.code).toBe("DOCUMENT_TOO_LARGE");
		});
	});
});

describe("adversarial: realistic breakage", () => {
	test("a note that grows past the ceiling between two passes is refused on the second", () => {
		const engine = ceiling(3);
		expect(evaluateDocument(engine, "1\n2").totalLines).toBe(2);
		expect(refusal(() => evaluateDocument(engine, "1\n2\n3\n4"))?.code).toBe("DOCUMENT_TOO_LARGE");
		expect(evaluateDocument(engine, "1\n2\n3").totalLines).toBe(3);
	});
});

describe("adversarial: edge cases", () => {
	test.each(DOCUMENT_EDGES.map((text) => [JSON.stringify(text), text]))("%s is refused or answered alike by both passes at a ceiling of 3", (_label, text) => {
		const batch = refusal(() => ceiling(3).parseDocument(text));
		const incremental = refusal(() => evaluateDocument(ceiling(3), text));
		expect(incremental).toEqual(batch);
	});
});
