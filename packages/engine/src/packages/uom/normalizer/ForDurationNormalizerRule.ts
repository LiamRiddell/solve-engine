import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/**
 * `for a <unit>` as "times one of them": `$24 a day for a year` is $8,760.
 *
 * The article is doing two different jobs in that one line. The first (`a day`)
 * introduces a rate denominator; the second (`a year`) is a quantity the rate
 * runs for. Without separating them the second article was read as another
 * denominator and the line failed with the fused token in operand position.
 *
 * Rewritten to an explicit multiplication rather than given its own operator,
 * because that is exactly what it means and the rate machinery already knows
 * how to multiply a rate by a duration.
 *
 * Requires the article. `for 3 years` keeps a number of its own and belongs to
 * the finance grammar (`$1,000 for 3 years at 7%`), which this must not touch.
 */

/** Whether a token is a unit spelling the engine knows. */
function isUnit(token: Token | undefined): boolean {
	if (token === undefined || token.type !== "UNIT") return false;
	return UNIT_TABLE[(token.value ?? "").toLowerCase()] !== undefined;
}

/** Articles meaning "one" in this position. */
const ARTICLES = new Set(["a", "an"]);

export function forDurationNormalizerRule(priority = 76): NormalizerRule {
	return {
		name: "uom:for-duration",
		priority,
		match(tokens, pos): NormalizerMatch | null {
			const head = tokens[pos];
			if (head?.type !== "FOR_DURATION") return null;

			const article = tokens[pos + 1];
			if (article?.type !== "IDENT") return null;
			if (!ARTICLES.has((article.text ?? article.value ?? "").toLowerCase())) return null;
			if (!isUnit(tokens[pos + 2])) return null;

			return {
				consumed: 3,
				replacement: [
					createFusedToken("STAR", "*", [head]),
					createFusedToken("NUMBER", "1", [article]),
					tokens[pos + 2],
				],
				ruleName: "uom:for-duration",
			};
		},
	};
}
