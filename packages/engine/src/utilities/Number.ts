/**
 * Render `value` in `locale` with `decimalPlaces` fractional digits and no
 * digit grouping, leaving the locale's own decimal separator alone.
 *
 * Asks `Intl` not to group in the first place rather than formatting with
 * grouping and then deleting a character afterwards. Deleting was wrong twice
 * over. It used `String.replace` with a string pattern, which removes one
 * occurrence, so "1,234,567" came back as "1234,567" and the surviving comma
 * read as a decimal point. And it chose the character to delete from a
 * two-case switch, "de-DE" or a comma for everything else, when a comma is the
 * DECIMAL separator in French, Spanish, Italian, Portuguese and every other
 * comma-decimal locale: deleting it turned 1.5 into "150", a hundred times the
 * number, while leaving French's actual group separator (a narrow no-break
 * space) in place. `numberResult.decimalSeparatorLocale` is an unvalidated
 * host string, so no locale can be assumed.
 *
 * An unusable locale tag still throws the `RangeError` `toLocaleString` has
 * always thrown for one, since swallowing it would hide the host's typo behind
 * silently different output.
 */
function removeThousandsSeparators(
	value: number,
	locale: string,
	decimalPlaces: number
) {
	return numberFormatFor(locale, false, decimalPlaces, decimalPlaces).format(value);
}

/** The most formatters {@link numberFormatFor} keeps before starting again. */
const NUMBER_FORMAT_CACHE_LIMIT = 64;

/** Formatters by locale and options; see {@link numberFormatFor}. */
const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * One `Intl.NumberFormat` for a locale and option set, built once and reused.
 *
 * `toLocaleString` with an options object builds a new formatter on every
 * call, which is most of what writing a number costs: 100,000 integers took
 * about 3.6 s that way and about 80 ms through one cached formatter (#764).
 * `format` on a formatter built from the same locale and options writes
 * exactly what `toLocaleString` writes, since that is how the specification
 * defines `toLocaleString`.
 *
 * The cache is bounded, because the locale is a host string: past
 * {@link NUMBER_FORMAT_CACHE_LIMIT} formatters it is emptied and refilled. An
 * unusable locale or place count throws the `RangeError` the constructor
 * throws, as `toLocaleString` did, and nothing is cached for it.
 *
 * @param locale - `Intl` locale tag.
 * @param useGrouping - `false` for no grouping, or `undefined` for the
 *   locale's own (`1,234` in English, while Spanish leaves four digits
 *   ungrouped). Not `true`: under current `Intl` that means grouping always,
 *   which is not what `toLocaleString` without the option writes.
 * @param minimumFractionDigits - Fewest fractional digits written.
 * @param maximumFractionDigits - Most fractional digits written.
 */
export function numberFormatFor(
	locale: string,
	useGrouping: false | undefined,
	minimumFractionDigits: number,
	maximumFractionDigits: number
): Intl.NumberFormat {
	// The locale goes last: the fields before it are a boolean and two numbers,
	// none of which can contain the separator, so no two option sets share a key.
	const key = `${useGrouping === false ? 0 : 1}|${minimumFractionDigits}|${maximumFractionDigits}|${locale}`;
	let format = numberFormats.get(key);
	if (format === undefined) {
		format = new Intl.NumberFormat(
			locale,
			useGrouping === false ? { useGrouping, minimumFractionDigits, maximumFractionDigits } : { minimumFractionDigits, maximumFractionDigits }
		);
		if (numberFormats.size >= NUMBER_FORMAT_CACHE_LIMIT) numberFormats.clear();
		numberFormats.set(key, format);
	}
	return format;
}

/** How many digits of a too-small value are worth showing: enough to read it, not enough to imply precision. */
const SIGNIFICANT_DIGITS = 3;

/**
 * Below this magnitude the plain decimal form stops being readable and the
 * exponent form takes over.
 *
 * At 1e-4 three significant digits still fit in six decimal places, which is
 * about as many zeros as a reader will count without losing their place.
 */
const EXPONENT_FORM_BELOW = 1e-4;

/** The most decimal places the plain form will spend showing a small value. */
const MAX_PLAIN_DECIMALS = 6;

/**
 * A reading for a value that is not zero but would print as one.
 *
 * Two decimal places is the right budget for almost everything the engine
 * answers, and wrong for the answers that live below it: `1 Hz in MHz` printed
 * `0.00 MHz`, which a reader cannot tell from a real zero, and `1 byte in GB`
 * printed `0.00 GB`. Both are correct conversions with nothing left of them.
 *
 * So a magnitude that rounds away is shown to three significant digits instead,
 * as a decimal while the zeros are still countable and in exponent form once
 * they are not: `0.001`, and `1e-6`. Three digits is enough to read the value
 * and few enough not to imply a precision the conversion does not have.
 *
 * Returns undefined when the ordinary rendering already shows something, which
 * is every other value the engine formats, so callers keep the output they had.
 *
 * @param value - The magnitude about to be rendered.
 * @param decimalPlaces - The budget it would be rendered with.
 * @param numberLocale - `Intl` locale, for the decimal separator of the plain form.
 */
export function tooSmallToPrintText(
	value: number,
	decimalPlaces: number,
	numberLocale: string = "en-US"
): string | undefined {
	if (!Number.isFinite(value) || value === 0) return undefined;
	if (Number(value.toFixed(decimalPlaces)) !== 0) return undefined;

	const rounded = Number(value.toPrecision(SIGNIFICANT_DIGITS));
	if (Math.abs(rounded) >= EXPONENT_FORM_BELOW) {
		// The zeros before the first digit, plus the digits themselves. Trailing
		// zeros are trimmed by asking for no minimum, so `0.001` does not read as
		// `0.00100` and imply three measured digits.
		const leadingZeros = -Math.floor(Math.log10(Math.abs(rounded)));
		const places = Math.min(MAX_PLAIN_DECIMALS, leadingZeros + SIGNIFICANT_DIGITS - 1);
		return rounded.toLocaleString(numberLocale, {
			useGrouping: false,
			minimumFractionDigits: 0,
			maximumFractionDigits: places,
		});
	}
	// `1.00e-6` says nothing `1e-6` does not, so the mantissa's trailing zeros go.
	return rounded.toExponential(SIGNIFICANT_DIGITS - 1).replace(/\.?0+e/, "e");
}

/**
 * Format `number` for display, branching on whether it's a whole number:
 * integers are always rendered with zero decimal places (never padded to
 * `decimalPlaces`), while non-integers are rendered with up to
 * `decimalPlaces` fractional digits. `includeThousandSeparators` controls
 * whether groups are separated (e.g. `"1,234"`) per `numberLocale`.
 *
 * @param number - The value to format.
 * @param decimalPlaces - Max fractional digits for non-integer values (default 2).
 * @param includeThousandSeparators - Whether to group digits (default false).
 * @param numberLocale - `Intl`/`toLocaleString` locale to format with (default "en-US").
 */
export function autoFormatIntegerOrFloat(
	number: number,
	decimalPlaces: number = 2,
	includeThousandSeparators: boolean = false,
	numberLocale: string = "en-US"
) {
	if (Number.isInteger(number)) {
		if (includeThousandSeparators) {
			// We can return the format early as we don't need to strip thousands
			return numberFormatFor(numberLocale, undefined, 0, 0).format(number);
		}

		return removeThousandsSeparators(Math.trunc(number), numberLocale, 0);
	}

	// Decimal
	if (includeThousandSeparators) {
		// We can return the format early as we don't need to strip thousands
		return numberFormatFor(numberLocale, undefined, decimalPlaces, decimalPlaces).format(number);
	}

	// number.toFixed(decimalPlaces)

	return removeThousandsSeparators(number, numberLocale, decimalPlaces);
}
