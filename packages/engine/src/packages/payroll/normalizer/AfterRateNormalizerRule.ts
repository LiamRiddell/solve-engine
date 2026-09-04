import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const AFTER_RATE_ID = tokenTypeId("AFTER_RATE");

/**
 * `after 20% tax`: take-home at a rate the line states, rather than a country's
 * bands.
 *
 * `after tax` is a fused phrase with HMRC's bands behind it, which are a fact
 * about the United Kingdom and are refused on any other currency. This is the
 * form that answers everyone else, and the one the refusal points at: the rate
 * is on the line, so nothing national is assumed and any currency works.
 *
 * The whole shape is required, down to the closing word `tax`. `after` is an
 * ordinary word (`3 days after tuesday`), and a percentage after it is
 * ordinary too, so only the pair with `tax` behind them is claimed.
 *
 * The rate is folded into the fused token rather than left for the parser,
 * because it is one number with nothing to work out about it, the same shape
 * `rootFontSizeNormalizerRule` uses for `at 20px base`.
 *
 * @module AfterRateNormalizerRule
 */

/** The rule: see the module comment for why the closing `tax` is required. */
export function afterRateNormalizerRule(priority = 74): NormalizerRule {
	const RULE = "payroll:after-rate";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["AFTER"] }, { types: ["NUMBER"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			if (tokens[pos]?.type !== "AFTER") return null;

			const rate = tokens[pos + 1];
			if (rate?.type !== "NUMBER") return null;
			if (tokens[pos + 2]?.type !== "PERCENT") return null;

			const tax = tokens[pos + 3];
			if (tax === undefined) return null;
			const word = (tax.value ?? "").toLowerCase();
			if (word !== "tax" && word !== "vat") return null;

			const head = tokens[pos];
			const fused = new LexerToken(
				"AFTER_RATE",
				AFTER_RATE_ID,
				rate.value ?? "",
				head.text ?? "after",
				head.offset,
				0,
				head.line,
				head.col,
			);
			return { consumed: 4, replacement: [fused], ruleName: RULE };
		},
	};
}
