/**
 * A rule chain that never settles is reported, not returned.
 *
 * The normaliser re-runs its rules until a pass changes nothing, with a
 * budget of passes (`maxPasses`, 100 by default) against a chain that never
 * settles. Reaching the budget used to end the loop silently and hand the
 * last pass's output to the parser as if it were the normal form, so a
 * document carried whatever a runaway rule had left at pass 100. It now
 * throws `NORMALIZER_PASS_LIMIT_EXCEEDED`, the way the token-count limit
 * already did, and a stream that settles inside the budget is untouched.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken, TokenNormalizer } from "@solve-js/normalizer/TokenNormalizer";

const lex = (input: string) => {
	const lexer = new ExpressionLexer("en");
	lexer.reset(input);
	return lexer.tokenizeAll();
};

/** Replaces every number with the next one, forever. */
const countingUp: NormalizerRule = {
	name: "test:count-up",
	priority: 50,
	shape: [{ types: ["NUMBER"] }],
	match(tokens, pos) {
		const token = tokens[pos];
		if (token.type !== "NUMBER") return null;
		return {
			consumed: 1,
			replacement: [createFusedToken("NUMBER", String(Number(token.value) + 1), [token])],
			ruleName: "test:count-up",
		};
	},
};

describe("the pass budget", () => {
	test("a chain that never settles is an error", () => {
		const normalizer = new TokenNormalizer({ maxPasses: 5 });
		normalizer.register(countingUp);
		let code: string | undefined;
		try {
			normalizer.normalize(lex("1 + 2"));
		} catch (thrown) {
			code = (thrown as EngineError).code;
		}
		expect(code).toBe("NORMALIZER_PASS_LIMIT_EXCEEDED");
	});

	test("a stream that settles inside the budget is unaffected", () => {
		const normalizer = new TokenNormalizer({ maxPasses: 5 });
		const tokens = normalizer.normalize(lex("1 + 2"));
		expect(tokens.map((t) => t.type)).toEqual(["NUMBER", "PLUS", "NUMBER"]);
	});
});
