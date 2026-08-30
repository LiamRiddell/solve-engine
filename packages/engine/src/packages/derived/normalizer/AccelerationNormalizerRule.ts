import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const UNIT_ID = tokenTypeId("UNIT");

/**
 * Fuses `m/s^2` (metres per second squared, an acceleration) into the single
 * unit `mps2`, so `9.81 m/s^2` is acceleration rather than the square of a speed
 * (issue #191). Without this the `^2` binds to the whole `m/s` rate and the
 * value comes out as `(m/s)²`, which is not what `m/s^2` means. It matches only
 * the exact `m / s ^ 2` run, written as one, so ordinary rate and exponent
 * arithmetic elsewhere is untouched. The unit is stored slash-free and shown as
 * `m/s²`.
 */
export function accelerationNormalizerRule(priority = 82): NormalizerRule {
	const RULE = "derived:acceleration";
	return {
		name: RULE,
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["UNIT"], values: ["m"] }, { types: ["SLASH"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const m = tokens[pos];
			const slash = tokens[pos + 1];
			const s = tokens[pos + 2];
			const caret = tokens[pos + 3];
			const two = tokens[pos + 4];
			if (!m || m.type !== "UNIT" || (m.value ?? "") !== "m") return null;
			if (slash?.type !== "SLASH") return null;
			if (s?.type !== "UNIT" || (s.value ?? "") !== "s") return null;
			if (caret?.type !== "CARET") return null;
			if (two?.type !== "NUMBER" || two.value !== "2") return null;

			const fused = new LexerToken("UNIT", UNIT_ID, "mps2", "m/s^2", m.offset, 0, m.line, m.col);
			return { consumed: 5, replacement: [fused], ruleName: RULE };
		},
	};
}
