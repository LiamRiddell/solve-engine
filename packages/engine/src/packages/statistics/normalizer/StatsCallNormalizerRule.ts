import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { STATISTICS_CALL_FUNCTIONS } from "../StatisticsFunctionNames";

const STAT_CALL_TYPE = "STAT_CALL";
const STAT_CALL_TYPE_ID = tokenTypeId(STAT_CALL_TYPE);

/**
 * Mints a `STAT_CALL` token from a statistics function name (`correlation`,
 * `percentile`, `zscore`, ...) only when it is immediately followed by `(`, so
 * `percentile([...], 90)` is a call while the word stays ordinary otherwise. The
 * same position-only claim the encoding `base64(` rule uses.
 */
export function statsCallNormalizerRule(priority = 80): NormalizerRule {
	const RULE = "statistics:call";
	return {
		name: RULE,
		priority,
		startTokenTypes: ["IDENT"],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			const name = (token.value ?? "").toLowerCase();
			if (!(name in STATISTICS_CALL_FUNCTIONS)) return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;
			if (tokens[pos - 1]?.type === "COLON") return null;

			const fused = new LexerToken(
				STAT_CALL_TYPE,
				STAT_CALL_TYPE_ID,
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
