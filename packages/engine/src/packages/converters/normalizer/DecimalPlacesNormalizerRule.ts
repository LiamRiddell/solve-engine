import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

const PLACE_WORDS = new Set(["dp", "dps", "decimals", "digits", "digit"]);

/** Two-word spellings whose first word alone means nothing here. */
const PLACE_PHRASES = new Set(["decimal"]);

/** The one-word spellings of significant figures. */
const FIGURE_WORDS = new Set(["sf", "s.f.", "sigfigs", "sigfig"]);

/** The first words of the two-word spellings, and the second words each takes. */
const FIGURE_PHRASES: Readonly<Record<string, ReadonlySet<string>>> = {
	sig: new Set(["figs", "fig", "figures", "figure"]),
	significant: new Set(["figures", "figure", "figs", "fig", "digits", "digit"]),
};

/**
 * How many tokens from `at` spell "significant figures", or 0 when they do not.
 *
 * @param tokens - The line's tokens.
 * @param at - The index of the word after the count.
 */
function significantFiguresLength(tokens: readonly Token[], at: number): number {
	const first = (tokens[at]?.text ?? tokens[at]?.value ?? "").toLowerCase();
	if (FIGURE_WORDS.has(first)) return 1;
	const seconds = FIGURE_PHRASES[first];
	if (seconds === undefined) return 0;
	const second = (tokens[at + 1]?.text ?? tokens[at + 1]?.value ?? "").toLowerCase();
	return seconds.has(second) ? 2 : 0;
}

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
 * Accepted spellings: `dp`, `dps`, `d.p.`, `decimal place(s)`, and `digits`;
 * and, fused to their own `SIG_FIGS` token, `sf`, `sig fig(s)` and
 * `significant figures` (or digits) for significant figures.
 * "digits" is included because Soulver documents `π to 5 digits` as 3.14159,
 * which is five decimal places rather than five significant figures.
 */
export function decimalPlacesNormalizerRule(priority = 66): NormalizerRule {
	return {
		name: "converters:decimal-places",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["TO"] }, { types: ["NUMBER"] }],
		match(tokens, pos): NormalizerMatch | null {
			if (tokens[pos]?.type !== "TO") return null;

			const count = tokens[pos + 1];
			if (count?.type !== "NUMBER") return null;

			const unitToken = tokens[pos + 2];
			if (!unitToken) return null;
			const word = (unitToken.text ?? unitToken.value ?? "").toLowerCase();

			// Significant figures: `to 3 sf`, `to 3 sig figs`, `to 3 significant
			// figures` (or digits). Fused to their own token, since the figures
			// count from the first non-zero digit rather than the decimal point.
			const figures = significantFiguresLength(tokens, pos + 2);
			if (figures > 0) {
				return {
					consumed: 2 + figures,
					replacement: [
						createFusedToken("SIG_FIGS", count.value, tokens.slice(pos, pos + 2 + figures)),
					],
					ruleName: "converters:decimal-places",
				};
			}

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
