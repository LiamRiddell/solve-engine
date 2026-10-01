/**
 * How a range refusal names its bounds: as the reader wrote them.
 *
 * A range's bounds are worked out before the range is built, so the refusal of
 * a range that runs downwards used to show only the numbers they came to. In
 * `total(1 + 24:00)` the colon is a range's (see `parseCollectionExpr`), its
 * bounds are `1 + 24` and `00`, and the reader was told "A range's min (25)
 * cannot be greater than its max (0)", two numbers they never typed. The
 * parser now keeps each side's text beside the range (`RANGE_NEW_WRITTEN`), and
 * the refusal quotes it, with the number it came to when that differs.
 */

import { quoted } from "@solve-js/engine/ColonLabel";

/**
 * One bound as the refusal names it: the number alone when the reader wrote
 * it that way (or no text was kept), otherwise their text and what it came to.
 *
 * @param written - The side as the reader wrote it, or "" when none was kept.
 * @param value - The number the side came to.
 * @returns `5`, or `1 + 24, which is 25`.
 */
export function boundAsWritten(written: string, value: number): string {
	const shown = String(value);
	const text = written.trim();
	if (text.length === 0 || text === shown) return shown;
	return `${quoted(text)}, which is ${shown}`;
}

/**
 * The refusal of a range that runs downwards, `5:1`, naming each bound as it
 * was written and offering the range the other way round.
 *
 * @param min - The number the first side came to.
 * @param max - The number the second side came to, smaller than `min`.
 * @param minWritten - The first side as written, or "".
 * @param maxWritten - The second side as written, or "".
 * @returns The message.
 */
export function descendingRangeMessage(min: number, max: number, minWritten = "", maxWritten = ""): string {
	return `A range's min (${boundAsWritten(minWritten, min)}) cannot be greater than its max (${boundAsWritten(maxWritten, max)}). Did you mean "${max}:${min}"?`;
}
