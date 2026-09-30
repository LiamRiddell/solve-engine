import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Found bug: two evaluators on one engine read each other's documents. An
 * evaluator wires its document model onto the engine when it is built, so the
 * second one built took the engine for its note, and the first one's
 * `line 1 * 2` read the second note's line 1; the VM, the dependency graph, the
 * line cache and the tables of units and names were shared the same way, so a
 * name or a unit one note defined was defined in the other. A `parseDocument`
 * or an `evaluateDocument` on the engine between two passes of a live
 * evaluator left the same state behind.
 *
 * The engine now counts each change of the document it serves
 * (`documentEpoch`), and an evaluator whose engine has served another document
 * since its last pass takes it back before it reads anything: its own model and
 * chain wired in, what the other note defined dropped (`beginDocument`), the
 * graph and the line cache cleared, and its lines run again from the top.
 */

function shownLine(line: EvalLineResult): string {
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	const text = formatValue(line.result).replace(/^=\s*/, "");
	return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
}

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
	});
}

const batch = (text: string): string[] => read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));

/** A live note on `engine`. */
function open(text: string, engine: ExpressionEngine): { doc: DocumentModel; evaluator: ThreeTierEvaluator; pass: () => string[] } {
	const doc = new DocumentModel();
	doc.setDocument(text);
	const evaluator = new ThreeTierEvaluator(doc, engine);
	return { doc, evaluator, pass: () => evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(shownLine) };
}

describe("the reported case: two notes on one engine", () => {
	test("each note's line references read its own lines, whichever ran last", () => {
		const engine = newTrackedEngine();
		const one = open("100\nprev + 1", engine);
		const two = open("7\nprev + 1", engine);
		expect(one.pass()).toEqual(["100", "101"]);
		expect(two.pass()).toEqual(["7", "8"]);
		expect(one.pass()).toEqual(["100", "101"]);
		one.doc.editLine(2, "prev + 2");
		expect(one.pass()).toEqual(["100", "102"]);
		expect(two.pass()).toEqual(["7", "8"]);
		one.evaluator.dispose();
		two.evaluator.dispose();
	});

	test("a name, a unit, a name of several words and an equation one note defines are not defined in the other", () => {
		const engine = newTrackedEngine();
		const one = open(["x = 5", "1 sprint = 2 weeks", "hourly rate = 9", "a * y = 10"].join("\n"), engine);
		const other = ["x * 2", "3 sprints in days", "hourly rate * 2", "y =>"].join("\n");
		const two = open(other, engine);
		one.pass();
		expect(two.pass()).toEqual(batch(other));
		expect(one.pass()).toEqual(batch(one.doc.getAllLines().map((l) => l.text).join("\n")));
		one.evaluator.dispose();
		two.evaluator.dispose();
	});

	test("a parseDocument and an evaluateDocument between two passes leave nothing behind", () => {
		const engine = newTrackedEngine();
		const live = open("10\nline 1 * 2\nq * 2", engine);
		expect(live.pass()).toEqual(["10", "20", "ERROR Undefined variable: q"]);
		engine.parseDocument("99\nq = 4");
		expect(live.pass()).toEqual(["10", "20", "ERROR Undefined variable: q"]);
		evaluateDocument(engine, "55\nq = 6");
		expect(live.pass()).toEqual(["10", "20", "ERROR Undefined variable: q"]);
		live.evaluator.dispose();
	});

	test("a retired evaluator does not take the engine back", () => {
		const engine = newTrackedEngine();
		const one = open("10\nline 1 * 2", engine);
		one.pass();
		one.evaluator.dispose();
		const epoch = engine.documentEpoch();
		const again = one.evaluator.evaluate({ startLine: 1, endLine: 2 }).lines.map(shownLine);
		expect(again[1]).toBe("ERROR A line reference needs a document to read, and an expression evaluated on its own has none");
		expect(engine.getDocumentModel()).toBeNull();
		expect(engine.documentEpoch()).toBe(epoch);
	});
});

describe("the three entry points", () => {
	test("evaluateLine on the shared engine has no document once both evaluators are retired", () => {
		const engine = newTrackedEngine();
		const one = open("10\nprev + 1", engine);
		const two = open("3\nprev + 1", engine);
		one.pass();
		two.pass();
		one.evaluator.dispose();
		two.evaluator.dispose();
		const outcome = expectHonestLine("prev + 1", { engine });
		expect(outcome.kind === "error" || outcome.kind === "thrown").toBe(true);
	});

	test("each note, live on a shared engine, agrees with parseDocument and evaluateDocument on a fresh one", () => {
		const notes = ["1 #a\n2 #a\ntotal of #a", "10\n20\ntotal above\nline 3 / 2", ":v = 4\nv * prev"];
		const engine = newTrackedEngine();
		const live = notes.map((text) => open(text, engine));
		for (let round = 0; round < 2; round++) {
			live.forEach((note, i) => {
				expect(note.pass()).toEqual(batch(notes[i]));
				expect(read(evaluateDocument(newTrackedEngine(), notes[i]))).toEqual(batch(notes[i]));
			});
		}
		for (const note of live) note.evaluator.dispose();
	});
});

describe("the parts: the engine's document count", () => {
	test("ordinary: it moves when the document model changes, a batch pass begins, or the engine is cleared", () => {
		const engine = newTrackedEngine();
		const start = engine.documentEpoch();
		const doc = new DocumentModel();
		engine.setDocumentModel(doc);
		expect(engine.documentEpoch()).toBe(start + 1);
		engine.setDocumentModel(doc);
		expect(engine.documentEpoch()).toBe(start + 1);
		engine.parseDocument("1");
		expect(engine.documentEpoch()).toBe(start + 2);
		engine.clear();
		expect(engine.documentEpoch()).toBe(start + 3);
	});

	test("boundary: a single expression does not move it", () => {
		const engine = newTrackedEngine();
		const start = engine.documentEpoch();
		engine.evaluateExpression("1 + 1");
		engine.evaluateExpression(":z = 3");
		expect(engine.documentEpoch()).toBe(start);
	});

	test("boundary: an evaluator's own passes do not move it", () => {
		const engine = newTrackedEngine();
		const note = open("1\n2", engine);
		note.pass();
		const after = engine.documentEpoch();
		note.pass();
		note.evaluator.setViewport({ startLine: 2, endLine: 2 });
		expect(engine.documentEpoch()).toBe(after);
		note.evaluator.dispose();
	});

	test("hostile: setting the same null model twice moves it once", () => {
		const engine = newTrackedEngine();
		engine.setDocumentModel(new DocumentModel());
		const before = engine.documentEpoch();
		engine.setDocumentModel(null);
		engine.setDocumentModel(null);
		expect(engine.documentEpoch()).toBe(before + 1);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a name %s one note defines is not defined in the other", (word) => {
		expectPrototypeUntouched(() => {
			const engine = newTrackedEngine();
			const one = open(`:${word} = 5`, engine);
			const two = open(`${word} * 2`, engine);
			one.pass();
			expect(two.pass()).toEqual(batch(`${word} * 2`));
			one.evaluator.dispose();
			two.evaluator.dispose();
		});
	});

	test("two notes of a thousand lines each taking turns stay within budget", () => {
		const engine = newTrackedEngine();
		const text = (seed: number) => [String(seed), ...Array.from({ length: 1_000 }, () => "prev + 1")].join("\n");
		const one = open(text(1), engine);
		const two = open(text(100), engine);
		const started = performance.now();
		for (let i = 0; i < 3; i++) {
			expect(one.pass()[1_000]).toBe("1,001");
			expect(two.pass()[1_000]).toBe("1,100");
		}
		expect(performance.now() - started).toBeLessThan(30_000);
		one.evaluator.dispose();
		two.evaluator.dispose();
	});
});

describe("adversarial: realistic breakage", () => {
	test("a host switching notes by building a new evaluator over each, without retiring the old one", () => {
		const engine = newTrackedEngine();
		const a = open(":rate = 3\nrate * 2", engine);
		expect(a.pass()).toEqual(["3", "6"]);
		const b = open("rate * 10", engine);
		expect(b.pass()).toEqual(["ERROR Undefined variable: rate"]);
		expect(a.pass()).toEqual(["3", "6"]);
		a.evaluator.dispose();
		b.evaluator.dispose();
	});

	test("an edit in one note between passes of the other", () => {
		const engine = newTrackedEngine();
		const a = open("5\nline 1 + 1", engine);
		const b = open("50\nline 1 + 1", engine);
		a.pass();
		b.pass();
		a.evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["2"] }]);
		expect(a.pass()).toEqual(["2", "5", "3"]);
		expect(b.pass()).toEqual(["50", "51"]);
		a.evaluator.dispose();
		b.evaluator.dispose();
	});

	test("a scroll in one note after a pass of the other", () => {
		const engine = newTrackedEngine();
		const a = open(":x = 1\nx + 1\n:x = 9\nx + 1", engine);
		const b = open(":x = 100\nx", engine);
		a.pass();
		b.pass();
		// Taking the engine back marks every line dirty, so the scroll runs from
		// line 1, as setViewport does whenever a line above it is dirty.
		const view = a.evaluator.setViewport({ startLine: 2, endLine: 4 });
		expect(view.lines.filter((l) => l.lineNumber >= 2).map(shownLine)).toEqual(["2", "9", "10"]);
		expect([...view.resultMap.keys()]).toEqual([2, 3, 4]);
		a.evaluator.dispose();
		b.evaluator.dispose();
	});
});

describe("adversarial: edge cases", () => {
	test("an empty note beside a full one", () => {
		const engine = newTrackedEngine();
		const a = open("", engine);
		const b = open("4\nprev * 2", engine);
		expect(a.pass()).toEqual([""]);
		expect(b.pass()).toEqual(["4", "8"]);
		expect(a.pass()).toEqual([""]);
		a.evaluator.dispose();
		b.evaluator.dispose();
	});

	test("two evaluators over one document model on one engine agree", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument("3\nprev * 3");
		const first = new ThreeTierEvaluator(doc, engine);
		const second = new ThreeTierEvaluator(doc, engine);
		expect(first.evaluate({ startLine: 1, endLine: 2 }).lines.map(shownLine)).toEqual(["3", "9"]);
		expect(second.evaluate({ startLine: 1, endLine: 2 }).lines.map(shownLine)).toEqual(["3", "9"]);
		first.dispose();
		second.dispose();
	});
});
