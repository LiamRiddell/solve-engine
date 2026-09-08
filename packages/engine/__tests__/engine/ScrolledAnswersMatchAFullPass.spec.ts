/**
 * What a line says does not depend on where the viewport is.
 *
 * The evaluator re-runs part of a document on a scroll and part of it on an
 * edit, against one VM that is never reset between passes. A name written on
 * more than one line has a value per POSITION, and the VM holds whichever write
 * ran last, so a re-run read the state the document ENDS in rather than the
 * state its own line sits in:
 *
 * | `:x = 1` / `x + 100` / `:x = 99` / `x + 200` | line 2 |
 * | ---                                          | ---    |
 * | evaluated whole                              | `101`  |
 * | then scrolled to, before                      | `199`  |
 * | then scrolled to, now                         | `101`  |
 *
 * The answer changed because the reader scrolled to it. `setViewport` has always
 * asked for the state at its first line, and got nothing back, because the
 * checkpointer that reconstructs it was an optional constructor argument that
 * nothing supplied. It is built by default now.
 *
 * These drive an evaluator the way an editor does, and compare every line
 * against the same text evaluated from scratch in one pass, which is the answer
 * with no re-running in it at all.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";

/** Every line's answer, as a reader sees it. */
function answers(doc: DocumentModel, count: number): (number | undefined)[] {
	const out: (number | undefined)[] = [];
	for (let n = 1; n <= count; n++) out.push(doc.getLineAt(n)?.result?.toNumber());
	return out;
}

/** The answers a single full pass over this text gives, with nothing re-run. */
function fromScratch(lines: string[]): (number | undefined)[] {
	const engine = createEngine() as unknown as ExpressionEngine;
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	new ThreeTierEvaluator(doc, engine).evaluate({ startLine: 1, endLine: lines.length });
	return answers(doc, lines.length);
}

function editorFor(lines: string[]) {
	const engine = createEngine() as unknown as ExpressionEngine;
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine);
	evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return { doc, evaluator };
}

/** A document that defines the same names more than once, which is the case. */
const REDEFINED = [
	":x = 1",
	"x + 100",
	":rate = 2",
	"rate * 10",
	":x = 99",
	"x + 200",
	"rate + x",
	":rate = 5",
	"rate * 100",
	"x + rate",
];

describe("scrolling does not change an answer", () => {
	test("a line above a redefinition keeps its own value when scrolled to", () => {
		const { doc, evaluator } = editorFor(REDEFINED);
		const whole = answers(doc, REDEFINED.length);
		expect(whole).toEqual(fromScratch(REDEFINED));

		evaluator.setViewport({ startLine: 2, endLine: 2 });
		expect(doc.getLineAt(2)!.result!.toNumber()).toBe(101);
	});

	test("every viewport in the document agrees with a full pass", () => {
		// The general statement. Each window is scrolled to in turn, and every
		// line it covers has to still say what one uninterrupted pass says.
		const expected = fromScratch(REDEFINED);
		const { doc, evaluator } = editorFor(REDEFINED);

		for (let start = 1; start <= REDEFINED.length; start++) {
			for (let end = start; end <= REDEFINED.length; end++) {
				evaluator.setViewport({ startLine: start, endLine: end });
				for (let line = start; line <= end; line++) {
					expect([line, doc.getLineAt(line)!.result!.toNumber()]).toEqual([line, expected[line - 1]]);
				}
			}
		}
	});

	test("scrolling backwards and forwards repeatedly settles on the same answers", () => {
		const expected = fromScratch(REDEFINED);
		const { doc, evaluator } = editorFor(REDEFINED);

		for (const [start, end] of [[6, 10], [1, 4], [8, 10], [2, 3], [1, 10]] as const) {
			evaluator.setViewport({ startLine: start, endLine: end });
		}
		expect(answers(doc, REDEFINED.length)).toEqual(expected);
	});
});

describe("editing does not change an answer either", () => {
	test("an edit inside a narrow viewport agrees with a full pass over the new text", () => {
		const { doc, evaluator } = editorFor(REDEFINED);
		evaluator.setViewport({ startLine: 1, endLine: 3 });

		doc.editLine(1, ":x = 7");
		evaluator.evaluate({ startLine: 1, endLine: REDEFINED.length });

		const edited = [...REDEFINED];
		edited[0] = ":x = 7";
		expect(answers(doc, edited.length)).toEqual(fromScratch(edited));
	});

	test("editing a redefinition updates the lines below it and not the ones above", () => {
		const { doc, evaluator } = editorFor(REDEFINED);
		doc.editLine(5, ":x = 500");
		evaluator.evaluate({ startLine: 1, endLine: REDEFINED.length });

		const edited = [...REDEFINED];
		edited[4] = ":x = 500";
		expect(answers(doc, edited.length)).toEqual(fromScratch(edited));
		// Line 2 sits above the redefinition, so it is untouched.
		expect(doc.getLineAt(2)!.result!.toNumber()).toBe(101);
	});

	test("a structural edit leaves every line agreeing with a full pass", () => {
		const { doc, evaluator } = editorFor(REDEFINED);
		evaluator.applyTransaction([{ startLine: 3, deleteCount: 0, insertLines: [":x = 42", "x + 1"] }]);
		evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });

		const edited = [...REDEFINED.slice(0, 2), ":x = 42", "x + 1", ...REDEFINED.slice(2)];
		expect(answers(doc, edited.length)).toEqual(fromScratch(edited));
	});

	test("deleting a definition leaves every line agreeing with a full pass", () => {
		const { doc, evaluator } = editorFor(REDEFINED);
		// Remove the second `:rate` definition.
		evaluator.applyTransaction([{ startLine: 8, deleteCount: 1, insertLines: [] }]);
		evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });

		const edited = [...REDEFINED.slice(0, 7), ...REDEFINED.slice(8)];
		expect(answers(doc, edited.length)).toEqual(fromScratch(edited));
	});

	test("a long session of edits and scrolls never drifts", () => {
		// The strongest form: an editor's whole life in miniature, checked
		// against a from-scratch pass at every step.
		const lines = [...REDEFINED];
		const { doc, evaluator } = editorFor(lines);

		const session: Array<() => void> = [
			() => { evaluator.setViewport({ startLine: 5, endLine: 8 }); },
			() => { doc.editLine(3, ":rate = 4"); lines[2] = ":rate = 4"; },
			() => { evaluator.setViewport({ startLine: 1, endLine: 3 }); },
			() => { doc.editLine(5, ":x = 11"); lines[4] = ":x = 11"; },
			() => { evaluator.setViewport({ startLine: 7, endLine: 10 }); },
			() => { doc.editLine(1, ":x = 3"); lines[0] = ":x = 3"; },
			() => { evaluator.setViewport({ startLine: 2, endLine: 6 }); },
		];

		for (const step of session) {
			step();
			evaluator.evaluate({ startLine: 1, endLine: lines.length });
			expect(answers(doc, lines.length)).toEqual(fromScratch(lines));
		}
	});
});

describe("a pass that does not cover the whole document", () => {
	test("a viewport-limited pass does not lose the definitions below it", () => {
		// The regression that nearly shipped. A pass limited to the top of the
		// document re-records the lines it covers, and dropping everything below
		// them left `restoreTo` replaying a prefix that no longer mentioned a
		// definition further down. It RESET the VM and put back less than it
		// held, so a line at the bottom reading that definition answered
		// `Undefined variable` where it had answered a number.
		const lines: string[] = [":top = 1"];
		for (let n = 2; n <= 24; n++) lines.push("1 + 1");
		lines.push(":mid = 500");
		for (let n = 26; n <= 40; n++) lines.push("2 + 2");
		for (let n = 41; n <= 60; n++) lines.push("mid + top");

		const { doc, evaluator } = editorFor(lines);
		expect(doc.getLineAt(41)!.result!.toNumber()).toBe(501);

		// A pass over the first screen only, then a scroll to the bottom.
		doc.editLine(1, ":top = 9");
		lines[0] = ":top = 9";
		evaluator.evaluate({ startLine: 1, endLine: 20 });
		evaluator.setViewport({ startLine: 41, endLine: 60 });

		expect(doc.getLineAt(41)!.result!.toNumber()).toBe(509);
		expect(doc.getLineAt(60)!.result!.toNumber()).toBe(509);
	});

	test("the chain keeps an entry per definition through a partial pass", () => {
		const lines: string[] = [];
		for (let i = 0; i < 60; i++) lines.push(i % 5 === 0 ? `:v${i} = ${i + 1}` : `v${i - (i % 5)} + 1`);
		const { doc, evaluator } = editorFor(lines);
		const before = evaluator.getCheckpointer()!.count;
		expect(before).toBe(12);

		doc.editLine(1, ":v0 = 100");
		evaluator.evaluate({ startLine: 1, endLine: 20 });
		expect(evaluator.getCheckpointer()!.count).toBe(before);
	});
});

describe("documents with nothing to restore", () => {
	test("a document that defines nothing is unaffected", () => {
		const plain = ["1 + 1", "2 + 2", "3 + 3", "4 + 4"];
		const expected = fromScratch(plain);
		const { doc, evaluator } = editorFor(plain);

		evaluator.setViewport({ startLine: 3, endLine: 4 });
		expect(answers(doc, plain.length)).toEqual(expected);
	});

	test("a name defined once reads the same from every viewport", () => {
		const once = [":total = 10", "total + 1", "total + 2", "total + 3"];
		const expected = fromScratch(once);
		const { doc, evaluator } = editorFor(once);

		for (let start = 1; start <= once.length; start++) {
			evaluator.setViewport({ startLine: start, endLine: once.length });
			expect(answers(doc, once.length)).toEqual(expected);
		}
	});
});
