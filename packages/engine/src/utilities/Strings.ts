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
 * How many lines `text` has, without splitting it into an array.
 *
 * `split("\n").length` answers the same question and allocates the whole
 * document to do it, which is the wrong shape for a caller whose next move may
 * be to refuse the document for being too large. Counting stops as soon as the
 * answer is "more than the caller cares about".
 *
 * @param text - The document.
 * @param stopAfter - Stop counting once past this many lines.
 * @returns The line count, or `stopAfter + 1` for anything longer. A document
 * with no newline in it is one line, matching `split`.
 */
export function countLines(text: string, stopAfter: number = Number.MAX_SAFE_INTEGER): number {
	let count = 1;
	let index = text.indexOf("\n");
	while (index !== -1) {
		if (++count > stopAfter) return count;
		index = text.indexOf("\n", index + 1);
	}
	return count;
}
