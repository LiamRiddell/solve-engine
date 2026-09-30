/**
 * Reading a thousands comma in an amount of money inside a call or a list:
 * `compoundInterest($1,000, 5%, 3)` is three arguments, the first $1,000.
 *
 * Inside a call's brackets or a list's, a comma separates arguments, so
 * `rgb(255,255,255)` is three numbers and `[100,200,300]` three elements. That
 * rule split `$1,000` into `$1` and `000`, and `compoundInterest($1,000, 5%, 3)`
 * was refused as a call with four arguments (#830). An amount written with a
 * currency sign in front is money, and nobody writes an argument list as `$1`
 * then `000`, so there the comma is read as the grouping it is.
 *
 * The rule is narrow on purpose. A group is exactly three digits, and what
 * follows it must end the amount: another group's comma, a decimal point, a
 * closing bracket, a space or the end of the text. A plain number keeps the
 * separator reading, since `max(1,000, 2)` could be a list of three numbers as
 * easily as two, and an amount with its currency after it (`1,000 USD`) is not
 * claimed either, since the comma is read before the code is.
 *
 * @module CurrencyGrouping
 */

/** The code units of the currency signs the lexer reads before an amount. */
const CURRENCY_SIGNS: ReadonlySet<number> = new Set([
	0x24, // $
	0xa3, // £
	0x20ac, // €
	0xa5, // ¥
	0x20bd, // ₽
	0x20a9, // ₩
	0x20b9, // ₹
	0x20ba, // ₺
	0x20b4, // ₴
	0x20aa, // ₪
	0x20ab, // ₫
	0x20a6, // ₦
	0x20b1, // ₱
]);

/** Whether the code unit at `at` is an ASCII digit. Outside the text is not a digit. */
function digitAt(text: string, at: number): boolean {
	if (at < 0 || at >= text.length) return false;
	const unit = text.charCodeAt(at);
	return unit >= 0x30 && unit <= 0x39;
}

/**
 * Whether a currency sign stands directly before the number starting at
 * `start`, with a minus allowed between (`$-1,000`).
 *
 * @param text - The text the number sits in.
 * @param start - Index of the number's first digit.
 */
export function currencySignBefore(text: string, start: number): boolean {
	let before = start - 1;
	if (before >= 0 && (text.charCodeAt(before) === 0x2d || text.charCodeAt(before) === 0x2212)) before--;
	return before >= 0 && CURRENCY_SIGNS.has(text.charCodeAt(before));
}

/**
 * Whether the comma at `commaAt` opens a thousands group of a currency amount
 * inside a call or a list: a currency sign before the number that starts at
 * `start`, then exactly three digits after the comma, then something that ends
 * the group (a comma, a decimal point, a closing bracket, a space, the end).
 *
 * @param text - The text the number sits in.
 * @param start - Index of the number's first digit.
 * @param commaAt - Index of the comma being weighed.
 */
export function groupsCurrencyInCall(text: string, start: number, commaAt: number): boolean {
	if (text.charCodeAt(commaAt) !== 0x2c) return false;
	if (!currencySignBefore(text, start)) return false;
	if (!digitAt(text, commaAt + 1) || !digitAt(text, commaAt + 2) || !digitAt(text, commaAt + 3)) return false;
	const after = commaAt + 4;
	if (after >= text.length) return true;
	const unit = text.charCodeAt(after);
	return unit === 0x2c || unit === 0x2e || unit === 0x29 || unit === 0x5d || unit === 0x20 || unit === 0x09 || unit === 0xa0;
}
