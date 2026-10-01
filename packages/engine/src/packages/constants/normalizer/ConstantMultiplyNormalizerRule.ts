/**
 * An amount written straight before a mathematical constant multiplies it:
 * `2tau` is `2 * tau`, as `2pi` is `2 * pi`.
 */

import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const STAR_ID = tokenTypeId("STAR");

/** What a constant can be multiplied after: an amount or a closing bracket. */
const AMOUNT_BEFORE: ReadonlySet<string> = new Set(["NUMBER", "RPAREN"]);

/**
 * The constants an amount multiplies when written against it. The core
 * implicit multiplication reads `pi` and `e`; these are the constants
 * package's mathematical ones. A physical constant (`2 gravity`) is left out:
 * its unit makes a bare amount before it read as a count of the constant, a
 * reading the line should spell with a `*`.
 */
export const MULTIPLIED_CONSTANTS: ReadonlySet<string> = new Set(["TAU", "PHI", "GOLDEN_RATIO"]);

/**
 * `2tau`, `2 phi`, `3 golden ratio` and `(1 + 1)tau` read as a product, the
 * way `2pi` does. Before this, the constant after an amount was a parse error
 * ("Expected an operator or the end of the line").
 *
 * @param priority - Where the rule sits among the normalizer's rules; below
 * phrase fusion, so `golden ratio` is one token when this reads it.
 */
export function constantMultiplyNormalizerRule(priority = 50): NormalizerRule {
	return {
		name: "constants:implicit-multiply",
		priority,
		shape: [{ types: [...AMOUNT_BEFORE] }, { types: [...MULTIPLIED_CONSTANTS] }],
		match(tokens, pos): NormalizerMatch | null {
			const before = tokens[pos];
			const constant = tokens[pos + 1];
			if (!before || !constant || !AMOUNT_BEFORE.has(before.type) || !MULTIPLIED_CONSTANTS.has(constant.type)) return null;
			const star = new LexerToken("STAR", STAR_ID, "*", "*", constant.offset, 0, constant.line, constant.col);
			return { consumed: 1, replacement: [before, star], ruleName: "constants:implicit-multiply" };
		},
	};
}
