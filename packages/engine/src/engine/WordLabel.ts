/**
 * A label written without a colon: `Rent $1200`, `Flight to Paris $450`,
 * `Petrol 40 l` (#742).
 *
 * `Rent: $1200` has long read as the label `Rent` and the amount after it. The
 * colon is the part people leave out, and a note typed that way answered
 * nothing. This module decides, from a line's tokens alone, whether a line that
 * has already failed to parse is a run of words followed by one amount. The
 * engine tries it only after the whole line and every colon label have failed
 * (see `ExpressionEngine.parseExpression`), so a line that answered before
 * answers the same.
 *
 * Prose is the reason the shape is narrow. Every line of a mostly-prose note
 * fails to parse, and this is the fallback that would make one answer, so it
 * takes only the shape a ledger line has:
 *
 * - **The label is words.** Every token before the amount is a word (letters,
 *   with an apostrophe or hyphen inside), so a number, a bracket or a symbol
 *   in front of the amount leaves the line alone. A word that is also an
 *   operator or a keyword may sit inside the label (`Flight to Paris`,
 *   `take home`), since it is the amount at the end that makes the line.
 * - **The label ends on a plain word.** The word right before the amount is a
 *   name or a unit word, never `to`, `in`, `at`, `for`, `with` or another word
 *   the engine reads: `Back in 5 min` and `Call me at 3 pm` are sentences about
 *   the amount, not a ledger line naming it. Nor is it a word that only leads
 *   into what follows it (`the`, `my`, `about`, `than`, `is`; see
 *   {@link LEAD_IN_WORDS}): `Remember the $5` and `It is 5 km` are sentences
 *   too, since a label names a thing and ends on it.
 * - **The amount is money or a quantity, and it ends the line.** A currency
 *   symbol and a number (`$1,200`, `-£5`), or a number and one unit (`45 EUR`,
 *   `40 l`, `20 square metres`). A bare number is not taken: `Chapter 12`,
 *   `Room 4` and `Page 3` are names, not amounts, and nothing on the line can
 *   tell them from `Groceries 45`. Anything after the amount (`I walked 5 km to
 *   the shop`) leaves the line alone as well.
 *
 * Linear in the line's length: one walk over the words and a look at the few
 * tokens after them, and at most one parse of the amount by the caller.
 */

import type { Token } from "@solve-js/lexer/Token";

/** A word: letters, with an apostrophe or hyphen between them. */
const WORD = /^\p{L}[\p{L}\p{M}'’-]*$/u;

/** A name of several words, as a defined multi-word variable's token carries it (#743). */
const WORDS = /^\p{L}[\p{L}\p{M}'’-]*(?: \p{L}[\p{L}\p{M}'’-]*)+$/u;

/**
 * Words that lead into the words after them and so never end a label: the
 * articles and possessives, the prepositions the engine does not already read,
 * the conjunctions, and the forms of "to be". Compared lower-cased.
 */
export const LEAD_IN_WORDS: ReadonlySet<string> = new Set([
	"a", "an", "the", "my", "our", "your", "his", "her", "their", "its", "this", "that", "these", "those",
	"some", "any", "each", "every", "no", "about", "around", "over", "under", "than", "from", "by", "on",
	"into", "onto", "of", "off", "near", "like", "as", "or", "nor", "but", "so", "if", "and",
	"is", "are", "was", "were", "be", "been", "am",
]);

/** A currency symbol (`$`, `£`, `€`, `¥`). */
const CURRENCY_SYMBOL = /^\p{Sc}$/u;

/**
 * Whether a token can be part of a label: one word of any kind, or a name of
 * several words (only an identifier, never a fused phrase such as `total
 * above`, whose words are the engine's own).
 *
 * @param token - A token from the line.
 * @returns `true` for a label word.
 */
export function isLabelWord(token: Token): boolean {
	const text = token.text;
	if (WORD.test(text)) return true;
	return token.type === "IDENT" && WORDS.test(text);
}

/**
 * Whether the tokens from `start` to the end are one amount of money or one
 * quantity, and nothing else.
 *
 * @param tokens - The line's tokens.
 * @param start - Where the amount would begin.
 * @returns `true` when they are `[-] <symbol> <number>` or `[-] <number> <unit>`.
 */
export function isAmount(tokens: readonly Token[], start: number): boolean {
	let i = start;
	if (tokens[i]?.type === "MINUS" && tokens[i].text === "-") i++;
	const first = tokens[i];
	const second = tokens[i + 1];
	if (first === undefined || second === undefined || i + 2 !== tokens.length) return false;
	if (CURRENCY_SYMBOL.test(first.text) && second.type === "NUMBER") return true;
	return first.type === "NUMBER" && second.type === "UNIT";
}

/**
 * Where the amount of a colon-free label line begins, or -1 when the line is
 * not one.
 *
 * @param tokens - The whole line's normalised tokens.
 * @returns The index of the amount's first token (the label is every token
 * before it), or -1.
 */
export function wordLabelEnd(tokens: readonly Token[]): number {
	let end = 0;
	while (end < tokens.length && isLabelWord(tokens[end])) end++;
	if (end === 0 || end === tokens.length) return -1;
	const last = tokens[end - 1];
	if (last.type !== "IDENT" && last.type !== "UNIT") return -1;
	if (LEAD_IN_WORDS.has(last.text.toLowerCase())) return -1;
	return isAmount(tokens, end) ? end : -1;
}
