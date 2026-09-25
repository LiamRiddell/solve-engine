import { describe, expect, test } from "@jest/globals";
import { CompilationWorkerManager, type CompileResponseItem } from "@solve-js/engine/CompilationWorkerManager";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { djb2Hash } from "@solve-js/utilities/Hash";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #664: `DocumentModel.editLine` decided "no change" from the djb2 hash
 * alone, and djb2 gives two adjacent characters `c1 c2` the same hash as
 * `c1+1, c2-33`: `ab` and `bA`. Editing `total = ab * 2` to `total = bA * 2`
 * returned false and kept `= 6`. The hash is now a pre-check and the text
 * decides; the worker's compile results are checked against the text too.
 */

/** A text with the same djb2 hash: the two characters at `at` become `c1+1, c2-33`. */
function collide(text: string, at: number): string {
	const c1 = text.charCodeAt(at);
	const c2 = text.charCodeAt(at + 1);
	return text.slice(0, at) + String.fromCharCode(c1 + 1, c2 - 33) + text.slice(at + 2);
}

const read = (line: EvalLineResult) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : "");

function live(lines: string[]): { doc: DocumentModel; pass: () => string[]; done: () => void } {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	return {
		doc,
		pass: () => evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(read),
		done: () => evaluator.terminateWorker(),
	};
}

const fresh = (lines: string[]) => newTrackedEngine().parseDocument(lines.join("\n"), { inputType: "markdown" }).lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));

describe("the pairs collide", () => {
	test.each([
		["total = ab * 2", 8, "total = bA * 2"],
		["price = qty * 3", 8, "price = rSy * 3"],
	])("%s and its pair share a hash", (text, at, pair) => {
		expect(collide(text, at)).toBe(pair);
		expect(djb2Hash(pair)).toBe(djb2Hash(text));
		expect(pair).not.toBe(text);
	});
});

describe("editLine takes an edit whose hash collides", () => {
	test("the survey's document", () => {
		const { doc, pass, done } = live(["ab = 3", "bA = 100", "total = ab * 2"]);
		try {
			expect(pass()[2]).toBe("= 6");
			expect(doc.editLine(3, "total = bA * 2")).toBe(true);
			expect(doc.getLineAt(3)?.text).toBe("total = bA * 2");
			expect(pass()).toEqual(fresh(["ab = 3", "bA = 100", "total = bA * 2"]));
			expect(pass()[2]).toBe("= 200");
		} finally {
			done();
		}
	});

	test("a longer pair", () => {
		const { doc, pass, done } = live(["qty = 2", "rSy = 50", "price = qty * 3"]);
		try {
			expect(pass()[2]).toBe("= 6");
			expect(doc.editLine(3, "price = rSy * 3")).toBe(true);
			expect(pass()[2]).toBe("= 150");
		} finally {
			done();
		}
	});

	test("the same text is still no change", () => {
		const { doc, done } = live(["ab = 3"]);
		try {
			expect(doc.editLine(1, "ab = 3")).toBe(false);
		} finally {
			done();
		}
	});
});

describe("adversarial", () => {
	test("a document built entirely from colliding lines", () => {
		const lines = ["ab = 3", "bA = 100", "ab + bA", "bA - ab"];
		const { doc, pass, done } = live(lines);
		try {
			expect(pass()).toEqual(fresh(lines));
			expect(doc.editLine(3, "bA + bA")).toBe(true);
			expect(doc.editLine(4, "ab - ab")).toBe(true);
			expect(pass()).toEqual(fresh(["ab = 3", "bA = 100", "bA + bA", "ab - ab"]));
		} finally {
			done();
		}
	});

	test("an undo back to the colliding previous text", () => {
		const { doc, pass, done } = live(["ab = 3", "bA = 100", "x = ab"]);
		try {
			expect(pass()[2]).toBe("= 3");
			expect(doc.editLine(3, "x = bA")).toBe(true);
			expect(pass()[2]).toBe("= 100");
			expect(doc.editLine(3, "x = ab")).toBe(true);
			expect(pass()[2]).toBe("= 3");
		} finally {
			done();
		}
	});
});

describe("worker bytecode is checked against the text", () => {
	test("isBytecodeValid refuses a colliding text when it is given the text", () => {
		const doc = new DocumentModel();
		doc.setDocument("total = ab * 2");
		const line = doc.getLineAt(1)!;
		const hash = line.textHash;
		doc.editLine(1, "total = bA * 2");
		expect(doc.isBytecodeValid(line.lineId, hash, "total = ab * 2")).toBe(false);
		expect(doc.isBytecodeValid(line.lineId, hash, "total = bA * 2")).toBe(true);
	});

	test("a compile result that arrives after a colliding edit is not stored", () => {
		const doc = new DocumentModel();
		doc.setDocument("total = ab * 2");
		const line = doc.getLineAt(1)!;
		const result: CompileResponseItem = {
			lineId: line.lineId,
			compiledAgainstHash: line.textHash,
			compiledAgainstText: "total = ab * 2",
			program: { opcodes: new Uint8Array([1]), numbers: new Float64Array(0), strings: [], hasAsync: false },
			reads: ["ab"],
			writes: ["total"],
			isVariableDef: true,
			error: null,
		};
		doc.editLine(1, "total = bA * 2");
		const manager = new CompilationWorkerManager();
		expect(manager.storeResults([result], doc)).toBe(0);
		expect(manager.storeResults([{ ...result, compiledAgainstText: "total = bA * 2" }], doc)).toBe(1);
		manager.terminate();
	});
});
