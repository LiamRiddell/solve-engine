import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/**
 * Fuses two adjacent unit tokens into the single multi-word unit the table
 * already carries, when that is what the pair spells.
 *
 * The lexer reads a unit as one run of word characters, so a spelling with a
 * space in it arrives as two tokens and the first one wins on its own. That is
 * not merely a missing feature, it produces a wrong answer with no error: `fl`
 * is a lexable spelling of the FEMTOLITRE, so `1 fl oz` was one femtolitre
 * relabelled `oz` and `1 cup in fl oz` reported 236,588,236,500,000. A recipe's
 * sixteen fluid ounces became sixteen ounces of weight. `oz t` landed on tonnes
 * the same way, a factor of thirty thousand out, and `kW h` on hours.
 *
 * Fusing here rather than teaching the lexer about spaces keeps the lexer's one
 * rule about what a unit looks like intact, and keeps the vocabulary in the one
 * place it is already defined: only a pair the table itself spells with a space
 * fuses, so nothing is invented and the rule cannot drift from the table.
 *
 * Deliberately narrow in three ways:
 *
 * - Both tokens must be UNIT tokens, so an identifier that happens to sit
 *   after a unit is left alone.
 * - They must be separated by exactly one space, because that is what the
 *   table key contains. `1 fl  oz` with two spaces is not a spelling the table
 *   has, and neither is `1 fl` at the end of one line and `oz` at the start of
 *   the next.
 * - The lookup is case-sensitive, like every other read of UNIT_TABLE. `W h`
 *   is the watt-hour and `w h` is not a spelling of anything.
 *
 * Seventeen pairs qualify today: the watt-hour and its twelve metric prefixes,
 * `oz t`, `ac ft` and `fl oz`. Each of them was previously read as its second
 * token applied to a quantity of its first, which is wrong in every case.
 */
export function multiWordUnitNormalizerRule(priority = 78): NormalizerRule {
	return {
		name: "uom:multi-word-unit",
		priority,
		match(tokens, pos): NormalizerMatch | null {
			const first = tokens[pos];
			const second = tokens[pos + 1];
			if (first?.type !== "UNIT" || second?.type !== "UNIT") return null;

			// Exactly one space between them, measured from the source offsets
			// rather than assumed from token order.
			if (first.offset + first.text.length + 1 !== second.offset) return null;

			const spelling = `${first.value} ${second.value}`;
			if (UNIT_TABLE[spelling] === undefined) return null;

			return {
				consumed: 2,
				replacement: [createFusedToken("UNIT", spelling, tokens.slice(pos, pos + 2))],
				ruleName: "uom:multi-word-unit",
			};
		},
	};
}
