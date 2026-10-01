import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { lowerCased, valueLowersTo } from "@solve-js/normalizer/RuleIndex";

/** Weekday token type to the index the calendar uses (0 = Sunday). */
const WEEKDAY_TOKEN_INDEX: ReadonlyMap<string, number> = new Map([
	["SUNDAY", 0], ["MONDAY", 1], ["TUESDAY", 2], ["WEDNESDAY", 3], ["THURSDAY", 4], ["FRIDAY", 5], ["SATURDAY", 6],
]);

/**
 * The plural spellings, which are the ones a person counting actually writes.
 *
 * Only the singulars are lexer keywords, since those are the forms a date needs
 * (`next friday`). `fridays` is an ordinary identifier, and this is the one
 * place it means something, so it is recognised here rather than claimed
 * globally.
 *
 * A `Map`, which holds only its own keys: read as an object, a word naming an
 * inherited property (`constructor until friday`) found `Object` itself and
 * put its source text into the line's error message.
 */
const WEEKDAY_PLURAL_INDEX: ReadonlyMap<string, number> = new Map([
	["sundays", 0], ["mondays", 1], ["tuesdays", 2], ["wednesdays", 3], ["thursdays", 4], ["fridays", 5], ["saturdays", 6],
]);

/** The connector after the weekday, and the token each one fuses to. */
const CONNECTOR_TYPE: ReadonlyMap<string, string> = new Map([
	["BETWEEN", "WEEKDAY_BETWEEN"],
	["UNTIL", "WEEKDAY_UNTIL"],
	["SINCE", "WEEKDAY_SINCE"],
]);

/**
 * The calendar index of the weekday a token names: a weekday keyword
 * (`friday`), or the plural identifier (`fridays`) in any case. Undefined for
 * any other token.
 */
export function weekdayIndexOf(token: Token): number | undefined {
	return WEEKDAY_TOKEN_INDEX.get(token.type) ??
		(token.type === "IDENT" ? WEEKDAY_PLURAL_INDEX.get(lowerCased(token.value ?? "")) : undefined);
}

/**
 * `fridays between 01/06/2026 and 31/08/2026`, counting a weekday across a
 * range.
 *
 * Planning against a weekday is an ordinary thing to want and there was no
 * form for it. The nearest approximation ignores which weekday the range starts
 * and ends on, so it is wrong at both ends: `weeks between` the dates above is
 * 13 whichever weekday you asked about, and the real answers differ.
 *
 * This is the sibling of {@link betweenUnitNormalizerRule}, which fuses a unit
 * with the same connectors and refuses a weekday because a weekday is not a
 * unit. Both spellings of the weekday are taken: `fridays`, which is what
 * somebody counting writes, and the singular `friday`, which is the lexer
 * keyword a date uses. A leading `how many` is swallowed the same way, and for
 * the same reason: it reads as one phrase to a person and is two ordinary
 * identifiers to the lexer, so fusing it only here keeps `how` and `many` from
 * shadowing variables named either.
 *
 * @module WeekdayCountNormalizerRule
 */

/** The rule: see the module comment for why both spellings of the weekday are taken. */
export function weekdayCountNormalizerRule(priority = 61): NormalizerRule {
	const RULE = "datetime:weekday-count";
	return {
		name: RULE,
		priority,
		// The first token is `how`, a weekday keyword, or the plural identifier,
		// so the slot is their union. See RuleSlot on why an over-broad slot is
		// safe and an over-narrow one is not.
		startTokenTypes: ["IDENT", "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			// Optional leading `how many`, as the between-unit rule does.
			let start = pos;
			let howManyLength = 0;
			if (valueLowersTo(tokens[pos], "how") && valueLowersTo(tokens[pos + 1], "many")) {
				start = pos + 2;
				howManyLength = 2;
			}

			const weekdayToken = tokens[start];
			const connectorToken = tokens[start + 1];
			if (!weekdayToken || !connectorToken) return null;

			// The connector first: a type lookup, where the weekday may need its
			// word lower-cased, and in running prose it is what is missing.
			const fused = CONNECTOR_TYPE.get(connectorToken.type);
			if (fused === undefined) return null;

			const index = weekdayIndexOf(weekdayToken);
			if (index === undefined) return null;

			const sources = tokens.slice(pos, start + 2);
			return {
				consumed: howManyLength + 2,
				replacement: [createFusedToken(fused, String(index), sources)],
				ruleName: RULE,
			};
		},
	};
}
