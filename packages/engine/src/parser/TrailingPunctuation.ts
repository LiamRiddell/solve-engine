/**
 * The sentence ending a line may carry when a host opts in to it.
 *
 * People end a question with `?` and a sentence with `.`, and so do language
 * models writing for a chat host: `what is 5 km in miles?`. With
 * `validation.allowTrailingPunctuation` on, one such character after a
 * complete expression is read as the end of the sentence rather than refused
 * (#741). Off by default, so strict parsing stays the default.
 */

import type { Token } from "@solve-js/lexer/Token";

/**
 * Token types after which a `?` or `.` is not a sentence ending: the
 * conversion words (`5 cm in ?` asks which units a length converts to), `=`
 * (`capital of France = ?` is the knowledge package's question) and `as`.
 * A line ending in one of these does not parse whole as it stands, so the
 * check matters only for a grammar that lets one close an expression.
 */
const NOT_AFTER: ReadonlySet<string> = new Set(["TO", "IN", "AS", "CONVERT", "EQUALS", "THEREFORE"]);

/**
 * Whether a token the parser did not consume is a sentence ending it may
 * drop: a lone `?` or `.` with nothing after it, after a token that can close
 * an expression.
 *
 * Only the last character is considered. A `?` inside a line, a doubled
 * `..` or `??`, and `.?` are left alone, since the character before the
 * last is then itself punctuation, and the parse fails on that as before.
 *
 * @param leftover - The first token the parser did not consume.
 * @param before - The token before it, the last one the expression read.
 * @param after - The token after it, if any.
 * @returns True when dropping `leftover` leaves the complete expression the
 * parser already read.
 */
export function isDroppableSentenceEnd(leftover: Token, before: Token | undefined, after: Token | undefined): boolean {
	if (after !== undefined || before === undefined) return false;
	if (leftover.type !== "QUESTION" && leftover.type !== "DOT") return false;
	if (leftover.value !== "?" && leftover.value !== ".") return false;
	if (NOT_AFTER.has(before.type)) return false;
	return before.type !== "QUESTION" && before.type !== "DOT";
}
