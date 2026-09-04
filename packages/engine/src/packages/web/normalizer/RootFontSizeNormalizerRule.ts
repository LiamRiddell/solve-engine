import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const ROOT_FONT_SIZE_ID = tokenTypeId("ROOT_FONT_SIZE");

/**
 * `at 20px base`: the root font size a `rem` on this line is measured against.
 *
 * The whole phrase is required, down to the closing word `base`. `at` is the
 * rate operator everywhere else in the engine (`30 hours at $30/hour`), so
 * claiming it on sight would take a meaning that is already spoken for. With
 * `20px base` behind it there is no other reading, and `40 hours at 20px` is
 * still the rate it always was.
 *
 * The base is folded into the fused token rather than left as tokens for the
 * parser, because it is one number and there is nothing to work out about it.
 *
 * @module RootFontSizeNormalizerRule
 */

/** The rule: see the module comment for why the whole phrase is required. */
export function rootFontSizeNormalizerRule(priority = 76): NormalizerRule {
	const RULE = "web:root-font-size";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["RATE_AT", "AT_RATE", "AT"] }, { types: ["NUMBER"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head?.type !== "RATE_AT" && head?.type !== "AT_RATE" && head?.type !== "AT") return null;

			const size = tokens[pos + 1];
			if (size?.type !== "NUMBER") return null;
			const unit = tokens[pos + 2];
			if (unit?.type !== "UNIT" || (unit.value ?? "").toLowerCase() !== "px") return null;
			const base = tokens[pos + 3];
			if (base?.type !== "IDENT" || (base.value ?? "").toLowerCase() !== "base") return null;

			const fused = new LexerToken(
				"ROOT_FONT_SIZE",
				ROOT_FONT_SIZE_ID,
				size.value ?? "",
				head.text ?? "at",
				head.offset,
				0,
				head.line,
				head.col,
			);
			return { consumed: 4, replacement: [fused], ruleName: RULE };
		},
	};
}
