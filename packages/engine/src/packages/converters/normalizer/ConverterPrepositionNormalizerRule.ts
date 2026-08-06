import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * Rewrites `in <converter>` and `to <converter>` into `as <converter>`.
 *
 * `256 as hex` has always worked. `99 in binary` and `0x9F31 to decimal` are
 * the same operation said differently, and both failed: `in` belongs to unit
 * conversion, which looked for a unit called "binary" and found none, and `to`
 * belongs to percentage change, which tried to parse "decimal" as a number.
 *
 * Doing this as a token rewrite rather than by teaching those two parselets
 * about converters keeps each of them with one job. It is also unambiguous in
 * a way a parselet-level fallback would not be: the lexer only produces
 * CONVERTER_NAME for a name that is already in the converter table, so there
 * is no unit and no expression this could be shadowing.
 */
export function converterPrepositionNormalizerRule(priority = 67): NormalizerRule {
	return {
		name: "converters:preposition",
		priority,
		match(tokens, pos): NormalizerMatch | null {
			const preposition = tokens[pos];
			if (preposition?.type !== "IN" && preposition?.type !== "TO") return null;
			if (tokens[pos + 1]?.type !== "CONVERTER_NAME") return null;

			// Only the preposition is replaced; the converter name is left for
			// AsConverterParselet to read exactly as it would after a real "as".
			return {
				consumed: 1,
				replacement: [createFusedToken("AS", "as", [preposition])],
				ruleName: "converters:preposition",
			};
		},
	};
}
