import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const BASE64_FN_TYPE = "BASE64_FN";
const BASE64_FN_TYPE_ID = tokenTypeId(BASE64_FN_TYPE);

/**
 * Mints the `BASE64_FN` token from the word `base64` only when it is immediately
 * followed by `(`, so the call form `base64("...")` is recognised while the word
 * stays ordinary everywhere else: `"..." as base64` still reads `base64` as the
 * converter name, and `:base64 = ...` still defines a variable. This is the same
 * position-only claim the `factor(` and `sum(` rules use (see the
 * recognising-phrases guide). The `(` is left in place for the parselet.
 */
export function base64CallNormalizerRule(priority = 80): NormalizerRule {
	const RULE = "encoding:base64-call";
	return {
		name: RULE,
		priority,
		startTokenTypes: ["IDENT"],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			if ((token.value ?? "").toLowerCase() !== "base64") return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;
			if (tokens[pos - 1]?.type === "COLON") return null; // `:base64 = ...` stays a variable

			const fused = new LexerToken(
				BASE64_FN_TYPE,
				BASE64_FN_TYPE_ID,
				token.value,
				token.value,
				token.offset,
				0,
				token.line,
				token.col,
			);
			return { consumed: 1, replacement: [fused], ruleName: RULE };
		},
	};
}
