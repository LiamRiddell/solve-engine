import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { getMeasure } from "@solve-js/uom/UomConverter";

/** The spellings of "degree" that can sit between a number and a temperature scale. */
const DEGREE_WORDS = new Set(["degrees", "degree", "deg"]);

/** Whether a token is the degree sign or a degree word. */
function isDegreeWord(token: Token | undefined): boolean {
	if (token === undefined) return false;
	const text = token.text ?? token.value ?? "";
	if (token.type === "IDENT") return text === "°";
	return token.type === "UNIT" && DEGREE_WORDS.has(text.toLowerCase());
}

/**
 * `90°` as ninety degrees.
 *
 * The degree sign is in the unit table but could never reach it: the lexer
 * reads a unit as one run of `[A-Za-z0-9_]`, so a non-ASCII character cannot
 * become a UNIT token however well the converter understands it. `90°` lexed
 * as a number and an identifier, and `sin(90°)` failed with "Undefined
 * variable: °".
 *
 * Retyping it here is the whole fix. It needs no lexer change, because the
 * symbol is unambiguous: `°` is degrees and nothing else, so there is no
 * context in which this could be claiming something that was already spoken
 * for.
 *
 * Note this is the angle degree. Temperature is written `°C` and `°F`, which
 * lex as their own units already and are not touched, because the symbol is
 * followed by a letter there rather than standing alone.
 */
export function degreeSymbolNormalizerRule(priority = 74): NormalizerRule {
	return {
		name: "uom:degree-symbol",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["NUMBER"] }, { types: ["IDENT", "UNIT"] }],
		match(tokens, pos): NormalizerMatch | null {
			// Matched from the number rather than from the symbol, so the
			// replacement emits the pair together and the unit lands adjacent to
			// the quantity it belongs to.
			const number = tokens[pos];
			if (number?.type !== "NUMBER") return null;

			// `20 degrees C` and `20° C`: the degree word names the scale's
			// degrees, not an angle, so the pair is the temperature alone. This
			// used to lean on a second unit relabelling the first (an angle in
			// degrees relabelled as Celsius), which is now refused for every
			// other pair (issue #536), so the reading is made here instead.
			const degree = tokens[pos + 1];
			const scale = tokens[pos + 2];
			if (isDegreeWord(degree) && scale?.type === "UNIT" && getMeasure(scale.value ?? "") === "temperature") {
				return {
					consumed: 3,
					replacement: [number, scale],
					ruleName: "uom:degree-symbol",
				};
			}

			const symbol = tokens[pos + 1];
			if (symbol === undefined || symbol.type !== "IDENT") return null;
			if ((symbol.text ?? symbol.value ?? "") !== "°") return null;

			return {
				consumed: 2,
				replacement: [number, createFusedToken("UNIT", "degrees", [symbol])],
				ruleName: "uom:degree-symbol",
			};
		},
	};
}
