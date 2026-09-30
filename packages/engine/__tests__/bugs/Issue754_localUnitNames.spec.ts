import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { FormattingOverrides } from "@solve-js/format/FormattingSettings";
import { INTL_UNIT_OF_ENGINE_NAME, localisesWords, withLocalUnitName } from "@solve-js/format/LocaleWords";
import { uomValue } from "@solve-js/vm/Value";
import { serializeValue } from "@solve-js/worker/serialize";

/**
 * Issue #754: under a German formatter the numbers and dates followed the
 * locale but unit words stayed English (`3,11 miles` beside `Dienstag, 10.
 * März 2026`). A unit's long name is now written in the formatter's language
 * for the simple units `Intl` sanctions; a symbol stays as it is, and English
 * output is unchanged.
 */

const under = (tag: string, extra: FormattingOverrides = {}): FormattingOverrides => ({ ...extra, numberResult: { decimalSeparatorLocale: tag } });

function shown(line: string, settings?: FormattingOverrides): string {
	return formatValue(newTrackedEngine().evaluateExpression(line), settings);
}

describe("the issue's table", () => {
	test.each([
		["5 km in miles", "= 3,11 miles", "= 3,11 Meilen"],
		["2 days", "= 2 days", "= 2 Tage"],
		["3600 seconds in hours", "= 1 hour", "= 1 Stunde"],
		["10 kg", "= 10,00 kg", "= 10,00 kg"],
		["2026-03-10", "= Dienstag, 10. März 2026", "= Dienstag, 10. März 2026"],
	])("%s: %s with the engine's spelling, %s under de", (line, engineSpelling, local) => {
		expect(shown(line, under("de", { wordsResult: { spelling: "engine" } }))).toBe(engineSpelling);
		expect(shown(line, under("de"))).toBe(local);
	});

	test("a full tag writes the same words as the short one", () => {
		expect(shown("5 km in miles", under("de-DE"))).toBe("= 3,11 Meilen");
		expect(shown("2 days", under("de-AT"))).toBe("= 2 Tage");
	});
});

describe("English output is unchanged", () => {
	test.each(["en", "en-US", "en-GB", "en-IN"])("%s", (tag) => {
		expect(shown("5 km in miles", under(tag))).toBe("= 3.11 miles");
		expect(shown("3600 seconds in hours", under(tag))).toBe("= 1 hour");
		expect(shown("2 days", under(tag))).toBe("= 2 days");
	});

	test("the default settings", () => {
		expect(shown("5 km in miles")).toBe("= 3.11 miles");
		expect(shown("1.5 hours")).toBe("= 1.50 hours");
	});
});

describe("the boundary", () => {
	test("a symbol is written as it is", () => {
		expect(shown("10 kg", under("de"))).toBe("= 10,00 kg");
		expect(shown("5 km", under("fr"))).toBe("= 5,00 km");
		expect(shown("2 h", under("de"))).toBe("= 2,00 h");
	});

	test("a unit Intl has no name for keeps its English name", () => {
		expect(shown("3 nautical miles", under("de"))).toBe("= 3,00 nautical miles");
		expect(shown("2 fortnights", under("de"))).toBe("= 2,00 fortnights");
	});

	test("a localised name does not read back in, which is why the engine's spelling is kept for a note", () => {
		const de = newTrackedEngine({ locale: "de-DE" });
		expect(() => de.evaluateExpression("3,11 Meilen")).toThrow();
		expect(formatValue(de.evaluateExpression("5 km in miles"), under("de", { wordsResult: { spelling: "engine" } }))).toBe("= 3,11 miles");
	});
});

describe("grammar: the form the count takes", () => {
	test("German singular and plural", () => {
		expect(shown("1 day", under("de"))).toBe("= 1 Tag");
		expect(shown("3 days", under("de"))).toBe("= 3 Tage");
		expect(shown("1 mile", under("de"))).toBe("= 1,00 Meilen");
		expect(shown("1.5 hours", under("de"))).toBe("= 1,50 Stunden");
	});

	test("more than two forms: Polish and Arabic", () => {
		expect(shown("1 day", under("pl"))).toBe("= 1 dzień");
		expect(shown("2 days", under("pl"))).toBe("= 2 dni");
		expect(shown("5 days", under("pl"))).toBe("= 5 dni");
		expect(shown("2 miles", under("pl"))).toBe("= 2,00 mili");
		expect(shown("3 days", under("ar"))).toBe("= 3 أيام");
		expect(shown("11 days", under("ar"))).toBe("= 11 يومًا");
	});

	test("right to left, and native digits", () => {
		expect(shown("3.5 days", under("ar-EG"))).toBe("= ٣٫٥٠ يوم");
		expect(shown("5 miles", under("fa"))).not.toMatch(/miles/);
	});

	test("every sanctioned unit is named in a handful of locales", () => {
		for (const tag of ["de", "fr", "es", "ja", "pl", "ar"]) {
			for (const name of Object.keys(INTL_UNIT_OF_ENGINE_NAME)) {
				const text = formatValue(uomValue(2.5, name), under(tag));
				// The locale's own name, which is sometimes the English one (French `gallons`).
				const intl = new Intl.NumberFormat(tag, { style: "unit", unit: INTL_UNIT_OF_ENGINE_NAME[name], unitDisplay: "long", minimumFractionDigits: 2 })
					.format(2.5).replace(/[  ]/g, " ");
				expect({ tag, name, text }).toEqual({ tag, name, text: `= ${intl}` });
			}
		}
	});
});

describe("the parts", () => {
	test("localisesWords: ordinary, boundary and hostile tags", () => {
		expect(localisesWords("de")).toBe(true);
		expect(localisesWords("de-DE")).toBe(true);
		expect(localisesWords("pl")).toBe(true);
		expect(localisesWords("en")).toBe(false);
		expect(localisesWords("en-GB")).toBe(false);
		expect(localisesWords("EN-us")).toBe(false);
		expect(localisesWords("")).toBe(false);
		expect(localisesWords("xx")).toBe(false);
		expect(localisesWords("de_DE")).toBe(false);
		expect(localisesWords("x".repeat(1000))).toBe(false);
		expect(localisesWords(undefined as unknown as string)).toBe(false);
		for (const word of PROTOTYPE_WORDS) expect(localisesWords(word)).toBe(false);
	});

	test("withLocalUnitName splices the engine's number into the locale's pattern", () => {
		expect(withLocalUnitName("3,11", "miles", 3.11, 2, "de")).toBe("3,11 Meilen");
		expect(withLocalUnitName("-3,11", "miles", -3.11, 2, "de")).toBe("-3,11 Meilen");
		expect(withLocalUnitName("1", "days", 1, 0, "de")).toBe("1 Tag");
		expect(withLocalUnitName("1e-6", "miles", 1e-6, undefined, "de")).toBe("1e-6 Meilen");
		expect(withLocalUnitName("3,50", "days", 3.5, 2, "fr")).toBe("3,50 jours");
	});

	test("withLocalUnitName declines what it cannot name", () => {
		expect(withLocalUnitName("3.11", "miles", 3.11, 2, "en-US")).toBeUndefined();
		expect(withLocalUnitName("3", "km", 3, 0, "de")).toBeUndefined();
		expect(withLocalUnitName("3", "nautical miles", 3, 0, "de")).toBeUndefined();
		expect(withLocalUnitName("∞", "miles", Infinity, undefined, "de")).toBeUndefined();
		expect(withLocalUnitName("NaN", "miles", NaN, undefined, "de")).toBeUndefined();
		expect(withLocalUnitName("3", "miles", 3, 0, "xx")).toBeUndefined();
		for (const word of PROTOTYPE_WORDS) expect(withLocalUnitName("3", word, 3, 0, "de")).toBeUndefined();
	});
});

describe("adversarial", () => {
	test("security: prototype words as a unit or a tag change nothing and leak nothing", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(formatValue(uomValue(3, word), under("de"))).toBe(`= 3,00 ${word}`);
				// A tag Intl cannot read either throws Intl's own RangeError, as a
				// mistyped setting always has, or writes the engine's English.
				try {
					expect(formatValue(uomValue(3, "miles"), under(word))).toMatch(/miles$/);
				} catch (error) {
					expect(error).toBeInstanceOf(RangeError);
				}
			}
		});
	});

	test("security: a unit carrying look-alike or markup text is written as text", () => {
		for (const edge of TEXT_EDGES) {
			const text = formatValue(uomValue(3, edge), under("de"));
			expect(text).toBe(`= 3,00 ${edge}`.trim());
		}
	});

	test("security: many tags do not grow the caches without bound or slow the formatter", () => {
		const started = performance.now();
		for (let i = 0; i < 2_000; i++) formatValue(uomValue(i, "miles"), under(`de-x-t${i}`));
		expect(performance.now() - started).toBeLessThan(5_000);
	});

	test("realistic: a value from the line above, a conversion, and the worker DTO", () => {
		const engine = newTrackedEngine({ locale: "de-DE" });
		engine.evaluateExpression("strecke = 10 km");
		expect(engine.formatValue(engine.evaluateExpression("strecke in miles"))).toBe("= 6,21 Meilen");
		expect(serializeValue(engine.evaluateExpression("2 days"), engine.getFormattingSettings()).text).toBe("= 2 Tage");
	});

	test("realistic: the shorter-number settings meet the local names", () => {
		const settings = under("de", { floatResult: { trimTrailingZeros: true, compactFrom: 1_000_000 } });
		expect(shown("1.5 hours", settings)).toBe("= 1,5 Stunden");
		expect(shown("2500000 miles", settings)).toBe("= 2,5M Meilen");
	});

	test("edges: zero, negative zero, negatives and a huge count", () => {
		expect(shown("0 days", under("de"))).toBe("= 0 Tage");
		expect(shown("-0 days", under("de"))).toBe("= 0 Tage");
		expect(shown("-1 day", under("de"))).toBe("= -1 Tag");
		expect(shown("1e300 miles", under("de"))).toMatch(/Meilen$/);
		expect(shown("0.000001 miles", under("de"))).toBe("= 1e-6 Meilen");
	});
});
