import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * The symbol spellings of a temperature, and the unit each one names.
 *
 * The precomposed `℃` and `℉` are single characters some keyboards emit for the
 * same thing, so they are listed beside the two-character forms rather than
 * left to be discovered as a separate gap. `°K` maps to the bare `K`, because
 * the kelvin scale has no degree sign and the table spells it that way.
 */
const DEGREE_UNITS: ReadonlyMap<string, string> = new Map([
	["\u00b0C", "\u00b0C"],
	["\u00b0F", "\u00b0F"],
	["\u00b0K", "K"],
	["\u2103", "\u00b0C"],
	["\u2109", "\u00b0F"],
]);

/**
 * `20°C` as twenty degrees Celsius.
 *
 * The unit table already carries `°C` and `°F`, and they could never reach it:
 * the lexer reads a unit as one run of `[A-Za-z0-9_]`, so a non-ASCII character
 * cannot become a UNIT token, and `20°C` arrived at the parser as a number and
 * an identifier nobody had defined. Meanwhile every other spelling of the same
 * question already answered, so `20 C in F` was `68.00 F` and `20°C in F` was a
 * refusal with the answer one retyped character away.
 *
 * Retyping it here is the whole fix, and it is the same repair
 * {@link degreeSymbolNormalizerRule} makes for the bare `°` of an angle. The
 * two do not overlap: that rule claims the symbol standing alone, this one
 * claims it only when a scale letter is attached to it, which is how `90°` goes
 * on being ninety degrees of arc.
 *
 * The boundary is the symbol forms only. `C` is still Celsius and `c` is still
 * the cooking cup, no bare word is claimed, and the case sensitivity of the unit
 * table is untouched: the spellings admitted here are exactly the five above.
 *
 * @module DegreeTemperatureNormalizerRule
 */

/** The rule: see the module comment for why the scale letter is what claims it. */
export function degreeTemperatureNormalizerRule(priority = 74): NormalizerRule {
	const RULE = "uom:degree-temperature";
	return {
		name: RULE,
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["NUMBER"] }, { types: ["IDENT"] }],
		match(tokens, pos): NormalizerMatch | null {
			// Matched from the number, like the degree-symbol rule, so the unit
			// lands adjacent to the quantity it belongs to.
			const number = tokens[pos];
			if (number?.type !== "NUMBER") return null;

			const symbol = tokens[pos + 1];
			if (symbol === undefined || symbol.type !== "IDENT") return null;

			const unit = DEGREE_UNITS.get(symbol.text ?? symbol.value ?? "");
			if (unit === undefined) return null;

			return {
				consumed: 2,
				replacement: [number, createFusedToken("UNIT", unit, [symbol])],
				ruleName: RULE,
			};
		},
	};
}
