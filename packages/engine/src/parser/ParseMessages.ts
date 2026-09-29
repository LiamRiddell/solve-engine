/**
 * The words a parse failure uses to name what the reader wrote.
 *
 * A token type (`GT`, `STAR`, `LINE_REF`) is the parser's name for a piece of
 * a line, and it means nothing to the person who typed the line. Every parse
 * message the parser builds goes through here instead, so it names the
 * characters the reader typed (`">"`) or, where there is nothing typed to quote
 * because the line stopped short, the kind of thing the engine expected there
 * ("a line reference such as line 1"). The code on the error is unchanged: a
 * host branches on the code, and the message is for the reader (#768).
 *
 * Two guarantees hold for every string these functions return, whatever the
 * line held: it has no upper-case token type name in it, and it is bounded. A
 * quoted piece of the line is cut at {@link MAX_QUOTED_LENGTH} characters, and
 * a character that would not show as itself (a control character, a lone
 * surrogate, a direction override, a zero-width character) is written as its
 * code point, so a message cannot be made to read as something it does not say.
 */

import type { Token } from "@solve-js/lexer/Token";
import type { SourceSpan } from "@solve-js/errors/EngineError";

/** The longest piece of a line a message quotes before cutting it short with "...". */
export const MAX_QUOTED_LENGTH = 32;

/**
 * The reader's words for the token types a parse message can name.
 *
 * Operators and punctuation are named by the character that is typed for
 * them, and a type that stands for a kind of value by a short description. A
 * type missing from here (a package's own) falls back to its name read as
 * words; see {@link describeTokenType}.
 */
const TOKEN_WORDS: Readonly<Record<string, string>> = {
	NUMBER: "a number",
	BIGINT: "a whole number",
	STRING: "text in quotes",
	IDENT: "a name",
	UNIT: "a unit",
	KEYWORD: "a word",
	DATETIME_LITERAL: "a date",
	DURATION: "a duration",
	LINE_REF: "a line reference such as line 1",
	PLUS: '"+"',
	MINUS: '"-"',
	STAR: '"*"',
	SLASH: '"/"',
	CARET: '"^"',
	PERCENT: '"%"',
	PLUS_MINUS: '"±"',
	PLUS_EQUALS: '"+="',
	MINUS_EQUALS: '"-="',
	STAR_EQUALS: '"*="',
	SLASH_EQUALS: '"/="',
	LSHIFT: '"<<"',
	RSHIFT: '">>"',
	URSHIFT: '">>>"',
	LPAREN: '"("',
	RPAREN: '")"',
	LBRACKET: '"["',
	RBRACKET: '"]"',
	LBRACE: '"{"',
	RBRACE: '"}"',
	COMMA: '","',
	DOT: '"."',
	COLON: '":"',
	SEMICOLON: '";"',
	EQUALS: '"="',
	GT: '">"',
	LT: '"<"',
	GTE: '">="',
	LTE: '"<="',
	EQUALITY: '"=="',
	NEQ: '"!="',
	BIT_XOR: '"xor"',
	LOGICAL_AND: '"&&"',
	LOGICAL_OR: '"||"',
	QUESTION: '"?"',
	BANG: '"!"',
	BIT_AND: '"&"',
	BIT_OR: '"|"',
	BIT_NOT: '"~"',
	DOLLAR: '"$"',
	POUND: '"£"',
	EURO: '"€"',
	YEN: '"¥"',
	AND_CONJ: '"and"',
	OF: '"of"',
	TO: '"to"',
	MOD: '"mod"',
};

/** Token types that close something, so a value can never follow them directly. */
const CLOSERS: ReadonlySet<string> = new Set(["RPAREN", "RBRACKET", "RBRACE"]);

/** Token types that are a value in themselves. */
const VALUE_TYPES: ReadonlySet<string> = new Set(["NUMBER", "BIGINT", "STRING", "IDENT", "UNIT", "DATETIME_LITERAL", "DURATION", "LINE_REF", "PI", "E", "TRUE", "FALSE"]);

/** Token types that open a bracket a line must close again. */
const OPENERS: Readonly<Record<string, string>> = { LPAREN: ")", LBRACKET: "]", LBRACE: "}" };

/** The closing partner of each opener, by the closer's type. */
const CLOSER_OF: Readonly<Record<string, string>> = { RPAREN: "LPAREN", RBRACKET: "LBRACKET", RBRACE: "LBRACE" };

/**
 * Whether a character would not show as itself in a message: a C0 or C1
 * control, a line or paragraph separator, a zero-width character, a byte
 * order mark, or a direction override or isolate.
 */
function isInvisible(code: number): boolean {
	return code < 0x20
		|| (code >= 0x7f && code <= 0x9f)
		|| (code >= 0x200b && code <= 0x200f)
		|| (code >= 0x2028 && code <= 0x202e)
		|| (code >= 0x2060 && code <= 0x2069)
		|| code === 0xfeff;
}

/** A code point written the way the Unicode standard names it, `U+202E`. */
function codePointName(code: number): string {
	return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * A piece of a line as a message may show it: cut to {@link MAX_QUOTED_LENGTH}
 * characters, with every character that would not show as itself (see
 * {@link isInvisible}) and every lone surrogate written as its code point in
 * angle brackets, `<U+202E>`.
 *
 * @param text - The piece of the line, exactly as typed.
 * @returns The same text, safe to put between quotes in a message.
 */
export function safeText(text: string): string {
	let out = "";
	let kept = 0;
	for (let i = 0; i < text.length; i++) {
		if (kept >= MAX_QUOTED_LENGTH) return `${out}...`;
		const code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				out += text[i] + text[i + 1];
				i++;
			} else {
				out += `<${codePointName(code)}>`;
			}
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			out += `<${codePointName(code)}>`;
		} else if (isInvisible(code)) {
			out += `<${codePointName(code)}>`;
		} else {
			out += text[i];
		}
		kept++;
	}
	return out;
}

/**
 * The text of a token as the reader typed it, in double quotes and made safe
 * by {@link safeText}.
 *
 * The typed text rather than the token's value, since a fused token's value is
 * the engine's own reading of it (a clock time's is its minutes since
 * midnight). A token the normaliser inserted has no typed text (the `*` read
 * between `2` and `x` in `2x`); it is quoted by its value, which is the
 * operator it stands for.
 *
 * @param token - The token to quote.
 * @returns The quoted text, `"*"`.
 */
export function quoteToken(token: Pick<Token, "text" | "value">): string {
	const typed = token.text !== "" ? token.text : token.value;
	return `"${safeText(typed)}"`;
}

/**
 * The reader's words for a token type: the character typed for an operator or
 * a bracket (`">"`), or a short description of a kind of value ("a number",
 * "a line reference such as line 1").
 *
 * A type this module does not know (a package's own) is read as words, lower
 * case and quoted: `FRAME_COUNT` becomes `"frame count"`. That is also the
 * spelling a package's keyword types have, since they are named after the word
 * they stand for (`BETWEEN` is typed "between").
 *
 * @param type - The token type.
 * @returns The description, never an upper-case type name.
 */
export function describeTokenType(type: string): string {
	const known = Object.prototype.hasOwnProperty.call(TOKEN_WORDS, type) ? TOKEN_WORDS[type] : undefined;
	if (known !== undefined) return known;
	const words = type.toLowerCase().replace(/_+/g, " ").trim();
	return words === "" ? "something else" : `"${safeText(words)}"`;
}

/** Whether a token ends a value, so what follows it may be an operator. */
function endsValue(token: Pick<Token, "type">): boolean {
	return CLOSERS.has(token.type) || VALUE_TYPES.has(token.type);
}

/** A message and the next step it offers, the two parts of a parse failure the reader sees. */
export interface ParseWording {
	/** The message: what was found, and what was expected there. */
	readonly message: string;
	/** The next step, when there is an obvious one. */
	readonly suggestion?: string;
}

/**
 * The brackets opened and not yet closed in `tokens`, innermost last, as the
 * closing character each needs.
 *
 * @param tokens - The line's tokens, in order.
 * @returns The closers owed, `[")", "]"]` for `([1, 2`.
 */
export function unclosedBrackets(tokens: readonly Pick<Token, "type">[]): string[] {
	const open: string[] = [];
	for (const token of tokens) {
		if (Object.prototype.hasOwnProperty.call(OPENERS, token.type)) {
			open.push(token.type);
		} else if (Object.prototype.hasOwnProperty.call(CLOSER_OF, token.type) && open[open.length - 1] === CLOSER_OF[token.type]) {
			open.pop();
		}
	}
	return open.map((type) => OPENERS[type]);
}

/**
 * The wording for a token that cannot start a value where the parser needed
 * one (`NO_PREFIX_PARSELET`): the `*` in `2 + * 3`, the `)` in `round(3.14, )`.
 *
 * @param found - The token that could not start a value.
 * @param previous - The token before it, or undefined when it opens the line.
 * @param next - The token after it, or undefined when it ends the line.
 * @returns The message and, where there is an obvious next step, a suggestion.
 */
export function valueExpectedWording(
	found: Pick<Token, "type" | "text" | "value">,
	previous: Pick<Token, "type" | "text" | "value"> | undefined,
	next: Pick<Token, "type" | "text" | "value"> | undefined,
): ParseWording {
	const what = quoteToken(found);
	const message = previous === undefined
		? `Expected a value, but found ${what}`
		: `Expected a value after ${quoteToken(previous)}, but found ${what}`;
	if (previous === undefined) {
		return { message, suggestion: `Write a value before ${what}, or remove it` };
	}
	if (previous.type === "MINUS" && found.type === "GT") {
		// `->`: an arrow, which people write for a conversion. Only a plain
		// word is echoed back as the target, never a number or an operator,
		// so the suggestion cannot read as an answer.
		const target = next !== undefined && (next.type === "UNIT" || next.type === "IDENT") ? ` ${safeText(next.text || next.value)}` : " followed by the unit";
		return { message, suggestion: `"->" is not a conversion here; to convert, write "in${target}"` };
	}
	if (previous.type === "STAR" && found.type === "STAR") {
		return { message, suggestion: 'Write a power with "^", as in 2 ^ 3' };
	}
	if (previous.type === "COMMA" && CLOSERS.has(found.type)) {
		return { message, suggestion: `Write a value after the ",", or remove the ","` };
	}
	if (Object.prototype.hasOwnProperty.call(OPENERS, previous.type) && CLOSERS.has(found.type)) {
		return { message, suggestion: "Write a value between the brackets, or remove them" };
	}
	if (endsValue(previous)) {
		return { message, suggestion: `Remove ${what}, or write a value in its place` };
	}
	return { message, suggestion: `Write a value between ${quoteToken(previous)} and ${what}, or remove one of them` };
}

/**
 * The wording for a line that stops where the parser needed more
 * (`UNEXPECTED_END_OF_INPUT`, `UNEXPECTED_END`): `5 +`, `(2 + 3`, `sqrt(`.
 *
 * @param tokens - The line's tokens, in order. The last is what the line ends on.
 * @param expectedType - The token type the parser needed next, when it needed
 * a particular one (the `)` of `(2 + 3`); undefined when it needed a value.
 * @returns The message and a suggestion.
 */
export function endOfLineWording(tokens: readonly Pick<Token, "type" | "text" | "value">[], expectedType?: string): ParseWording {
	const last = tokens[tokens.length - 1];
	const owed = unclosedBrackets(tokens);
	if (expectedType !== undefined) {
		const wanted = describeTokenType(expectedType);
		const message = `The line ends where ${wanted} was expected`;
		if (expectedType === "RPAREN" || expectedType === "RBRACKET" || expectedType === "RBRACE") {
			return { message, suggestion: `Close the bracket with ${wanted}` };
		}
		return { message, suggestion: `Finish the line with ${wanted}` };
	}
	if (last === undefined) {
		return { message: "The line ends before a value", suggestion: "Write a value" };
	}
	const after = quoteToken(last);
	const message = `The line ends after ${after}, where a value was expected`;
	const steps = [`write a value after ${after}`];
	if (owed.length > 0) steps.push(`close the bracket with "${owed[owed.length - 1]}"`);
	const suggestion = steps.join(", then ");
	return { message, suggestion: suggestion.charAt(0).toUpperCase() + suggestion.slice(1) };
}

/**
 * The wording for a token that is not the one the parser needed
 * (`UNEXPECTED_TOKEN_TYPE`): a `,` where a form needed its `)`.
 *
 * @param expectedType - The token type the parser needed.
 * @param found - The token it found instead.
 * @returns The message and a suggestion.
 */
export function unexpectedTokenWording(expectedType: string, found: Pick<Token, "type" | "text" | "value">): ParseWording {
	const wanted = describeTokenType(expectedType);
	const what = quoteToken(found);
	const message = `Expected ${wanted}, but found ${what}`;
	if (expectedType === "RPAREN" || expectedType === "RBRACKET" || expectedType === "RBRACE") {
		return { message, suggestion: `Close the bracket with ${wanted} before ${what}` };
	}
	return { message, suggestion: `Write ${wanted} where ${what} is` };
}

/**
 * The wording for a token left over after a complete expression
 * (`UNEXPECTED_TRAILING_TOKEN`): the `,` in `1,5 + 1`, the `:` in `x := 5`.
 *
 * @param leftover - The first token the expression did not use.
 * @param previous - The token before it, the last one the expression used.
 * @param next - The token after it, if any.
 * @returns The message and a suggestion.
 */
export function trailingTokenWording(
	leftover: Pick<Token, "type" | "text" | "value">,
	previous: Pick<Token, "type" | "text" | "value"> | undefined,
	next: Pick<Token, "type" | "text" | "value"> | undefined,
): ParseWording {
	const what = quoteToken(leftover);
	const message = `Expected an operator or the end of the line, but found ${what}`;
	if (leftover.type === "COMMA" && previous?.type === "NUMBER" && next?.type === "NUMBER") {
		return { message, suggestion: 'Write a decimal with a point, as in 1.5; a comma separates the items of a list' };
	}
	if (leftover.type === "COLON" && next?.type === "EQUALS") {
		return { message, suggestion: 'Assign with "=" on its own' };
	}
	return { message, suggestion: `Join ${what} to the expression with an operator such as "+", or remove it` };
}

/**
 * The wording for a variable's name that is not one: the `5` in `:5 = 3`, or a
 * word the engine already reads as something else, such as the `gcd` in
 * `:gcd = 4`, which a reader would otherwise be told is not a name.
 *
 * @param found - The token where the name should be.
 * @param after - What the name follows, as typed: `":"` or `"global :"`.
 * @param example - A definition to show, `:total = 5`.
 * @returns The message and a suggestion.
 */
export function variableNameWording(found: Pick<Token, "text" | "value">, after: string, example: string): ParseWording {
	const what = quoteToken(found);
	const typed = found.text !== "" ? found.text : found.value;
	if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(typed)) {
		return { message: `${what} is a word the engine already reads, so it cannot name a variable`, suggestion: `Choose another name, as in ${example}` };
	}
	return { message: `Expected a name after "${after}", but found ${what}`, suggestion: `Name the variable with a word, as in ${example}` };
}

/**
 * Where a token sits in its line, as a parse error's span gives it: the part
 * of the line an editor underlines.
 *
 * @param token - The token to point at.
 * @returns Its span: start and end offsets, and its one-based line and column.
 */
export function tokenSpan(token: Pick<Token, "offset" | "sourceEnd" | "text" | "line" | "col">): SourceSpan {
	return { start: token.offset, end: token.sourceEnd ?? token.offset + token.text.length, line: token.line, col: token.col };
}
