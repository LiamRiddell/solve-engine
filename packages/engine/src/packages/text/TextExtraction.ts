/**
 * Reading the numbers, and the amounts of money, written in a piece of text.
 *
 * A receipt, a log line or a bank statement pasted into a note is text, and
 * the numbers in it are characters, not values. This module finds them the way
 * a reader would, in the number format the engine is configured with, so
 * `1,234.56` is one number in English and `1.234,56` is one number in German,
 * and neither is guessed from the text itself.
 *
 * The scan is one pass over the text and reads nothing as code. It stops as
 * soon as it has found more numbers than the caller allows, so a pasted log of
 * any size costs at most one read up to the limit.
 */
import { getLocale, groupsInLakhs } from "@solve-js/constants/locales";
import { lakhGroupEnd, rupeeMarked } from "@solve-js/lexer/LakhGrouping";
import { CURRENCY_DISPLAY, CURRENCY_SYMBOL_ALIASES } from "@solve-js/uom/CurrencyAliases";

/** How numbers are written: the decimal mark and the characters that group thousands. */
export interface NumberFormat {
	/** The decimal mark, `.` in English and `,` in German and French. */
	readonly decimal: string;
	/** Each character accepted between groups of three digits. Empty when grouping is not read. */
	readonly groups: readonly string[];
	/**
	 * Whether Indian grouping (`1,00,000`, `12,34,567`) is read wherever it
	 * appears, as an Indian-region engine (`en-IN`) reads it. Absent or false,
	 * it is read only beside a rupee marker, `₹` before the number or `INR`
	 * after it, and only when `,` is one of the {@link groups}.
	 */
	readonly lakhs?: boolean;
}

/** One number found in the text. */
export interface FoundNumber {
	/** Its value, sign included. */
	readonly value: number;
	/** The ISO 4217 code of the currency written beside it, when there is one. */
	readonly currency?: string;
}

/** The result of a scan that found more numbers than it was allowed to. */
export interface TooManyNumbers {
	/** Always true: the scan stopped at the limit rather than finishing. */
	readonly tooMany: true;
}

/**
 * The number format a locale writes: English groups with `,` and marks the
 * decimal with `.`; German the other way round; French groups with a space.
 *
 * Where the grouping character is a space, the two no-break spaces are read as
 * it too, since they are what a formatted French number carries (`1 234,56`
 * copied from a page usually has a narrow no-break space in it, not a space).
 *
 * An Indian-region tag (`en-IN`) also reads Indian grouping throughout; see
 * {@link NumberFormat.lakhs}.
 *
 * @param localeCode - The engine's locale tag: `en`, `de`, `fr`, or a
 * regional tag such as `de-DE`, which reads as its language does.
 */
export function numberFormatFor(localeCode: string): NumberFormat {
	const display = getLocale(localeCode).display;
	const group = display.thousandsSeparator;
	const groups = group === " " ? [" ", " ", " "] : group ? [group] : [];
	return groupsInLakhs(localeCode)
		? { decimal: display.decimalSeparator, groups, lakhs: true }
		: { decimal: display.decimalSeparator, groups };
}

/** Whether a UTF-16 unit is an ASCII digit. */
function isDigit(unit: number): boolean {
	return unit >= 0x30 && unit <= 0x39;
}

/** Whether the character at `at` is a letter (in any script). Outside the text is not a letter. */
function isLetter(text: string, at: number): boolean {
	if (at < 0 || at >= text.length) return false;
	const ch = text[at];
	return ch.toLowerCase() !== ch.toUpperCase();
}

/** Whether the character at `at` is a letter or an ASCII digit. */
function isLetterOrDigit(text: string, at: number): boolean {
	return at >= 0 && at < text.length && (isDigit(text.charCodeAt(at)) || isLetter(text, at));
}

/** A hyphen-minus or the Unicode minus sign. */
function isMinus(text: string, at: number): boolean {
	const ch = text[at];
	return ch === "-" || ch === "−";
}

/** A single space of the kinds that sit between an amount and its currency: space, or a no-break space. */
function isGap(text: string, at: number): boolean {
	const ch = text[at];
	return ch === " " || ch === " " || ch === " ";
}

/** Whether exactly three digits start at `at` and a fourth does not follow. */
function threeDigitsAt(text: string, at: number): boolean {
	return (
		at + 3 <= text.length &&
		isDigit(text.charCodeAt(at)) &&
		isDigit(text.charCodeAt(at + 1)) &&
		isDigit(text.charCodeAt(at + 2)) &&
		!(at + 3 < text.length && isDigit(text.charCodeAt(at + 3)))
	);
}

/** The grouping character starting at `at`, or null. */
function groupAt(text: string, at: number, groups: readonly string[]): string | null {
	for (const g of groups) {
		if (text.startsWith(g, at)) return g;
	}
	return null;
}

/** Where a leading fraction such as `.50` may begin: the start, a space, an opening bracket or a currency sign. */
function mayOpenFraction(text: string, at: number): boolean {
	if (at < 0) return true;
	const ch = text[at];
	return isGap(text, at) || ch === "\t" || ch === "\n" || ch === "(" || ch === "[" || isMinus(text, at) || Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL_ALIASES, ch);
}

/** A number as found, with where it sits, before any currency is attached. */
interface Span {
	/** Index of its first character, its minus sign when it has one. */
	readonly start: number;
	/** Index just past its last digit. */
	readonly end: number;
	readonly magnitude: number;
	negative: boolean;
	currency?: string;
}

/** A currency sign or code as found. */
interface Mark {
	readonly start: number;
	readonly end: number;
	readonly code: string;
}

/**
 * The currencies read from a three-letter code: the ones the engine shows with
 * a sign of its own (`USD`, `GBP`, `EUR`, `JPY`, `CHF`, ...). A rarer code is
 * not read, because a great many three-letter capitals are also currency codes
 * (`ALL`, `TOP`, `CUP`, `PEN`, `AMD`), and `TOP 10` is not ten Tongan pa'anga.
 */
function isReadCurrencyCode(code: string): boolean {
	return Object.prototype.hasOwnProperty.call(CURRENCY_DISPLAY, code);
}

/** Every number in the text as a span, or null past the limit. */
function numberSpans(text: string, format: NumberFormat, limit: number): Span[] | null {
	const spans: Span[] = [];
	const { decimal, groups } = format;
	const length = text.length;
	let i = 0;
	while (i < length) {
		const unit = text.charCodeAt(i);
		const leadingFraction =
			!isDigit(unit) &&
			text.startsWith(decimal, i) &&
			i + decimal.length < length &&
			isDigit(text.charCodeAt(i + decimal.length)) &&
			mayOpenFraction(text, i - 1);
		if (!isDigit(unit) && !leadingFraction) {
			i++;
			continue;
		}

		const start = i;
		while (i < length && isDigit(text.charCodeAt(i))) i++;
		let whole = text.slice(start, i);
		// Grouping is read only after a first group of one to three digits, and
		// only while each group is exactly three digits: `1,234,567` is one
		// number, `1,2345` and `12345,678` are two.
		if (whole.length >= 1 && whole.length <= 3) {
			for (;;) {
				const g = groupAt(text, i, groups);
				if (g === null || !threeDigitsAt(text, i + g.length)) break;
				whole += text.slice(i + g.length, i + g.length + 3);
				i += g.length + 3;
			}
		}
		// Indian grouping, `1,00,000` and `12,34,567`: a first group of one or
		// two digits, then groups of two, then three, which the loop above
		// stopped at. Read beside a rupee marker, or everywhere for an
		// Indian-region engine, as the lexer reads it (lexer/LakhGrouping.ts).
		if (whole.length >= 1 && whole.length <= 2 && text.charCodeAt(i) === 0x2c && groups.includes(",")) {
			const lakhEnd = lakhGroupEnd(text, i);
			if (lakhEnd !== -1 && (format.lakhs === true || rupeeMarked(text, start, lakhEnd, 1))) {
				whole = text.slice(start, lakhEnd).split(",").join("");
				i = lakhEnd;
			}
		}
		let fraction = "";
		if (text.startsWith(decimal, i) && i + decimal.length < length && isDigit(text.charCodeAt(i + decimal.length))) {
			const fractionStart = i + decimal.length;
			let j = fractionStart;
			while (j < length && isDigit(text.charCodeAt(j))) j++;
			fraction = text.slice(fractionStart, j);
			i = j;
		}

		// A minus signs the number only when it stands in front of it, not
		// between two words or two numbers: `-5` and `(-5)`, but not `10-20`.
		const signed = start > 0 && isMinus(text, start - 1) && !isLetterOrDigit(text, start - 2);
		const magnitude = Number(`${whole === "" ? "0" : whole}${fraction === "" ? "" : `.${fraction}`}`);
		spans.push({ start: signed ? start - 1 : start, end: i, magnitude, negative: signed });
		if (spans.length > limit) return null;
	}
	return spans;
}

/** Every currency sign, and every three-letter code standing apart from a neighbouring word. */
function currencyMarks(text: string): Mark[] {
	const marks: Mark[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL_ALIASES, ch)) {
			marks.push({ start: i, end: i + 1, code: CURRENCY_SYMBOL_ALIASES[ch] });
			continue;
		}
		const unit = text.charCodeAt(i);
		if (unit < 0x41 || unit > 0x5a || isLetter(text, i - 1)) continue;
		const code = text.slice(i, i + 3);
		// A digit may touch the code (`12EUR`, `USD12`); a letter may not.
		if (/^[A-Z]{3}$/.test(code) && !isLetter(text, i + 3) && isReadCurrencyCode(code)) {
			marks.push({ start: i, end: i + 3, code });
			i += 2;
		}
	}
	return marks;
}

/**
 * Attach each currency to the number it belongs to.
 *
 * A sign or code belongs to a number it touches, or that is one space away. When
 * it sits between two numbers (`5 € 6`), the one it touches wins, then the one
 * that has no currency yet, then the one after it, which is how `3,20 € 12,50 €`
 * reads as two amounts in euros and `2 £5` as a count and five pounds. Marks
 * with only one neighbour are settled first, so the ambiguous ones see which
 * numbers are already taken.
 */
function attachCurrencies(text: string, spans: Span[], marks: readonly Mark[]): void {
	const endingAt = new Map<number, Span>();
	const startingAt = new Map<number, Span>();
	for (const span of spans) {
		endingAt.set(span.end, span);
		startingAt.set(span.start, span);
	}
	type Side = { span: Span; touching: boolean; after: boolean };
	const neighbours = marks.map((mark) => {
		const sides: Side[] = [];
		const beforeTouching = endingAt.get(mark.start);
		const beforeGapped = mark.start > 0 && isGap(text, mark.start - 1) ? endingAt.get(mark.start - 1) : undefined;
		if (beforeTouching) sides.push({ span: beforeTouching, touching: true, after: false });
		else if (beforeGapped) sides.push({ span: beforeGapped, touching: false, after: false });
		const afterTouching = startingAt.get(mark.end);
		const afterGapped = isGap(text, mark.end) ? startingAt.get(mark.end + 1) : undefined;
		if (afterTouching) sides.push({ span: afterTouching, touching: true, after: true });
		else if (afterGapped) sides.push({ span: afterGapped, touching: false, after: true });
		return sides;
	});
	const bind = (mark: Mark, side: Side): void => {
		side.span.currency = mark.code;
		// `-£5`: a minus in front of the currency signs the amount after it.
		if (side.after && mark.start > 0 && isMinus(text, mark.start - 1) && !isLetterOrDigit(text, mark.start - 2)) {
			side.span.negative = true;
		}
	};
	marks.forEach((mark, i) => {
		const sides = neighbours[i];
		if (sides.length === 1 && sides[0].span.currency === undefined) bind(mark, sides[0]);
	});
	marks.forEach((mark, i) => {
		const sides = neighbours[i];
		if (sides.length !== 2) return;
		const [before, after] = sides;
		const ordered = before.touching && !after.touching ? [before, after] : [after, before];
		const free = ordered.find((side) => side.span.currency === undefined);
		if (free) bind(mark, free);
	});
}

/**
 * Every number written in `text`, in order.
 *
 * A number is a run of digits, with thousands grouped by the format's grouping
 * character (a group is exactly three digits, and only after a first group of
 * one to three) and a fraction after its decimal mark. A fraction may also
 * stand alone after a space or a currency sign, as in `$.50`. A minus sign
 * counts when it stands in front of the number and not between two words or
 * numbers, so `-5` and `(-5)` are negative while `10-20` is two numbers and
 * `A-4` is 4. A currency sign, or one of the common three-letter codes, beside
 * the number, touching it or one space away, is recorded with it.
 *
 * Nothing else is read: `15%` is 15, `3 kg` is 3, `1.5e3` is 1.5 and 3, and a
 * date or a time is the numbers it is written with.
 *
 * @param text - The text to read.
 * @param format - How numbers are written in it.
 * @param limit - The most numbers to find before giving up.
 * @returns The numbers, or {@link TooManyNumbers} when there are more than `limit`.
 */
export function scanNumbers(text: string, format: NumberFormat, limit: number): FoundNumber[] | TooManyNumbers {
	const spans = numberSpans(text, format, limit);
	if (spans === null) return { tooMany: true };
	attachCurrencies(text, spans, currencyMarks(text));
	return spans.map((span) => {
		const value = span.negative && span.magnitude !== 0 ? -span.magnitude : span.magnitude;
		return span.currency === undefined ? { value } : { value, currency: span.currency };
	});
}
