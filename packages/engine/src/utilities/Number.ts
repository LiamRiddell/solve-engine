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
	return value.toLocaleString(locale, {
		useGrouping: false,
		maximumFractionDigits: decimalPlaces,
		minimumFractionDigits: decimalPlaces,
	});
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
			return number.toLocaleString(numberLocale, {
				minimumFractionDigits: 0,
				maximumFractionDigits: 0,
			});
		}

		return removeThousandsSeparators(Math.trunc(number), numberLocale, 0);
	}

	// Decimal
	if (includeThousandSeparators) {
		// We can return the format early as we don't need to strip thousands
		return number.toLocaleString(numberLocale, {
			maximumFractionDigits: decimalPlaces,
			minimumFractionDigits: decimalPlaces,
		});
	}

	// number.toFixed(decimalPlaces)

	return removeThousandsSeparators(number, numberLocale, decimalPlaces);
}
