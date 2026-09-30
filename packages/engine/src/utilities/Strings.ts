/**
 * Strips a single layer of matching double quotes from a string, if present.
 * Returns the input unchanged if it isn't fully wrapped in quotes.
 *
 * Was needed for STRING token values, which the lexer used to emit with their
 * surrounding `"..."` quotes still attached. `tokenizeString()` now strips them
 * when it builds the token, so on that path this is a no-op kept as a defence
 * against text arriving from somewhere else already quoted.
 */
export function stripQuotes(value: string): string {
	return value.startsWith('"') && value.endsWith('"') && value.length >= 2
		? value.slice(1, -1)
		: value;
}

/**
 * What ends a line: a CRLF pair, a lone line feed, or a lone carriage return.
 *
 * The same three the lexer's document scan treats as a line break, so a
 * document is split into the same lines by every path that reads it. A lone
 * carriage return is a line break in markdown and in the editors that load a
 * note written on an old Mac; splitting on the line feed alone kept `5\r6` as
 * one line on one path and two on the other.
 */
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * The lines of a document, without their line breaks.
 *
 * A CRLF pair is one break, and a break at the very end leaves an empty last
 * line, as `split` does and as the document scan does.
 *
 * @param text - The document.
 * @returns Its lines, at least one.
 */
export function splitLines(text: string): string[] {
	return text.split(LINE_BREAK);
}

/**
 * The length of the line break that starts at `index`, or 0 when none does.
 *
 * @param text - The document.
 * @param index - A position in it.
 * @returns 2 for a CRLF pair, 1 for a lone CR or LF, 0 otherwise.
 */
export function lineBreakLengthAt(text: string, index: number): number {
	const c = text.charCodeAt(index);
	if (c === 10) return 1;
	if (c !== 13) return 0;
	return text.charCodeAt(index + 1) === 10 ? 2 : 1;
}

/**
 * How many lines `text` has, without splitting it into an array.
 *
 * `splitLines(text).length` answers the same question and allocates the whole
 * document to do it, which is the wrong shape for a caller whose next move may
 * be to refuse the document for being too large. Counting stops as soon as the
 * answer is "more than the caller cares about". A line ends where
 * {@link splitLines} ends one.
 *
 * @param text - The document.
 * @param stopAfter - Stop counting once past this many lines.
 * @returns The line count, or `stopAfter + 1` for anything longer. A document
 * with no line break in it is one line, matching `split`.
 */
export function countLines(text: string, stopAfter: number = Number.MAX_SAFE_INTEGER): number {
	let count = 1;
	const length = text.length;
	for (let i = 0; i < length; i++) {
		const c = text.charCodeAt(i);
		if (c === 10 || c === 13) {
			// A CRLF pair is one break.
			if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
			if (++count > stopAfter) return count;
		}
	}
	return count;
}
