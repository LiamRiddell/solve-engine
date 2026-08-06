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
/**
 * A word that is not a unit, standing where a rate numerator would be.
 *
 * `30 bottles / week` is thirty bottles a week. "bottles" is not a unit and
 * never will be, so the only readings available are to drop it, which is what
 * Soulver does, or to keep it as the label it plainly is. Keeping it says more
 * and loses nothing.
 *
 * Only fires when the very next thing is a rate denominator, which is a strong
 * enough signal to distinguish a count noun from a variable. The cost is real
 * and stated: if `bottles` happens to be a defined variable, this reads the
 * word rather than its value. That is asserted in the spec so the trade is
 * visible rather than discovered.
 */
function isCountLabel(token: Token | undefined): boolean {
	if (token === undefined || token.type !== "IDENT") return false;
	const word = (token.text ?? token.value ?? "").toLowerCase();
	if (PER_WORDS.has(word)) return false;
	// A word, not a symbol or a single letter: single letters are overwhelmingly
	// variables (`30 x / week`) and overwhelmingly not count nouns.
	return /^[a-z][a-z_]{2,}$/.test(word) && UNIT_TABLE[word] === undefined;
}

export function bareRateDenominatorNormalizerRule(priority = 75): NormalizerRule {
	return {
		name: "uom:bare-rate-denominator",
		priority,
		match(tokens, pos): NormalizerMatch | null {
			const head = tokens[pos];
			if (head === undefined) return null;

			// `30 bottles / week`: a count noun in front of the denominator.
			// Retyped as the unit it is acting as, so the rate keeps the label.
			if (head.type === "NUMBER" && isCountLabel(tokens[pos + 1])) {
				const label = tokens[pos + 1];
				const after = tokens[pos + 2];
				const introduces =
					after?.type === "SLASH" ||
					(after?.type === "IDENT" && PER_WORDS.has((after.text ?? after.value ?? "").toLowerCase()));
				if (introduces && isUnit(tokens[pos + 3])) {
					return {
						consumed: 2,
						replacement: [head, createFusedToken("UNIT", label.value, [label])],
						ruleName: "uom:bare-rate-denominator",
					};
				}
			}

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
