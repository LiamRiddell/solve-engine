/**
 * Making text safe to print to a terminal.
 *
 * A document is untrusted text, and the text output echoes each line back
 * beside its answer. A line carrying an escape sequence (ESC `[2J` clears the
 * screen, an OSC sequence can set the window title or write a link) would act
 * on the reader's terminal instead of being shown, and a direction override or
 * a zero-width character would make the line read as something it is not. So
 * every such character is written as a visible escape, `\u{1b}`. The JSON
 * output needs none of this: `JSON.stringify` already escapes the controls,
 * and a reader of JSON is a program, not a person.
 */

/**
 * The characters written as escapes: the C0 controls other than tab, DEL and
 * the C1 controls, the zero-width and direction marks (U+200B to U+200F), the
 * line and paragraph separators, the embedding and override controls (U+202A
 * to U+202E), the isolates (U+2066 to U+2069) and the byte-order mark.
 */
// eslint-disable-next-line no-control-regex -- matching these characters is the point
const UNSAFE = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Text with every character that could act on a terminal, or disguise what a
 * line says, written as a visible `\u{..}` escape. A tab becomes a space, so
 * the columns stay where they are.
 *
 * @param text - Any text, typically a document line or an engine message.
 * @returns The same text, safe to print.
 */
export function escapeForTerminal(text: string): string {
	return String(text)
		.replace(/\t/g, " ")
		.replace(UNSAFE, (ch) => `\\u{${ch.codePointAt(0)!.toString(16)}}`);
}

/**
 * A value quoted for a message, escaped as {@link escapeForTerminal} does.
 *
 * @param text - The value a message names.
 * @returns It in double quotes.
 */
export function quoted(text: string): string {
	return `"${escapeForTerminal(text)}"`;
}
