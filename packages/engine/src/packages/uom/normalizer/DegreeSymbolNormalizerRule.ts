import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

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
		match(tokens, pos): NormalizerMatch | null {
			// Matched from the number rather than from the symbol, so the
			// replacement emits the pair together and the unit lands adjacent to
			// the quantity it belongs to.
			const number = tokens[pos];
			if (number?.type !== "NUMBER") return null;

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
