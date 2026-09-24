/**
 * Highlighting a line never changes what the document holds (#559).
 *
 * The language service decides whether to colour a line by asking the engine
 * whether it parses, through `tryCompileExpression`. Some lines do their work
 * while being compiled rather than by leaving bytecode behind, and that check
 * used to do the work too, so reading a line for colour ran it:
 *
 * | document, then highlighted                       | what it changed, before                | now       |
 * | ---                                              | ---                                    | ---       |
 * | `total += 5`, its line highlighted once          | `total` 10                             | `total` 5 |
 * | `total += 5`, its line highlighted four times    | `total` 25                             | `total` 5 |
 * | `total += 5`, then `total += prev` highlighted   | `total` a `LINE_REF_NO_DOCUMENT` error | `total` 5 |
 * | anything, then `z = 2 + 2` highlighted           | `z` defined as 4                       | nothing   |
 * | anything, then `w^2 - 4 = 0` highlighted         | an equation stored for `w`             | nothing   |
 * | `1 sprint = 3 weeks` / `3 sprints in weeks`, line 1 highlighted then deleted | line 1 still answers `9 weeks` | `Undefined variable: sprints` |
 *
 * The last row is the quiet one. Checking a unit definition re-registered the
 * unit as owned by no line (id -1), so deleting its real line no longer removed
 * it, and the conversion below went on answering from a definition the
 * document no longer contained.
 *
 * Now those shapes are matched and their operands compiled, and nothing runs or
 * is stored. The tests below highlight, complete and check every kind of line
 * that changes something when it runs, several times over, under both a batch
 * pass and a live editor, and compare every variable, running total, function,
 * equation, user unit, cached line result and dependency edge before and after.
 *
 * The boundary: `compileExpression` still applies a line's effect, because the
 * incremental evaluator compiles through it and relies on that. Only the check
 * is read-only.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import {
	STATE_CHANGING_LINES,
	answersOf as answers,
	openBatch as batch,
	openEditor as editor,
	stateOf,
} from "@tools/readOnlyHarness";

/**
 * Every read-only call the language service makes on a line, the way an editor
 * makes them: highlighting at more than one line number, both highlighting
 * modes, a completion at every caret position, and the check itself.
 */
function readRepeatedly(engine: ExpressionEngine, line: string, rounds = 3): void {
	const plain = new LanguageService(engine);
	const normalized = new LanguageService(engine, { normalizeForHighlighting: true });
	for (let round = 0; round < rounds; round++) {
		plain.invalidateCache();
		normalized.invalidateCache();
		for (const lineNumber of [1, 2, 40]) {
			plain.getSemanticTokens(line, lineNumber);
			normalized.getSemanticTokens(line, lineNumber);
		}
		for (let caret = 0; caret <= line.length; caret++) plain.getCompletions(line, caret);
		engine.tryCompileExpression(line);
	}
}

describe.each([
	["after a batch pass", () => batch()],
	["under a live editor", () => editor()],
])("highlighting changes nothing %s", (_setup, open) => {
	test.each(STATE_CHANGING_LINES)("%s: %s", (_kind, line) => {
		const session = open();
		try {
			const before = stateOf(session.engine, session.doc);
			readRepeatedly(session.engine, line);
			expect(stateOf(session.engine, session.doc)).toEqual(before);
		} finally {
			session.dispose();
		}
	});

	test("every state-changing line, one after another, changes nothing either", () => {
		const session = open();
		try {
			const before = stateOf(session.engine, session.doc);
			for (const [, line] of STATE_CHANGING_LINES) readRepeatedly(session.engine, line, 2);
			expect(stateOf(session.engine, session.doc)).toEqual(before);
		} finally {
			session.dispose();
		}
	});
});

describe("the issue's own session", () => {
	test("a running total stays at 5 however often its line is highlighted", () => {
		const engine = createEngine() as unknown as ExpressionEngine;
		try {
			engine.parseDocument("total += 5");
			const service = new LanguageService(engine);
			service.getSemanticTokens("total += 5", 1);
			service.getSemanticTokens("total += 5", 1);
			for (let i = 0; i < 5; i++) {
				service.invalidateLines([1]);
				service.getSemanticTokens("total += 5", 1);
			}
			expect(engine.evaluateExpression("total").toNumber()).toBe(5);
		} finally {
			engine.clear();
		}
	});
});

describe("what a live editor shows after highlighting", () => {
	/** What a settled pass over this text gives, with no highlighting at all. */
	function settled(lines: string[]): string[] {
		const session = editor(lines);
		try {
			return answers(session.doc);
		} finally {
			session.dispose();
		}
	}

	test("a highlighted unit definition still goes when its line is deleted", () => {
		// The highlight used to re-register the unit as owned by line id -1, so
		// the delete, which drops what the deleted line owned, found nothing.
		const session = editor(["1 sprint = 3 weeks", "3 sprints in weeks"]);
		try {
			expect(answers(session.doc)).toEqual(["sprint defined", "9 weeks"]);
			readRepeatedly(session.engine, "1 sprint = 3 weeks");

			session.evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
			for (let pass = 0; pass < 3; pass++) session.evaluator.evaluate({ startLine: 1, endLine: 1 });

			expect(answers(session.doc)).toEqual(settled(["3 sprints in weeks"]));
			expect(answers(session.doc)[0]).toContain("Undefined variable: sprints");
		} finally {
			session.dispose();
		}
	});

	test("a highlighted running total leaves the document answering as a fresh pass does", () => {
		const lines = ["total += 5", "total += 2", "total * 10"];
		const session = editor(lines);
		try {
			for (const line of lines) readRepeatedly(session.engine, line);
			expect(session.engine.evaluateExpression("total").toNumber()).toBe(7);

			session.doc.editLine(3, "total * 100");
			for (let pass = 0; pass < 3; pass++) session.evaluator.evaluate({ startLine: 1, endLine: 3 });
			expect(answers(session.doc)).toEqual(settled(["total += 5", "total += 2", "total * 100"]));
		} finally {
			session.dispose();
		}
	});
});

describe("the check still answers the question it is asked", () => {
	test("agrees with compileExpression on every effectful shape it now checks instead of running", () => {
		// compileExpression applies the effect, so each line gets an engine of
		// its own, and the check gets another: agreement cannot come from one
		// having set up the other.
		for (const [, line] of STATE_CHANGING_LINES) {
			const compiling = createEngine() as unknown as ExpressionEngine;
			const checking = createEngine() as unknown as ExpressionEngine;
			try {
				let compiles = true;
				try {
					compiling.compileExpression(line);
				} catch {
					compiles = false;
				}
				expect({ line, parses: checking.tryCompileExpression(line) }).toEqual({ line, parses: compiles });
			} finally {
				compiling.clear();
				checking.clear();
			}
		}
	});

	test.each([
		["total +=", false],
		["total =", false],
		["total += 3 +", false],
		["total += (", false],
		["x = 3 +", false],
		["=>", false],
		["1 sprint = 2 weeks", true],
		["w^2 - 4 = 0", true],
		["n =>", true],
	])("%s parses: %s", (line, parses) => {
		const engine = createEngine() as unknown as ExpressionEngine;
		try {
			expect(engine.tryCompileExpression(line)).toBe(parses);
		} finally {
			engine.clear();
		}
	});

	test("a running total whose step would fail still parses, the same as the expression it adds", () => {
		// Nothing runs, so the answer is about the line's form. `5 + nope` has
		// always been a well-formed line with an undefined name in it, and
		// `total += nope` is the same line with a total in front.
		const engine = createEngine() as unknown as ExpressionEngine;
		try {
			expect(engine.tryCompileExpression("5 + nope")).toBe(true);
			expect(engine.tryCompileExpression("total += nope")).toBe(true);

			const service = new LanguageService(engine);
			const painted = service.getSemanticTokens("total += nope", 1).map(t => `${"total += nope".slice(t.from, t.to)}:${t.category}`);
			expect(painted).toEqual(["total:variable", "+=:operator", "nope:variable"]);
		} finally {
			engine.clear();
		}
	});
});

describe("a running total's name is painted as a variable", () => {
	// The lexer, on its own, reads a lone `b` as the unit bit and a lone `s` as
	// seconds. The engine reads `b += 5` as adding to a variable called `b`, so
	// that is what the line is painted as.
	const paint = (service: LanguageService, line: string) =>
		service.getSemanticTokens(line, 1).map(t => `${line.slice(t.from, t.to)}:${t.category}`);

	test.each([
		["total += 5", ["total:variable", "+=:operator", "5:number"]],
		["b += 5", ["b:variable", "+=:operator", "5:number"]],
		["s -= 2 kg", ["s:variable", "-=:operator", "2:number", "kg:unit"]],
		["m += 3 m", ["m:variable", "+=:operator", "3:number", "m:unit"]],
	])("%s", (line, expected) => {
		const engine = createEngine() as unknown as ExpressionEngine;
		try {
			expect(paint(new LanguageService(engine), line)).toEqual(expected);
			expect(paint(new LanguageService(engine, { normalizeForHighlighting: true }), line)).toEqual(expected);
		} finally {
			engine.clear();
		}
	});

	test("a unit-letter name that is not a running total keeps the lexer's category", () => {
		const engine = createEngine() as unknown as ExpressionEngine;
		try {
			expect(paint(new LanguageService(engine), "5 m + 3 m")).toEqual(["5:number", "m:unit", "+:operator", "3:number", "m:unit"]);
		} finally {
			engine.clear();
		}
	});
});
