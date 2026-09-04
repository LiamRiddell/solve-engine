/**
 * Three edges of the lexer's vocabulary, hardened.
 *
 * An identifier run accepted every non-ASCII character, so `x×2` was one word
 * and an undefined variable; the symbols the scanner reads as tokens of their
 * own now end a word. A raw-line pattern written with the `g` flag carried
 * its lastIndex between lines, so every second line failed to match; the
 * lexer now keeps a flag-safe copy. And an operator the fast path could never
 * read (three characters, or a first character the scanner does not class as
 * an operator) registered without complaint and never fired; it is refused.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { newTrackedEngine } from "@tools/trackedEngine";

const types = (lexer: ExpressionLexer, input: string): string[] => {
	lexer.reset(input);
	return lexer.tokenizeAll().map((t) => t.type);
};

describe("a symbol that is a token of its own", () => {
	test("ends an identifier", () => {
		const lexer = new ExpressionLexer("en");
		expect(types(lexer, "abc×2")).toEqual(["IDENT", "STAR", "NUMBER"]);
		expect(types(lexer, "abc÷def")).toEqual(["IDENT", "SLASH", "IDENT"]);
		expect(types(lexer, "x−1")).toEqual(["IDENT", "MINUS", "NUMBER"]);
	});

	test("so a pasted product of a variable evaluates", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression(":x = 3");
		expect(engine.evaluateExpression("x×2").toNumber()).toBe(6);
	});

	test("while an accented word is still one word", () => {
		const lexer = new ExpressionLexer("en");
		expect(types(lexer, "café")).toEqual(["IDENT"]);
	});
});

describe("a raw-line pattern", () => {
	test("matches line after line whatever flags it was written with", () => {
		const lexer = new ExpressionLexer("en");
		const vocabulary = { rawLinePatterns: [{ pattern: /^say (.+)$/g, tokenType: "SAY_LINE" }] };
		lexer.registerVocabulary(vocabulary);
		expect(types(lexer, "say hello")).toEqual(["SAY_LINE"]);
		expect(types(lexer, "say hello")).toEqual(["SAY_LINE"]);
		expect(types(lexer, "say again")).toEqual(["SAY_LINE"]);

		lexer.unregisterVocabulary(vocabulary);
		expect(types(lexer, "say hello")).not.toContain("SAY_LINE");
	});
});

describe("an operator shape the scanner cannot read", () => {
	const code = (fn: () => void): string | undefined => {
		try {
			fn();
		} catch (thrown) {
			return (thrown as EngineError).code;
		}
		return undefined;
	};

	test("is refused at registration", () => {
		const lexer = new ExpressionLexer("en");
		expect(code(() => lexer.registerVocabulary({ operators: { "abc": "THREE" } }))).toBe("PLUGIN_OPERATOR_UNSUPPORTED");
		expect(code(() => lexer.registerVocabulary({ operators: { "a>": "WORDY" } }))).toBe("PLUGIN_OPERATOR_UNSUPPORTED");
		expect(code(() => lexer.registerVocabulary({ operators: { "~": "ONE" } }))).toBe("PLUGIN_OPERATOR_UNSUPPORTED");
	});

	test("while a readable one still registers", () => {
		const lexer = new ExpressionLexer("en");
		lexer.registerVocabulary({ operators: { "~>": "ARROW" } });
		expect(types(lexer, "1 ~> 2")).toEqual(["NUMBER", "ARROW", "NUMBER"]);
	});
});
