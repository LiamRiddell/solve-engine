/**
 * Which lines of a note are rows of a markdown table.
 *
 * A table is markup: its rows are read by the table forms (`total of column
 * "cost" above`, `lookup`), never evaluated. The line classifier sees one line
 * at a time, and a pipe row on its own is not a table (`5 | 3` is bitwise or,
 * 7), so it could only recognise the `|---|` separator row. Every other row fell
 * through to the expression path and reported `No prefix parselet found for
 * token: BIT_OR`, on both document paths (#616).
 *
 * The rule, the same for both paths: a pipe row is table markup when the
 * contiguous block of pipe rows it belongs to holds a separator row that is not
 * the block's first line, so there is a header above it. A block with no such
 * separator stays expressions. A row holding an inline solve is read like prose
 * holding one, so its solves are still worked out; the callers leave it
 * unskipped.
 *
 * @module TableBlocks
 */

/** Whether a line starts with a pipe, after any indentation. */
export function isPipeRow(text: string | undefined): boolean {
	if (text === undefined) return false;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 32 || c === 9) continue;
		return c === 124;
	}
	return false;
}

/**
 * Whether a line is a table's separator row, `|---|:--:|`: only pipes, dashes,
 * colons and whitespace, with at least one dash and one pipe. The dash keeps a
 * row of empty cells (`|  |  |`) from reading as the separator.
 */
export function isSeparatorRowText(text: string | undefined): boolean {
	if (text === undefined || !isPipeRow(text)) return false;
	let dash = false;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 45) dash = true;
		else if (c !== 124 && c !== 58 && c !== 32 && c !== 9 && c !== 13) return false;
	}
	return dash;
}

/**
 * Whether line `n` is a row of a table, read through `getText` (1-based, and
 * undefined past either end).
 *
 * One walk of the line's block. A caller classifying many rows should use
 * {@link tableBlockAt} and reuse its answer for the whole block: asked row by
 * row, a data row's walk reaches back to the separator, so a long table costs
 * the square of its length (130,000 rows took seven minutes).
 *
 * @param getText - The text of a line by its 1-based position.
 * @param n - The line to ask about.
 */
export function isTableRowAt(getText: (n: number) => string | undefined, n: number): boolean {
	return tableBlockAt(getText, n)?.isTable ?? false;
}

/**
 * The block of pipe rows around line `n`, and whether it is a table: whether
 * it holds a separator row below its first line. Null when line `n` is not a
 * pipe row. One walk of the block, so a caller that keeps the answer pays once
 * per block, not once per row.
 *
 * @param getText - The text of a line by its 1-based position.
 * @param n - A line in the block.
 */
export function tableBlockAt(getText: (n: number) => string | undefined, n: number): { first: number; last: number; isTable: boolean } | null {
	const block = pipeBlockAround(getText, n);
	if (block === null) return null;
	let isTable = false;
	for (let k = block.first + 1; k <= block.last && !isTable; k++) isTable = isSeparatorRowText(getText(k));
	return { first: block.first, last: block.last, isTable };
}

/**
 * The first and last positions of the block of pipe rows around line `n`, or
 * null when line `n` is not a pipe row. For an edit, which has to reclassify
 * every row of the block it touched.
 *
 * @param getText - The text of a line by its 1-based position.
 * @param n - A line in the block.
 */
export function pipeBlockAround(getText: (n: number) => string | undefined, n: number): { first: number; last: number } | null {
	if (!isPipeRow(getText(n))) return null;
	let first = n;
	while (first > 1 && isPipeRow(getText(first - 1))) first--;
	let last = n;
	while (isPipeRow(getText(last + 1))) last++;
	return { first, last };
}
