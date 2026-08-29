import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const RATIO_CALL_TYPE = "RATIO_CALL";
const RATIO_CALL_TYPE_ID = tokenTypeId(RATIO_CALL_TYPE);

/**
 * Mints a `RATIO_CALL` token from the word `ratio` only when it is immediately
 * followed by `(`, so `ratio(16, 9)` is a call while `ratio` stays an ordinary
 * word otherwise (a variable `:ratio = ...` is untouched). The same position-only
 * claim the encoding `base64(` rule uses.
 */
export function ratioCallNormalizerRule(priority = 80): NormalizerRule {
	const RULE = "ratio:call";
	return {
		name: RULE,
		priority,
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			if ((token.value ?? "").toLowerCase() !== "ratio") return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;
			if (tokens[pos - 1]?.type === "COLON") return null;

			const fused = new LexerToken(
				RATIO_CALL_TYPE,
				RATIO_CALL_TYPE_ID,
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
