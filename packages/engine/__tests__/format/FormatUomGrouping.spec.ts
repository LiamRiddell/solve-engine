/**
 * Quantities and money group their digits the way plain numbers do.
 *
 * A bare `52000` rendered as `52,000` while `£52000` rendered as `£52000.00`,
 * because the unit-of-measure path used a bare `toFixed` and never consulted
 * `enableSeperator` or the locale. Money is the value type people most want
 * grouped, so this pins the three renderings that share the repair: a symbol
 * currency, a suffix currency, and an ordinary quantity, plus the exact-money
 * path, which rounds from its decimal and must keep doing so.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS, type FormattingSettings } from "@solve-js/format/FormattingSettings";
import { uomValue } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

function settingsWith(overrides: { enableSeperator?: boolean; decimalSeparatorLocale?: string }): FormattingSettings {
	return {
		...DEFAULT_FORMATTING_SETTINGS,
		floatResult: { ...DEFAULT_FORMATTING_SETTINGS.floatResult, enableSeperator: overrides.enableSeperator ?? DEFAULT_FORMATTING_SETTINGS.floatResult.enableSeperator },
		numberResult: { ...DEFAULT_FORMATTING_SETTINGS.numberResult, decimalSeparatorLocale: overrides.decimalSeparatorLocale ?? DEFAULT_FORMATTING_SETTINGS.numberResult.decimalSeparatorLocale },
	};
}

describe("digit grouping on quantities and money", () => {
	test("a prefix-symbol currency: $1,234,567.89", () => {
		expect(formatValue(uomValue(1234567.891, "USD"))).toBe("= $1,234,567.89");
	});

	test("a suffix currency: 1,234,567.00 kr", () => {
		expect(formatValue(uomValue(1234567, "SEK"))).toBe("= 1,234,567.00 kr");
	});

	test("a quantity: 1,234,567.00 km", () => {
		expect(formatValue(uomValue(1234567, "km"))).toBe("= 1,234,567.00 km");
	});

	test("a whole-number timespan keeps its integer rendering and gains grouping", () => {
		expect(formatValue(uomValue(1000, "days"))).toBe("= 1,000 days");
	});

	test("a negative amount keeps its sign in front of the grouped digits", () => {
		expect(formatValue(uomValue(-1234.5, "USD"))).toBe("= $-1,234.50");
	});

	test("an exact money literal still rounds from its decimal, then groups", () => {
		// The half-cent case the exact path exists for: `toFixed` on the double
		// answers 52000.00, the decimal answers 52000.01. Grouping is applied to
		// the already-rounded digits rather than re-rendering the double.
		const value = newTrackedEngine().evaluateExpression("£52000.005");
		expect(formatValue(value)).toBe("= £52,000.01");
	});

	test("grouping follows enableSeperator, as it does for plain numbers", () => {
		expect(formatValue(uomValue(1234567.891, "USD"), settingsWith({ enableSeperator: false }))).toBe("= $1234567.89");
	});

	test("the locale's own marks: €1.234.567,50 in German", () => {
		expect(formatValue(uomValue(1234567.5, "EUR"), settingsWith({ decimalSeparatorLocale: "de-DE" }))).toBe("= €1.234.567,50");
	});
});
