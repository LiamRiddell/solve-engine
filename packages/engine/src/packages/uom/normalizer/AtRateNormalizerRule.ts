import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { isPhysicalTimeRate } from "@solve-js/uom/UomConverter";

/** Whether a token is a unit spelling the engine knows. */
function isUnit(token: Token | undefined): boolean {
	if (token === undefined || token.type !== "UNIT") return false;
	return UNIT_TABLE[(token.value ?? "").toLowerCase()] !== undefined;
}

/** Words that introduce a rate denominator, matching the bare-denominator rule. */
const PER_WORDS = new Set(["per", "a", "an", "each", "every"]);

/**
 * Whether a rate denominator appears soon after `from`.
 *
 * Checked against the raw shapes as well as the already-fused `PER_UNIT`, so
 * this does not depend on which normalizer rule ran first.
 */
function hasRateAhead(tokens: readonly Token[], from: number): boolean {
	for (let i = from; i < tokens.length && i < from + 5; i++) {
		const token = tokens[i];
		if (token.type === "PER_UNIT") return true;
		if (token.type === "EOF" || token.type === "COMMA" || token.type === "RATE_AT") return false;
		// A single-token physical rate over time, `60 mph` / `50 Mbps`: a distance
		// or data size at one of these is a duration, so the `at` is a rate `at`.
		if (token.type === "UNIT" && isPhysicalTimeRate(token.value ?? undefined)) return true;
		const word = (token.text ?? token.value ?? "").toLowerCase();
		const introducesDenominator =
			token.type === "SLASH" || (token.type === "IDENT" && PER_WORDS.has(word));
		if (introducesDenominator && isUnit(tokens[i + 1])) return true;
	}
	return false;
}

/**
 * Retypes `at` to `AT_RATE`, but only when a rate actually follows.
 *
 *   30 hours at $30/hour   ->  AT_RATE
 *   $500 at $20/hour       ->  AT_RATE
 *   over 6 years at 6%     ->  left alone
 *
 * The lookahead is the entire point. Registering an ordinary infix parselet on
 * `at` was tried and broke every mortgage and investment expression: the
 * finance grammar parses its own rate with the same word, and the infix took
 * the token before those parselets could consume it, so
 * `$1,000 after 3 years at 7%` failed with "Unexpected end of input".
 *
 * Looking for a denominator ahead separates them cleanly, because a finance
 * rate is a bare percentage and never has one. The scan is deliberately short
 * and stops at anything that ends a clause, so a `/` much later in the line
 * cannot drag an unrelated `at` into this.
 */
export function atRateNormalizerRule(priority = 73): NormalizerRule {
	return {
		name: "uom:at-rate",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["RATE_AT"] }],
		match(tokens, pos): NormalizerMatch | null {
			if (tokens[pos]?.type !== "RATE_AT") return null;
			if (!hasRateAhead(tokens, pos + 1)) return null;

			return {
				consumed: 1,
				replacement: [createFusedToken("AT_RATE", "at", [tokens[pos]])],
				ruleName: "uom:at-rate",
			};
		},
	};
}
