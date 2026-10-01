import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { spreadOperatorBefore } from "@solve-js/normalizer/ValuePosition";
import { isCalendarLength, readCompoundQuantity } from "@solve-js/uom/CompoundQuantity";

/**
 * Quantities written as several units at once: `3 hours 5 minutes 10 seconds`,
 * `5 hours 30 minutes`, `3h 5m 10s`, `1 month 1 day`.
 *
 * This is how durations are actually written, and none of it parsed. The two
 * parts sat next to each other as separate quantities and the parser reported
 * an unexpected number, which is why `5 hours 30 minutes to seconds`,
 * `16:00 + 3 hours 12 minutes` and the timespan examples all failed at the
 * same place for the same reason.
 *
 * The parts are read by {@link readCompoundQuantity} (one measure, strictly
 * decreasing units, unsigned amounts) and combined in one of two ways:
 *
 * - **Spread through a `+` or `-` before it**, when the length is a calendar
 *   length ({@link isCalendarLength}: a day or longer leads it), it is the
 *   right side of an addition or subtraction, and nothing tighter follows:
 *   `2026-01-31 + 1 month 1 day` is read `2026-01-31 + 1 month + 1 day`. On a
 *   date that applies the parts largest first, so the month moves the month
 *   field (January 31 to February 28, clamped as the engine always clamps) and
 *   the day then moves the day field, landing on March 1. Summed first, the
 *   length would be 31 days at the unit table's 30-day month, and land on
 *   March 3. A subtraction repeats the minus: `d - 1 month 1 day` is
 *   `d - 1 month - 1 day`. Between two lengths the spread gives the sum it
 *   always gave.
 * - **Summed into the smallest unit present** everywhere else, so
 *   `3 hours 5 minutes 10 seconds` becomes 11,110 seconds and behaves as one
 *   quantity afterwards: convertible, addable to a clock time, and comparable.
 *   The engine renders that total rather than restating the parts.
 */
export function compoundQuantityNormalizerRule(priority = 63): NormalizerRule {
	return {
		name: "uom:compound-quantity",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["NUMBER"] }, { types: ["UNIT"] }],
		match(tokens, pos): NormalizerMatch | null {
			const quantity = readCompoundQuantity(tokens, pos);
			if (quantity === null) return null;
			const { parts, consumed } = quantity;
			const source = tokens.slice(pos, pos + consumed);

			const operator = isCalendarLength(quantity) ? spreadOperatorBefore(tokens, pos, consumed) : null;
			if (operator !== null) {
				const replacement: Token[] = [];
				parts.forEach((part, i) => {
					if (i > 0) replacement.push(createFusedToken(operator.type, operator.text, source));
					replacement.push(createFusedToken("NUMBER", part.amount, source), createFusedToken("UNIT", part.spelling, [part.unitToken]));
				});
				return { consumed, replacement, ruleName: "uom:compound-quantity" };
			}

			// The total is expressed in the smallest unit that appeared, which
			// keeps it exact for the units people actually combine and reads
			// naturally when converted.
			const smallest = parts[parts.length - 1];
			const total = parts.reduce((sum, part) => sum + Number(part.amount) * part.ratio, 0);
			return {
				consumed,
				replacement: [
					createFusedToken("NUMBER", String(total / smallest.ratio), source),
					createFusedToken("UNIT", smallest.spelling, [smallest.unitToken]),
				],
				ruleName: "uom:compound-quantity",
			};
		},
	};
}
