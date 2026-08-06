import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/**
 * Recognises a rate denominator written with no number: `/ day`, `per week`,
 * `a day`.
 *
 * This is the distinction that makes rates work. `3 hours / day` is a rate;
 * `3 hours / 3 days` is a division that cancels to a plain number. The two are
 * told apart by whether a number was written, which is a fact about the source
 * text and therefore has to be decided here rather than at evaluation time.
 *
 * The earlier attempt at this supplied the missing `1` and let the ordinary
 * division run. It made `$50/week × 12 weeks` work and turned `3 hours / day`
 * into 0.125, because once the denominator has a number the same-measure units
 * cancel. Fusing instead means the rate is constructed directly and no division
 * ever happens.
 *
 * `per`, `a`, `an`, `each` and `every` are only ever consumed when a unit
 * follows, so those very common words are otherwise untouched.
 */

/** Whether a token is a unit spelling the engine knows. */
function isUnit(token: Token | undefined): boolean {
	if (token === undefined || token.type !== "UNIT") return false;
	return UNIT_TABLE[(token.value ?? "").toLowerCase()] !== undefined;
}

/** Words that introduce a rate denominator on their own. */
const PER_WORDS = new Set(["per", "a", "an", "each", "every"]);

// Priority above the implicit-multiplication rule (50), which would
// otherwise insert a `*` between a bare number and the `per` that follows it
// and leave the fused token in operand position.
export function bareRateDenominatorNormalizerRule(priority = 75): NormalizerRule {
	return {
		name: "uom:bare-rate-denominator",
		priority,
		match(tokens, pos): NormalizerMatch | null {
			const head = tokens[pos];
			if (head === undefined) return null;
			if (!isUnit(tokens[pos + 1])) return null;

			const isSlash = head.type === "SLASH";
			const word = (head.text ?? head.value ?? "").toLowerCase();
			const isPerWord = head.type === "IDENT" && PER_WORDS.has(word);
			if (!isSlash && !isPerWord) return null;

			// A number after the unit means this was never a bare denominator:
			// `/ 3 days` is a division and `a day + 2` is not a rate at all.
			const unitToken = tokens[pos + 1];
			return {
				consumed: 2,
				replacement: [
					createFusedToken("PER_UNIT", unitToken.value, [head, unitToken]),
				],
				ruleName: "uom:bare-rate-denominator",
			};
		},
	};
}
