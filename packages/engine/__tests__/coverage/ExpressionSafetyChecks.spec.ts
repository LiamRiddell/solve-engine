/**
 * The two input-bound checks published through the `solve-engine/engine`
 * subpath.
 *
 * `checkExpressionLength` and `checkExpressionComplexity` are exported for a
 * host that wants to apply the engine's own limits before handing it a line,
 * for instance to grey out a run button rather than let a paste of a
 * hundred-kilobyte cell produce an error. Neither was named by any test.
 *
 * They are worth testing separately from the engine that calls them because
 * both are pure functions of an input and a config, so their boundaries can be
 * pinned exactly, and both are the difference between a bounded refusal and an
 * unbounded parse.
 */

import { describe, expect, test } from "@jest/globals";
import {
	checkExpressionComplexity,
	checkExpressionLength,
	type ValidationConfig,
} from "@solve-js/engine/ExpressionEngineSafety";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";

const CONFIG: ValidationConfig = { maxExpressionLength: 20, maxComplexity: 50 };

/** Tokens as the engine would hand them to the complexity check. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter(
		(t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"),
	);
}

describe("checkExpressionLength", () => {
	test("passes anything shorter than the limit, with no error attached", () => {
		const result = checkExpressionLength("1 + 1", CONFIG);
		expect(result.passed).toBe(true);
		expect(result.error).toBeUndefined();
	});

	test("the limit itself passes, so the config value means what it says", () => {
		/*
		 * The comparison is `>`, which makes `maxExpressionLength` a
		 * permitted maximum rather than a first refused value. Both sides are
		 * asserted because an off-by-one here silently narrows every host's
		 * configured limit by one character.
		 */
		expect(checkExpressionLength("x".repeat(20), CONFIG).passed).toBe(true);
		expect(checkExpressionLength("x".repeat(21), CONFIG).passed).toBe(false);
	});

	test("the refusal names the limit and the actual length", () => {
		/*
		 * A host showing this to a user needs both numbers to say anything
		 * useful: "too long" alone gives no idea how much to cut.
		 */
		const result = checkExpressionLength("x".repeat(35), CONFIG);

		expect(result.passed).toBe(false);
		expect(result.error?.engineError?.code).toBe("EXPRESSION_TOO_LONG");
		expect(result.error?.error).toContain("20");
		expect(result.error?.error).toContain("35");
	});

	test("the refusal carries a complete, usable result shape", () => {
		/*
		 * The error branch is spread straight into the engine's own return
		 * shape, so every field has to be present and safe to consume. A
		 * missing `program` would make a caller that walks the bytecode
		 * throw on the error path, which is the worst place to throw.
		 */
		const result = checkExpressionLength("x".repeat(35), CONFIG);

		expect(result.error?.value.toNumber()).toBe(0);
		expect(result.error?.tokens).toEqual([]);
		expect(result.error?.program.opcodes).toHaveLength(0);
		expect(result.error?.program.hasAsync).toBe(false);
	});

	test("an empty expression passes", () => {
		// A blank line is the most common line in a document.
		expect(checkExpressionLength("", CONFIG).passed).toBe(true);
	});
});

describe("checkExpressionComplexity", () => {
	test("with no functions or brackets the score is just the token count", () => {
		/*
		 * The score is `tokens + functionCalls * 5 + maxNesting * 10`. "1 + 2"
		 * lexes to three tokens and has neither of the other two terms, so it
		 * scores three.
		 */
		const result = checkExpressionComplexity(lex("1 + 2"), CONFIG);
		expect(result.passed).toBe(true);
		expect(result.complexityScore).toBe(3);
	});

	test("a bracket pair costs ten for the nesting, on top of its two tokens", () => {
		/*
		 * "(1)" is three tokens, LPAREN NUMBER RPAREN, at nesting depth one,
		 * so 3 + 10 = 13. Nesting is weighted heavily on purpose: depth, not
		 * length, is what turns parsing into something exponential.
		 */
		expect(checkExpressionComplexity(lex("(1)"), CONFIG).complexityScore).toBe(13);
	});

	test("nesting is charged at its deepest point, not once per bracket", () => {
		/*
		 * "((1))" is five tokens reaching depth two, so 5 + 20 = 25. Charging
		 * per bracket instead would score the same as two sibling pairs,
		 * which are much cheaper to parse.
		 */
		expect(checkExpressionComplexity(lex("((1))"), CONFIG).complexityScore).toBe(25);

		// Two pairs side by side reach depth one, so "(1)+(2)" is seven
		// tokens plus ten, not plus twenty.
		expect(checkExpressionComplexity(lex("(1)+(2)"), CONFIG).complexityScore).toBe(17);
	});

	test("a function call costs five, plus whatever its brackets cost", () => {
		/*
		 * "sqrt(4)" is four tokens: the FUNC, the bracket pair and the
		 * number. One function call is five and depth one is ten, so
		 * 4 + 5 + 10 = 19.
		 */
		expect(checkExpressionComplexity(lex("sqrt(4)"), CONFIG).complexityScore).toBe(19);
	});

	test("an empty token list scores zero and passes", () => {
		const result = checkExpressionComplexity([], CONFIG);
		expect(result.complexityScore).toBe(0);
		expect(result.passed).toBe(true);
	});

	test("the limit itself passes and one past it does not", () => {
		/*
		 * Same `>` boundary as the length check, pinned the same way. The
		 * config is chosen so a hand-countable expression lands exactly on
		 * it: "(1)" scores 13.
		 */
		const atLimit: ValidationConfig = { maxExpressionLength: 100, maxComplexity: 13 };
		const belowLimit: ValidationConfig = { maxExpressionLength: 100, maxComplexity: 12 };

		expect(checkExpressionComplexity(lex("(1)"), atLimit).passed).toBe(true);
		expect(checkExpressionComplexity(lex("(1)"), belowLimit).passed).toBe(false);
	});

	test("the refusal names both the score and the ceiling, and reports the score anyway", () => {
		/*
		 * `complexityScore` is returned on the failing path too, which is
		 * what lets a host tell "slightly over" from "wildly over" and decide
		 * whether to suggest splitting the line.
		 */
		const strict: ValidationConfig = { maxExpressionLength: 100, maxComplexity: 5 };
		const result = checkExpressionComplexity(lex("sqrt(4)"), strict);

		expect(result.passed).toBe(false);
		expect(result.complexityScore).toBe(19);
		expect(result.engineError?.code).toBe("EXPRESSION_TOO_COMPLEX");
		expect(result.errorMessage).toContain("19");
		expect(result.errorMessage).toContain("5");
	});

	test("unbalanced closing brackets do not drive the nesting term negative", () => {
		/*
		 * Malformed input reaches this check, since it runs before parsing.
		 * A stray ")" decrements the running depth, and if the maximum were
		 * taken from that running value rather than a high-water mark, a line
		 * ending in extra brackets could score lower than the same line
		 * without them and slip past a limit it should have met.
		 */
		const balanced = checkExpressionComplexity(lex("(1)"), CONFIG).complexityScore;
		const trailing = checkExpressionComplexity(lex("(1)))"), CONFIG).complexityScore;

		expect(trailing).toBeGreaterThanOrEqual(balanced);
	});
});
