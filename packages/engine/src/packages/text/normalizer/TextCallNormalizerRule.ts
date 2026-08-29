import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { TEXT_CALL_FUNCTIONS } from "../TextFunctionNames";

const TEXT_CALL_TYPE = "TEXT_CALL";
const TEXT_CALL_TYPE_ID = tokenTypeId(TEXT_CALL_TYPE);

/**
 * Mints a `TEXT_CALL` token from a text function name (`length`, `upper`,
 * `replace`, ...) only when it is immediately followed by `(`, so the call form
 * `length("hi")` is recognised while the word stays ordinary everywhere else: a
 * variable `:length = 3` and a heading word `title` are untouched. The same
 * position-only claim the encoding `base64(` rule uses; the `(` is left in
 * place for the parselet, and the lower-cased name rides on the token.
 */
export function textCallNormalizerRule(priority = 80): NormalizerRule {
	const RULE = "text:call";
	return {
		name: RULE,
		priority,
		startTokenTypes: ["IDENT"],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			const name = (token.value ?? "").toLowerCase();
			if (!(name in TEXT_CALL_FUNCTIONS)) return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;
			if (tokens[pos - 1]?.type === "COLON") return null; // `:length = ...` stays a variable

			const fused = new LexerToken(
				TEXT_CALL_TYPE,
				TEXT_CALL_TYPE_ID,
				name,
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
