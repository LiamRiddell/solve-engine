/**
 * Where the block of figures `total above` reads comes to an end.
 *
 * `total above` and `average above` add up the column of figures directly over
 * them, and a blank line or a heading ends that column. They used to stop at
 * any line the classifier skips, so a `// remember to check` comment inside the
 * column cut it short: `rent: $500`, the comment, `food: $200`, `total above`
 * gave $200.00 (#652). A comment, a blockquote or a wiki link has no figure, and
 * the total passes over it, as a line range already did. What ends the block is
 * a blank line, a heading, a horizontal rule, a code or math fence, or a table,
 * whose rows are markup read by the table forms.
 *
 * @module BlockBoundary
 */

import type { LineClassification } from "@solve-js/lexer/ExpressionLexer";
import { isPipeRow, tableBlockAt } from "@solve-js/lexer/TableBlocks";

/** The line kinds that end a block of figures. A heading is matched by its `#` below, as it always was. */
const BLOCK_ENDING_TYPES: ReadonlySet<string> = new Set(["empty", "heading", "hr", "code_fence", "math_fence", "table", "table_separator"]);

/**
 * Whether line `n` has no figure, read from its text: a blank line, a heading,
 * a line the classifier skips (a comment, a blockquote, a fence), or a row of a
 * table. The batch pass knows this for every line from its scan; the incremental
 * pass knew it for a line only once the evaluator had reached it, so a form
 * reading a comment below it saw a figure still to come (#803). This is the
 * incremental pass's answer for a line it has not reached.
 *
 * @param getText - The text of a line by its 1-based position.
 * @param classify - The line classifier.
 * @param n - The line to ask about.
 */
export function hasNoFigure(
	getText: (n: number) => string | undefined,
	classify: (text: string) => LineClassification,
	n: number,
): boolean {
	const text = getText(n);
	if (text === undefined) return true;
	if (/^\s*#/.test(text)) return true;
	const classification = classify(text);
	if (classification.skip) return true;
	// A row holding an inline solve is read like prose holding one, on both passes.
	return !classification.hasInlineSolve && isPipeRow(text) && (tableBlockAt(getText, n)?.isTable ?? false);
}

/**
 * Whether line `n` ends the block of figures above a `total above`, read
 * through `getText` (1-based, undefined past either end, which ends the block
 * too).
 *
 * @param getText - The text of a line by its 1-based position.
 * @param classify - The line classifier, which reads a line's markdown kind.
 * @param n - The line to ask about.
 */
export function endsFigureBlock(
	getText: (n: number) => string | undefined,
	classify: (text: string) => LineClassification,
	n: number,
): boolean {
	const text = getText(n);
	if (text === undefined) return true;
	if (/^\s*#/.test(text)) return true;
	if (BLOCK_ENDING_TYPES.has(classify(text).type)) return true;
	// A pipe row is a table row only because of the separator in its block.
	return isPipeRow(text) && (tableBlockAt(getText, n)?.isTable ?? false);
}
