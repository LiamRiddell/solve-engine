import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { resolveCurrencyAlias } from "@solve-js/uom/CurrencyAliases";
import { isDenominatorUnit } from "./BareRateDenominatorNormalizerRule";

/** The token types a currency symbol arrives as: `$`, `£`, `€`. */
const CURRENCY_SYMBOL_TYPES: ReadonlySet<string> = new Set(["DOLLAR", "POUND", "EURO", "YEN", "RUBLE", "WON", "CURRENCY_SYMBOL"]);

/**
 * The top of a rate target, as the unit spelling it names: a unit as written
 * (`miles`), a currency word or symbol as its code (`dollars` and `$` are
 * `USD`). `undefined` for any other token.
 *
 * @param token - The token after `in` or `to`.
 * @returns The numerator's spelling, or `undefined`.
 */
export function rateTargetNumerator(token: Token | undefined): string | undefined {
	if (token === undefined) return undefined;
	const text = token.value ?? "";
	if (text === "") return undefined;
	if (token.type === "UNIT") return resolveCurrencyAlias(text) ?? text;
	if (CURRENCY_SYMBOL_TYPES.has(token.type)) return resolveCurrencyAlias(text);
	return undefined;
}

/** Whether a token introduces a rate's denominator in a target: a slash, or the word `per`. */
function introducesDenominator(token: Token | undefined): boolean {
	if (token === undefined) return false;
	if (token.type === "SLASH") return true;
	return token.type === "IDENT" && (token.text ?? token.value ?? "").toLowerCase() === "per";
}

/**
 * Reads a conversion target written as a rate the way a source can be (#738):
 * `in miles per hour`, `in $/day`, `in dollars per day`, `in £ / hour`, and a
 * count per something, `in /s`. Each becomes one unit token, `miles/hour`,
 * `USD/day`, `GBP/hour` or `/s`, which is the target `in miles/hour` and
 * `in USD/day` already were.
 *
 * Without this, the target was cut at its first unit: `in miles` was taken as
 * the target and `per hour` was read after the conversion, so a speed was
 * refused as "not a length" and `$20/hour in $/day` as "not money".
 *
 * Narrow on purpose:
 *
 * - Only straight after `in` or `to`, and only with a unit after the slash or
 *   `per`, so `per` in prose after a conversion is untouched.
 * - Only `per` and the slash. `a`, `each` and `every` also introduce a rate on
 *   the source side, but after a conversion they are prose (`100 km in miles a
 *   day` stays a distance converted, then a rate).
 * - `in $` with nothing after it is still a currency conversion: a symbol is
 *   joined only when a denominator follows.
 */
export function rateTargetNormalizerRule(priority = 78): NormalizerRule {
	const RULE = "uom:rate-target";
	return {
		name: RULE,
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["IN", "TO"] }],
		match(tokens, pos): NormalizerMatch | null {
			const keyword = tokens[pos];
			if (keyword?.type !== "IN" && keyword?.type !== "TO") return null;
			// Straight after a number, `in` is the inch: `5 in/s` is five inches a
			// second, not five converted into a count per second.
			if (tokens[pos - 1]?.type === "NUMBER") return null;
			// `in /s`: a count per something.
			if (tokens[pos + 1]?.type === "SLASH" && isDenominatorUnit(tokens[pos + 2])) {
				const denominator = tokens[pos + 2];
				return {
					consumed: 3,
					replacement: [keyword, createFusedToken("UNIT", `/${denominator.value}`, [tokens[pos + 1], denominator])],
					ruleName: RULE,
				};
			}
			const numerator = rateTargetNumerator(tokens[pos + 1]);
			if (numerator === undefined) return null;
			if (!introducesDenominator(tokens[pos + 2]) || !isDenominatorUnit(tokens[pos + 3])) return null;
			const denominator = tokens[pos + 3];
			return {
				consumed: 4,
				replacement: [keyword, createFusedToken("UNIT", `${numerator}/${denominator.value}`, [tokens[pos + 1], tokens[pos + 2], denominator])],
				ruleName: RULE,
			};
		},
	};
}
