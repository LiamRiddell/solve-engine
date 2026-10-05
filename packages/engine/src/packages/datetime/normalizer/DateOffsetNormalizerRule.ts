import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { getMeasure } from "@solve-js/uom/UomConverter";
import { lowerCased } from "@solve-js/normalizer/RuleIndex";
import { isCalendarLength, readCompoundQuantity } from "@solve-js/uom/CompoundQuantity";

/**
 * The three words that put a duration in front of a date, and which way each
 * one counts.
 *
 * `before` is not a lexer keyword and arrives as an ordinary identifier, which
 * is why it is matched by value here rather than by token type.
 */
const CONNECTORS: ReadonlyMap<string, "DATE_OFFSET_AFTER" | "DATE_OFFSET_BEFORE"> = new Map([
	["FROM", "DATE_OFFSET_AFTER"],
	["AFTER", "DATE_OFFSET_AFTER"],
	["before", "DATE_OFFSET_BEFORE"],
] as const);

/**
 * The offset token a connector after a time unit opens, or undefined: `from`
 * and `after` by their keyword type, `before` by its word in any case.
 *
 * A `Map`, which holds only its own keys: read as an object, a word naming an
 * inherited property (`5 days constructor 3`) found `Object` itself and made
 * it the fused token's type, which the next pass could not read.
 *
 * @param connector - The token after the unit.
 */
export function offsetConnectorOf(connector: Token): "DATE_OFFSET_AFTER" | "DATE_OFFSET_BEFORE" | undefined {
	return CONNECTORS.get(connector.type) ??
		(connector.type === "IDENT" ? CONNECTORS.get(lowerCased(connector.value ?? "")) : undefined);
}

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
			// The connector first, a lookup by type: most units are followed by
			// no connector at all (`120 km/h`), and the unit's measure is a
			// second lookup.
			const connector = tokens[pos + 1];
			if (connector === undefined) return null;
			const fused = offsetConnectorOf(connector);
			if (fused === undefined) return null;
			if (getMeasure(unitToken.value ?? "") !== "time") return null;
			// After `line N for`, the word is a sweep's input name, not a unit:
			// `line 2 for d from 1 to 3 step 1` sweeps a variable `d`, and read
			// as "days from" it failed to parse (#505).
			// The rule may see `line 2` fused into a LINE_REF or still as its
			// two words, depending on which rule reached it first.
			const before = tokens[pos - 1];
			const isFor = before?.type === "FOR_DURATION" || (before?.type === "IDENT" && (before.value ?? "").toLowerCase() === "for");
			const lineRefBefore =
				tokens[pos - 2]?.type === "LINE_REF" ||
				(tokens[pos - 2]?.type === "NUMBER" && (tokens[pos - 3]?.value ?? "").toLowerCase() === "line");
			if (isFor && lineRefBefore) return null;
			// Or already opened as a sweep, whose token stands for `line N for`.
			if (before?.type === "SWEEP") return null;

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

/**
 * The token each further part of a length of several units becomes in front
 * of a date offset, its value `<amount> <unit>` as in `1 day`. Only ever
 * emitted straight after a `DATE_OFFSET_AFTER` or `DATE_OFFSET_BEFORE`, whose
 * parselet reads it.
 */
export const DATE_OFFSET_PART_TYPE = "DATE_OFFSET_PART";

/**
 * The fused connector a token stands for (`from`, `after`, `before`), or
 * undefined when it is not one, or there is no token: {@link offsetConnectorOf}
 * for a place that may be past the end of the line. A word naming an inherited
 * property (`5 days constructor 3`) is not a connector, since that lookup reads
 * the map's own entries only.
 */
export function connectorAt(token: Token | undefined): "DATE_OFFSET_AFTER" | "DATE_OFFSET_BEFORE" | undefined {
	return token === undefined ? undefined : offsetConnectorOf(token);
}

/**
 * `1 month 1 day after 31 January 2026`, a date offset whose length is written
 * in several units led by a day or longer (see `isCalendarLength`).
 *
 * The parts are applied to the date one at a time, largest first, as
 * `31 January 2026 + 1 month + 1 day` applies them: the month is clamped to
 * February 28 and the day then lands on March 1. Summed into one length first,
 * the 30-day month of the unit table made it March 3. `before` takes each part
 * off in the same order.
 *
 * The first part becomes the count and the fused connector, as a one-unit
 * offset does, and each further part a {@link DATE_OFFSET_PART_TYPE} token that
 * the connector's parselet reads before its date. The rule runs above the
 * compound-quantity rule, which would otherwise sum the parts before the
 * connector is seen. A length led by hours or smaller
 * (`1 hour 30 minutes from 9:00`) is a fixed length, so it is left to that sum.
 */
export function compoundDateOffsetNormalizerRule(priority = 64): NormalizerRule {
	const RULE = "datetime:compound-date-offset";
	return {
		name: RULE,
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["NUMBER"] }, { types: ["UNIT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const quantity = readCompoundQuantity(tokens, pos);
			if (quantity === null || !isCalendarLength(quantity)) return null;
			const fused = connectorAt(tokens[pos + quantity.consumed]);
			// There has to be something to offset from.
			if (fused === undefined || tokens[pos + quantity.consumed + 1] === undefined) return null;

			const [first, ...rest] = quantity.parts;
			const source = tokens.slice(pos, pos + quantity.consumed + 1);
			return {
				consumed: quantity.consumed + 1,
				replacement: [
					createFusedToken("NUMBER", first.amount, [tokens[pos]]),
					createFusedToken(fused, first.spelling, [first.unitToken]),
					...rest.map((part) => createFusedToken(DATE_OFFSET_PART_TYPE, `${part.amount} ${part.spelling}`, source)),
				],
				ruleName: RULE,
			};
		},
	};
}
