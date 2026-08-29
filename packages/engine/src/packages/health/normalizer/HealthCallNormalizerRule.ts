import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/** The health function names, each mapped to its plugin function. */
export const HEALTH_CALL_FUNCTIONS: Record<string, string> = {
	bmi: "healthBmi",
	pace: "healthPace",
	speed: "healthSpeed",
};

const HEALTH_CALL_TYPE = "HEALTH_CALL";
const HEALTH_CALL_TYPE_ID = tokenTypeId(HEALTH_CALL_TYPE);

/**
 * Mints a `HEALTH_CALL` token from a health function name (`bmi`, `pace`,
 * `speed`) only when it is immediately followed by `(`, so `pace(10, 50)` is a
 * call while the word stays ordinary otherwise (a variable `:speed = ...` is
 * untouched). The same position-only claim the encoding `base64(` rule uses.
 */
export function healthCallNormalizerRule(priority = 80): NormalizerRule {
	const RULE = "health:call";
	return {
		name: RULE,
		priority,
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			const name = (token.value ?? "").toLowerCase();
			if (!(name in HEALTH_CALL_FUNCTIONS)) return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;
			if (tokens[pos - 1]?.type === "COLON") return null;

			const fused = new LexerToken(
				HEALTH_CALL_TYPE,
				HEALTH_CALL_TYPE_ID,
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
