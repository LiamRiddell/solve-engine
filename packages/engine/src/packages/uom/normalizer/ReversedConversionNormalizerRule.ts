import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { namesAUnit } from "@solve-js/vm/VMConversion";

/**
 * Whether a token is a unit spelling the engine knows, read the way the rest
 * of the unit system reads one: in its own case, and from every table the
 * conversion path consults (an extended unit such as `furlong`, a currency).
 *
 * This used to look the lower-cased text up in the generated table alone, so
 * `km in 1 furlong` and `USD in 1 EUR` were refused, and `mW` would have been
 * read as `mw` (#825).
 */
export function isReversibleUnit(token: Token | undefined): boolean {
	if (token === undefined || token.type !== "UNIT") return false;
	const text = token.value;
	if (typeof text !== "string" || text === "") return false;
	return namesAUnit(text);
}

/** Articles that stand in for "one" in front of a unit. */
const ARTICLES = new Set(["a", "an"]);

/**
 * Conversions asked the other way round: `meters in 10 km`, `days in 3 weeks`,
 * `seconds in a day`.
 *
 * `10 km in meters` has always worked. Asking "how many X in Y" is the same
 * question with the parts swapped, and it failed on the leading unit, which
 * had nothing in front of it to convert.
 *
 * Implemented as a reorder rather than a second conversion grammar, so there
 * is still exactly one path that performs a conversion and this is only a
 * different way of spelling the input.
 *
 * Narrow on purpose. The quantity after `in` must be a plain number and unit,
 * optionally with the article standing in for the one, so:
 *
 * - `days in February 2020` is left alone. That asks how long a named period
 *   is, which is a different question with a different answer, and quietly
 *   turning it into `February 2020 in days` would answer something nobody
 *   asked.
 * - `10 km in m` is untouched, since it does not start with a bare unit.
 */
export function reversedConversionNormalizerRule(priority = 61): NormalizerRule {
	return {
		name: "uom:reversed-conversion",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["UNIT"] }, { types: ["IN"] }],
		match(tokens, pos): NormalizerMatch | null {
			// A bare unit, at the very start of the expression. Anywhere else it
			// is far more likely to be part of something already being parsed.
			if (pos !== 0 || !isReversibleUnit(tokens[pos])) return null;
			if (tokens[pos + 1]?.type !== "IN") return null;

			const target = tokens[pos];
			const third = tokens[pos + 2];
			if (third === undefined) return null;

			// `days in 3 weeks`
			if (third.type === "NUMBER" && isReversibleUnit(tokens[pos + 3])) {
				return {
					consumed: 4,
					replacement: [third, tokens[pos + 3], tokens[pos + 1], target],
					ruleName: "uom:reversed-conversion",
				};
			}

			// `km in -1 mile`: a signed count. Left alone, the rule did not match
			// and the leading unit was read as a variable, so the line failed as
			// "Undefined variable: km". The sign stays in front of the count, so
			// the conversion reads `-1 mile in km`.
			const count = tokens[pos + 3];
			if ((third.type === "MINUS" || third.type === "PLUS") && count?.type === "NUMBER" && isReversibleUnit(tokens[pos + 4])) {
				return {
					consumed: 5,
					replacement: [third, count, tokens[pos + 4], tokens[pos + 1], target],
					ruleName: "uom:reversed-conversion",
				};
			}

			// `seconds in a day`
			const word = (third.text ?? third.value ?? "").toLowerCase();
			if (third.type === "IDENT" && ARTICLES.has(word) && isReversibleUnit(tokens[pos + 3])) {
				return {
					consumed: 4,
					replacement: [
						createFusedToken("NUMBER", "1", [third]),
						tokens[pos + 3],
						tokens[pos + 1],
						target,
					],
					ruleName: "uom:reversed-conversion",
				};
			}

			return null;
		},
	};
}
