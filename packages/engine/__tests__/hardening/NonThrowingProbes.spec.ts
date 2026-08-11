/**
 * `tryCompileExpression()` answers "does this compile" with a boolean, and
 * `LanguageService` calls it for every visible line on every keystroke to
 * decide what to highlight. A throw from it does not land in a caller that is
 * looking for one: in the Obsidian plugin it reaches CodeMirror's transaction
 * dispatch and takes the editor down mid-edit.
 *
 * The reported case was clearing a document that contained `hello =`. That
 * shape is not exotic. It is what every assignment looks like for the moment
 * between typing the `=` and typing the value, so the crash was reachable by
 * typing an assignment at ordinary speed.
 *
 * `evaluateExpression()` is a separate contract: it is documented `@throws`
 * and is asserted below to keep throwing, so this file cannot be read as
 * saying that malformed input is now silently fine.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Every line a caller could be part-way through typing. */
const HALF_TYPED = [
	"hello =",
	"hello=",
	"x = ",
	"total =",
	"a*b =",
	"f(x) =",
	"my note =",
	"2 +",
	"1 -",
	"1 *",
	"1 /",
	"1 ^",
	"(((",
	"[1,2",
	"foo(",
	"= 5",
	"==",
	"* 5",
	")",
	"a, b =",
	// Shrunk by the fuzzer once the invariant existed, from cases that looked
	// nothing like these. Both threw from the lexer, before the parser was
	// reached at all, which is why fixing the symbolic grammar alone left them.
	'"',
	"der(",
	'say "hi',
	"'",
];

describe("tryCompileExpression() returns rather than throws", () => {
	test.each(HALF_TYPED)("%j returns a boolean", (source) => {
		const engine = newTrackedEngine("en");
		expect(typeof engine.tryCompileExpression(source)).toBe("boolean");
	});

	test("an assignment with an empty right-hand side does not compile", () => {
		// The reported crash. `false` rather than a throw is the whole fix: the
		// line genuinely does not compile, and saying so is the correct answer.
		const engine = newTrackedEngine("en");
		expect(engine.tryCompileExpression("hello =")).toBe(false);
	});

	test("the same line still compiles once it is finished", () => {
		// Guards against fixing the crash by making the grammar decline the
		// shape outright, which would stop assignments working.
		const engine = newTrackedEngine("en");
		expect(engine.tryCompileExpression("hello = 5")).toBe(true);
	});
});

describe("the throwing contract is unchanged", () => {
	test("evaluateExpression() still throws on the same input", () => {
		// Documented `@throws {EngineError}`, and the plugin's own tests rely
		// on it. Only the boolean probe was wrong.
		const engine = newTrackedEngine("en");
		expect(() => engine.evaluateExpression("hello =")).toThrow();
	});
});
