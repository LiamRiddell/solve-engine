/**
 * The invisible characters that change the direction text is shown in, and the
 * rule that keeps them out of a name.
 *
 * Unicode has a dozen characters whose only job is to say which way the text
 * around them runs: the marks (U+200E, U+200F, U+061C), the embeddings and
 * overrides (U+202A to U+202E) and the isolates (U+2066 to U+2069). None of them
 * is drawn, and each changes how its neighbours are drawn. Inside a name that is
 * the "Trojan Source" shape: `<U+202E>rent` is stored under one spelling and
 * shown as another, so a line can read as using a name it does not use.
 *
 * The lexer reads every character past ASCII as part of a word, so before this
 * rule such a character became part of whatever word it touched, and a document
 * could define and read a name that holds one. A name, a number or a unit that
 * holds one is now refused by name (`DIRECTION_CONTROL_IN_NAME`), with the
 * character written as its code point. Refused rather than dropped, because
 * silently dropping it would leave the line showing one thing while the engine
 * read another, which is the problem in the first place.
 *
 * The boundary: text keeps them. A string literal (`"a<U+202E>b"`), a comment, a
 * heading, the label before a colon and a prose line are read as text, and a
 * right-to-left script needs these marks to show correctly. A prose line that
 * already fails before it reaches the character keeps its own error, so this
 * rule adds no error to a line of prose.
 */

import { ErrorFactory, type EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import type { Token } from "@solve-js/lexer/Token";
import { safeText } from "@solve-js/parser/ParseMessages";

/** Every direction control, for a quick test of a whole line before its tokens are read. */
const ANY_DIRECTION_CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

/** Each direction control's name, as the Unicode standard gives it, in lower case for a sentence. */
const DIRECTION_CONTROL_NAMES: ReadonlyMap<number, string> = new Map([
	[0x061c, "arabic letter mark"],
	[0x200e, "left-to-right mark"],
	[0x200f, "right-to-left mark"],
	[0x202a, "left-to-right embedding"],
	[0x202b, "right-to-left embedding"],
	[0x202c, "pop directional formatting"],
	[0x202d, "left-to-right override"],
	[0x202e, "right-to-left override"],
	[0x2066, "left-to-right isolate"],
	[0x2067, "right-to-left isolate"],
	[0x2068, "first strong isolate"],
	[0x2069, "pop directional isolate"],
]);

/**
 * Whether a UTF-16 code unit is one of the direction controls.
 *
 * @param code - A code unit, as `charCodeAt` returns it.
 */
export function isDirectionControl(code: number): boolean {
	return DIRECTION_CONTROL_NAMES.has(code);
}

/**
 * Whether a piece of text holds a direction control anywhere.
 *
 * @param text - Any text; the empty string holds none.
 */
export function hasDirectionControl(text: string): boolean {
	return ANY_DIRECTION_CONTROL.test(text);
}

/**
 * A direction control written for a reader: its code point and its name,
 * `U+202E (right-to-left override)`.
 *
 * @param code - A code unit that {@link isDirectionControl} accepts.
 * @returns The description, or the bare code point for any other code unit.
 */
export function describeDirectionControl(code: number): string {
	const point = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
	const name = DIRECTION_CONTROL_NAMES.get(code);
	return name === undefined ? point : `${point} (${name})`;
}

/** A word on a line that holds a direction control: where it starts, what was typed, and the first control in it. */
export interface HiddenDirection {
	/** The word's offset, in the same terms as its token's `offset`. */
	readonly offset: number;
	/** The word as typed, control included. */
	readonly text: string;
	/** The first direction control in the word, as a code unit. */
	readonly code: number;
	/** The word's line, as its token has it, for the error's span. */
	readonly line?: number;
	/** The word's column, as its token has it, for the error's span. */
	readonly col?: number;
}

/** The answer of {@link findHiddenDirections} for a line with no direction control, shared so such a line allocates nothing. */
export const NO_HIDDEN_DIRECTIONS: readonly HiddenDirection[] = Object.freeze([]);

/**
 * The words on a line that hold a direction control, in order.
 *
 * Every token is a word, a number, a unit, a tag or a symbol the engine reads,
 * except text in quotes and a comment, which are read as text and may keep
 * these characters. Pass the lexer's tokens, before the normaliser fuses any:
 * a fused token's value is the engine's own reading, and may hold a quoted
 * string's characters.
 *
 * @param tokens - One line's tokens, as the lexer produced them.
 * @returns The words holding a control; empty for almost every line.
 */
export function findHiddenDirections(tokens: readonly Token[]): readonly HiddenDirection[] {
	const found: HiddenDirection[] = [];
	for (const token of tokens) {
		if (token.type === "STRING" || token.type === "COMMENT") continue;
		const text = token.text;
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (isDirectionControl(code)) {
				found.push({ offset: token.offset, text, code, line: token.line, col: token.col });
				break;
			}
		}
	}
	return found;
}

/**
 * The refusal for a word that holds a direction control.
 *
 * @param hidden - The word, as {@link findHiddenDirections} found it.
 * @returns A parse error with the code `DIRECTION_CONTROL_IN_NAME` and a span on the word.
 */
export function directionControlRefusal(hidden: HiddenDirection): EngineError {
	const character = describeDirectionControl(hidden.code);
	return ErrorFactory.parsing({
		code: "DIRECTION_CONTROL_IN_NAME",
		message: `"${safeText(hidden.text)}" holds ${character}, an invisible character that changes the direction text is shown in, so it would not read as what it is. A name, a number or a unit cannot hold one: delete it and type the word again.`,
		context: { codePoint: character, word: safeText(hidden.text) },
		span: { start: hidden.offset, end: hidden.offset + hidden.text.length, line: hidden.line, col: hidden.col },
	});
}

/**
 * Whether a line's outcome should be the direction-control refusal, and which
 * word it names.
 *
 * A line whose code part (past any label) parsed and holds such a word is
 * refused at that word. A line that failed is refused only when the word comes
 * at or before the place it failed, since the character is then the likely
 * cause; a prose line that fails earlier keeps its own error, so a sentence
 * that merely contains one of these characters gets no new error.
 *
 * @param hidden - The line's words holding a control, in order.
 * @param codeStart - Where the code part begins after a successful parse (past a label), or null when the line failed.
 * @param failedAt - Where the line failed, from its error's span; undefined when the error has no span, which counts as failing at the end.
 * @returns The word to refuse, or null to keep the line's own outcome.
 */
export function hiddenDirectionToRefuse(
	hidden: readonly HiddenDirection[],
	codeStart: number | null,
	failedAt?: number,
): HiddenDirection | null {
	for (const word of hidden) {
		if (codeStart !== null) {
			if (word.offset >= codeStart) return word;
		} else if (failedAt === undefined || word.offset <= failedAt) {
			return word;
		}
	}
	return null;
}
