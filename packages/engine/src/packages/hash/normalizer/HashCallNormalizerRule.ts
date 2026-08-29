import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { HASH_CALL_FUNCTIONS } from "../HashPluginFunctions";

const HASH_CALL_TYPE = "HASH_CALL";
const HASH_CALL_TYPE_ID = tokenTypeId(HASH_CALL_TYPE);

/**
 * Mints a `HASH_CALL` token from a hash function name (`sha256`, `md5`, ...)
 * only when it is immediately followed by `(`, so `sha256("hi")` is a call while
 * the word stays ordinary otherwise (a variable `:md5 = ...` is untouched). The
 * same position-only claim the encoding `base64(` rule uses; the lower-cased
 * name rides on the token and the `(` is left for the parselet.
 */
export function hashCallNormalizerRule(priority = 80): NormalizerRule {
	const RULE = "hash:call";
	return {
		name: RULE,
		priority,
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			const name = (token.value ?? "").toLowerCase();
			if (!(name in HASH_CALL_FUNCTIONS)) return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;
			if (tokens[pos - 1]?.type === "COLON") return null;

			const fused = new LexerToken(
				HASH_CALL_TYPE,
				HASH_CALL_TYPE_ID,
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
