/**
 * Refusing a number literal a comma-decimal locale cannot read without
 * guessing.
 *
 * German writes one thousand as `1.000` and two and a half as `2,5`; French
 * marks the decimal with a comma too and groups with a space. The lexer
 * coalesces a `.` or `,` into the number it is reading when exactly three
 * digits follow it (see `lexer/ExpressionLexer.ts`'s "Thousands separators"
 * block), whatever the locale, and the parser then strips the locale's group
 * mark and turns its decimal comma into a point. Two shapes came out wrong,
 * silently:
 *
 * - A dot decimal under a locale that groups with a dot. `2.5` reaches the
 *   parser whole, as the lexer's own decimal, and stripping every `.` read it
 *   as 25: `$9.99` became $999.00 and `0.5` became 5, wrong money a hundred
 *   times too large (#654). A dot followed by one, two, or four or more digits
 *   is not a German thousands group; it is an English decimal typed into a
 *   German engine. A dot with no digit in front of it (`.5`) is refused for the
 *   same reason: a group mark sits between digits.
 * - A second decimal mark after the decimal comma. `1,234,567` is one number to
 *   an English reader, and turning its first comma into a point left
 *   `1.234,567`, which `parseFloat` stops reading at the comma: 1.234, a
 *   millionth of the number. `1,234.56` under `fr` came out the same way. A
 *   locale with a decimal comma has one decimal mark, and nothing but digits
 *   after it. This shape reached German and French engines from the start; a
 *   regional tag (`de-DE`, `fr-FR`) reached it too once tags fell back to their
 *   language's pack instead of English (#655), which is why it is refused in
 *   the same change.
 *
 * Both are refused by name, the way `1.000n` is refused in an English engine
 * (see `parser/BigIntLiteral.ts`), rather than guessed at. What stays: `2.500`
 * is two thousand five hundred in German, `1.234.567` is over a million, and
 * `1.234,567` is a German one thousand two hundred and thirty-four and a bit. A
 * dotted date (`17.11.2025`) never reaches here, since the date normaliser
 * fuses it into a date first.
 *
 * Written once here and called from both parse sites, `PrecedenceParser`'s
 * Tier-1 NUMBER case and `NumberParselet`, because the two tiers disagreeing
 * about a literal is a bug shape this codebase has had before.
 *
 * @module LocaleNumberLiteral
 */

import { getLocale } from "@solve-js/constants/locales";
import type { EngineError, SourceSpan } from "@solve-js/errors/EngineError";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * A `.` that cannot be a thousands group: one with no digit in front of it, or
 * one not followed by exactly three digits. The exponent's `e` is not a digit,
 * so `1.000e3` passes as a group and `1.5e3` does not.
 */
const DOT_THAT_IS_NOT_A_GROUP = /(?:^|[^0-9])\.|\.(?![0-9]{3}(?![0-9]))/;

/**
 * A group before the first dot longer than three digits, where "." groups
 * thousands: `12345.678` is not grouped either (#806).
 */
const LONG_FIRST_GROUP = /^[+-]?[0-9]{4,}\./;

/** Why a literal cannot be read in its locale; see {@link unreadableInLocale}. */
export type UnreadableLiteral = "dot-decimal" | "second-decimal-mark" | "misplaced-group" | "grouped-decimal";

/**
 * Whether a number literal holds a `.` that a locale grouping thousands with
 * `.` cannot read as a group.
 *
 * @param raw - The NUMBER token's text, e.g. `2.5`, `2.500` or `1.234.567`.
 * @returns True for `2.5`, `0.5`, `.5`, `1.0001`, `1,000.5` and `1.5e3`; false
 * for `2.500`, `1.234.567`, `1.000e3` and any literal with no dot at all.
 */
export function isDotDecimal(raw: string): boolean {
	return raw.indexOf(".") !== -1 && DOT_THAT_IS_NOT_A_GROUP.test(raw);
}

/**
 * Whether a literal holds a second decimal mark, read in a locale that marks
 * the decimal with a comma: another mark after its comma (`1,234,567`,
 * `1,234.567`), or, where `.` does not group thousands, a dot decimal before
 * it (`1.234,56` under `fr`).
 *
 * @param raw - The NUMBER token's text.
 * @param thousandsSeparator - The locale's group mark, `.` for `de` and a space for `fr`.
 */
export function hasSecondDecimalMark(raw: string, thousandsSeparator: string): boolean {
	const comma = raw.indexOf(",");
	if (comma === -1) return false;
	for (let i = comma + 1; i < raw.length; i++) {
		const c = raw.charCodeAt(i);
		if (c === 44 || c === 46) return true;
	}
	return thousandsSeparator !== "." && raw.lastIndexOf(".", comma) !== -1;
}

/**
 * Why a literal cannot be read in a locale that marks the decimal with a
 * comma, or null when it can.
 *
 * @param raw - The NUMBER token's text.
 * @param decimalSeparator - The locale's decimal mark.
 * @param thousandsSeparator - The locale's group mark.
 * @returns `dot-decimal` for `2.5` where `.` groups, `second-decimal-mark` for
 * `1,234,567`, and null for everything a point-decimal locale reads, since
 * neither shape is ambiguous there.
 */
export function unreadableInLocale(raw: string, decimalSeparator: string, thousandsSeparator: string): UnreadableLiteral | null {
	if (decimalSeparator === ".") {
		// The mirror of #654 in a point-decimal locale: a comma group after the
		// decimal point, `1.234,567`, is a German number, and stripping the
		// comma read it as 1.234567 (#805).
		const point = raw.indexOf(".");
		return thousandsSeparator === "," && point !== -1 && raw.indexOf(",", point) !== -1 ? "grouped-decimal" : null;
	}
	if (decimalSeparator !== ",") return null;
	if (thousandsSeparator === "." && isDotDecimal(raw)) return "dot-decimal";
	if (thousandsSeparator === "." && LONG_FIRST_GROUP.test(raw)) return "misplaced-group";
	if (hasSecondDecimalMark(raw, thousandsSeparator)) return "second-decimal-mark";
	return null;
}

/**
 * A number literal's value in its locale, for a parselet that reads a number's
 * text itself rather than through the parser's NUMBER case, refusing what
 * {@link unreadableInLocale} refuses.
 *
 * A frame rate read its text with `parseFloat`, the English reading, in every
 * locale, so under `de` `2.5 fps` was 2.5 frames a second where `2.5` alone is
 * refused, and `2.500 fps` was 2.5 where German means two thousand five hundred
 * (#806).
 *
 * @param raw - The number's text as the lexer read it.
 * @param localeCode - The engine's locale tag.
 * @returns The number.
 * @throws An `INVALID_NUMBER_LITERAL` parsing error for a literal the locale cannot read.
 */
export function readLocaleNumber(raw: string, localeCode: string): number {
	const { decimalSeparator, thousandsSeparator } = getLocale(localeCode).display;
	const unreadable = unreadableInLocale(raw, decimalSeparator, thousandsSeparator);
	if (unreadable !== null) throw localeLiteralRefusal(raw, localeCode, unreadable);
	let normalized = raw;
	if (thousandsSeparator && normalized.indexOf(thousandsSeparator) !== -1) normalized = normalized.split(thousandsSeparator).join("");
	if (decimalSeparator && decimalSeparator !== ".") normalized = normalized.replace(decimalSeparator, ".");
	return parseFloat(normalized);
}

/**
 * The refusal for a literal {@link unreadableInLocale} caught.
 *
 * The message names the language pack whose rule applies (`de` for a `de-AT`
 * engine too), not the host's full tag, so a tag of any length cannot swell
 * the message. The tag itself is kept in the context.
 *
 * @param raw - The NUMBER token's text.
 * @param localeCode - The engine's locale tag.
 * @param why - Which shape it is.
 * @param span - Where the literal sits, when the caller knows it.
 * @returns An `INVALID_NUMBER_LITERAL` parsing error, for the caller to throw.
 */
export function localeLiteralRefusal(raw: string, localeCode: string, why: UnreadableLiteral, span?: SourceSpan): EngineError {
	const language = getLocale(localeCode).code;
	const message =
		why === "dot-decimal"
			? `"${raw}" is not a number in the ${language} locale: "." groups thousands there, so it is followed by exactly three digits, as in 2.500 (two thousand five hundred).`
			: why === "misplaced-group"
				? `"${raw}" is not a number in the ${language} locale: "." groups thousands there, in threes, as in 12.345.678.`
				: why === "grouped-decimal"
					? `"${raw}" is not a number in the ${language} locale: "." marks the decimal there, and the digits after it are not grouped.`
					: `"${raw}" is not a number in the ${language} locale: "," marks the decimal there, so it appears once, with only digits after it.`;
	return ErrorFactory.parsing({
		code: "INVALID_NUMBER_LITERAL",
		message,
		context: { raw, localeCode, separator: why === "dot-decimal" || why === "misplaced-group" ? "." : "," },
		span,
	});
}
