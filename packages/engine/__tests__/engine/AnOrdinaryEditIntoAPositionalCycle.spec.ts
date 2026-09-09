/**
 * An ordinary edit into a positional cycle reports the cycle.
 *
 * Two lines that read each other's positions have no settled value, because
 * each is computed from the other. Reached from scratch, neither has a value to
 * start from, so each reports the other and stays there. Reached by editing one
 * line's text, one of them already held a number, the other read it, and the
 * pair chased those numbers for as long as the document was open:
 *
 * | document                          | action                      | before                      | now                   |
 * | ---                               | ---                         | ---                         | ---                   |
 * | `1 sprint = 2 weeks` / `prev + 5` | edit line 1 to `line 2 + 5` | a number, ten larger a pass | `Line 2 has an error` |
 *
 * The insert and delete half was fixed first (2.38.19), keyed to the one moment
 * the document's shape provably changed. An ordinary edit moves no position, and
 * every rule tried for it that changed what a positional read returns, or when
 * an answer is thrown away, traded this for a disagreement of the same size
 * somewhere else. Two things were wrong, and both were in the graph rather than
 * in any read:
 *
 * - A positional edge outlived the text that read it. An edge is discovered
 *   while the line runs and pinned, so a position the line stopped reading
 *   could not be discovered at all: `prev + 1` edited to `7` still read line 1
 *   as far as the graph knew, and `total above` kept its edges to the lines
 *   above a heading that had cut its block short. Anything consulting the graph
 *   was told what a line used to read, so cycles that had been edited away were
 *   found, and a cycle re-closed by removing the heading was nothing new. Now an
 *   edited line's positions go before it runs, and a run cuts them back to what
 *   it read.
 * - Nothing took a stale number off a cycle. A pass from scratch has every
 *   member holding an error by the time the cycle closes, because some member
 *   reads a line below it that has not run yet, and every positional form
 *   answers an unread or errored line with an error, all the way round. A
 *   number on a member is the one thing a settled pass never holds. Now, at the
 *   end of a pass in which a line recorded a position it had not recorded, the
 *   cycles through those lines are found once, and each member holding a
 *   number is forgotten and marked to run again, which leaves the members
 *   where a pass from scratch has them before they first run.
 *
 * The walk is skipped while no edge points downwards (a cycle needs one, and a
 * document of `prev` and `above` has none), and it is one pass over the graph
 * however many lines gained an edge, so a column of `prev + 1` stays linear on
 * the pass after an insert.
 *
 * The boundary: a cycle through a *name* (`:a = line 2 + 1` above `a + 1`) is
 * not walked. The positional graph does not hold it, and taking it apart would
 * also mean undefining the members' variables and their checkpoint entries. The
 * fuzz generator emits only literal definitions, so it cannot reach the shape;
 * it is pinned at the end so a change to either can be seen here.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";

/** One line's answer, as a reader sees it. */
function shown(doc: DocumentModel, lineNumber: number): string {
	const result = doc.getLineAt(lineNumber)?.result;
	return result ? formatValue(result).replace(/^=\s*/, "") : "";
}

const answersOf = (doc: DocumentModel, count: number) =>
	Array.from({ length: count }, (_, i) => shown(doc, i + 1));

/**
 * What a settled pass over this text gives, with no editing history, and how
 * many passes it took to stop changing: the same rule the differential fuzz
 * settles its oracle by, a pass equal to the one before it.
 */
function settle(lines: string[]): { answers: string[]; passes: number } {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	let previous: string[] = [];
	let passes = 0;
	for (let pass = 0; pass < 12; pass++) {
		evaluator.evaluate({ startLine: 1, endLine: lines.length });
		passes++;
		const current = answersOf(doc, lines.length);
		if (pass > 0 && current.every((answer, i) => answer === previous[i])) break;
		previous = current;
	}
	const answers = answersOf(doc, lines.length);
	evaluator.terminateWorker();
	return { answers, passes };
}

const settled = (lines: string[]) => settle(lines).answers;

function editorFor(lines: string[]) {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
	for (let pass = 0; pass < 4; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return { doc, evaluator };
}

/** Edit one line and run the passes an editor would, then hand back the text as it now stands. */
function edit(session: ReturnType<typeof editorFor>, lines: string[], lineNumber: number, text: string, passes = 4): string[] {
	session.doc.editLine(lineNumber, text);
	const now = [...lines];
	now[lineNumber - 1] = text;
	for (let pass = 0; pass < passes; pass++) session.evaluator.evaluate({ startLine: 1, endLine: now.length });
	return now;
}

/** The answers after eight more passes are the answers now: the document is still. */
function expectStill(session: ReturnType<typeof editorFor>, count: number): void {
	const before = answersOf(session.doc, count);
	for (let pass = 0; pass < 8; pass++) session.evaluator.evaluate({ startLine: 1, endLine: count });
	expect(answersOf(session.doc, count)).toEqual(before);
}

describe("an ordinary edit that closes a cycle", () => {
	test("editing the reader above reports the cycle, as a pass over the text does", () => {
		// The shape the fuzzer shrank to (seed 27000208), and the issue's own.
		const session = editorFor(["1 sprint = 2 weeks", "prev + 5"]);
		const text = edit(session, ["1 sprint = 2 weeks", "prev + 5"], 1, "line 2 + 5");

		expect(answersOf(session.doc, 2)).toEqual(settled(text));
		expect(answersOf(session.doc, 2)).toEqual(["Line 2 has an error", "Line 1 has an error"]);
		expectStill(session, 2);
		session.evaluator.terminateWorker();
	});

	test("editing the reader below reports it too", () => {
		const session = editorFor(["line 2 + 1", "7"]);
		expect(shown(session.doc, 1)).toBe("8");
		const text = edit(session, ["line 2 + 1", "7"], 2, "line 1 + 1");

		expect(answersOf(session.doc, 2)).toEqual(settled(text));
		expect(answersOf(session.doc, 2)).toEqual(["Line 2 has an error", "Line 1 has an error"]);
		session.evaluator.terminateWorker();
	});

	test("a cycle of three", () => {
		const session = editorFor(["7", "line 1 + 1", "line 2 + 1"]);
		const text = edit(session, ["7", "line 1 + 1", "line 2 + 1"], 1, "line 3 + 1");

		expect(answersOf(session.doc, 3)).toEqual(settled(text));
		expect(answersOf(session.doc, 3)).toEqual(["Line 3 has an error", "Line 1 has an error", "Line 2 has an error"]);
		expectStill(session, 3);
		session.evaluator.terminateWorker();
	});

	test("a cycle through an above aggregate", () => {
		// The aggregate covers the edited line, and the edited line reads the
		// aggregate. The two amounts in between are not on the cycle and keep
		// their answers.
		const session = editorFor(["9", "3", "5", "total above"]);
		const text = edit(session, ["9", "3", "5", "total above"], 1, "line 4 + 1");

		expect(answersOf(session.doc, 4)).toEqual(settled(text));
		expect(answersOf(session.doc, 4)).toEqual(["Line 4 has an error", "3", "5", "Line 1 has an error"]);
		session.evaluator.terminateWorker();
	});

	test("a cycle through a range", () => {
		const session = editorFor(["10", "", "5", "line 1 + 1"]);
		const text = edit(session, ["10", "", "5", "line 1 + 1"], 1, "sum(line 3 : line 4)");

		expect(answersOf(session.doc, 4)).toEqual(settled(text));
		expect(answersOf(session.doc, 4)).toEqual(["Line 4 has an error", "", "5", "Line 1 has an error"]);
		session.evaluator.terminateWorker();
	});

	test("a cycle through a category tag", () => {
		// `count of` included: every tag aggregate reads its members through the
		// same check, so a member with no answer yet, or an error, is an error.
		for (const aggregate of ["total of #t", "average of #t", "count of #t"]) {
			const session = editorFor(["7 #t", aggregate]);
			const text = edit(session, ["7 #t", aggregate], 1, "line 2 + 1 #t");

			expect(answersOf(session.doc, 2)).toEqual(settled(text));
			expect(answersOf(session.doc, 2)).toEqual(["Line 2 has an error", "Line 1 has an error"]);
			session.evaluator.terminateWorker();
		}
	});

	test("retargeting a reference into a cycle", () => {
		const session = editorFor(["line 3 + 5", "prev + 5", "9"]);
		expect(answersOf(session.doc, 3)).toEqual(["14", "19", "9"]);
		const text = edit(session, ["line 3 + 5", "prev + 5", "9"], 1, "line 2 + 5");

		expect(answersOf(session.doc, 3)).toEqual(settled(text));
		expect(answersOf(session.doc, 3)).toEqual(["Line 2 has an error", "Line 1 has an error", "9"]);
		session.evaluator.terminateWorker();
	});
});

describe("a cycle through a goal seek", () => {
	test("a target edited to read the seek back reports the cycle", () => {
		// The seek reads its target through its own closures rather than through
		// `line N`, and used to take no edge for it, so this cycle was invisible
		// to the walk: the edited side settled to a number where a pass over the
		// same text reports the cycle on both lines.
		const session = editorFor([":v1 = 7", "v1 + 1", "solve line 2 for v1 = 27"]);
		expect(answersOf(session.doc, 3)).toEqual(["7", "8", "26"]);
		const text = edit(session, [":v1 = 7", "v1 + 1", "solve line 2 for v1 = 27"], 2, "line 3 + v1", 6);

		expect(answersOf(session.doc, 3)).toEqual(settled(text));
		expect(answersOf(session.doc, 3)).toEqual(["7", "Line 3 has an error", "Line 3 has an error"]);
		expectStill(session, 3);
		session.evaluator.terminateWorker();
	});

	test("a seek edited in below a target that reads it", () => {
		const session = editorFor([":v1 = 7", "line 3 + v1", "9"]);
		const text = edit(session, [":v1 = 7", "line 3 + v1", "9"], 3, "solve line 2 for v1 = 27", 6);

		expect(answersOf(session.doc, 3)).toEqual(settled(text));
		expect(answersOf(session.doc, 3)).toEqual(["7", "Line 3 has an error", "Line 3 has an error"]);
		session.evaluator.terminateWorker();
	});
});

describe("a cycle that comes and goes", () => {
	test("breaking a cycle by editing a member recovers both lines", () => {
		const session = editorFor(["line 2 + 5", "prev + 5"]);
		expect(shown(session.doc, 1)).toContain("error");
		const text = edit(session, ["line 2 + 5", "prev + 5"], 2, "12");

		expect(answersOf(session.doc, 2)).toEqual(settled(text));
		expect(answersOf(session.doc, 2)).toEqual(["17", "12"]);
		session.evaluator.terminateWorker();
	});

	test("a reader is not stranded when the cycle it was on is broken", () => {
		// The two shapes an earlier attempt stranded, at `Line N has not been
		// evaluated yet` for ever: the breaking edit dropped the member's
		// positions in the document but not in the graph, so the graph went on
		// seeing the cycle and resetting it every pass.
		const travel = editorFor(["total of #travel", "line 1 + 1 #travel"]);
		const travelText = edit(travel, ["total of #travel", "line 1 + 1 #travel"], 2, "12 #travel");
		expect(answersOf(travel.doc, 2)).toEqual(settled(travelText));
		expect(answersOf(travel.doc, 2)).toEqual(["12", "12"]);
		travel.evaluator.terminateWorker();

		const four = editorFor(["1", "line 4 + 5", "2", "line 2 + 5"]);
		const fourText = edit(four, ["1", "line 4 + 5", "2", "line 2 + 5"], 4, "12 #travel");
		expect(answersOf(four.doc, 4)).toEqual(settled(fourText));
		expect(answersOf(four.doc, 4)).toEqual(["1", "17", "2", "12"]);
		four.evaluator.terminateWorker();
	});

	test("a block that shrinks under a heading drops the edges above it", () => {
		// The aggregate is never edited, so nothing but its own run can say it
		// stopped reading lines 1 and 2. With the old edges kept, editing line 1
		// found a cycle that the heading had broken and cost a pass; with them
		// gone it is an ordinary reference.
		const session = editorFor(["line 4 + 1", "3", "5", "total above"]);
		let text = edit(session, ["line 4 + 1", "3", "5", "total above"], 2, "# a heading");
		expect(answersOf(session.doc, 4)).toEqual(settled(text));
		expect(answersOf(session.doc, 4)).toEqual(["6", "", "5", "5"]);

		text = edit(session, text, 1, "line 4 + 2");
		expect(answersOf(session.doc, 4)).toEqual(settled(text));
		expect(answersOf(session.doc, 4)).toEqual(["7", "", "5", "5"]);
		expectStill(session, 4);
		session.evaluator.terminateWorker();
	});

	test("a cycle re-closed through a reader that was never edited", () => {
		// The heading breaks the cycle and its removal re-closes it, and the
		// aggregate's text is the same throughout. Its edges to lines 1 and 2
		// have to be new to the graph on the re-closing run for the cycle to be
		// noticed, which they are only because the shrinking run dropped them.
		const session = editorFor(["line 4 + 1", "5", "3", "total above"]);
		let text = edit(session, ["line 4 + 1", "5", "3", "total above"], 2, "# a heading");
		expect(answersOf(session.doc, 4)).toEqual(["4", "", "3", "3"]);

		text = edit(session, text, 2, "5");
		expect(answersOf(session.doc, 4)).toEqual(settled(text));
		expect(answersOf(session.doc, 4)).toEqual(["Line 4 has an error", "5", "3", "Line 1 has an error"]);
		expectStill(session, 4);
		session.evaluator.terminateWorker();
	});

	test("a structural edit after the cycle still agrees", () => {
		const session = editorFor(["1 sprint = 2 weeks", "prev + 5"]);
		const text = edit(session, ["1 sprint = 2 weeks", "prev + 5"], 1, "line 2 + 5");
		session.evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["9"] }]);
		const inserted = ["9", ...text];
		for (let pass = 0; pass < 4; pass++) session.evaluator.evaluate({ startLine: 1, endLine: 3 });

		expect(answersOf(session.doc, 3)).toEqual(settled(inserted));
		session.evaluator.terminateWorker();
	});
});

describe("what is left alone", () => {
	test("a plain forward reference is still tolerated", () => {
		// The incremental path reads a line below on the next pass; that is
		// not a cycle and is not touched.
		const session = editorFor(["5", "7"]);
		const text = edit(session, ["5", "7"], 1, "line 2 + 1");

		expect(answersOf(session.doc, 2)).toEqual(settled(text));
		expect(answersOf(session.doc, 2)).toEqual(["8", "7"]);
		session.evaluator.terminateWorker();
	});

	test("retargeting a reference out of a cycle", () => {
		const session = editorFor(["line 2 + 5", "prev + 5", "9"]);
		const text = edit(session, ["line 2 + 5", "prev + 5", "9"], 1, "line 3 + 5");

		expect(answersOf(session.doc, 3)).toEqual(settled(text));
		expect(answersOf(session.doc, 3)).toEqual(["14", "19", "9"]);
		session.evaluator.terminateWorker();
	});

	test("an ordinary edit to what a reader reads keeps the reader's answer", () => {
		const session = editorFor(["10", "20", "total above", "line 3 + 1"]);
		const text = edit(session, ["10", "20", "total above", "line 3 + 1"], 1, "15");

		expect(answersOf(session.doc, 4)).toEqual(settled(text));
		expect(shown(session.doc, 4)).toBe("36");
		session.evaluator.terminateWorker();
	});
});

describe("a pass from scratch is unchanged", () => {
	// The specification is the from-scratch answer, so the reset must never
	// fire there: every member holds an error when the cycle closes. Answers
	// and pass counts are pinned so a later change to the reset cannot move
	// the thing it is measured against.
	const shapes: { lines: string[]; answers: string[]; passes: number }[] = [
		{ lines: ["line 2 + 5", "prev + 5"], answers: ["Line 2 has an error", "Line 1 has an error"], passes: 3 },
		{
			lines: ["line 3 + 1", "line 1 + 1", "line 2 + 1"],
			answers: ["Line 3 has an error", "Line 1 has an error", "Line 2 has an error"],
			passes: 3,
		},
		{ lines: ["line 4 + 1", "3", "5", "total above"], answers: ["Line 4 has an error", "3", "5", "Line 1 has an error"], passes: 3 },
		{
			lines: ["sum(line 3 : line 4)", "", "5", "line 1 + 1"],
			answers: ["Line 4 has an error", "", "5", "Line 1 has an error"],
			passes: 3,
		},
		{ lines: ["total of #travel", "line 1 + 1 #travel"], answers: ["Line 2 has an error", "Line 1 has an error"], passes: 3 },
		{ lines: ["line 2 + 1", "7"], answers: ["8", "7"], passes: 3 },
		{
			lines: ["average above", "line 1 + 2"],
			answers: ["No lines above to aggregate (hit the top of the document, a blank line, or a heading immediately)", "Line 1 has an error"],
			passes: 2,
		},
		{
			lines: [":v1 = 7", "line 3 + v1", "solve line 2 for v1 = 27"],
			answers: ["7", "Line 3 has an error", "Line 3 has an error"],
			passes: 3,
		},
	];

	for (const shape of shapes) {
		test(`${JSON.stringify(shape.lines)} settles in ${shape.passes} passes`, () => {
			expect(settle(shape.lines)).toEqual({ answers: shape.answers, passes: shape.passes });
		});
	}
});

describe("the boundary", () => {
	test("a cycle through a name is not walked", () => {
		// `:a = line 2 + 1` reads line 2's position; `a + 1` reads the name `a`,
		// not a position, so the positional graph holds no cycle. A pass over
		// the text reports one, and the edited document keeps chasing. Pinned
		// rather than fixed: the fuzz generator emits only literal definitions,
		// so this is not a shape it can reach, and if either changes this is
		// where it shows.
		expect(settled([":a = line 2 + 1", "a + 1"])).toEqual(["Line 2 has an error", "Line 2 has an error"]);

		const session = editorFor([":a = 7", "a + 1"]);
		edit(session, [":a = 7", "a + 1"], 1, ":a = line 2 + 1");
		expect(shown(session.doc, 1)).not.toContain("error");
		session.evaluator.terminateWorker();
	});
});
