import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

const PLACE_WORDS = new Set(["dp", "dps", "decimals", "digits", "digit"]);

/** Two-word spellings whose first word alone means nothing here. */
const PLACE_PHRASES = new Set(["decimal"]);

/**
 * Fuses `to <n> dp` into one token carrying the place count.
 *
 * `1/3 to 2 dp` and `π to 5 digits` are three tokens where the middle one is
 * the operand. That cannot be a plain infix parselet on "to", because "to" is
 * already one: `100 to 150` is a percentage change. A second parselet on the
 * same token would have to guess which grammar it was in by looking ahead,
 * and lookahead that decides between two unrelated meanings is how a parser
 * becomes impossible to reason about.
 *
 * Fusing first means the parser sees a single, unambiguous postfix operator,
 * and "to" keeps its one meaning. The place count rides on the fused token's
 * value, which is what `sourceEnd` exists for (see Token.ts).
 *
 * Accepted spellings: `dp`, `dps`, `d.p.`, `decimal place(s)`, and `digits`.
 * "digits" is included because Soulver documents `π to 5 digits` as 3.14159,
 * which is five decimal places rather than five significant figures.
 */
export function decimalPlacesNormalizerRule(priority = 66): NormalizerRule {
	return {
		name: "converters:decimal-places",
		priority,
		startTokenTypes: ["TO"],
		match(tokens, pos): NormalizerMatch | null {
			if (tokens[pos]?.type !== "TO") return null;

			const count = tokens[pos + 1];
			if (count?.type !== "NUMBER") return null;

			const unitToken = tokens[pos + 2];
			if (!unitToken) return null;
			const word = (unitToken.text ?? unitToken.value ?? "").toLowerCase();

			// "to 2 decimal places" is four tokens; the rest are three.
			let consumed = 3;
			if (PLACE_PHRASES.has(word)) {
				const tail = tokens[pos + 3];
				const tailWord = (tail?.text ?? "").toLowerCase();
				if (tailWord !== "place" && tailWord !== "places") return null;
				consumed = 4;
			} else if (!PLACE_WORDS.has(word)) {
				return null;
			}

			return {
				consumed,
				replacement: [
					createFusedToken("DECIMAL_PLACES", count.value, tokens.slice(pos, pos + consumed)),
				],
				ruleName: "converters:decimal-places",
			};
		},
	};
}
