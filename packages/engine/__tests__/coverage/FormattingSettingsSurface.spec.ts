/**
 * `formatValue` under settings a host actually supplies, rather than the
 * defaults.
 *
 * `FormattingSettings` has eight fields across five groups and the docs tell a
 * host to spread `DEFAULT_FORMATTING_SETTINGS` and override the group it cares
 * about. Before this file, `floatResult.enableSeperator` was never set to
 * `false` anywhere in the suite, `hexResult.enablePadding` was never set to
 * `true`, and the ninth field, `unitOfMeasurementResult.unitNames`, was never
 * set at all, which is how it shipped wired to nothing until this file found
 * it and it was removed. Those are the settings whose whole purpose is to
 * change the output, so testing only the defaults tests the one configuration
 * where most of them do nothing.
 *
 * Turning separators off is where this stops being an accounting exercise: it
 * is the only route into `utilities/Number.ts`'s `removeThousandsSeparators()`,
 * which was wrong for any value at or above a million and catastrophically
 * wrong in a comma-decimal locale. See `PublicUtilities.spec.ts` for the unit
 * level; the two cases here are the same defects seen through the published
 * `formatValue` a host calls.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import {
	DEFAULT_FORMATTING_SETTINGS,
	type FormattingSettings,
} from "@solve-js/format/FormattingSettings";
import {
	hexValue,
	matrixValue,
	numberValue,
	percentageValue,
	uomValue,
} from "@solve-js/vm/Value";

/** Spread-and-override, exactly as the formatting guide instructs a host to. */
function settings(overrides: Partial<FormattingSettings>): FormattingSettings {
	return { ...DEFAULT_FORMATTING_SETTINGS, ...overrides };
}

const SEPARATORS_OFF = settings({ floatResult: { decimalPlaces: 2, enableSeperator: false } });

describe("the defaults", () => {
	test("group with commas and round to two places", () => {
		// The baseline the other cases are measured against: separators on,
		// two decimal places, en-US.
		expect(formatValue(numberValue(1234567))).toBe("= 1,234,567");
		expect(formatValue(numberValue(1234.5))).toBe("= 1,234.50");
	});

	test("an integer is not padded to two places even though non-integers are", () => {
		// A result gutter showing "4.00" for two plus two reads as a
		// measurement rather than an answer.
		expect(formatValue(numberValue(4))).toBe("= 4");
		expect(formatValue(numberValue(4.5))).toBe("= 4.50");
	});
});

describe("floatResult.enableSeperator", () => {
	test("off, a four-digit number comes back with no grouping", () => {
		// The size where the separators-off path happens to be correct.
		expect(formatValue(numberValue(1234), SEPARATORS_OFF)).toBe("= 1234");
		expect(formatValue(numberValue(1234.5), SEPARATORS_OFF)).toBe("= 1234.50");
	});

	/*
	 * `removeThousandsSeparators()` used to strip with `String.replace` and a
	 * string pattern, which removes one occurrence. Below a million there is
	 * one separator, so the setting appeared to work; at a million and above
	 * the later separators survived, and in en-US a surviving comma reads as a
	 * decimal point. A host that turned grouping off was shown "1234,567" for
	 * one million two hundred thousand-odd.
	 *
	 * This was reachable by any host that sets the flag, and matrices go
	 * through the same helper, so a table of large numbers showed it in every
	 * cell. The matrix case is asserted here for that reason.
	 */
	test("off, every separator is removed and not just the first", () => {
		expect(formatValue(numberValue(1234567), SEPARATORS_OFF)).toBe("= 1234567");
		expect(formatValue(numberValue(1234567.5), SEPARATORS_OFF)).toBe("= 1234567.50");
		expect(formatValue(matrixValue(1, 2, [1234567, 1]), SEPARATORS_OFF)).toBe("= [1234567, 1]");
	});

	/*
	 * The separator to strip used to be picked by a two-case switch on the
	 * locale string: "de-DE", or everything else stripped ",". In French,
	 * Spanish, Italian, Portuguese and every other comma-decimal locale, ","
	 * IS the decimal separator, so stripping it deleted the decimal point and
	 * multiplied the displayed number by a hundred, while the actual group
	 * separator (a narrow no-break space in French) was left in place.
	 *
	 * The engine ships a French locale and a test suite for it, and
	 * `numberResult.decimalSeparatorLocale` is an unvalidated host string, so
	 * nothing stood between a host and this.
	 */
	test("off, a comma-decimal locale keeps its decimal separator", () => {
		const french = settings({
			floatResult: { decimalPlaces: 2, enableSeperator: false },
			numberResult: { decimalSeparatorLocale: "fr" },
		});

		// One and a half, written the French way, is "1,50". It is not 150.
		expect(formatValue(numberValue(1.5), french)).toBe("= 1,50");
		expect(formatValue(numberValue(1234.5), french)).toBe("= 1234,50");
	});

	test("on, grouping follows the locale rather than always using commas", () => {
		// The path that works. German groups with dots and separates decimals
		// with a comma, which is the mirror image of en-US.
		const german = settings({
			floatResult: { decimalPlaces: 2, enableSeperator: true },
			numberResult: { decimalSeparatorLocale: "de" },
		});

		expect(formatValue(numberValue(1234567), german)).toBe("= 1.234.567");
		expect(formatValue(numberValue(1234.5), german)).toBe("= 1.234,50");
	});
});

describe("floatResult.decimalPlaces", () => {
	test("rounds a non-integer to the requested width", () => {
		// 2.75 to one place rounds half away from zero, giving 2.8, and to
		// zero places gives 3.
		const onePlace = settings({ floatResult: { decimalPlaces: 1, enableSeperator: false } });
		const nonePlace = settings({ floatResult: { decimalPlaces: 0, enableSeperator: false } });

		expect(formatValue(numberValue(2.75), onePlace)).toBe("= 2.8");
		expect(formatValue(numberValue(2.75), nonePlace)).toBe("= 3");
	});

	test("does not pad an integer, whatever it is set to", () => {
		const fourPlaces = settings({ floatResult: { decimalPlaces: 4, enableSeperator: false } });
		expect(formatValue(numberValue(7), fourPlaces)).toBe("= 7");
	});
});

describe("hexResult", () => {
	test("padding off, only the digits the value needs", () => {
		// 255 is FF, two digits, and 4096 is 1000, four.
		expect(formatValue(hexValue(255))).toBe("= 0xFF");
		expect(formatValue(hexValue(4096))).toBe("= 0x1000");
	});

	test("padding on, zero-filled to the requested width", () => {
		/*
		 * The setting exists so a column of addresses lines up. Eight is the
		 * width a 32-bit value is usually written at, so 255 becomes
		 * 000000FF.
		 */
		const padded = settings({ hexResult: { enablePadding: true, paddingZeros: 8 } });
		expect(formatValue(hexValue(255), padded)).toBe("= 0x000000FF");
		expect(formatValue(hexValue(0), padded)).toBe("= 0x00000000");
	});

	test("a value wider than the padding is not truncated to it", () => {
		// Padding is a minimum, never a maximum. Truncating would change the
		// number rather than its alignment.
		const padded = settings({ hexResult: { enablePadding: true, paddingZeros: 2 } });
		expect(formatValue(hexValue(4096), padded)).toBe("= 0x1000");
	});

	test("the padding is hexadecimal only, not applied to binary or octal", () => {
		/*
		 * The setting names hex, and the same count of zeros means a
		 * different quantity in another base: padding 0b101 to eight digits
		 * is not what a hex width of eight asks for.
		 */
		const padded = settings({ hexResult: { enablePadding: true, paddingZeros: 8 } });
		expect(formatValue(hexValue(5, "bin"), padded)).toBe("= 0b101");
		expect(formatValue(hexValue(8, "oct"), padded)).toBe("= 0o10");
	});

	test("the sign sits outside the literal", () => {
		// "-0xFF", not "0x-FF": the minus belongs to the quantity, and a hex
		// literal has no way to write one.
		expect(formatValue(hexValue(-255))).toBe("= -0xFF");
	});
});

describe("percentageResult.decimalPlaces", () => {
	test("a percentage stores a fraction and displays as a percentage", () => {
		/*
		 * ValueType.Percentage holds 0.25 for 25%. Formatting without the
		 * multiply displayed every percentage-change result as "0.25%",
		 * which is the same number said in a way that is off by a hundred.
		 */
		expect(formatValue(percentageValue(0.25))).toBe("= 25.00%");
	});

	test("its own decimal-places setting, independent of floatResult", () => {
		/*
		 * The two groups exist separately so a host can show whole-number
		 * percentages next to two-place currency. Setting one must not move
		 * the other.
		 */
		const wholePercent = settings({
			percentageResult: { decimalPlaces: 0 },
			floatResult: { decimalPlaces: 3, enableSeperator: false },
		});

		expect(formatValue(percentageValue(0.25), wholePercent)).toBe("= 25%");
		expect(formatValue(numberValue(1.5), wholePercent)).toBe("= 1.500");
	});
});

describe("unitOfMeasurementResult", () => {
	test("decimalPlaces applies to units and not to the float setting", () => {
		const zeroPlaces = settings({
			unitOfMeasurementResult: { decimalPlaces: 0 },
			floatResult: { decimalPlaces: 3, enableSeperator: false },
		});

		expect(formatValue(uomValue(3000.456, "m"), zeroPlaces)).toBe("= 3000 m");
		expect(formatValue(numberValue(1.5), zeroPlaces)).toBe("= 1.500");
	});

	test("a currency renders with its symbol in the conventional position", () => {
		// The currency table is what turns "100 USD" into "$100.00" and
		// "100 SEK" into "100.00 kr", which is placement rather than
		// translation.
		expect(formatValue(uomValue(100, "USD"))).toBe("= $100.00");
	});

	/*
	 * `unitNames` used to be a published field of `FormattingSettings`, named
	 * in the formatting guide's own worked example, that had no effect
	 * whatsoever: `FormatEngine.ts`'s `formatUom` read it into `useUnitNames`
	 * and then wrote
	 *
	 *   const unitLabel = useUnitNames ? (unit || "") : (unit || "");
	 *
	 * whose two branches are the same expression. Same shape as the
	 * `dateFormat` check whose branches were identical until issue #77, which
	 * is recorded in `constants/locales/FrenchLocale.spec.ts`'s header.
	 *
	 * It was deleted rather than implemented, because the engine has no unit
	 * names to render. The generated unit table maps a spelling to
	 * [measure, ratio], and a name cannot be recovered from that: units that
	 * differ by an offset rather than a ratio share an entry shape, so
	 * "celsius" and "kelvin" are indistinguishable there and `20 C` would come
	 * back as "20 kelvins". Making it work means a hand-authored name per unit
	 * plus pluralization and per-locale spelling, which is a feature to design
	 * and not the repair of a dead ternary. Removing it before 1.0.0 is the
	 * one moment it costs nothing.
	 *
	 * What is asserted is the consequence: a unit is written as its symbol,
	 * and the settings object no longer carries a switch that claims otherwise.
	 */
	test("a unit is written as its symbol, and there is no setting claiming otherwise", () => {
		expect(formatValue(uomValue(3000, "km"))).toBe("= 3,000.00 km");
		expect("unitNames" in DEFAULT_FORMATTING_SETTINGS.unitOfMeasurementResult).toBe(false);
	});
});

describe("the settings argument is optional and complete", () => {
	test("omitting it uses the documented defaults", () => {
		expect(formatValue(numberValue(1234.5))).toBe(
			formatValue(numberValue(1234.5), DEFAULT_FORMATTING_SETTINGS),
		);
	});

	test("DEFAULT_FORMATTING_SETTINGS is what the docs say it is", () => {
		/*
		 * Hosts spread this object, so its values are effectively part of the
		 * API: a change to one silently changes every host that overrode only
		 * one group.
		 */
		expect(DEFAULT_FORMATTING_SETTINGS.floatResult).toEqual({
			decimalPlaces: 2,
			enableSeperator: true,
		});
		expect(DEFAULT_FORMATTING_SETTINGS.numberResult.decimalSeparatorLocale).toBe("en-US");
		expect(DEFAULT_FORMATTING_SETTINGS.hexResult).toEqual({
			enablePadding: false,
			paddingZeros: 0,
		});
		expect(DEFAULT_FORMATTING_SETTINGS.percentageResult).toEqual({ decimalPlaces: 2 });
	});
});
