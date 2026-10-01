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
	decimalPlaces: number,
	minimumFractionDigits: number = decimalPlaces
) {
	return numberFormatFor(locale, false, minimumFractionDigits, decimalPlaces).format(value);
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

/**
 * The magnitude from which `Number.prototype.toFixed` stops writing digits and
 * writes the number as `String` does, in exponent form (`1e+21`).
 */
const FIXED_EXPONENT_FROM = 1e21;

/**
 * A number written to exactly `places` places, in ASCII digits with a `.`
 * mark and no grouping, as `toFixed` writes it, at every magnitude.
 *
 * `toFixed` writes a number of 1e21 or more the way `String` does, in
 * JavaScript's exponent form, so `1e306 as %` showed `1e+308%` and `1e22 m`
 * showed `1e+22 m` while a plain `1e22` showed every digit. Past that
 * magnitude the digits come from the same `Intl` formatter a plain number is
 * written with, so a quantity, a percentage and money read as a number does.
 * Below it, and for a value that is not finite, this is `toFixed` itself, one
 * comparison and nothing more.
 *
 * @param value - The number.
 * @param places - The places after the point, a whole number from 0 to 100.
 * @returns The digits (`"-12.50"`, `"10000000000000000000000.00"`), or `toFixed`'s text for an infinity or NaN.
 */
export function fixedDecimalText(value: number, places: number): string {
	if (!(value >= FIXED_EXPONENT_FROM || value <= -FIXED_EXPONENT_FROM) || value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
		return value.toFixed(places);
	}
	return numberFormatFor("en-US", false, places, places).format(value);
}

/**
 * A number in its shortest form, as `String` writes it, except that a number
 * of 1e21 or more either way is written in full digits rather than in
 * JavaScript's exponent form (`1e+22`), as a plain number's answer is. A
 * double that large is always whole, so no place is lost. A small number keeps
 * `String`'s form (`1e-7`), the exponent form the engine writes for a value
 * too small to show in places.
 *
 * @param n - The number.
 * @returns Its text (`"0.25"`, `"10000000000000000000000"`, `"Infinity"`).
 */
export function shortestText(n: number): string {
	return n >= FIXED_EXPONENT_FROM || n <= -FIXED_EXPONENT_FROM ? fixedDecimalText(n, 0) : String(n);
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
 * `decimalPlaces` fractional digits, padded with zeros to that many unless
 * `trimTrailingZeros` is set. `includeThousandSeparators` controls whether
 * groups are separated (e.g. `"1,234"`) per `numberLocale`.
 *
 * @param number - The value to format.
 * @param decimalPlaces - Max fractional digits for non-integer values (default 2).
 * @param includeThousandSeparators - Whether to group digits (default false).
 * @param numberLocale - `Intl`/`toLocaleString` locale to format with (default "en-US").
 * @param trimTrailingZeros - Whether a fraction drops the zeros that only pad it
 *   out to `decimalPlaces`, so 1.5 is `1.5` rather than `1.50` (default false).
 */
export function autoFormatIntegerOrFloat(
	number: number,
	decimalPlaces: number = 2,
	includeThousandSeparators: boolean = false,
	numberLocale: string = "en-US",
	trimTrailingZeros: boolean = false
) {
	if (Number.isInteger(number)) {
		if (includeThousandSeparators) {
			// We can return the format early as we don't need to strip thousands
			return numberFormatFor(numberLocale, undefined, 0, 0).format(number);
		}

		return removeThousandsSeparators(Math.trunc(number), numberLocale, 0);
	}

	const minimumFractionDigits = trimTrailingZeros ? 0 : decimalPlaces;
	if (includeThousandSeparators) {
		// We can return the format early as we don't need to strip thousands
		return numberFormatFor(numberLocale, undefined, minimumFractionDigits, decimalPlaces).format(number);
	}

	return removeThousandsSeparators(number, numberLocale, decimalPlaces, minimumFractionDigits);
}

/** The compact suffixes, largest first, each with the power of ten it stands for. */
const COMPACT_TIERS: ReadonlyArray<readonly [number, string]> = [
	[1e12, "T"],
	[1e9, "B"],
	[1e6, "M"],
	[1e3, "k"],
];

/** A number's shortest spelling to at most `figures` significant figures, trailing zeros trimmed. */
function significant(n: number, figures: number): string {
	return String(Number(n.toPrecision(figures)));
}

/**
 * A number's compact form in pieces: its sign, its figure and the suffix after
 * it, so a formatter can write the figure in a locale's digits and marks.
 */
export interface CompactParts {
	/** `"-"` for a negative number, `""` otherwise. */
	readonly sign: string;
	/**
	 * The figure in ASCII: a plain decimal (`"1.5"`, `"999"`) when a suffix
	 * carries the scale, or exponent form (`"1e+308"`) past the largest suffix,
	 * where there is no suffix.
	 */
	readonly figure: string;
	/** `"k"`, `"M"`, `"B"`, `"T"`, or `""` below a thousand and past the largest suffix. */
	readonly suffix: string;
}

/**
 * Where the suffixes stop: a figure of a thousand trillion or more is written
 * in exponent form instead, since `1000T` is past the tier and `1e+296T` mixes
 * two ways of writing a scale.
 */
const COMPACT_LIMIT = 1e15;

/**
 * `n` in compact pieces, to three significant figures, or undefined for a value
 * that is not finite.
 *
 * Past the largest suffix the figure is in exponent form with no suffix
 * (`1e+308`), because a figure divided by a trillion can itself need an
 * exponent, and `1e+296T` wrote the scale twice in two notations.
 *
 * @param n - The number.
 * @returns The pieces, or undefined for an infinity or NaN.
 */
export function compactParts(n: number): CompactParts | undefined {
	if (!Number.isFinite(n)) return undefined;
	const sign = n < 0 ? "-" : "";
	const magnitude = Math.abs(n);
	// Rounded first, so 999.95 trillion, which is a thousand trillion to three
	// figures, takes the exponent form rather than `1000T`.
	if (Number(magnitude.toPrecision(3)) >= COMPACT_LIMIT) {
		// Written straight from the double, not re-read from three figures: the
		// largest double rounds up to 1.80e+308, which reads back as Infinity.
		return { sign, figure: magnitude.toExponential(2).replace(/\.?0+e/, "e"), suffix: "" };
	}
	for (let i = 0; i < COMPACT_TIERS.length; i++) {
		const [size, suffix] = COMPACT_TIERS[i];
		if (magnitude < size) continue;
		const scaled = Number((magnitude / size).toPrecision(3));
		// 999,950 rounds to 1,000k, which is 1M written worse.
		if (scaled >= 1000 && i > 0) {
			const [largerSize, largerSuffix] = COMPACT_TIERS[i - 1];
			return { sign, figure: significant(magnitude / largerSize, 3), suffix: largerSuffix };
		}
		return { sign, figure: significant(scaled, 3), suffix };
	}
	return { sign, figure: significant(magnitude, 3), suffix: "" };
}
