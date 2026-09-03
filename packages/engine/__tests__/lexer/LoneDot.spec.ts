/**
 * A line holding nothing but "." is not the number zero.
 *
 * The tokeniser's one-character fast path folded the DOT character class into
 * the NUMBER arm, so a stray dot on a line of its own lexed as a number and the
 * engine answered 0 for it, while ". " and "a." (which take the main loop) were
 * refused. The two paths now agree: a lone dot is a DOT token, and the parser
 * reports it.
 */

import { describe, expect, test } from "@jest/globals";
import { Lexer } from "@solve-js/lexer/Lexer";
import { EngineError } from "@solve-js/errors/EngineError";
import { newTrackedEngine } from "@tools/trackedEngine";

describe("a lone dot", () => {
	test("lexes as DOT on the one-character path, as it does on the main path", () => {
		const alone = new Lexer("en");
		alone.reset(".");
		expect(Array.from(alone).map((t) => t.type)).toEqual(["DOT"]);

		const withSpace = new Lexer("en");
		withSpace.reset(". ");
		expect(Array.from(withSpace).map((t) => t.type)).toEqual(["DOT"]);
	});

	test("is refused rather than answered with 0", () => {
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression(".")).toThrow(EngineError);
	});

	test("a decimal fraction on the one-character path is untouched", () => {
		// The fast path only ever sees one character, so the digits stay NUMBER.
		const lexer = new Lexer("en");
		lexer.reset("5");
		expect(Array.from(lexer).map((t) => t.type)).toEqual(["NUMBER"]);
		expect(newTrackedEngine().evaluateExpression(".5").toNumber()).toBe(0.5);
	});
});
