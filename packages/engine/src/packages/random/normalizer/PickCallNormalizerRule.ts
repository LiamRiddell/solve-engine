import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const PICK_CALL_TYPE = "PICK_CALL";
const PICK_CALL_TYPE_ID = tokenTypeId(PICK_CALL_TYPE);

/**
 * Mints a `PICK_CALL` token from the word `pick` only when it is immediately
 * followed by `(`, so `pick("a", "b")` is a call while `pick` stays an ordinary
 * word otherwise (a variable `:pick = ...` is untouched). The same position-only
 * claim the encoding `base64(` rule uses; the `(` is left for the parselet.
 */
export function pickCallNormalizerRule(priority = 80): NormalizerRule {
	const RULE = "random:pick-call";
	return {
		name: RULE,
		priority,
		startTokenTypes: ["IDENT"],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			if ((token.value ?? "").toLowerCase() !== "pick") return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;
			if (tokens[pos - 1]?.type === "COLON") return null;

			const fused = new LexerToken(
				PICK_CALL_TYPE,
				PICK_CALL_TYPE_ID,
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
