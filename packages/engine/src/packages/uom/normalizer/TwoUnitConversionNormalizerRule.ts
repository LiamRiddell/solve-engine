import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

function isUnit(token: Token | undefined): boolean {
	if (token === undefined || token.type !== "UNIT") return false;
	return UNIT_TABLE[(token.value ?? "").toLowerCase()] !== undefined;
}

/**
 * Recognises `in <unit> and <unit>`, the two-unit conversion.
 *
 * Fused here rather than handled by the ordinary conversion parselet, so that
 * parselet keeps its single job and does not have to look ahead for an `and`
 * that is almost never there. The two unit names ride on the fused token.
 *
 * Both names must be real units, so `in minutes and pay me` is left alone.
 */
export function twoUnitConversionNormalizerRule(priority = 59): NormalizerRule {
	return {
		name: "uom:two-unit-conversion",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["IN", "TO"] }, { types: ["UNIT"] }],
		match(tokens, pos): NormalizerMatch | null {
			const preposition = tokens[pos];
			if (preposition?.type !== "IN" && preposition?.type !== "TO") return null;
			if (!isUnit(tokens[pos + 1])) return null;
			if (tokens[pos + 2]?.type !== "AND_CONJ") return null;
			if (!isUnit(tokens[pos + 3])) return null;

			const major = tokens[pos + 1].value;
			const minor = tokens[pos + 3].value;
			return {
				consumed: 4,
				replacement: [
					createFusedToken("IN_TWO_UNITS", `${major} ${minor}`, tokens.slice(pos, pos + 4)),
				],
				ruleName: "uom:two-unit-conversion",
			};
		},
	};
}
