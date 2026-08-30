import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const UNIT_ID = tokenTypeId("UNIT");

/**
 * Fuses the written form `l/100km` into the single unit `l100km` (litres per
 * hundred kilometres), the standard way fuel consumption is quoted (issue
 * #190). Without this the run would parse as `l / (100 km)` and read out as a
 * plain `l/km` rate; keeping it as one unit means it displays and converts as
 * `l/100km`. It matches only the exact `l / 100 km` shape (litres, over a
 * hundred, kilometres), written as one run, so it never disturbs an ordinary
 * division.
 */
export function fuelConsumptionNormalizerRule(priority = 82): NormalizerRule {
	const RULE = "fuel:l-per-100km";
	return {
		name: RULE,
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["UNIT", "IDENT"], values: ["l"] }, { types: ["SLASH"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const litres = tokens[pos];
			const slash = tokens[pos + 1];
			const hundred = tokens[pos + 2];
			const km = tokens[pos + 3];
			if (!litres || (litres.type !== "UNIT" && litres.type !== "IDENT")) return null;
			if ((litres.value ?? "").toLowerCase() !== "l") return null;
			if (slash?.type !== "SLASH") return null;
			if (hundred?.type !== "NUMBER" || hundred.value !== "100") return null;
			if (km?.type !== "UNIT" || (km.value ?? "").toLowerCase() !== "km") return null;

			const fused = new LexerToken("UNIT", UNIT_ID, "l100km", "l/100km", litres.offset, 0, litres.line, litres.col);
			return { consumed: 4, replacement: [fused], ruleName: RULE };
		},
	};
}
