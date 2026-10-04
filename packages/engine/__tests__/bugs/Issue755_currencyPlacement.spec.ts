import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { FormattingOverrides } from "@solve-js/format/FormattingSettings";
import { localCurrencyPlacement } from "@solve-js/format/LocaleWords";
import { CURRENCY_DISPLAY } from "@solve-js/uom/CurrencyAliases";
import { uomValue } from "@solve-js/vm/Value";
import { serializeValue } from "@solve-js/worker/serialize";

/**
 * Issue #755: each currency had one fixed placement, so under a German
 * formatter `€5` showed `€5,00`, where German writes `5,00 €`. The symbol now
 * takes the place the formatter's locale gives it, through `Intl`'s own
 * rendering; the engine's symbol, places, rounding and sign rule are kept, and
 * English output is unchanged.
 */

const under = (tag: string, extra: FormattingOverrides = {}): FormattingOverrides => ({ ...extra, numberResult: { decimalSeparatorLocale: tag } });

function shown(line: string, settings?: FormattingOverrides): string {
	return formatValue(newTrackedEngine().evaluateExpression(line), settings);
}

describe("the issue's table", () => {
	test.each([
		["€5", "= €5,00", "= 5,00 €"],
		["5 EUR", "= €5,00", "= 5,00 €"],
		["€1234.5", "= €1.234,50", "= 1.234,50 €"],
		["-€5", "= -€5,00", "= -5,00 €"],
		["$5", "= $5,00", "= 5,00 $"],
		["5 SEK", "= 5,00 kr", "= 5,00 kr"],
	])("%s: %s with the engine's placement, %s under de", (line, engine, local) => {
		expect(shown(line, under("de", { wordsResult: { spelling: "engine" } }))).toBe(engine);
		expect(shown(line, under("de"))).toBe(local);
	});
});

describe("English output is unchanged", () => {
	test.each(["en", "en-US", "en-GB", "en-IN"])("%s", (tag) => {
		expect(shown("€5", under(tag))).toBe("= €5.00");
		expect(shown("-€5", under(tag))).toBe("= -€5.00");
		expect(shown("5 SEK", under(tag))).toBe("= 5.00 kr");
	});
});

describe("other locales", () => {
	test.each([
		["fr", "€1234.5", "= 1 234,50 €"],
		["ja", "€5", "= €5.00"],
		["nl", "€5", "= € 5,00"],
		["nl", "-€5", "= -€ 5,00"],
		["de-CH", "5 CHF", "= Fr 5.00"],
		["ar", "€5", "= 5.00 €"],
		["de", "£5/hour", "= 5,00 £/hour"],
		["de", "¥1000", "= 1.000 ¥"],
	])("%s %s is %s", (tag, line, answer) => {
		expect(shown(line, under(tag))).toBe(answer);
	});
});

describe("the boundary", () => {
	test("the engine's symbol is kept for a symbol several currencies share", () => {
		expect(shown("$5 CAD", under("de"))).toBe("= 5,00 $");
		expect(shown("12 NOK", under("de"))).toBe("= 12,00 kr");
	});

	test("a code with no symbol is written after the amount, as before", () => {
		expect(shown("5 KWD", under("de"))).toBe("= 5,000 KWD");
		expect(shown("5 KWD", under("ja"))).toBe("= 5.000 KWD");
	});

	test("exact half-cent rounding is the engine's own", () => {
		expect(shown("€1.005", under("de"))).toBe("= 1,01 €");
		expect(shown("€2.675", under("de"))).toBe("= 2,68 €");
	});

	test("a German engine reads the suffix form back as the same money", () => {
		const de = newTrackedEngine({ locale: "de-DE" });
		const written = de.formatValue(de.evaluateExpression("€1250")).replace(/^=\s*/, "");
		expect(written).toBe("1.250,00 €");
		expect(de.formatValue(de.evaluateExpression(written))).toBe("= 1.250,00 €");
		expect(de.formatValue(de.evaluateExpression(`${written} + 1 EUR`))).toBe("= 1.251,00 €");
		expect(de.formatValue(de.evaluateExpression("-5,00 €"))).toBe("= -5,00 €");
		expect(de.formatValue(de.evaluateExpression("5,00 $"))).toBe("= 5,00 $");
	});
});

describe("the parts", () => {
	test("localCurrencyPlacement: ordinary locales", () => {
		expect(localCurrencyPlacement("EUR", "de")).toEqual({ position: "suffix", spaced: true });
		expect(localCurrencyPlacement("EUR", "ja")).toEqual({ position: "prefix", spaced: false });
		expect(localCurrencyPlacement("EUR", "nl")).toEqual({ position: "prefix", spaced: true });
		expect(localCurrencyPlacement("GBP", "bn")).toEqual({ position: "suffix", spaced: false });
	});

	test("localCurrencyPlacement declines an English tag, an unknown tag and a malformed code", () => {
		expect(localCurrencyPlacement("EUR", "en-US")).toBeUndefined();
		expect(localCurrencyPlacement("EUR", "xx")).toBeUndefined();
		expect(localCurrencyPlacement("EUR", "")).toBeUndefined();
		expect(localCurrencyPlacement("eur", "de")).toBeUndefined();
		expect(localCurrencyPlacement("USDT", "de")).toBeUndefined();
		expect(localCurrencyPlacement("", "de")).toBeUndefined();
		for (const word of PROTOTYPE_WORDS) {
			expect(localCurrencyPlacement(word, "de")).toBeUndefined();
			expect(localCurrencyPlacement("EUR", word)).toBeUndefined();
		}
	});

	test("every currency in the display table is placed under a handful of locales", () => {
		for (const tag of ["de", "fr", "ja", "ar", "hi", "pl"]) {
			for (const code of Object.keys(CURRENCY_DISPLAY)) {
				const placement = localCurrencyPlacement(code, tag);
				expect(placement === undefined || placement.position === "prefix" || placement.position === "suffix").toBe(true);
				const text = formatValue(uomValue(-12.5, code), under(tag));
				expect(text).toContain(CURRENCY_DISPLAY[code].symbol);
				expect(text.startsWith("= -")).toBe(true);
				expect(text).not.toMatch(/undefined|\[object|NaN/);
			}
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words as a currency or tag change nothing", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(formatValue(uomValue(5, word), under("de"))).toBe(`= 5,00 ${word}`);
			}
		});
	});

	test("security: many tags stay within time", () => {
		const started = performance.now();
		for (let i = 0; i < 2_000; i++) formatValue(uomValue(i, "EUR"), under(`de-x-c${i}`));
		expect(performance.now() - started).toBeLessThan(5_000);
	});

	test("realistic: a rate, a split, a value from the line above and the worker DTO", () => {
		const engine = newTrackedEngine({ locale: "de-DE" });
		engine.evaluateExpression("miete = €1200");
		expect(engine.formatValue(engine.evaluateExpression("miete / 3"))).toBe("= 400,00 €");
		expect(engine.formatValue(engine.evaluateExpression("€15/hour"))).toBe("= 15,00 €/hour");
		expect(shown("split €100 between 3", under("de"))).toBe("= 33,33 € each, with 1 share paying 33,34 €");
		expect(serializeValue(engine.evaluateExpression("€5"), engine.getFormattingSettings()).text).toBe("= 5,00 €");
	});

	test("realistic: compact money under a locale", () => {
		expect(shown("€3300000", under("de", { floatResult: { compactFrom: 1_000_000 } }))).toBe("= 3,3M €");
	});

	test("edges: zero, negative zero, negatives and a huge amount", () => {
		expect(shown("€0", under("de"))).toBe("= 0,00 €");
		expect(shown("-€0", under("de"))).toBe("= 0,00 €");
		expect(shown("-€1234.5", under("de"))).toBe("= -1.234,50 €");
		expect(shown("€1e20", under("de"))).toMatch(/ €$/);
		expect(shown("€0.001", under("de"))).toBe("= 0,00 €");
	});
});
