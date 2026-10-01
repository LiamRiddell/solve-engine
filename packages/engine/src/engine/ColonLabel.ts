/**
 * What may stand before a label's colon: `Rent: $1200`, `Week 12: 75`,
 * `pi approximation: 355/113`.
 *
 * A line that does not parse whole is retried as `<label>: <expression>`, with
 * the text before a colon set aside as the label and the text after it as the
 * answer (see `ExpressionEngine.parseExpression`). That fallback used to take
 * any text at all as the label, so a colon that belonged to something else
 * made the text before it vanish and the line answer with whatever followed:
 * `1 + 24:00` answered 0 (the label `1 + 24`), `1:23:99` answered 99 (the label
 * `1:23`) and `true ? 25 : 30` answered 30 (the label `true ? 25`). Each is a
 * confident wrong number.
 *
 * A label is a name, written the way a ledger names a figure: words, with the
 * numbers and joining marks a name has (`Week 12`, `Year-end`, `Cost/unit`,
 * `Food + drink`, `Q1/Q2`, `Done?`). This module decides, from the tokens
 * alone, when the text before a colon is not one, and says what it is instead:
 *
 * - **A time of day the clock rules refused.** A colon between two numbers is
 *   a clock time's. When the number before it starts the line, or follows an
 *   operator, a bracket or a comma with the colon touching both numbers as a
 *   time is written, it is an operand and the pair is a time, so `24:00`,
 *   `1 + 24:00` and `9:30 + 24:00` are refused as times that do not exist. A
 *   clock time with a third field written straight after it, `1:23:99`, is one
 *   too: its seconds are out of range. A number that follows a word is part of
 *   a name (`Week 12: 75`, `Week 12:75`), and a colon with a space after it
 *   (`Score >= 90: 12`) is a label's, which the rules below then read.
 * - **A choice written with `?` and `:`.** There is no such operator; a choice
 *   is `if ... then ... else`, and the refusal spells the reader's own line
 *   that way.
 * - **A comparison.** `>`, `<`, `>=`, `<=`, `==` or `!=` written as a symbol
 *   make the text a condition, not a name, so `a > b: 1` is refused rather
 *   than answered 1 whatever `a` and `b` are. The same words written as
 *   words (`Orders over $100: 12`) are prose and stay a label.
 * - **A calculation with no word in it.** `(1+2): 5` names nothing.
 *
 * The boundary: arithmetic between words stays a label (`Food + drink: $40`,
 * `Year-end: 5`, `Q1-Q2: 40`), since those are how ledgers name things and
 * the figure after the colon is the answer the reader asked for. A date on its
 * own before the colon (`2026-01-04: 45`) is still a label.
 *
 * Linear in the line's length: one walk over the tokens before the colon.
 */

import type { Token } from "@solve-js/lexer/Token";
import { isLabelWord } from "@solve-js/engine/WordLabel";

/** Why the text before a colon is not a label: the code and the reader's message. */
export interface ColonLabelFault {
	readonly code: string;
	readonly message: string;
}

/** Tokens after which a number is an operand, never part of a name. */
const OPERAND_BEFORE: ReadonlySet<string> = new Set([
	"PLUS", "MINUS", "STAR", "SLASH", "CARET", "EQUALS", "EQUALITY", "NEQ", "GT", "GTE", "LT", "LTE",
	"LPAREN", "LBRACKET", "COMMA", "QUESTION", "PLUS_EQUALS", "MINUS_EQUALS", "STAR_EQUALS", "SLASH_EQUALS",
]);

/**
 * Comparison tokens: written as a symbol, they make the text a condition, not
 * a name. An `=` never reaches here: `Net = gross: 5` is a definition whose
 * right-hand side is the labelled figure, read before any label is.
 */
const COMPARISON: ReadonlySet<string> = new Set(["EQUALITY", "NEQ", "GT", "GTE", "LT", "LTE"]);

/** Arithmetic tokens, for a label that holds no word at all. */
const ARITHMETIC: ReadonlySet<string> = new Set(["PLUS", "MINUS", "STAR", "SLASH", "CARET"]);

/** A token whose text is a word (letters), as opposed to a symbol. */
const LETTERS = /\p{L}/u;

/** The longest piece of the reader's line a message quotes before shortening it. */
export const QUOTE_LIMIT = 40;

/**
 * Where a token's source text ends: its fused end when the normaliser fused it,
 * otherwise the end of its own text.
 *
 * @param token - Any token with an offset.
 * @returns The exclusive end offset.
 */
export function tokenEnd(token: Token): number {
	return token.sourceEnd ?? token.offset + token.text.length;
}

/**
 * The reader's text for a run of tokens, with a space wherever the line had
 * one and none where it did not, so `(1+2)` reads back as typed.
 *
 * A token the normaliser fused from several words can carry the engine's own
 * reading as its text (`line 3` becomes `3`, `1 : 2` becomes `1:2`), which is
 * not what the reader typed, so a run holding one has no text to quote.
 *
 * @param tokens - Tokens in line order.
 * @returns Their text, joined as written, or null when a token's text is not
 *   the reader's.
 */
export function textOf(tokens: readonly Token[]): string | null {
	let out = "";
	for (let k = 0; k < tokens.length; k++) {
		const token = tokens[k];
		if (token.sourceEnd !== undefined && token.sourceEnd - token.offset !== token.text.length) return null;
		if (k > 0 && token.offset > tokenEnd(tokens[k - 1])) out += " ";
		out += token.text;
	}
	return out;
}

/**
 * A piece of the reader's line for a message, shortened past
 * {@link QUOTE_LIMIT} characters so a long line gives a short message.
 *
 * @param text - The text to quote.
 * @returns The text, or its start and an ellipsis.
 */
export function quoted(text: string): string {
	return text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT)}...` : text;
}

/** Whether two tokens touch, with no space between them. */
function touching(left: Token, right: Token): boolean {
	return tokenEnd(left) === right.offset;
}

/**
 * The time a colon belongs to, when the colon at `colon` is a clock time's
 * rather than a label's, or null.
 *
 * @param tokens - The line's normalised tokens.
 * @param colon - The index of a COLON token, at least 1.
 * @returns The time as written (`24:00`, `1:23:99`), or null.
 */
export function timeAtColon(tokens: readonly Token[], colon: number): string | null {
	const before = tokens[colon - 1];
	const after = tokens[colon + 1];
	if (before === undefined || after === undefined || after.type !== "NUMBER") return null;
	// A clock time with a third field straight after it: `1:23:99`. Its own
	// text ends on a digit (an am or pm cannot take seconds, so `9:30 pm: 5`
	// is a label), and the colon and the field touch it on both sides.
	if (before.type === "CLOCK_TIME") {
		if (!/\d$/.test(before.text)) return null;
		if (!touching(before, tokens[colon]) || !touching(tokens[colon], after)) return null;
		return `${before.text}:${after.text}`;
	}
	if (before.type !== "NUMBER") return null;
	// A number that follows a word is part of a name (`Week 12: 75`); one that
	// starts the line, or follows an operator, a bracket or a comma, is an
	// operand, so the pair around the colon is a time.
	const lead = tokens[colon - 2];
	if (lead !== undefined && !OPERAND_BEFORE.has(lead.type)) return null;
	if (lead !== undefined && (!touching(before, tokens[colon]) || !touching(tokens[colon], after))) return null;
	return `${before.text}:${after.text}`;
}

/**
 * How many brackets, `(` or `[`, are still open at each token: the entry at
 * `k` counts those opened before token `k` and not yet closed. A closing
 * bracket with none open is ignored, so the count is never negative.
 *
 * A label stands at the top level of a line, never inside a bracket, so a
 * colon whose count is above zero is not a label's: `Total: total(1000:1002)`
 * has its label colon at the top and a range's colon inside the call. The
 * label reading used to weigh the range's colon first (it walks from the
 * right), read `1000:1002` as a time of day and refused the line, where the
 * same call with no label answers 3,003.
 *
 * @param tokens - The line's normalised tokens.
 * @returns One count per token, in line order.
 */
export function openBracketsAt(tokens: readonly Token[]): number[] {
	const counts: number[] = new Array<number>(tokens.length);
	let depth = 0;
	for (let k = 0; k < tokens.length; k++) {
		counts[k] = depth;
		const type = tokens[k].type;
		if (type === "LPAREN" || type === "LBRACKET") depth++;
		else if ((type === "RPAREN" || type === "RBRACKET") && depth > 0) depth--;
	}
	return counts;
}

/**
 * Why the text before the colon at `colon` cannot be a label, or null when it
 * may be one.
 *
 * Only the shapes that are something else are refused; a time of day that
 * the clock rules would have read is never seen here, since it is fused into
 * one token before the parser runs and leaves no colon behind.
 *
 * @param tokens - The line's normalised tokens.
 * @param colon - The index of a COLON token, at least 1, with a token after it.
 * @returns The refusal's code and message, or null.
 */
export function colonLabelFault(tokens: readonly Token[], colon: number): ColonLabelFault | null {
	// A choice written `condition ? value : other`. The `?` has text on both
	// sides of it before the colon, so `Done?: 5` is still a label.
	for (let k = colon - 2; k >= 1; k--) {
		if (tokens[k].type === "COLON") break;
		if (tokens[k].type === "QUESTION") return ternaryFault(tokens, k, colon);
	}

	const time = timeAtColon(tokens, colon);
	if (time !== null) return { code: "INVALID_TIME_LITERAL", message: `"${time}" is not a valid time` };

	// Only the text since the previous colon is this colon's label: in
	// `Note: a > b: 1` the label `Note` has already been set aside.
	let from = 0;
	for (let k = colon - 1; k >= 0; k--) {
		if (tokens[k].type === "COLON") {
			from = k + 1;
			break;
		}
	}
	const label = tokens.slice(from, colon);
	for (const token of label) {
		if (COMPARISON.has(token.type) && !LETTERS.test(token.text)) {
			return {
				code: "LABEL_NOT_A_NAME",
				message: `${labelSubject(label)} is a comparison, not a label: a label names the figure in words, and a choice is written if ... then ... else`,
			};
		}
	}
	const hasWord = label.some((t) => isLabelWord(t) || LETTERS.test(t.text) || t.type === "DATETIME_LITERAL");
	if (!hasWord && label.some((t) => ARITHMETIC.has(t.type))) {
		return {
			code: "LABEL_NOT_A_NAME",
			message: `${labelSubject(label)} is a calculation, not a label: a label names the figure in words`,
		};
	}
	return null;
}

/**
 * How a refusal names the text before the colon: quoted as the reader typed
 * it, or in words when a fused token holds no text of the reader's.
 *
 * @param label - The label's tokens.
 * @returns The subject of the refusal's sentence.
 */
export function labelSubject(label: readonly Token[]): string {
	const text = textOf(label);
	return text === null ? "The text before the colon" : `"${quoted(text)}" before the colon`;
}

/**
 * The refusal for `condition ? value : other`, spelling the reader's own line
 * as the conditional expression the engine reads.
 *
 * @param tokens - The line's normalised tokens.
 * @param question - The index of the QUESTION token.
 * @param colon - The index of the COLON after it.
 * @returns The refusal.
 */
export function ternaryFault(tokens: readonly Token[], question: number, colon: number): ColonLabelFault {
	const lead = conditionStart(tokens, question);
	return ternaryMessage(textOf(tokens.slice(0, lead)), textOf(tokens.slice(lead, question)), textOf(tokens.slice(question + 1, colon)), textOf(tokens.slice(colon + 1)));
}

/**
 * The refusal for a `?` the parser met where it wanted an operator or the end
 * of the line, when a `:` follows it: `a > b ? 1 : 2`. The `1 : 2` there is
 * read as the clock time 1:02 before the parser runs, so no colon is left for
 * the label reading to find, and the `?` is where the parser stops.
 *
 * @param tokens - The tokens the parser was given.
 * @param question - The index of the QUESTION token it stopped at.
 * @returns The refusal, or null when no `:` follows the `?` (`true ? 25`),
 *   which is left to the parser's own wording.
 */
export function ternaryAtQuestion(tokens: readonly Token[], question: number): ColonLabelFault | null {
	if (question < 1 || tokens[question]?.type !== "QUESTION") return null;
	for (let k = question + 1; k < tokens.length; k++) {
		if (tokens[k].type === "COLON") return k > question + 1 && k + 1 < tokens.length ? ternaryFault(tokens, question, k) : null;
		// Two clock times around the colon (`true ? 9:30 : 10:00`) fuse into
		// one timecode, whose fields no longer say where the colon was: the
		// refusal gives the shape rather than the reader's parts.
		if (tokens[k].type === "VIDEO_TIMECODE") return ternaryMessage("", "", "", "");
		if (tokens[k].type !== "CLOCK_TIME") continue;
		// The colon inside a fused clock time (`1 : 2` reads as 1:02): its
		// text splits at the colon into the value chosen and the other one.
		const split = CLOCK_SPLIT.exec(tokens[k].text);
		if (split === null) return null;
		const lead = conditionStart(tokens, question);
		const chosen = joined(textOf(tokens.slice(question + 1, k)), split[1]);
		const other = joined(split[2], textOf(tokens.slice(k + 1)));
		return ternaryMessage(textOf(tokens.slice(0, lead)), textOf(tokens.slice(lead, question)), chosen, other);
	}
	return null;
}

/** Two pieces of text with a space between, an empty one left out; null when either is null. */
function joined(left: string | null, right: string | null): string | null {
	if (left === null || right === null) return null;
	return [left, right].filter((p) => p.length > 0).join(" ");
}

/** A clock time's text split at its first colon, spaces either side dropped. */
const CLOCK_SPLIT = /^([^:]*?)\s*:\s*(.+)$/;

/**
 * Where a choice's condition begins: after a label's colon or a definition's
 * `=` in front of it (`Note: a ? b : c`, `x = a ? b : c`), which stay where
 * they are, or at the start of the line.
 *
 * @param tokens - The line's tokens.
 * @param question - The index of the QUESTION token.
 * @returns The index of the condition's first token.
 */
export function conditionStart(tokens: readonly Token[], question: number): number {
	for (let k = question - 1; k >= 0; k--) {
		if (tokens[k].type === "COLON" || tokens[k].type === "EQUALS") return k + 1;
	}
	return 0;
}

/**
 * The words of the refusal for a choice written with `?` and `:`.
 *
 * Each part is null when it holds no text of the reader's to quote (see
 * {@link textOf}).
 *
 * @param before - What stays in front of the choice (a label, a definition), or "".
 * @param condition - The text before the `?`.
 * @param chosen - The text between the `?` and the `:`.
 * @param other - The text after the `:`.
 * @returns The refusal, with the line spelled as `if ... then ... else`, or
 *   the bare shape when a part is empty, too long to quote or not the reader's.
 */
export function ternaryMessage(before: string | null, condition: string | null, chosen: string | null, other: string | null): ColonLabelFault {
	let written = "if ... then ... else ...";
	if (before !== null && condition !== null && chosen !== null && other !== null) {
		const fits = condition.length > 0 && chosen.length > 0 && other.length > 0 && [before, condition, chosen, other].every((p) => p.length <= QUOTE_LIMIT);
		if (fits) written = `${before.length > 0 ? `${before} ` : ""}if ${condition} then ${chosen} else ${other}`;
	}
	return {
		code: "TERNARY_UNSUPPORTED",
		message: `There is no choice written with "?" and ":": write ${written}`,
	};
}
