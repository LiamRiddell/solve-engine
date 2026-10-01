/**
 * When a colon between two numbers is a label's rather than a time's:
 * `Item 2: 45`, `Room 4: 12`, `Weeks 1-2: 40`.
 *
 * The time rules join a number, a colon and a number into one literal
 * (`9:30`, `1:23:45`, `5:30/km`). A ledger line names a figure the same way,
 * `Item 2: 45`, and when the pair happened to make a real time the rules took
 * it, so the label lost its number and the line was refused with the parser's
 * `found "2:45"`. `Week 12: 75` only worked because 12:75 is no time.
 *
 * Two things together mark the label's colon:
 *
 * - **A space after the colon.** A time is written with its colon touching the
 *   minutes (`9:30`); a label's colon is followed by a space, as in prose.
 * - **A name before the number.** The number follows a word, as `Item 2`,
 *   `Room 4` and `Weeks 1-2` do, with only the numbers and joining marks
 *   (`-`, `/`) a name has between them.
 *
 * The boundary: a spaced pair that starts the line, or follows an operator,
 * a bracket or `=`, is still a time (`9: 30`, `x = 5: 6`, `2*3: 4`), since no
 * name stands before it. A word that leads into a time (`at`, `before`,
 * `until`, `from`, `the`; see {@link TIME_LEAD_WORDS} and `LEAD_IN_WORDS`) is
 * no name either, so `before 9: 30` keeps its time. And a colon that touches
 * both numbers is a time whatever stands before it (`Lap 1:23`, `at 9:30`).
 *
 * Constant time per call: the walk back over the name's numbers is bounded by
 * {@link MAX_NAME_NUMBERS}.
 */

import type { Token } from "@solve-js/lexer/Token";
import { LEAD_IN_WORDS } from "@solve-js/engine/WordLabel";

/** A name's word holds a letter: `Item`, `Q1`, `my_total`. */
const LETTER = /\p{L}/u;

/**
 * Words that lead into a time rather than name a figure, beyond the articles
 * and prepositions of `LEAD_IN_WORDS`: `before 9: 30` is a time, not a label
 * `before 9`. Compared lower-cased.
 */
export const TIME_LEAD_WORDS: ReadonlySet<string> = new Set([
	"at", "before", "after", "past", "till", "til", "until", "to", "since", "between", "then", "from", "starts", "ends",
]);

/** The token types a name's numbers are written with: `Weeks 1-2`, `Part 1/2`. */
const NAME_NUMBER_PARTS: ReadonlySet<string> = new Set(["NUMBER", "MINUS", "SLASH"]);

/** The most tokens of numbers and joining marks a name holds before its word. */
export const MAX_NAME_NUMBERS = 7;

/**
 * Whether the token after the colon at `colon` is set apart from it by a
 * space, as a label's figure is (`Item 2: 45`) and a time's minutes are not
 * (`2:45`).
 *
 * @param tokens - The pass's tokens.
 * @param colon - The index of the colon.
 * @returns `true` when `colon` is a COLON with a token after it that does not
 *   touch it.
 */
export function spaceAfterColon(tokens: readonly Token[], colon: number): boolean {
	const mark = tokens[colon];
	const next = tokens[colon + 1];
	if (mark?.type !== "COLON" || next === undefined) return false;
	const end = mark.sourceEnd ?? mark.offset + mark.text.length;
	return next.offset > end;
}

/**
 * Whether the number at `pos` is part of a name: it follows a word, with only
 * a name's numbers and joining marks between (`Item 2`, `Weeks 1-2`). The
 * word is a name (an identifier or a unit word with a letter in it, such as
 * `Item`, `Q1` or `my_total`), never one that leads into what follows it.
 *
 * @param tokens - The pass's tokens.
 * @param pos - The index of the number.
 * @returns `true` when a naming word stands before the number.
 */
export function numberFollowsName(tokens: readonly Token[], pos: number): boolean {
	if (tokens[pos]?.type !== "NUMBER") return false;
	let k = pos - 1;
	let parts = 0;
	while (k >= 0 && parts < MAX_NAME_NUMBERS && NAME_NUMBER_PARTS.has(tokens[k].type)) {
		k--;
		parts++;
	}
	const word = tokens[k];
	if (word === undefined || (word.type !== "IDENT" && word.type !== "UNIT")) return false;
	// A name's joining mark sits between numbers: `Item -2` is no name.
	if (tokens[k + 1]?.type !== "NUMBER") return false;
	const text = word.text;
	if (!LETTER.test(text)) return false;
	const lower = text.toLowerCase();
	return !LEAD_IN_WORDS.has(lower) && !TIME_LEAD_WORDS.has(lower);
}

/**
 * Whether the colon after the number at `pos` separates a label from its
 * figure, so no time rule should join the number to the one after the colon.
 *
 * @param tokens - The pass's tokens.
 * @param pos - The index of the number before the colon.
 * @returns `true` for `Item 2: 45`; `false` for `9: 30`, `Item 2:45` and
 *   `x = 5: 6`.
 */
export function isLabelColon(tokens: readonly Token[], pos: number): boolean {
	return spaceAfterColon(tokens, pos + 1) && numberFollowsName(tokens, pos);
}
