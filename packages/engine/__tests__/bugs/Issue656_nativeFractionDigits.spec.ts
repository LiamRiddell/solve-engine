import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue, localiseFixedDecimal } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS, type FormattingSettings } from "@solve-js/format/FormattingSettings";

/**
 * Issue #656: `localiseFixedDecimal` localised a fixed-decimal string's integer
 * part through Intl and its decimal mark, then appended the fraction digits as
 * the ASCII they arrived in. Every quantity and money amount, and an exact
 * number shown to a fixed place count, goes through it, so under `ar-EG`
 * `3.5 days` showed `٣٫50 days` while a plain `1234.5` was native throughout.
 * The fraction's digits now follow the locale's numbering system too, and so
 * does the integer when grouping is off, which had the same gap.
 */

/** Formatting settings with only the locale tag (and optionally grouping) changed. */
function tagged(tag: string, grouping = true): FormattingSettings {
	return {
		...DEFAULT_FORMATTING_SETTINGS,
		floatResult: { ...DEFAULT_FORMATTING_SETTINGS.floatResult, enableSeperator: grouping },
		numberResult: { decimalSeparatorLocale: tag },
	};
}

/** A line evaluated under the default engine and formatted with `settings`. */
function show(line: string, settings: FormattingSettings): string {
	return formatValue(newTrackedEngine().evaluateExpression(line), settings);
}

/** The ASCII digits left in `text`, which a fully localised rendering has none of. */
const ASCII_DIGIT = /[0-9]/;

describe("localiseFixedDecimal", () => {
	test("English is unchanged", () => {
		expect(localiseFixedDecimal("1234567.50", "en-US", true)).toBe("1,234,567.50");
		expect(localiseFixedDecimal("1234567.50", "en-US", false)).toBe("1234567.50");
		expect(localiseFixedDecimal("-3", "en-US", true)).toBe("-3");
	});

	test("every digit follows an Arabic-Indic numbering system", () => {
		expect(localiseFixedDecimal("3.50", "ar-EG", true)).toBe("٣٫٥٠");
		expect(localiseFixedDecimal("1234.50", "ar-EG", true)).toBe("١٬٢٣٤٫٥٠");
		expect(localiseFixedDecimal("1234.50", "fa", true)).toBe("۱٬۲۳۴٫۵۰");
	});

	test("and the Bengali and Devanagari ones", () => {
		expect(localiseFixedDecimal("1234.50", "bn", true)).toBe("১,২৩৪.৫০");
		expect(localiseFixedDecimal("1234.50", "mr", true)).toBe("१,२३४.५०");
	});

	test("a fraction keeps its leading zeros", () => {
		expect(localiseFixedDecimal("3.05", "ar-EG", true)).toBe("٣٫٠٥");
		expect(localiseFixedDecimal("0.00", "ar-EG", true)).toBe("٠٫٠٠");
		expect(localiseFixedDecimal("0.007", "bn", true)).toBe("০.০০৭");
	});

	test("an ungrouped integer is localised as well", () => {
		expect(localiseFixedDecimal("1234.50", "ar-EG", false)).toBe("١٢٣٤٫٥٠");
		expect(localiseFixedDecimal("1234", "ar-EG", false)).toBe("١٢٣٤");
	});

	test("a sign stays ASCII, before the native digits", () => {
		expect(localiseFixedDecimal("-1234.5", "ar-EG", true)).toBe("-١٬٢٣٤٫٥");
	});

	test("a tag that selects Latin digits keeps them", () => {
		expect(localiseFixedDecimal("3.50", "ar-EG-u-nu-latn", true)).toBe("3.50");
		expect(localiseFixedDecimal("1234.50", "ar-EG-u-nu-latn", true)).toBe("1,234.50");
	});

	test("a locale that writes Latin digits only changes its marks", () => {
		expect(localiseFixedDecimal("1234.50", "de-DE", true)).toBe("1.234,50");
		expect(localiseFixedDecimal("1234.50", "en-IN", true)).toBe("1,234.50");
	});

	test("every one of the ten digits maps, across a long fraction", () => {
		const text = localiseFixedDecimal("1234567890.012345678901234567890123456789", "ar-EG", false);
		expect(text).not.toMatch(ASCII_DIGIT);
		expect(text).toBe("١٢٣٤٥٦٧٨٩٠٫٠١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨٩");
	});

	test("anything that is not plain digits is returned as it came", () => {
		expect(localiseFixedDecimal("Infinity", "ar-EG", true)).toBe("Infinity");
		expect(localiseFixedDecimal("1e+21", "ar-EG", true)).toBe("1e+21");
		expect(localiseFixedDecimal("", "ar-EG", true)).toBe("");
	});

	test("adversarial: a tag Intl cannot read throws its RangeError, as a number has always done", () => {
		expect(() => localiseFixedDecimal("3.50", "__proto__", true)).toThrow(RangeError);
		expect(() => localiseFixedDecimal("3.50", "x".repeat(300), false)).toThrow(RangeError);
	});

	test("adversarial: a prototype-named tag Intl accepts leaves Object.prototype alone", () => {
		expectPrototypeUntouched(() => {
			for (const tag of PROTOTYPE_WORDS) {
				try {
					localiseFixedDecimal("3.50", tag, true);
				} catch (error) {
					expect(error).toBeInstanceOf(RangeError);
				}
			}
		});
	});

	test("adversarial: a ten-thousand-digit fraction is written in time", () => {
		const fixed = `1.${"7".repeat(10_000)}`;
		const started = performance.now();
		const text = localiseFixedDecimal(fixed, "ar-EG", true);
		expect(performance.now() - started).toBeLessThan(500);
		expect(text).not.toMatch(ASCII_DIGIT);
		expect(text.length).toBe(fixed.length);
	});
});

describe("through formatValue, the issue's table", () => {
	test.each([
		["ar-EG", "3.5 days", "= ٣٫٥٠ days"],
		["ar-EG", "£1234.5", "= £١٬٢٣٤٫٥٠"],
		["ar-EG", "3.14159 to 2 dp", "= ٣٫١٤"],
		["ar-EG", "1234.5", "= ١٬٢٣٤٫٥٠"],
		["bn", "3.5 days", "= ৩.৫০ days"],
		["bn", "£1234.5", "= £১,২৩৪.৫০"],
		["mr", "3.5 days", "= ३.५० days"],
		["mr", "£1234.5", "= £१,२३४.५०"],
		["fa", "3.5 days", "= ۳٫۵۰ days"],
		["ar-EG-u-nu-latn", "3.5 days", "= 3.50 days"],
	])("%s %s", (tag, line, expected) => {
		expect(show(line, tagged(tag))).toBe(expected);
	});

	test("a quantity and money with grouping off are native throughout", () => {
		expect(show("3.5 days", tagged("ar-EG", false))).toBe("= ٣٫٥٠ days");
		expect(show("£1234.5", tagged("ar-EG", false))).toBe("= £١٢٣٤٫٥٠");
	});

	test("realistic breakage: a negative amount, a conversion and a whole number of days", () => {
		expect(show("-£5.25", tagged("ar-EG"))).toBe("= -£٥٫٢٥");
		expect(show("1.5 km to m", tagged("ar-EG"))).not.toMatch(ASCII_DIGIT);
		expect(show("3 days", tagged("ar-EG"))).toBe("= ٣ days");
	});

	test("the default settings are unchanged", () => {
		expect(formatValue(newTrackedEngine().evaluateExpression("3.5 days"))).toBe("= 3.50 days");
		expect(formatValue(newTrackedEngine().evaluateExpression("£1234.5"))).toBe("= £1,234.50");
	});
});
