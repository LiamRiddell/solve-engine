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
 *
 * `hex` and `bin` are the exception to that, and they are named here by hand.
 * Both used to lex as CONVERTER_NAME, and both were moved to FUNC so that the
 * call spellings `hex(255)` / `bin(255)` could exist at all (a word gets one
 * token type; see the locale's own comment on those two entries).
 * AsConverterParselet was widened to accept FUNC at the same time, which kept
 * `255 as hex` working, but this rule was not, so `255 in hex` and `255 to
 * bin` stopped parsing while `255 in binary` carried on working. Only those
 * two names are listed: widening the check to FUNC in general would rewrite
 * `100 to sqrt(4)`, a percentage change, into a converter nobody asked for.
 */
const FUNC_TYPED_CONVERTERS = new Set(["hex", "bin"]);
/**
 * The rule itself.
 *
 * @param priority - Where this sits among the normalizer rules. It must run
 * before anything that reads `IN`/`TO` as its own operator, since it rewrites
 * the preposition out from under them.
 * @returns The rule, ready to register on a package.
 */
export function converterPrepositionNormalizerRule(priority = 67): NormalizerRule {
	return {
		name: "converters:preposition",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["IN", "TO"] }, { types: ["CONVERTER_NAME", "FUNC"] }],
		match(tokens, pos): NormalizerMatch | null {
			const preposition = tokens[pos];
			if (preposition?.type !== "IN" && preposition?.type !== "TO") return null;
			const target = tokens[pos + 1];
			const isConverterTarget =
				target?.type === "CONVERTER_NAME" ||
				(target?.type === "FUNC" && FUNC_TYPED_CONVERTERS.has(target.value.toLowerCase()));
			if (!isConverterTarget) return null;

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
