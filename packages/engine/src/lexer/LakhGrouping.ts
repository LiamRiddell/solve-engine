/**
 * Reading Indian digit grouping: `1,00,000` and `12,34,567`.
 *
 * In India one lakh (a hundred thousand) is written `1,00,000` and ten lakh
 * `10,00,000`: the last three digits form a group, and every group before them
 * is two digits. The engine already writes numbers this way under `en-IN`, but
 * it read a thousands group only as exactly three digits, so `₹1,00,000` was
 * refused at its first comma and `amounts in "₹1,00,000"` answered `[1]`, a
 * confident wrong answer for one lakh (#657).
 *
 * The lexer and text extraction share the scan here. Each decides for itself
 * when to try it, since outside the convention `12,34` is not a group at all:
 * beside a rupee marker (`₹` before the number, `INR` after it), or everywhere
 * in an engine whose locale's region is India (see `groupsInLakhs` in
 * `constants/locales`).
 *
 * @module LakhGrouping
 */

/** The code unit of `,`. */
const COMMA = 0x2c;

/** The code unit of `.`. */
const FULL_STOP = 0x2e;

/** The Indian rupee sign, `₹`. */
const RUPEE_SIGN = 0x20b9;

/** Whether the code unit at `at` is an ASCII digit. Outside the text is not a digit. */
function digitAt(text: string, at: number): boolean {
	if (at < 0 || at >= text.length) return false;
	const unit = text.charCodeAt(at);
	return unit >= 0x30 && unit <= 0x39;
}

/** Whether the code unit at `at` is a space that may sit between an amount and its currency: space, tab, or a no-break space. */
function spaceAt(text: string, at: number): boolean {
	if (at < 0 || at >= text.length) return false;
	const unit = text.charCodeAt(at);
	return unit === 0x20 || unit === 0x09 || unit === 0xa0 || unit === 0x202f;
}

/** Whether the code unit at `at` continues a word: a letter, a digit or `_`. Outside the text does not. */
function wordAt(text: string, at: number): boolean {
	if (at < 0 || at >= text.length) return false;
	const ch = text[at];
	return digitAt(text, at) || ch === "_" || ch.toLowerCase() !== ch.toUpperCase();
}

/**
 * Where a lakh-grouped number's digits end, given the comma after its first
 * group.
 *
 * The caller has read the first group, one or two digits. From the comma the
 * pattern is one or more groups of two, each followed by another comma, then a
 * final group of three with no fourth digit after it. A single group of three
 * is ordinary thousands grouping and not claimed here, and a further group of
 * three after the final one (`1,00,000,000`) is not the pattern, so nothing is
 * read and the caller's refusal stands.
 *
 * @param text - The text the number sits in.
 * @param commaAt - Index of the comma after the first group.
 * @returns The index just past the final group, or -1 when the digits from
 * `commaAt` are not lakh grouping.
 */
export function lakhGroupEnd(text: string, commaAt: number): number {
	let at = commaAt;
	let pairs = 0;
	while (text.charCodeAt(at) === COMMA && digitAt(text, at + 1) && digitAt(text, at + 2)) {
		if (text.charCodeAt(at + 3) === COMMA) {
			pairs++;
			at += 3;
			continue;
		}
		if (pairs === 0 || !digitAt(text, at + 3) || digitAt(text, at + 4)) return -1;
		const end = at + 4;
		// `1,00,000,000` mixes the two conventions; neither reading is safe.
		if (text.charCodeAt(end) === COMMA && digitAt(text, end + 1)) return -1;
		return end;
	}
	return -1;
}

/** A hyphen-minus or the Unicode minus sign. */
function minusAt(text: string, at: number): boolean {
	const unit = text.charCodeAt(at);
	return unit === 0x2d || unit === 0x2212;
}

/**
 * Whether a rupee marker sits beside the digits from `start` to `end`: the sign
 * `₹` before them, with a minus allowed between (`₹-1,00,000`, as `₹-100` is
 * read), or the code `INR` after them and after any fraction.
 *
 * @param text - The text the number sits in.
 * @param start - Index of the number's first digit.
 * @param end - Index just past its grouped digits.
 * @param maxGap - The most spaces allowed between the number and the marker:
 * any number in an expression, where spacing means nothing, and one in pasted
 * text, where a currency belongs to a number only when it touches it or is one
 * space away.
 */
export function rupeeMarked(text: string, start: number, end: number, maxGap: number): boolean {
	let before = start - 1;
	for (let gap = 0; gap < maxGap && spaceAt(text, before); gap++) before--;
	if (minusAt(text, before)) {
		before--;
		for (let gap = 0; gap < maxGap && spaceAt(text, before); gap++) before--;
	}
	if (before >= 0 && text.charCodeAt(before) === RUPEE_SIGN) return true;

	let after = end;
	if (text.charCodeAt(after) === FULL_STOP && digitAt(text, after + 1)) {
		after++;
		while (digitAt(text, after)) after++;
	}
	for (let gap = 0; gap < maxGap && spaceAt(text, after); gap++) after++;
	return text.startsWith("INR", after) && !wordAt(text, after + 3);
}
