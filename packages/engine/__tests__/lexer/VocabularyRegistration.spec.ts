/**
 * Registering a vocabulary is all-or-nothing, and unregistering one gives
 * back only what it claimed.
 *
 * Keywords, operators and units were written into the lexer one at a time
 * and a collision threw part way, so a registration that failed still
 * changed the lexer. And each word was stored by name with no record of who
 * registered it: a second package claiming the same word silently replaced
 * the first, and unregistering either removed the word for both. Every guard
 * now runs before anything is written, and each word carries its owners, so
 * removing one package hands the word back to the other.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";

const types = (lexer: ExpressionLexer, input: string): string[] => {
	lexer.reset(input);
	try {
		return lexer.tokenizeAll().map((t) => t.type);
	} catch (thrown) {
		if (thrown instanceof EngineError) return ["<lexer error>"];
		throw thrown;
	}
};

describe("a registration that fails", () => {
	test("leaves the lexer exactly as it was", () => {
		const lexer = new ExpressionLexer("en");
		const builtin = Object.keys(lexer.getKeywords())[0];
		const before = [types(lexer, "zork 1 ~> 2 plonk"), types(lexer, "5 zorks")];

		expect(() =>
			lexer.registerVocabulary({
				keywords: { zork: "ZORK", plonk: "PLONK", [builtin]: "AGAIN" },
				operators: { "~>": "ARROW" },
				units: ["zorks"],
			}),
		).toThrow(EngineError);

		expect([types(lexer, "zork 1 ~> 2 plonk"), types(lexer, "5 zorks")]).toEqual(before);
		expect(lexer.getKeywords()).not.toHaveProperty("zork");
		expect(lexer.getKeywords()).not.toHaveProperty("plonk");
	});
});

describe("two vocabularies that claim the same word", () => {
	test("a keyword goes back to the survivor when the other is unregistered", () => {
		const lexer = new ExpressionLexer("en");
		const a = { keywords: { zork: "ZORK_A" } };
		const b = { keywords: { zork: "ZORK_B" } };
		lexer.registerVocabulary(a);
		lexer.registerVocabulary(b);
		expect(types(lexer, "zork")).toEqual(["ZORK_B"]);

		lexer.unregisterVocabulary(b);
		expect(types(lexer, "zork")).toEqual(["ZORK_A"]);

		lexer.unregisterVocabulary(a);
		expect(types(lexer, "zork")).toEqual(["IDENT"]);
	});

	test("a unit stays while any owner remains", () => {
		const lexer = new ExpressionLexer("en");
		const a = { units: ["zorks"] };
		const b = { units: ["zorks"] };
		lexer.registerVocabulary(a);
		lexer.registerVocabulary(b);
		expect(types(lexer, "5 zorks")).toEqual(["NUMBER", "UNIT"]);

		lexer.unregisterVocabulary(a);
		expect(types(lexer, "5 zorks")).toEqual(["NUMBER", "UNIT"]);

		lexer.unregisterVocabulary(b);
		expect(types(lexer, "5 zorks")).toEqual(["NUMBER", "IDENT"]);
	});

	test("an operator goes back to the survivor", () => {
		const lexer = new ExpressionLexer("en");
		const a = { operators: { "~>": "ARROW_A" } };
		const b = { operators: { "~>": "ARROW_B" } };
		lexer.registerVocabulary(a);
		lexer.registerVocabulary(b);
		expect(types(lexer, "1 ~> 2")).toEqual(["NUMBER", "ARROW_B", "NUMBER"]);

		lexer.unregisterVocabulary(b);
		expect(types(lexer, "1 ~> 2")).toEqual(["NUMBER", "ARROW_A", "NUMBER"]);

		lexer.unregisterVocabulary(a);
		expect(types(lexer, "1 ~> 2")).not.toContain("ARROW_A");
	});

	test("unregistering a vocabulary that was never registered changes nothing", () => {
		const lexer = new ExpressionLexer("en");
		lexer.registerVocabulary({ keywords: { zork: "ZORK_A" }, units: ["zorks"] });
		lexer.unregisterVocabulary({ keywords: { zork: "ZORK_B" }, units: ["zorks"] });
		expect(types(lexer, "zork")).toEqual(["ZORK_A"]);
		expect(types(lexer, "5 zorks")).toEqual(["NUMBER", "UNIT"]);
	});
});
