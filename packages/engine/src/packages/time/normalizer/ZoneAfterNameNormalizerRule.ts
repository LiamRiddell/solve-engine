import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { expectsValueAt } from "@solve-js/normalizer/ValuePosition";
import { ZONE_LOOKUP } from "../timezones/CityZones";
import { startsZoneReference } from "../parselets/shared/ZoneReference";

/**
 * `t London in Tokyo`, with `t = 3pm`: a zone named after a variable that holds
 * a time, read as the zone that time is in, to convert it into the zones after
 * `in`.
 *
 * The clock-time form (`3pm London in Tokyo`) reads its source zone inside its
 * own parselet, straight after the time it wrote out. A time held in a variable
 * had no such reading: `x London in Tokyo` stopped at "London", and with a
 * name the unit table also knows (`t`, a teaspoon; `m`, a metre) the cooking
 * rule read the zone as an ingredient and asked for a mass or a volume.
 *
 * The zone name is retyped to `ZONE_SOURCE`, which an infix parselet reads
 * with the time before it as its left operand, only in the whole shape: a
 * name the table lists (a city, a country, an abbreviation, as `3pm London`
 * reads them), straight after a variable in a value position or a closing
 * bracket (`(t + 1 hour) London in Tokyo`), and straight before `in` and
 * another zone (so `x cat in kg` is never a zone, whatever `cat` is). A zone
 * word anywhere else stays the ordinary word it was, so a variable named
 * `london` is untouched. The numeric `UTC+5` spelling is not read here; the
 * clock-time form keeps it.
 *
 * @module ZoneAfterNameNormalizerRule
 */

/** Whether a token names a zone the city table lists, by its text in any case. */
export function namesListedZone(token: Token | undefined): boolean {
	if (token === undefined || (token.type !== "IDENT" && token.type !== "CITY_NAME" && token.type !== "UNIT")) return false;
	return Object.prototype.hasOwnProperty.call(ZONE_LOOKUP, token.value.toLowerCase());
}

/**
 * Whether the token before a zone is a time the reader named: a variable
 * where a value begins (a word the unit table also knows included), or a
 * closing bracket.
 */
export function endsNamedTime(tokens: readonly Token[], at: number): boolean {
	const token = tokens[at];
	if (token === undefined) return false;
	if (token.type === "RPAREN") return true;
	return (token.type === "IDENT" || token.type === "UNIT") && expectsValueAt(tokens, at);
}

/**
 * Whether the tokens from `pos` are a named time, a listed zone, `in` and
 * another zone: the whole shape the rule claims.
 *
 * @param tokens - The line's tokens, part-way through normalising.
 * @param pos - The position of the time's last token.
 */
export function zoneAfterNameAt(tokens: readonly Token[], pos: number): boolean {
	return endsNamedTime(tokens, pos)
		&& namesListedZone(tokens[pos + 1])
		&& tokens[pos + 2]?.type === "IN"
		&& startsZoneReference(tokens[pos + 3]);
}

/**
 * The rule: see the module comment for the whole shape it claims.
 *
 * Matched at the time's last token rather than at the zone, and above implicit
 * multiplication (50), because that rule inserts its `*` from the same token
 * in the same pass: matched here first, the zone is retyped before a `*` can
 * be put in front of it.
 */
export function zoneAfterNameNormalizerRule(priority = 69): NormalizerRule {
	const RULE = "time:zone-after-name";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["IDENT", "UNIT", "RPAREN"] }, { types: ["IDENT", "CITY_NAME", "UNIT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			if (!zoneAfterNameAt(tokens, pos)) return null;
			const zone = tokens[pos + 1];
			return { consumed: 2, replacement: [tokens[pos], createFusedToken("ZONE_SOURCE", zone.value, [zone])], ruleName: RULE };
		},
	};
}
