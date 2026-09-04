/**
 * A single-word phrase fuses once and settles.
 *
 * The phrase trie matched on a token's written value, and a fused single-word
 * phrase keeps that value: `assuming` became ASSUMING("assuming"), and on the
 * next pass the trie read "assuming" again and proposed the same fusion. Every
 * pass was therefore a change, so a line holding such a word ran the
 * normaliser to its pass budget (100 passes) on every evaluation, and the
 * result was whatever the last pass left. Found the moment the pass budget
 * became an error rather than a silent exit. A token that already carries the
 * phrase's type is now the fusion, not a word to fuse.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { TokenNormalizer } from "@solve-js/normalizer/TokenNormalizer";
import { newTrackedEngine } from "@tools/trackedEngine";

const lex = (input: string) => {
	const lexer = new ExpressionLexer("en");
	lexer.reset(input);
	return lexer.tokenizeAll();
};

describe("a single-word phrase", () => {
	test("settles in two passes rather than running to the budget", () => {
		// Two passes: one to fuse, one to find nothing left to do. Before the
		// fix the second pass fused again and the budget was the only exit.
		const normalizer = new TokenNormalizer({ maxPasses: 2 });
		normalizer.addPhrase("assuming", "ASSUMING");
		const tokens = normalizer.normalize(lex("500 assuming 3"));
		expect(tokens.map((t) => t.type)).toEqual(["NUMBER", "ASSUMING", "NUMBER"]);
	});

	test("so an inflation line settles inside a budget of three passes", () => {
		const engine = newTrackedEngine();
		(engine.getNormalizer() as unknown as { options: { maxPasses: number } }).options.maxPasses = 3;
		const lexer = engine.getLexer();
		lexer.resetExpression("value of $500 in 2031 assuming 3% inflation");
		const types = engine.getNormalizer().normalize([...lexer]).map((t) => t.type);
		expect(types).toContain("ASSUMING");
	});
});
