/**
 * Turning a `123n` literal's source text into the digits `PUSH_BIGINT` stores.
 *
 * The lexer coalesces thousands groups into the number token it is building,
 * accepting both `,` and `.` as the separator regardless of locale (see
 * `lexer/ExpressionLexer.ts`'s "Thousands separators" block). For a NUMBER that
 * is fine, because the separators are stripped again when the text is turned
 * into a double. For a BIGINT nothing stripped them: both consumers took the
 * token text, removed the trailing `n`, and handed the rest straight to
 * `BigInt()`.
 *
 * So `1.000n` reached `BigInt("1.000")`, which throws a raw `SyntaxError` that
 * arrived at the host as UNEXPECTED_ERROR/INTERNAL: the engine reporting its
 * own bug for six characters a user typed. `1.01n` and `1.1n` were fine, which
 * is the tell that the `n` suffix was never the problem, the three-digit
 * thousands group was: a dot followed by exactly three digits is what the lexer
 * swallows, and one followed by one or two digits it leaves alone.
 *
 * Written once here rather than inline at both call sites. There are two
 * (`parser/PrecedenceParser.ts`'s Tier-1 switch and
 * `packages/biginteger/parselets/BigIntNumberParselet.ts`), they already held
 * identical copies of the `n`-stripping, and the two tiers disagreeing about a
 * literal is a bug shape this codebase has had before.
 *
 * @module BigIntLiteral
 */

import { getLocale } from "@solve-js/constants/locales";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Two or more dot-separated groups of three, e.g. `1.234.567`.
 *
 * Unambiguous in any locale, since no locale writes two decimal points, so this
 * is stripped without consulting one. Same regex and same reasoning as
 * `NumberParselet.ts`'s copy for the NUMBER path.
 */
const CHAINED_DOT_THOUSANDS_GROUPS = /^\d{1,3}(\.\d{3}){2,}$/;

/** Digits and nothing else, which is what `BigInt()` can be handed safely. */
const DIGITS_ONLY = /^\d+$/;

/**
 * The digit string behind a bigint literal.
 *
 * A bigint literal has no fractional part by construction: the lexer only emits
 * BIGINT when it saw no decimal point of its own and no exponent, so any `.` or
 * `,` still in the text got there as a thousands group. Which of the two the
 * writer meant is a locale question, and answering it wrongly would silently
 * change the value by three orders of magnitude, so only the separator this
 * locale actually uses for grouping is removed. Anything left over is refused
 * rather than guessed at.
 *
 * @param raw - The token's text, with or without the trailing `n`.
 * @param localeCode - The engine's active locale.
 * @returns A string of digits, ready for `BigInt()`.
 * @throws An `INVALID_NUMBER_LITERAL` parsing error when what is left is not a
 * whole number, e.g. `1.000n` in a locale that writes decimals with a dot.
 */
export function bigIntLiteralDigits(raw: string, localeCode: string): string {
	const withoutSuffix = raw.endsWith("n") ? raw.slice(0, -1) : raw;

	// The common case first: nothing was grouped, so there is nothing to decide.
	if (DIGITS_ONLY.test(withoutSuffix)) return withoutSuffix;

	const digits = CHAINED_DOT_THOUSANDS_GROUPS.test(withoutSuffix)
		? withoutSuffix.split(".").join("")
		: stripLocaleGrouping(withoutSuffix, localeCode);

	if (!DIGITS_ONLY.test(digits)) {
		const separator = withoutSuffix.includes(".") ? "." : withoutSuffix.includes(",") ? "," : withoutSuffix;
		throw ErrorFactory.parsing(
			"INVALID_NUMBER_LITERAL",
			`"${raw}" is not a whole number: "${separator}" separates decimals in the ${localeCode} locale, and a whole number cannot have a fractional part.`,
			{ raw, localeCode, separator },
		);
	}
	return digits;
}

/**
 * Removes the active locale's own thousands separator and nothing else.
 *
 * @param text - The literal without its `n`.
 * @param localeCode - The engine's active locale.
 * @returns The text with grouping removed, which the caller then re-checks.
 */
function stripLocaleGrouping(text: string, localeCode: string): string {
	const thousandsSeparator = getLocale(localeCode).display.thousandsSeparator;
	return thousandsSeparator ? text.split(thousandsSeparator).join("") : text;
}
