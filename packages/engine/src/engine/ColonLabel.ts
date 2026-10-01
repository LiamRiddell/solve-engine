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
 *   operator, a bracket, a comma or a label's colon with the colon touching
 *   both numbers as a time is written, it is an operand and the pair is a
 *   time, so `24:00`, `1 + 24:00`, `9:30 + 24:00` and `Total: 24:00` are
 *   refused as times that do not exist. A
 *   clock time with a third field written straight after it, `1:23:99`, is one
 *   too: its seconds are out of range. A number that follows a word is part of
 *   a name (`Week 12: 75`, `Week 12:75`), and a colon with a space after it
 *   (`Score >= 90: 12`) is a label's, which the rules below then read.
 * - **A figure in another script's digits.** The engine reads numbers in the
 *   digits 0 to 9 only, and the lexer reads `٢٤` as a word, so `٢٤:00` was
 *   the label `٢٤` and answered 0. A figure in operand position before the
 *   colon, by the rule a number follows there, is refused by name and
 *   spelled in 0 to 9 (`OTHER_SCRIPT_DIGITS`).
 * - **A figure with an invisible character in it.** A direction override or a
 *   zero-width joiner in `24` makes the lexer read it as a word, so
 *   `<U+202E>24:00` was the label `<U+202E>24` and answered 0. In operand
 *   position it is refused by name: a direction control as any name holding
 *   one is (`DIRECTION_CONTROL_IN_NAME`), any other such character as
 *   `INVISIBLE_CHARACTER_IN_NUMBER`.
 * - **A choice written with `?` and `:`.** There is no such operator; a choice
 *   is `if ... then ... else`, and the refusal spells the reader's own line
 *   that way.
 * - **A comparison.** `>`, `<`, `>=`, `<=`, `==` or `!=` written as a symbol
 *   make the text a condition, not a name, so `a > b: 1` is refused rather
 *   than answered 1 whatever `a` and `b` are. The same words written as
 *   words (`Orders over $100: 12`) are prose and stay a label.
 * - **A calculation with no word in it.** `(1+2): 5` names nothing, and nor
 *   does a bracketed figure, so `(24):00` and `[24]:00` are refused rather
 *   than answered 0.
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
import { directionControlRefusal, isDirectionControl } from "@solve-js/engine/DirectionControls";

/** Why the text before a colon is not a label: the code and the reader's message. */
export interface ColonLabelFault {
	readonly code: string;
	readonly message: string;
}

/**
 * Tokens after which a number is an operand, never part of a name. A label's
 * colon is one: the figure after it starts an expression, so in
 * `Total: 24:00` the `24` begins the answer and `24:00` is a time, where it
 * was read as a second label `24` and the line answered 0.
 */
export const OPERAND_BEFORE: ReadonlySet<string> = new Set([
	"PLUS", "MINUS", "STAR", "SLASH", "CARET", "EQUALS", "EQUALITY", "NEQ", "GT", "GTE", "LT", "LTE",
	"LPAREN", "LBRACKET", "COMMA", "QUESTION", "PLUS_EQUALS", "MINUS_EQUALS", "STAR_EQUALS", "SLASH_EQUALS",
	"COLON",
]);

/**
 * Comparison tokens: written as a symbol, they make the text a condition, not
 * a name. An `=` never reaches here: `Net = gross: 5` is a definition whose
 * right-hand side is the labelled figure, read before any label is.
 */
const COMPARISON: ReadonlySet<string> = new Set(["EQUALITY", "NEQ", "GT", "GTE", "LT", "LTE"]);

/** Arithmetic tokens, for a label that holds no word at all. */
const ARITHMETIC: ReadonlySet<string> = new Set(["PLUS", "MINUS", "STAR", "SLASH", "CARET"]);

/** Bracket tokens, which with no word beside them make the label a bracketed expression. */
const BRACKETS: ReadonlySet<string> = new Set(["LPAREN", "RPAREN", "LBRACKET", "RBRACKET"]);

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
	// starts the line, or follows an operator, a bracket, a comma or a label's
	// colon, is an operand, so the pair around the colon is a time.
	const lead = tokens[colon - 2];
	if (lead !== undefined && !OPERAND_BEFORE.has(lead.type)) return null;
	if (lead !== undefined && (!touching(before, tokens[colon]) || !touching(tokens[colon], after))) return null;
	return `${before.text}:${after.text}`;
}

/** One decimal digit of any script, as Unicode classes it. */
const DECIMAL_DIGIT = /\p{Nd}/u;

/**
 * A figure written in digits from another script: decimal digits, at least
 * one of them not 0 to 9 (Arabic-Indic `٢٤`, Devanagari `२४`, fullwidth
 * `１２`, mathematical `𝟐𝟒`), with the Arabic decimal and thousands marks.
 * The lexer reads such a figure as a word, since the engine reads numbers
 * only in the digits 0 to 9.
 */
const OTHER_SCRIPT_FIGURE = /^(?=.*[^0-9٫٬])[\p{Nd}٫٬]+$/u;

/** Invisible formatting characters (a zero-width space, a direction override), which a word can carry and a figure is read without. */
const FORMAT_CHARACTERS = /\p{Cf}/gu;

/**
 * The value, 0 to 9, of one decimal digit of any script, or -1 for a
 * character that is not one.
 *
 * Unicode keeps every script's digits in a run of ten from 0 to 9, and runs
 * that touch (the five sets of mathematical digits) follow each other whole,
 * so a digit's value is how far it sits from the start of its run, counted in
 * tens. The walk back is at most a few runs long.
 *
 * @param digit - One character (a code point, which may be two UTF-16 units).
 * @returns Its value, or -1.
 */
export function digitValue(digit: string): number {
	const code = digit.codePointAt(0);
	if (code === undefined || !DECIMAL_DIGIT.test(digit) || String.fromCodePoint(code) !== digit) return -1;
	let start = code;
	while (start > 0 && DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start--;
	return (code - start) % 10;
}

/**
 * A figure in another script's digits written in the digits 0 to 9 (`٢٤` is
 * `24`, `٢٫٥` is `2.5`), or null when the text is not such a figure: a word,
 * or a figure already in 0 to 9. Invisible formatting characters in the text
 * (a direction override, a zero-width space) are read past, since they change
 * how a figure shows and not which figure it is.
 *
 * @param text - A token's text.
 * @returns The figure in 0 to 9, or null.
 */
export function otherScriptFigure(text: string): string | null {
	const shown = text.replace(FORMAT_CHARACTERS, "");
	if (!OTHER_SCRIPT_FIGURE.test(shown)) return null;
	let out = "";
	for (const ch of shown) {
		if (ch === "٫") out += ".";
		else if (ch === "٬") out += ",";
		else out += String(digitValue(ch));
	}
	return out;
}

/**
 * The figure in another script's digits that stands as an operand before the
 * colon at `colon`, or null. `written` is the figure as typed and `reading`
 * is it in the digits 0 to 9.
 *
 * The figure is the run of tokens before the colon made of such figures and
 * numbers in 0 to 9, ending in such a figure: `٢٤`, `2٤` (which the normaliser
 * reads as a product, putting a multiplication with no text of the reader's
 * between the two), and `٢` and `٤` with a zero-width space between them,
 * which the lexer reads as two words. The rule for where it stands follows
 * {@link timeAtColon}'s for a number: a figure that starts the line, or
 * follows an operator, a bracket, a comma or a label's colon, is an operand,
 * never part of a name, so `٢٤:00` and `Total: ٢٤:00` are the time they look
 * like, written in digits the engine does not read. A figure after a word is
 * part of the name, as a number is (`Week ٢: 5`).
 *
 * Linear in the length of the run.
 *
 * @param tokens - The line's normalised tokens.
 * @param colon - The index of a COLON token, at least 1.
 * @returns The figure, or null.
 */
export function otherScriptFigureAtColon(tokens: readonly Token[], colon: number): { written: string; reading: string } | null {
	const last = tokens[colon - 1];
	if (last === undefined || tokens[colon + 1] === undefined || otherScriptFigure(last.text) === null) return null;
	const found = figureRunAtColon(tokens, colon, otherScriptFigure);
	return found === null ? null : { written: found.written, reading: found.reading };
}

/** A figure the lexer read as a word, standing before a colon: its tokens, its text as typed and its reading in 0 to 9. */
export interface FigureRun {
	readonly run: readonly Token[];
	readonly written: string;
	readonly reading: string;
}

/**
 * The run of tokens before the colon at `colon` that make one figure, ending at
 * the colon, when it stands where a number would be an operand; or null.
 *
 * The run is numbers in 0 to 9 and words `readWord` reads as figures, with the
 * multiplication the normaliser puts between a number and a word that touches
 * it (`2٤`) passed over, since it has no text of the reader's. The rule for
 * where it stands is {@link timeAtColon}'s for a number: the line's start, or
 * after an operator, a bracket, a comma or a label's colon. After a word it is
 * part of a name. The caller checks the token before the colon first.
 *
 * Linear in the length of the run.
 *
 * @param tokens - The line's normalised tokens.
 * @param colon - The index of a COLON token, at least 1.
 * @param readWord - A word's text as a figure in 0 to 9, or null when it is not one.
 * @returns The figure, or null.
 */
export function figureRunAtColon(tokens: readonly Token[], colon: number, readWord: (text: string) => string | null): FigureRun | null {
	const run: Token[] = [];
	const readings: string[] = [];
	let k = colon - 1;
	for (; k >= 0; k--) {
		const token = tokens[k];
		const next = run[0];
		// The multiplication the normaliser puts in `2٤` stands where the
		// figure after it starts, and has no text of the reader's.
		if (token.type === "STAR" && next !== undefined && token.offset === next.offset) continue;
		const reading = token.type === "NUMBER" ? token.text : readWord(token.text);
		if (reading === null) break;
		const gap = next !== undefined && tokenEnd(token) < next.offset ? " " : "";
		run.unshift(token);
		readings.unshift(`${reading}${gap}`);
	}
	const lead = tokens[k];
	if (run.length === 0 || (lead !== undefined && !OPERAND_BEFORE.has(lead.type))) return null;
	const written = run.map((token, j) => (j + 1 < run.length && tokenEnd(token) < run[j + 1].offset ? `${token.text} ` : token.text)).join("");
	return { run, written, reading: readings.join("") };
}

/** A figure in the digits 0 to 9, with the decimal point, thousands commas and exponent a number is written with. */
const PLAIN_FIGURE = /^[0-9][0-9.,]*(?:[eE][+-]?[0-9]+)?$/;

/** One invisible formatting character, the first a text holds. */
const FORMAT_CHARACTER = /\p{Cf}/u;

/**
 * A figure in the digits 0 to 9 that holds an invisible formatting character,
 * which made the lexer read it as a word: a direction override (`<U+202E>24`),
 * a zero-width joiner or non-joiner, a word joiner, a soft hyphen. Returns the
 * figure without the character and the first such character's code, or null
 * when the text holds none, or is not a figure once they are read past.
 *
 * The zero-width space and the byte-order mark never reach here: the lexer
 * reads them as a space.
 *
 * @param text - A token's text.
 * @returns The figure and the character, or null.
 */
export function hiddenFigure(text: string): { reading: string; code: number } | null {
	const found = FORMAT_CHARACTER.exec(text);
	if (found === null) return null;
	const reading = text.replace(FORMAT_CHARACTERS, "");
	if (!PLAIN_FIGURE.test(reading)) return null;
	return { reading, code: found[0].codePointAt(0) ?? 0 };
}

/** The reading {@link figureRunAtColon} takes of a word that is a hidden figure. */
function hiddenFigureReading(text: string): string | null {
	return hiddenFigure(text)?.reading ?? null;
}

/**
 * A text with every invisible formatting or control character written as its
 * code point in angle brackets (`<U+202E>`), so a message shows what was typed
 * and is not itself turned round by it.
 *
 * @param text - A piece of the reader's line.
 */
export function visibleText(text: string): string {
	return text.replace(INVISIBLE_CHARACTERS, (ch) => `<U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}>`);
}

/** Every invisible formatting or control character, for {@link visibleText}. */
const INVISIBLE_CHARACTERS = /[\p{Cf}\p{Cc}]/gu;

/** Unicode's names for the invisible formatting characters a figure is likeliest to carry, in lower case for a sentence. */
const INVISIBLE_NAMES: ReadonlyMap<number, string> = new Map([
	[0x00ad, "soft hyphen"],
	[0x200c, "zero width non-joiner"],
	[0x200d, "zero width joiner"],
	[0x2060, "word joiner"],
	[0x2061, "function application"],
	[0x2062, "invisible times"],
	[0x2063, "invisible separator"],
	[0x2064, "invisible plus"],
]);

/**
 * The refusal for a figure in 0 to 9 standing before a colon where a number
 * would be an operand, when an invisible character in it made the lexer read
 * it as a word, so the label reading took it as a name: `<U+202E>24:00`
 * answered the 00 after the colon. A direction control gets the refusal any
 * name holding one gets (`DIRECTION_CONTROL_IN_NAME`); any other invisible
 * character gets `INVISIBLE_CHARACTER_IN_NUMBER`, with the figure in plain
 * digits. Null when no such figure stands there.
 *
 * @param tokens - The line's normalised tokens.
 * @param colon - The index of a COLON token, at least 1.
 * @returns The refusal's code and message, or null.
 */
export function hiddenFigureAtColon(tokens: readonly Token[], colon: number): ColonLabelFault | null {
	const last = tokens[colon - 1];
	// The figure may end on a plain number: `<U+202E>1.5` is the word
	// `<U+202E>1` and the number `.5`.
	if (last === undefined || tokens[colon + 1] === undefined || (last.type !== "NUMBER" && hiddenFigure(last.text) === null)) return null;
	const found = figureRunAtColon(tokens, colon, hiddenFigureReading);
	if (found === null) return null;
	for (const token of found.run) {
		const hidden = token.type === "NUMBER" ? null : hiddenFigure(token.text);
		if (hidden === null) continue;
		if (isDirectionControl(hidden.code)) {
			const error = directionControlRefusal({ offset: token.offset, text: token.text, code: hidden.code });
			return { code: error.code, message: error.message };
		}
		const point = `U+${hidden.code.toString(16).toUpperCase().padStart(4, "0")}`;
		const name = INVISIBLE_NAMES.get(hidden.code);
		return {
			code: "INVISIBLE_CHARACTER_IN_NUMBER",
			message: `"${visibleText(quoted(found.written))}" holds ${name === undefined ? point : `${point} (${name})`}, an invisible character, so it is read as a word and not as the number ${quoted(found.reading)}. A number cannot hold one: delete it and type the number again.`,
		};
	}
	return null;
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

	const figure = otherScriptFigureAtColon(tokens, colon);
	if (figure !== null) {
		return {
			code: "OTHER_SCRIPT_DIGITS",
			message: `"${quoted(figure.written)}" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in ${quoted(figure.reading)}`,
		};
	}

	const hidden = hiddenFigureAtColon(tokens, colon);
	if (hidden !== null) return hidden;

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
	// A number's letters (the e of `1e308`, the x of `0xff`) are not a word.
	const hasWord = label.some((t) => isLabelWord(t) || (t.type !== "NUMBER" && LETTERS.test(t.text)) || t.type === "DATETIME_LITERAL");
	// A bracket with no word in the label is a bracketed expression: `(24)`
	// in `(24):00`, `[24]` in `[24]:00`. It names nothing, and read as a label
	// the line answered the 00 after the colon.
	if (!hasWord && label.some((t) => ARITHMETIC.has(t.type) || BRACKETS.has(t.type))) {
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
	return text === null ? "The text before the colon" : `"${visibleText(quoted(text))}" before the colon`;
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

/**
 * The error to report for a line that did not parse whole, when the parse
 * stopped at a label's colon and the expression after the label was retried
 * and failed as well: that retry's error, or undefined to keep the line's own.
 *
 * The line is then `<label>: <expression>`, and the expression's error is the
 * specific one: `Total: average(10:12)` is refused because 10:12 is a clock
 * time, which the reader can act on, where the whole line's error only said
 * an operator was expected at the colon after `Total`. Two shapes keep the
 * line's own error: a parse that stopped somewhere other than a colon, where
 * the line is not a label's, and a colon followed by `=` (`x := 5`), whose
 * own wording says to assign with `=` alone.
 *
 * @param leftover - The token the whole-line parse stopped at.
 * @param next - The token after it, if any.
 * @param retryError - The error the rightmost labelled retry raised, if one ran and failed.
 * @returns The error to report, or undefined.
 */
export function labelledRetryError<E>(leftover: Pick<Token, "type">, next: Pick<Token, "type"> | undefined, retryError: E | undefined): E | undefined {
	if (retryError === undefined) return undefined;
	if (leftover.type !== "COLON") return undefined;
	if (next?.type === "EQUALS") return undefined;
	return retryError;
}
