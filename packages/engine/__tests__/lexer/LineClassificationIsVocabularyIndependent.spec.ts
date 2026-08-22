import { describe, expect, test } from "@jest/globals";
import { Lexer, sharedLexer } from "@solve-js/lexer/Lexer";
import type { LexerVocabulary } from "@solve-js/lexer/ExpressionLexer";

/**
 * Line classification and inline-solve detection must not depend on which
 * packages an engine registered.
 *
 * Three call sites reach for the shared lexer rather than an engine's own:
 * `ExpressionEngineSafety.isEmptyLine`, `findInlineSolvesInLine`,
 * `PageManager`, and `ThreeTierEvaluator`. Two of those export free functions
 * with no engine to ask, so wiring them per-engine would mean changing their
 * signatures and every caller.
 *
 * That is only acceptable if these operations genuinely see the same answer
 * from any lexer. They read characters looking for headings, comment markers,
 * code fences and backtick spans, and never consult the keyword, unit or
 * operator tables, so they should. This pins that, because if it ever stops
 * being true the shared instance silently becomes a correctness bug rather
 * than a deliberate choice.
 */
describe("line classification does not depend on registered vocabulary", () => {
	const lines = [
		"# a heading",
		"## another heading",
		"",
		"   ",
		"1 + 2",
		"// a comment line",
		"1 + 2 // trailing comment",
		"```",
		"some prose that merely mentions pi and sqrt",
		"a line with `2 + 2 =?` inline",
		"two `1+1 =?` spans `3*3 =?` here",
		"an escaped \\` backtick",
		"> a quote",
		"- a list item",
		// Colour literals: the `#hex` shape is classified by character, never by
		// vocabulary, so a bare lexer and a colour-aware one must still agree.
		"#ff0000",
		"#f00",
		"#deadbeef",
		"#tag",
		"#face",
		"color = #3366cc",
	];

	/** A package-style vocabulary claiming words the built-ins do not. */
	const vocabulary: LexerVocabulary = {
		keywords: { zorblat: "ZORBLAT", frobnicate: "FROBNICATE", heading: "HEADING_KW" },
		units: ["qux"],
		operators: { "@@": "AT_AT" },
	};

	test("classifyLine agrees between a bare lexer and one with extra vocabulary", () => {
		const withVocab = new Lexer("en", undefined);
		withVocab.registerVocabulary(vocabulary);

		for (const line of lines) {
			expect({ line, ...withVocab.classifyLine(line) }).toEqual({
				line,
				...sharedLexer.classifyLine(line),
			});
		}
	});

	test("findInlineSolves agrees between a bare lexer and one with extra vocabulary", () => {
		const withVocab = new Lexer("en", undefined);
		withVocab.registerVocabulary(vocabulary);

		for (const line of lines) {
			expect({ line, spans: withVocab.findInlineSolves(line) }).toEqual({
				line,
				spans: sharedLexer.findInlineSolves(line),
			});
		}
	});

	test("classification also survives a line built entirely from claimed words", () => {
		const withVocab = new Lexer("en", undefined);
		withVocab.registerVocabulary(vocabulary);

		// "heading" is claimed as a keyword above. If classification consulted
		// the keyword table, a line starting with it could classify differently.
		const line = "heading zorblat frobnicate 3 qux";
		expect(withVocab.classifyLine(line)).toEqual(sharedLexer.classifyLine(line));
	});
});
