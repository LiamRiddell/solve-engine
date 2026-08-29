import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const PLOT_TYPE = "PLOT";
const PLOT_TYPE_ID = tokenTypeId(PLOT_TYPE);

/**
 * The token types that begin the sub-expression of a `plot` clause. A bare
 * `plot` followed by one of these reads as the plot keyword; followed by an
 * operator (`plot - 5`), an `=` (`plot = 5`), or nothing, it stays an ordinary
 * variable name.
 */
const EXPRESSION_START = new Set(["NUMBER", "IDENT", "FUNC", "UNIT", "LPAREN", "PI", "E"]);

/**
 * Mints the `PLOT` token from the word `plot` only where it starts a plot
 * clause, so `plot` is not a reserved word: `:plot = 5` still defines a variable
 * and `plot + 1` still reads it. The rule fires when `plot` is immediately
 * followed by an expression-starting token and is not sitting just after a
 * colon, the same discipline the `symbolic` package uses for `factor`/`solve`
 * (see the recognising-phrases guide). The rest of the clause, `<expr> from <a>
 * to <b>`, is left for {@link PlotParselet}.
 */
export function plotNormalizerRule(priority = 80): NormalizerRule {
	const RULE = "plot:plot-clause";
	return {
		name: RULE,
		priority,
		startTokenTypes: ["IDENT"],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			if ((token.value ?? "").toLowerCase() !== "plot") return null;
			// A variable assignment (`:plot = ...`) is never a plot clause.
			if (tokens[pos - 1]?.type === "COLON") return null;
			const next = tokens[pos + 1];
			if (!next || !EXPRESSION_START.has(next.type)) return null;

			const fused = new LexerToken(
				PLOT_TYPE,
				PLOT_TYPE_ID,
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
