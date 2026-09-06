import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * The token types that, following `in`, leave no conversion for it to be the
 * preposition of.
 *
 * A whitelist rather than a list of targets, because the failure directions are
 * not symmetric: a type missing from here leaves the old reading in place, and a
 * type wrongly added to a list of targets would turn a working conversion into
 * inches. `$500 in 1990 dollars` and `99 in binary` are why: their right-hand
 * sides are neither units nor identifiers, and a rule that fired on everything
 * it did not recognise claimed both of them.
 */
const NOTHING_TO_CONVERT_INTO: ReadonlySet<string> = new Set([
	// Another preposition: the `12 in in cm` and `12 in to cm` shapes, where the
	// second word is doing the converting and the first has to be the unit.
	"IN",
	"TO",
	// An operator, which ends the quantity: `2 in + 3 in`, `(5 in) * 2`.
	"PLUS",
	"MINUS",
	"STAR",
	"SLASH",
	"CARET",
	"RPAREN",
	"COMMA",
	"RBRACKET",
	"RBRACE",
]);

/**
 * `12 in` as twelve inches, where `in` cannot be the conversion preposition.
 *
 * `in` is the conversion operator, so the unit table deliberately refuses to
 * claim the spelling (`lexer/units.ts`'s excluded list) and the word lexes as a
 * keyword wherever it appears. That is right for `12 in ft`, which is the most
 * common form in the engine, and wrong for `12 in in cm`: the first `in` there
 * is the unit, and reading it as the preposition took the magnitude and
 * relabelled it, so the answer was `12.00 cm` where the full spelling gives
 * `30.48 cm`. `2 in + 3 in` lost the unit entirely and answered a bare `5`.
 *
 * The shape that separates them is what follows the word. A conversion needs
 * something to convert into, so `in` is the unit only where there is plainly
 * nothing there to convert into: at the end of the line, before an operator, or
 * before another `in` or a `to`, which is the `12 in in cm` case itself. Every
 * other continuation keeps the reading the line already had.
 *
 * The claim is deliberately narrow in the other direction too. It fires only
 * directly after a number, so `3 ft in in` still reads as a conversion into
 * inches: the `in` there follows a unit, not a quantity, and the word is doing
 * its ordinary job.
 *
 * The boundary this leaves alone: `12 in ft` and `12 in cm` stay conversions,
 * which for a bare number relabels it, exactly as they did before. Whether a
 * unitless number should be convertible at all is a separate question from
 * whether `in` is a unit here.
 *
 * @module InchAbbreviationNormalizerRule
 */

/** The rule: see the module comment for what separates the unit from the preposition. */
export function inchAbbreviationNormalizerRule(priority = 74): NormalizerRule {
	const RULE = "uom:inch-abbreviation";
	return {
		name: RULE,
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["NUMBER"] }, { types: ["IN"] }],
		match(tokens, pos): NormalizerMatch | null {
			// Matched from the number rather than from the word, so the
			// replacement emits the pair together and the unit lands adjacent to
			// the quantity it belongs to, the way the degree-symbol rule does.
			const number = tokens[pos];
			if (number?.type !== "NUMBER") return null;

			const word = tokens[pos + 1];
			if (word?.type !== "IN") return null;

			// The end of the line leaves nothing to convert into either.
			const next = tokens[pos + 2];
			if (next !== undefined && !NOTHING_TO_CONVERT_INTO.has(next.type)) return null;

			return {
				consumed: 2,
				replacement: [number, createFusedToken("UNIT", "in", [word])],
				ruleName: RULE,
			};
		},
	};
}
