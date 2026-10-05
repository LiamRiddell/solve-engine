import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel, type ViewportRange } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, EvalTier, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a viewport starting below line 1 broke the positional forms. The
 * dirty lines above it were compiled without running (Tier 3), so a line in
 * view that read one by position had no answer to read: `prev + 1` at the top
 * of a viewport starting at line 3 answered "Line 2 has not been evaluated
 * yet", `line 1 * 3` the same, and `total above` "Line 4 has an error", where
 * `parseDocument` answers 21, 30 and 81. `setViewport` on a note that had never
 * been evaluated did not even compile them, and a clean definition above the
 * viewport handed a line in view the value a later definition left in the VM
 * (`x + 100` between `:x = 1` and `:x = 99` answered 199).
 *
 * A dirty line above the viewport now runs in full, `setViewport` falls back
 * to a pass from line 1 when a line above it has never been compiled
 * (`DocumentModel.hasAnyUncompiledDirtyLineBefore`), and the VM is moved to
 * each line's prefix before it runs (see the forward-reads spec).
 */

const NOTE = ["10", "20", "prev + 1", "line 1 * 3", "total above"];

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

const batch = (lines: string[]): string[] => read(newTrackedEngine().parseDocument(lines.join("\n"), { inputType: "markdown" }));

/** A fresh evaluator over `lines`, given to `body`, and retired afterwards. */
function withEditor<T>(lines: string[], body: (doc: DocumentModel, evaluator: ThreeTierEvaluator) => T): T {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	try {
		return body(doc, evaluator);
	} finally {
		evaluator.dispose();
	}
}

/** The answers a pass shows for the lines of `viewport`. */
function inView(pass: { lines: EvalLineResult[] }, viewport: ViewportRange): string[] {
	return pass.lines.filter((l) => l.lineNumber >= viewport.startLine && l.lineNumber <= viewport.endLine).map(shownLine);
}

describe("the reported document", () => {
	const viewport = { startLine: 3, endLine: 5 };

	test("the batch pass answers it", () => {
		expect(batch(NOTE)).toEqual(["10", "20", "21", "30", "81"]);
	});

	test("a first evaluate with the viewport below line 1 answers what the batch pass answers", () => {
		withEditor(NOTE, (_doc, evaluator) => {
			expect(inView(evaluator.evaluate(viewport), viewport)).toEqual(["21", "30", "81"]);
		});
	});

	test("a first setViewport does too, by running from line 1", () => {
		withEditor(NOTE, (_doc, evaluator) => {
			expect(inView(evaluator.setViewport(viewport), viewport)).toEqual(["21", "30", "81"]);
		});
	});

	test("an edit above the viewport reaches the positional readers in it", () => {
		withEditor(NOTE, (doc, evaluator) => {
			evaluator.evaluate(viewport);
			doc.editLine(2, "40");
			expect(inView(evaluator.evaluate(viewport), viewport)).toEqual(batch(doc.getAllLines().map((l) => l.text)).slice(2));
		});
	});

	test("a clean definition above the viewport is read at its own line, not the last one written", () => {
		const lines = [":x = 1", "x + 100", ":x = 99"];
		withEditor(lines, (doc, evaluator) => {
			evaluator.evaluate({ startLine: 1, endLine: 3 });
			expect(inView(evaluator.evaluate({ startLine: 2, endLine: 2 }), { startLine: 2, endLine: 2 })).toEqual(["101"]);
			doc.editLine(2, "x + 200");
			expect(inView(evaluator.evaluate({ startLine: 2, endLine: 2 }), { startLine: 2, endLine: 2 })).toEqual(["201"]);
			expect(inView(evaluator.setViewport({ startLine: 2, endLine: 2 }), { startLine: 2, endLine: 2 })).toEqual(["201"]);
		});
	});

	test("the dirty lines above the viewport run as Tier 1 and are not reported", () => {
		withEditor(NOTE, (_doc, evaluator) => {
			const pass = evaluator.evaluate(viewport);
			expect(pass.lines.slice(0, 2).map((l) => l.tier)).toEqual([EvalTier.Tier1, EvalTier.Tier1]);
			expect([...pass.resultMap.keys()]).toEqual([3, 4, 5]);
		});
	});
});

describe("the three entry points", () => {
	test("evaluateLine has no document for the positional forms and says so", () => {
		for (const line of ["prev + 1", "line 1 * 3", "total above"]) {
			const outcome = expectHonestLine(line);
			expect(outcome.kind === "error" || outcome.kind === "thrown").toBe(true);
		}
	});

	test("parseDocument, evaluateDocument and a viewport below line 1 agree value for value", () => {
		const docs = [NOTE, ["# Costs", "10", "20", "total above", "prev * 2"], ["1 #a", "2 #a", "total of #a", "line 3 + 1"]];
		for (const lines of docs) {
			const answers = batch(lines);
			expect(read(evaluateDocument(newTrackedEngine(), lines.join("\n")))).toEqual(answers);
			for (let start = 2; start <= lines.length; start++) {
				const viewport = { startLine: start, endLine: lines.length };
				withEditor(lines, (_doc, evaluator) => {
					expect(inView(evaluator.evaluate(viewport), viewport)).toEqual(answers.slice(start - 1));
				});
				withEditor(lines, (_doc, evaluator) => {
					expect(inView(evaluator.setViewport(viewport), viewport)).toEqual(answers.slice(start - 1));
				});
			}
		}
	});
});

describe("the parts: a line nothing has compiled yet", () => {
	test("ordinary: a fresh document counts, and a compiled one does not", () => {
		const doc = new DocumentModel();
		doc.setDocument("10\n20\nprev + 1");
		expect(doc.hasAnyUncompiledDirtyLineBefore(3)).toBe(true);
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		expect(doc.hasAnyUncompiledDirtyLineBefore(4)).toBe(false);
		doc.editLine(1, "11");
		expect(doc.hasAnyUncompiledDirtyLineBefore(2)).toBe(true);
		expect(doc.hasAnyUncompiledDirtyLineBefore(1)).toBe(false);
		evaluator.dispose();
	});

	test("boundary: a blank line never counts, and a line whose program was evicted keeps its expressions", () => {
		const doc = new DocumentModel();
		doc.setDocument("\n  \n5");
		expect(doc.hasAnyUncompiledDirtyLineBefore(3)).toBe(false);
		expect(doc.hasAnyUncompiledDirtyLineBefore(4)).toBe(true);
		const line3 = doc.getLineAt(3)!;
		doc.updateLineCompiled(line3.lineId, ["5"], [], [], [], false, 0);
		expect(doc.hasAnyUncompiledDirtyLineBefore(4)).toBe(false);
	});

	test("hostile: a position that is not a line answers false", () => {
		const doc = new DocumentModel();
		doc.setDocument("5\n6");
		expect(doc.hasAnyUncompiledDirtyLineBefore(Number.NaN)).toBe(false);
		expect(doc.hasAnyUncompiledDirtyLineBefore(-3)).toBe(false);
		expect(doc.hasAnyUncompiledDirtyLineBefore(Number.POSITIVE_INFINITY)).toBe(true);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a %s definition above the viewport is read at its own line", (word) => {
		expectPrototypeUntouched(() => {
			const lines = [`:${word} = 1`, `${word} + 1`, `:${word} = 9`, "prev * 2"];
			const answers = batch(lines);
			withEditor(lines, (_doc, evaluator) => {
				expect(inView(evaluator.evaluate({ startLine: 2, endLine: 4 }), { startLine: 2, endLine: 4 })).toEqual(answers.slice(1));
			});
		});
	});

	test("a viewport at the bottom of three thousand lines answers the positional forms within budget", () => {
		const lines = [...Array.from({ length: 3_000 }, (_, i) => String(i % 7)), "prev + 1", "line 1 + 1"];
		withEditor(lines, (_doc, evaluator) => {
			const started = performance.now();
			const viewport = { startLine: 3_001, endLine: 3_002 };
			const view = inView(evaluator.evaluate(viewport), viewport);
			expect(performance.now() - started).toBeLessThan(20_000);
			expect(view).toEqual(["4", "1"]);
		});
	});

	test("a viewport of hostile numbers is refused rather than thrown", () => {
		withEditor(NOTE, (_doc, evaluator) => {
			for (const viewport of [{ startLine: Number.NaN, endLine: 5 }, { startLine: 3, endLine: Number.NaN }, { startLine: -10, endLine: 2 }, { startLine: 9, endLine: 1 }]) {
				expect(() => evaluator.evaluate(viewport)).not.toThrow();
				expect(() => evaluator.setViewport(viewport)).not.toThrow();
			}
		});
	});
});

describe("adversarial: realistic breakage", () => {
	test("scrolling down and back up keeps every answer the batch pass gives", () => {
		const lines = [":x = 1", "prev + 1", ":x = x + 10", "x * 2", "line 2 * 3", ":x = 50", "x", "total above"];
		const answers = batch(lines);
		withEditor(lines, (_doc, evaluator) => {
			evaluator.evaluate({ startLine: 1, endLine: 3 });
			for (const viewport of [{ startLine: 4, endLine: 6 }, { startLine: 6, endLine: 8 }, { startLine: 2, endLine: 4 }, { startLine: 7, endLine: 8 }, { startLine: 1, endLine: 8 }]) {
				expect(inView(evaluator.setViewport(viewport), viewport)).toEqual(answers.slice(viewport.startLine - 1, viewport.endLine));
			}
		});
	});

	test("a structural edit above the viewport, then a pass over the viewport", () => {
		withEditor(NOTE, (doc, evaluator) => {
			evaluator.evaluate({ startLine: 1, endLine: 5 });
			evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["5"] }]);
			const viewport = { startLine: 4, endLine: 6 };
			expect(inView(evaluator.evaluate(viewport), viewport)).toEqual(batch(doc.getAllLines().map((l) => l.text)).slice(3));
		});
	});

	test("a running total above the viewport is not counted twice", () => {
		const lines = ["spent += 10", "spent += 20", "prev", "spent"];
		withEditor(lines, (_doc, evaluator) => {
			for (let i = 0; i < 3; i++) expect(inView(evaluator.evaluate({ startLine: 3, endLine: 4 }), { startLine: 3, endLine: 4 })).toEqual(["30", "30"]);
			expect(inView(evaluator.setViewport({ startLine: 3, endLine: 4 }), { startLine: 3, endLine: 4 })).toEqual(["30", "30"]);
		});
	});
});

describe("adversarial: edge cases", () => {
	// An inline solve's answer is reported beside the line by the batch pass and
	// as the line's own by a live pass, so those documents are compared elsewhere.
	test.each(DOCUMENT_EDGES.filter((text) => !text.includes("s`")).map((text) => [JSON.stringify(text), text]))("%s through a viewport starting at line 2", (_label, text) => {
		const answers = read(newTrackedEngine().parseDocument(text));
		const doc = new DocumentModel();
		doc.setDocument(text);
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			const viewport = { startLine: 2, endLine: doc.lineCount };
			expect(inView(evaluator.evaluate(viewport), viewport)).toEqual(answers.slice(1));
		} finally {
			evaluator.dispose();
		}
	});

	test("a viewport past the end of the note runs every line and reports none", () => {
		withEditor(NOTE, (doc, evaluator) => {
			const pass = evaluator.evaluate({ startLine: 10, endLine: 20 });
			expect(pass.resultMap.size).toBe(0);
			expect(doc.getAllLines().map((l) => (l.result ? formatValue(l.result).replace(/^=\s*/, "") : ""))).toEqual(batch(NOTE));
		});
	});
});
