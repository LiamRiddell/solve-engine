import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { getMeasure } from "@solve-js/uom/UomConverter";

/**
 * The three words that put a duration in front of a date, and which way each
 * one counts.
 *
 * `before` is not a lexer keyword and arrives as an ordinary identifier, which
 * is why it is matched by value here rather than by token type.
 */
const CONNECTORS: Readonly<Record<string, "DATE_OFFSET_AFTER" | "DATE_OFFSET_BEFORE">> = {
	FROM: "DATE_OFFSET_AFTER",
	AFTER: "DATE_OFFSET_AFTER",
	before: "DATE_OFFSET_BEFORE",
};

/**
 * `30 days from 3 March 2026`, a date offset written the way a person says it.
 *
 * The harder, rarer sibling already shipped: `30 working days from 3 March 2026`
 * has always answered, because that is a fixed three-word phrase the package
 * fuses. The ordinary one did not, and everyone with a deadline, a renewal, a
 * notice period or an invoice term wants the ordinary one. The arithmetic was
 * never the gap either, since `3 March 2026 + 30 days` has always been right,
 * including the month clamping.
 *
 * A fixed phrase cannot cover this, because the unit is part of what the reader
 * writes: days, weeks and months all have to work. So the unit and the
 * connector are fused instead, which is the shape
 * {@link betweenUnitNormalizerRule} already uses for `days between`.
 *
 * Fusing is also what keeps the connectors out of each other's way. `after` is
 * the finance package's own infix, as in `£1,000 at 5% after 3 years`, and it
 * stays that way: this rule claims the word only when a **time** unit sits
 * directly in front of it, so `5% after` is untouched, and so is `30 kg after`,
 * which is not a duration and cannot offset a date.
 *
 * `to` is deliberately not claimed. `2 April 2026 to 6 September 2026` already
 * means something, and quietly turning it into an offset would take that away.
 *
 * @module DateOffsetNormalizerRule
 */

/** The rule: see the module comment for why the unit is what claims the connector. */
export function dateOffsetNormalizerRule(priority = 62): NormalizerRule {
	const RULE = "datetime:date-offset";
	return {
		name: RULE,
		priority,
		// Derived from this rule's own opening guard; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["UNIT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const unitToken = tokens[pos];
			if (unitToken?.type !== "UNIT") return null;
			if (getMeasure(unitToken.value ?? "") !== "time") return null;

			const connector = tokens[pos + 1];
			if (connector === undefined) return null;
			const fused =
				CONNECTORS[connector.type] ??
				(connector.type === "IDENT" ? CONNECTORS[(connector.value ?? "").toLowerCase()] : undefined);
			if (fused === undefined) return null;

			// There has to be something to offset from.
			if (tokens[pos + 2] === undefined) return null;

			return {
				consumed: 2,
				replacement: [createFusedToken(fused, unitToken.value, [unitToken, connector])],
				ruleName: RULE,
			};
		},
	};
}
