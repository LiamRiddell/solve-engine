/**
 * Explaining a line never changes what the document holds (#566).
 *
 * `explainLine` is a hover API, so a host calls it as often as the pointer
 * moves. A derivation is built from the values a line arrives at, so the line
 * has to run, and it used to run against the document's own state:
 *
 * | document, then explained three times      | before                          | now           |
 * | ---                                       | ---                             | ---           |
 * | `total += 5`, then `total += 5`           | answers 10, 15, 20; total is 20 | 10, 10, 10; total is 5 |
 * | `:x = 3`, then `:x = 30`                  | x is 30                         | x is 3        |
 * | anything, then `z = 2 + 2`                | z is 4                          | z undefined   |
 * | anything, then `w^2 - 4 = 0`              | an equation stored for `w`      | nothing       |
 * | a live editor, then `1 sprint = 3 weeks`  | every line marked dirty, the unit redefined | nothing |
 * | anything, then `global :g = 5`            | `g` 5 in every open document    | nothing       |
 *
 * Now the run happens in scratch state that is discarded: a VM that reads the
 * document's values and keeps its own writes, a global store that holds the
 * run's writes aside, a dependency graph and line context of the run's own.
 * The tests below explain every kind of line that changes something when it
 * runs, several times over, after a batch pass and under a live editor, and
 * require the engine to be exactly as it was, and each explanation to be the
 * same as the first, which is the one the line gives against the document as
 * it stands.
 *
 * The boundary: the answer is still the line's own against the current state,
 * as `evaluateExpression` would give it, not its answer at its place in the
 * document. Explaining `total += 5` with the total at 5 answers 10.
 */
import { afterEach, describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import {
	STATE_CHANGING_DOCUMENT,
	STATE_CHANGING_LINES,
	answersOf,
	openBatch,
	openEditor,
	stateOf,
	type Session,
} from "@tools/readOnlyHarness";

afterEach(() => {
	sharedGlobalVariableStore.clear();
});

/** The lines explained here: every state-changing shape, a global, a goal seek. */
const EXPLAINED_LINES: [string, string][] = [
	...STATE_CHANGING_LINES,
	["a global assignment", "global :g = 5"],
	["a goal seek", "solve line 9 for total = 100"],
	["an ordinary derivation", "2 + 3 * 4"],
	["a derivation over the document's variables", "x * 2 + y"],
];

/** The document with a global in it, so a scratch write has a value to shadow. */
const DOCUMENT = [...STATE_CHANGING_DOCUMENT, "global :g = 1"];

/** An explanation as text: every step and the result, or the error it throws. */
function explained(engine: ExpressionEngine, line: string): string {
	try {
		const explanation = engine.explainLine(line);
		const steps = explanation.steps.map(step => `${step.description} -> ${formatValue(step.value)}`);
		return [...steps, `result ${formatValue(explanation.result)}`].join("; ");
	} catch (error) {
		return `throws ${(error as Error).message}`;
	}
}

describe.each([
	["after a batch pass", () => openBatch(DOCUMENT)],
	["under a live editor", () => openEditor(DOCUMENT)],
])("explaining changes nothing %s", (_setup, open: () => Session) => {
	test.each(EXPLAINED_LINES)("%s: %s", (_kind, line) => {
		const session = open();
		try {
			const before = stateOf(session.engine, session.doc);
			const explanations = [1, 2, 3].map(() => explained(session.engine, line));
			expect(stateOf(session.engine, session.doc)).toEqual(before);
			// Each hover answers the same as the first.
			expect(explanations).toEqual([explanations[0], explanations[0], explanations[0]]);
		} finally {
			session.dispose();
		}
	});

	test("every line, one after another, changes nothing either", () => {
		const session = open();
		try {
			const before = stateOf(session.engine, session.doc);
			for (const [, line] of EXPLAINED_LINES) explained(session.engine, line);
			expect(stateOf(session.engine, session.doc)).toEqual(before);
		} finally {
			session.dispose();
		}
	});
});

describe("the issue's own session", () => {
	test("a running total stays at 5 however often its line is explained, and each explanation answers 10", () => {
		const engine = createEngine() as unknown as ExpressionEngine;
		try {
			engine.parseDocument("total += 5");
			const results = [1, 2, 3].map(() => engine.explainLine("total += 5").result.toNumber());
			expect(results).toEqual([10, 10, 10]);
			expect(engine.evaluateExpression("total").toNumber()).toBe(5);
		} finally {
			engine.clear();
		}
	});
});

describe("what an explanation answers", () => {
	test.each([
		["total += 5", "result = 10"],
		[":x = 30", "result = 30"],
		["z = 2 + 2", "result = 4"],
		["f(x) = x * 9", "result = f(x) defined"],
		["1 sprint = 3 weeks", "result = sprint defined"],
		["w^2 - 4 = 0", `result = w stored as an equation — solve with "w =>"`],
		["global :g = 5", "result = 5"],
		["2 + 3 * 4", "3 times 4 -> = 12; 2 plus 12 -> = 14; result = 14"],
		["x * 2 + y", "x times 2 -> = 6; 6 plus y -> = 9; result = 9"],
	])("%s explains as %s", (line, expected) => {
		// The answers are the ones the line gave before #566 on its first
		// explanation; only the second and later explanations changed.
		const session = openBatch(DOCUMENT);
		try {
			expect(explained(session.engine, line)).toBe(expected);
		} finally {
			session.dispose();
		}
	});

	test("agrees with evaluateExpression on an engine of its own, which does apply the line", () => {
		for (const [, line] of EXPLAINED_LINES) {
			const explaining = openBatch(DOCUMENT);
			const evaluating = openBatch(DOCUMENT);
			try {
				let evaluated: string;
				try {
					evaluated = `result ${formatValue(evaluating.engine.evaluateExpression(line))}`;
				} catch (error) {
					evaluated = `throws ${(error as Error).message}`;
				}
				const explanation = explained(explaining.engine, line);
				const result = explanation.startsWith("throws") ? explanation : explanation.slice(explanation.lastIndexOf("result "));
				expect({ line, result }).toEqual({ line, result: evaluated });
			} finally {
				explaining.dispose();
				evaluating.dispose();
				sharedGlobalVariableStore.clear();
			}
		}
	});
});

describe("state that reaches past the document", () => {
	test("an explained global is not written to the shared store, and no document is told of it", () => {
		const session = openBatch(DOCUMENT);
		let notified = 0;
		const unsubscribe = sharedGlobalVariableStore.subscribe(() => notified++);
		try {
			for (let i = 0; i < 3; i++) expect(explained(session.engine, "global :g = 5")).toBe("result = 5");
			expect(formatValue(sharedGlobalVariableStore.get("g")!)).toBe("= 1");
			expect(notified).toBe(0);
		} finally {
			unsubscribe();
			session.dispose();
		}
	});

	test("an explained unit definition leaves the live document clean and converting as before", () => {
		const session = openEditor(["1 sprint = 2 weeks", "6 sprints in weeks"]);
		try {
			expect(answersOf(session.doc)).toEqual(["sprint defined", "12 weeks"]);
			for (let i = 0; i < 3; i++) expect(explained(session.engine, "1 sprint = 3 weeks")).toBe("result = sprint defined");

			for (let n = 1; n <= session.doc.lineCount; n++) expect(session.doc.getLineAt(n)?.dirty).toBe(false);
			expect(session.engine.evaluateExpression("6 sprints in weeks").toString()).toBe(
				session.engine.evaluateExpression("12 weeks").toString(),
			);

			// Deleting the definition still removes the unit, so it is still owned
			// by its line and not by the explanation.
			session.evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
			for (let pass = 0; pass < 3; pass++) session.evaluator.evaluate({ startLine: 1, endLine: 1 });
			expect(answersOf(session.doc)[0]).toContain("Undefined variable: sprints");
		} finally {
			session.dispose();
		}
	});

	test("an explained goal seek re-runs its target without leaving an edge in the document's graph", () => {
		const session = openEditor(DOCUMENT);
		try {
			const graph = JSON.stringify(session.engine.getDag().getSnapshot());
			expect(explained(session.engine, "solve line 9 for total = 100")).toBe("result = 50");
			expect(JSON.stringify(session.engine.getDag().getSnapshot())).toBe(graph);
		} finally {
			session.dispose();
		}
	});
});
