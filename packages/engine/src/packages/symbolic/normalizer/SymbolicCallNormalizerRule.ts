import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/**
 * The algebra verbs, mapped to the token type each becomes when it is being
 * called.
 *
 * Kept in one place so {@link SYMBOLIC_FUNCTIONS} in `SymbolicPackage.ts` and
 * this rule cannot disagree about which words the package claims.
 */
export const SYMBOLIC_WORD_TO_TOKEN_TYPE: Readonly<Record<string, string>> = {
	expand: "EXPAND_FN",
	factor: "FACTOR_FN",
	solve: "SOLVE_FN",
	der: "DER_FN",
	derivative: "DER_FN",
	integral: "INTEGRAL_FN",
	taylor: "TAYLOR_FN",
	jacobian: "JACOBIAN_FN",
};

/**
 * Fuses an algebra verb into its own token type, but only when the bare word is
 * immediately followed by `(`.
 *
 * None of these words may be a plain `keywordMap` entry, and the reason is
 * concrete rather than stylistic. A `keywordMap` entry makes the lexer emit a
 * reserved token type everywhere the word appears, which would break
 * `:factor = 1.5` and `:solve = 2` as ordinary variable names. `solve` is also
 * the product's own name and `factor` is an everyday English noun, so both are
 * words a user will reasonably assign to.
 *
 * Mirrors `packages/mapreduce/normalizer/MapReduceCallNormalizerRule.ts`, which
 * exists for exactly this reason for `map`/`reduce`/`sum`/`prod`.
 *
 * @param priority - Rule ordering within the normalizer, defaulting to the same
 * band the map/reduce call rule uses.
 * @returns The normalizer rule.
 */
export function symbolicCallNormalizerRule(priority = 80): NormalizerRule {
	return {
		name: "symbolic:call",
		priority,
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			const tokenType = SYMBOLIC_WORD_TO_TOKEN_TYPE[token.value.toLowerCase()];
			if (!tokenType) return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;

			return {
				consumed: 1,
				replacement: [
					new LexerToken(tokenType, tokenTypeId(tokenType), token.value, token.value, token.offset, 0, token.line, token.col),
				],
				ruleName: "symbolic:call",
			};
		},
	};
}
