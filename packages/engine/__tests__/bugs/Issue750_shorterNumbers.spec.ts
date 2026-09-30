import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { compactText, formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS, mergeFormattingSettings, type FormattingOverrides } from "@solve-js/format/FormattingSettings";
import { autoFormatIntegerOrFloat } from "@solve-js/utilities/Number";
import { serializeValue } from "@solve-js/worker/serialize";

/**
 * Issue #750: a host could set places, grouping, the locale, hex padding and
 * the date form, but not the two shorter styles notepad readers ask for:
 * decimals without padding zeros (`1.5`, not `1.50`) and large numbers written
 * compactly (`1.5M`). Two optional `floatResult` fields, off by default:
 * `trimTrailingZeros` and `compactFrom`.
 */

const SHORTER: FormattingOverrides = { floatResult: { trimTrailingZeros: true, compactFrom: 1_000_000 } };
const TRIM: FormattingOverrides = { floatResult: { trimTrailingZeros: true } };
const COMPACT: FormattingOverrides = { floatResult: { compactFrom: 1_000_000 } };

function shown(line: string, settings?: FormattingOverrides): string {
	return formatValue(newTrackedEngine().evaluateExpression(line), settings);
}

describe("the issue's table", () => {
	test.each([
		["1.5", "= 1.50", "= 1.5"],
		["2.5 km", "= 2.50 km", "= 2.5 km"],
		["0.1 + 0.2", "= 0.30", "= 0.3"],
		["1500000", "= 1,500,000", "= 1.5M"],
		["1234567", "= 1,234,567", "= 1.23M"],
		["$3,300,000", "= $3,300,000.00", "= $3.3M"],
		["1.5M", "= 1,500,000", "= 1.5M"],
		["999999", "= 999,999", "= 999,999"],
		["12.5%", "= 12.50%", "= 12.5%"],
		["$1.50", "= $1.50", "= $1.50"],
		["3.14159 to 4 dp", "= 3.1416", "= 3.1416"],
		["2^64", "= 18,446,744,073,709,551,616", "= 18,446,744,073,709,551,616"],
	])("%s: %s by default, %s with both set", (line, before, now) => {
		expect(shown(line)).toBe(before);
		expect(shown(line, SHORTER)).toBe(now);
	});
});

describe("each field on its own", () => {
	test("trimTrailingZeros drops only the padding", () => {
		expect(shown("1.5", TRIM)).toBe("= 1.5");
		expect(shown("1.25", TRIM)).toBe("= 1.25");
		expect(shown("1.001", TRIM)).toBe("= 1");
		expect(shown("1.005", TRIM)).toBe("= 1.01");
		expect(shown("1500000", TRIM)).toBe("= 1,500,000");
		expect(shown("12.5%", TRIM)).toBe("= 12.5%");
		expect(shown("25%", TRIM)).toBe("= 25%");
		expect(shown("1.50 hours", TRIM)).toBe("= 1.5 hours");
		expect(shown("[1.5, 2.25]", TRIM)).toBe("= [1.5, 2.25]");
	});

	test("compactFrom writes the compact form from its threshold", () => {
		expect(shown("1500000", COMPACT)).toBe("= 1.5M");
		expect(shown("999999", COMPACT)).toBe("= 999,999");
		expect(shown("1.5", COMPACT)).toBe("= 1.50");
		expect(shown("-2500000", COMPACT)).toBe("= -2.5M");
		expect(shown("2500000 km", COMPACT)).toBe("= 2.5M km");
		expect(shown("1500", { floatResult: { compactFrom: 1000 } })).toBe("= 1.5k");
		expect(shown("999999", { floatResult: { compactFrom: 1000 } })).toBe("= 1M");
	});

	test("both are off by default, so no existing answer changes", () => {
		expect(DEFAULT_FORMATTING_SETTINGS.floatResult.trimTrailingZeros).toBeUndefined();
		expect(DEFAULT_FORMATTING_SETTINGS.floatResult.compactFrom).toBeUndefined();
		for (const line of ["1.5", "1500000", "$1.50", "12.5%", "2.5 km"]) {
			expect(shown(line)).toBe(shown(line, { floatResult: { trimTrailingZeros: false } }));
		}
	});
});

describe("the boundary", () => {
	test("money keeps its currency's places", () => {
		expect(shown("$1.50", SHORTER)).toBe("= $1.50");
		expect(shown("$1,500.50", SHORTER)).toBe("= $1,500.50");
		expect(shown("¥1000 / 3", SHORTER)).toBe("= ¥333");
		expect(shown("$15/hour", SHORTER)).toBe("= $15.00/hour");
	});

	test("an explicit precision keeps its zeros and its full form", () => {
		expect(shown("3.14159 to 4 dp", SHORTER)).toBe("= 3.1416");
		expect(shown("1.5 to 3 dp", SHORTER)).toBe("= 1.500");
		expect(shown("1500000 to 2 dp", SHORTER)).toBe("= 1,500,000.00");
		expect(shown("2.5 km to 3 dp", SHORTER)).toBe("= 2.500 km");
	});

	test("a measurement with a tolerance keeps its full form", () => {
		expect(shown("1500000 +/- 20000", SHORTER)).toBe(shown("1500000 +/- 20000"));
	});

	test("past the largest suffix the ordinary form stays, so an exact integer shows every digit", () => {
		expect(shown("2^64", SHORTER)).toBe("= 18,446,744,073,709,551,616");
		expect(shown("2^53 + 1", SHORTER)).toBe("= 9,007,199,254,740,993");
		expect(shown("999e12", SHORTER)).toBe("= 999T");
		expect(shown("1e15", SHORTER)).toBe(shown("1e15"));
	});

	test("read-back: 1.5M reads back as itself, 1.23M does not", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("1.5M").toNumber()).toBe(1_500_000);
		expect(engine.evaluateExpression("1.23M").toNumber()).toBe(1_230_000);
	});
});

describe("the parts", () => {
	test("autoFormatIntegerOrFloat trims only when asked", () => {
		expect(autoFormatIntegerOrFloat(1.5, 2, true, "en-US")).toBe("1.50");
		expect(autoFormatIntegerOrFloat(1.5, 2, true, "en-US", true)).toBe("1.5");
		expect(autoFormatIntegerOrFloat(1234.5, 2, false, "en-US", true)).toBe("1234.5");
		expect(autoFormatIntegerOrFloat(1234.5, 2, true, "de-DE", true)).toBe("1.234,5");
		expect(autoFormatIntegerOrFloat(3, 2, true, "en-US", true)).toBe("3");
		expect(autoFormatIntegerOrFloat(1.999, 2, true, "en-US", true)).toBe("2");
		expect(autoFormatIntegerOrFloat(-0.5, 0, true, "en-US", true)).toBe("-1");
	});

	test("compactText: ordinary, boundary and hostile thresholds", () => {
		const at = (compactFrom: unknown) => mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, { floatResult: { compactFrom: compactFrom as number } });
		expect(compactText(1_500_000, at(1_000_000))).toBe("1.5M");
		expect(compactText(999_999, at(1_000_000))).toBeUndefined();
		expect(compactText(1_000_000, at(1_000_000))).toBe("1M");
		expect(compactText(-1_000_000, at(1_000_000))).toBe("-1M");
		expect(compactText(500, at(0))).toBeUndefined();
		expect(compactText(1500, at(-5))).toBe("1.5k");
		expect(compactText(1500, at(NaN))).toBeUndefined();
		expect(compactText(1500, at(Infinity))).toBeUndefined();
		expect(compactText(1500, at("1000"))).toBeUndefined();
		expect(compactText(1500, at(undefined))).toBeUndefined();
		expect(compactText(Infinity, at(1000))).toBeUndefined();
		expect(compactText(NaN, at(1000))).toBeUndefined();
		expect(compactText(1e15, at(1000))).toBeUndefined();
		expect(compactText(Number.MAX_VALUE, at(1000))).toBeUndefined();
	});

	test("compactText writes the locale's decimal mark", () => {
		const de = mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, { floatResult: { compactFrom: 1000 }, numberResult: { decimalSeparatorLocale: "de-DE" } });
		expect(compactText(1_500_000, de)).toBe("1,5M");
		const ar = mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, { floatResult: { compactFrom: 1000 }, numberResult: { decimalSeparatorLocale: "ar-EG" } });
		expect(compactText(1_500_000, ar)).toBe("١٫٥M");
	});
});

describe("adversarial", () => {
	test("security: settings named by prototype words are ignored and change nothing", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const hostile = JSON.parse(`{"floatResult": {"${word}": 1, "trimTrailingZeros": true}, "${word}": {"compactFrom": 1}}`) as FormattingOverrides;
				expect(shown("1.5", hostile)).toBe("= 1.5");
				expect(shown("1500000", hostile)).toBe("= 1,500,000");
			}
		});
	});

	test("security: a compact form of a huge figure is bounded, never a long string", () => {
		// Past the largest suffix: the ordinary form, every digit of the exact integer.
		expect(shown("10^300", SHORTER)).toBe(shown("10^300"));
		expect(shown("1e300", SHORTER)).toBe(shown("1e300"));
		expect(shown("-(10^14) * 9.99", SHORTER)).toBe("= -999T");
	});

	test("realistic: a value from the line above, a rate, and the worker DTO", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("budget = 2400000");
		expect(formatValue(engine.evaluateExpression("budget / 2"), SHORTER)).toBe("= 1.2M");
		const settings = mergeFormattingSettings(engine.getFormattingSettings(), SHORTER);
		expect(serializeValue(engine.evaluateExpression("budget * 1.5"), settings).text).toBe("= 3.6M");
		expect(serializeValue(engine.evaluateExpression("0.75"), settings).text).toBe("= 0.75");
		expect(formatValue(engine.evaluateExpression("2400000 km/h"), SHORTER)).toBe("= 2.4M km/h");
	});

	test("realistic: another locale's separators", () => {
		const de: FormattingOverrides = { ...SHORTER, numberResult: { decimalSeparatorLocale: "de-DE" } };
		expect(shown("1.5", de)).toBe("= 1,5");
		expect(shown("1500000", de)).toBe("= 1,5M");
		expect(shown("1234.5", de)).toBe("= 1.234,5");
		const fr: FormattingOverrides = { ...SHORTER, numberResult: { decimalSeparatorLocale: "fr-FR" } };
		expect(shown("1234.5", fr)).toBe("= 1\u202f234,5");
	});

	test("edges: every numeric edge formats under both settings without a raw error", () => {
		for (const line of NUMERIC_EDGES) {
			const value = newTrackedEngine().evaluateExpression(line);
			const text = formatValue(value, SHORTER);
			expect(typeof text).toBe("string");
			expect(text).not.toMatch(/undefined|\[object/);
		}
		expect(shown("-0", SHORTER)).toBe("= 0");
		expect(shown("0.001", SHORTER)).toBe("= 0.001");
		expect(shown("1/0", SHORTER)).toBe(shown("1/0"));
		expect(shown("-1e308", SHORTER)).toBe(shown("-1e308"));
		expect(shown("0.1234567890123456789012345678901234567", SHORTER)).toBe("= 0.12");
	});
});
