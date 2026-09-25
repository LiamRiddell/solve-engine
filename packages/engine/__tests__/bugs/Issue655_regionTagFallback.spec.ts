import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, evaluateLine, expectPrototypeUntouched } from "@tools/adversarial";
import { createEngine } from "@solve-js/api/createEngine";
import { deLocale, enLocale, frLocale, getLocale, groupsInLakhs } from "@solve-js/constants/locales";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS, type FormattingSettings } from "@solve-js/format/FormattingSettings";
import { hasSecondDecimalMark, localeLiteralRefusal, unreadableInLocale } from "@solve-js/parser/LocaleNumberLiteral";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { datetimeValue, type Value } from "@solve-js/vm/Value";

/**
 * Issue #655: `getLocale` was `locales[code] || enLocale`, an exact-key lookup
 * on a plain object. A full language tag (`de-DE`, which is what
 * `navigator.language` gives) missed `de` and fell back to English, so
 * `€1.250` under `de-DE` was €1.25; and a code that names an
 * `Object.prototype` property returned what the object inherits, so
 * `createEngine({ locale: "toString" })` threw a raw TypeError. A tag now falls
 * back by its language subtag, a lookup is an own key or nothing, and
 * `formatValue` writes a date's names with the host's full tag, as it already
 * wrote its digits.
 *
 * Falling back to the language pack brought a regional tag the pack's reading
 * of `1,234,567` too, which was 1.234 under `de` and `fr`: the first comma
 * became the decimal point and `parseFloat` stopped at the second. A de-DE
 * host had read it as English until now, so that literal (a second decimal
 * mark after the decimal comma) is refused in the same change rather than
 * handed to every regional host as a new wrong answer.
 */

/** A line through the single-expression path under `locale`: the answer, or `CODE: message`. */
function show(line: string, locale: string): string {
	const outcome = evaluateLine(line, newTrackedEngine({ locale }));
	if (outcome.kind === "value") return outcome.text;
	if (outcome.kind === "crashed") return `CRASHED ${outcome.name}: ${outcome.message}`;
	return `${outcome.code}: ${outcome.message}`;
}

/** Formatting settings with only the locale tag changed. */
function tagged(tag: string): FormattingSettings {
	return { ...DEFAULT_FORMATTING_SETTINGS, numberResult: { decimalSeparatorLocale: tag } };
}

/** The spelled-out date Intl writes for `tag`, the reference a formatted date is held to. */
function intlLongDate(epochMs: number, tag: string): string {
	return new Date(epochMs).toLocaleDateString(tag, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** Each line's answer or error, from a document result. */
function lines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		const failed = line.error ?? (v?.isError() ? String(v.errorMessage) : null);
		if (failed !== null) return `ERROR ${failed}`;
		return v ? formatValue(v) : "";
	});
}

describe("getLocale", () => {
	test.each(["de", "de-DE", "de-AT", "de-CH", "DE", "De-de", "de_DE", "de-Latn-DE", "de-DE-u-nu-latn", "de-"])("%s is German", (code) => {
		expect(getLocale(code)).toBe(deLocale);
	});

	test.each(["fr", "fr-FR", "fr-CA", "FR_be"])("%s is French", (code) => {
		expect(getLocale(code)).toBe(frLocale);
	});

	test.each(["en", "en-GB", "en-US", "en-IN", "xx", "xx-DE", "", "-de", "_de", "deutsch", "d", "zz-ZZ"])("%s is English", (code) => {
		expect(getLocale(code)).toBe(enLocale);
	});

	test.each([...PROTOTYPE_WORDS, "__PROTO__", "toString-DE", "constructor_de"])("adversarial: %s names an inherited property and is English", (code) => {
		expect(getLocale(code)).toBe(enLocale);
	});

	test("adversarial: a value that is not a string, from a host that is not type-checked, is English", () => {
		for (const code of [null, undefined, 42, {}, [], Symbol.iterator]) {
			expect(getLocale(code as unknown as string)).toBe(enLocale);
		}
	});

	test("adversarial: a tag of any length is settled in its first few characters", () => {
		const long = "x".repeat(1_000_000);
		const started = performance.now();
		expect(getLocale(long)).toBe(enLocale);
		expect(getLocale(`de-${long}`)).toBe(deLocale);
		expect(getLocale(`${long}-de`)).toBe(enLocale);
		expect(performance.now() - started).toBeLessThan(200);
	});

	test("a lookup changes nothing it reads from", () => {
		expectPrototypeUntouched(() => {
			for (const code of PROTOTYPE_WORDS) getLocale(code);
		});
		expect(enLocale.code).toBe("en");
		expect(deLocale.code).toBe("de");
	});
});

describe("groupsInLakhs", () => {
	test.each(["en-IN", "EN-in", "en_IN", "hi-IN", "ta-IN", "en-Latn-IN", "en-IN-u-nu-latn"])("%s is an Indian-region tag grouping with a comma", (code) => {
		expect(groupsInLakhs(code)).toBe(true);
	});

	test.each(["en", "in", "en-GB", "en-INX", "en-IND", "de-IN", "fr-IN", "IN", "xx"])("%s is not", (code) => {
		expect(groupsInLakhs(code)).toBe(false);
	});

	test("adversarial: prototype words, non-strings and a huge tag are not", () => {
		for (const code of PROTOTYPE_WORDS) expect(groupsInLakhs(code)).toBe(false);
		expect(groupsInLakhs(null as unknown as string)).toBe(false);
		expect(groupsInLakhs(`en-${"I".repeat(1_000_000)}`)).toBe(false);
	});
});

describe("a region tag gets its language's engine", () => {
	test("the issue's table: de-DE now answers as de", () => {
		const table = ["de", "de-DE", "en"].map((locale) => [locale, show("€1.250", locale), show("1.000 + 1", locale)]);
		expect(table).toEqual([
			["de", "= €1,250.00", "= 1,001"],
			["de-DE", "= €1,250.00", "= 1,001"],
			["en", "= €1.25", "= 2"],
		]);
	});

	test.each(["de-DE", "de-AT", "de-CH"])("%s refuses a dot decimal as de does (#654), rather than inheriting the English reading", (locale) => {
		expect(show("1.5 + 1", locale)).toMatch(/^INVALID_NUMBER_LITERAL: "1\.5" is not a number in the de locale/);
		expect(show("$9.99", locale)).toMatch(/^INVALID_NUMBER_LITERAL: /);
	});

	test("a German keyword is a keyword under de-DE", () => {
		expect(show("3 mal 4", "de-DE")).toBe("= 12");
		expect(show("3 mal 4", "en-GB")).not.toBe("= 12");
	});

	test("fr-FR reads as fr, and every English region as en", () => {
		expect(show("2.5 + 1", "fr-FR")).toBe("= 3.50");
		for (const locale of ["en-GB", "en-US", "en-IN", "xx"]) expect(show("1.5 + 1", locale)).toBe("= 2.50");
	});

	test("both document passes agree under a region tag", () => {
		const text = "preis = €1.250\npreis * 2\n1.5";
		const batch = lines(newTrackedEngine({ locale: "de-DE" }).parseDocument(text));
		const incremental = lines(evaluateDocument(newTrackedEngine({ locale: "de-DE" }), text));
		expect(batch.slice(0, 2)).toEqual(["= €1,250.00", "= €2,500.00"]);
		expect(batch[2]).toMatch(/^ERROR "1\.5" is not a number in the de locale/);
		expect(incremental).toEqual(batch);
	});
});

describe("hasSecondDecimalMark", () => {
	test.each([
		["1,234,567", "."],
		["1,234.567", "."],
		["1,000,5", "."],
		["1,234,567", " "],
		["1,234.56", " "],
		["1.234,567", " "],
	])("%s holds a second decimal mark where the group mark is %p", (raw, group) => {
		expect(hasSecondDecimalMark(raw, group)).toBe(true);
	});

	test.each([
		["1,000", "."],
		["1.234,567", "."],
		["1.234.567,5", "."],
		["2.5", " "],
		["1,000", " "],
		["1234", "."],
		["", "."],
	])("%s does not where the group mark is %p", (raw, group) => {
		expect(hasSecondDecimalMark(raw, group)).toBe(false);
	});

	test("unreadableInLocale names it, and only for a comma-decimal locale", () => {
		expect(unreadableInLocale("1,234,567", ",", ".")).toBe("second-decimal-mark");
		expect(unreadableInLocale("1,234,567", ",", " ")).toBe("second-decimal-mark");
		expect(unreadableInLocale("1,234,567", ".", ",")).toBeNull();
	});

	test("localeLiteralRefusal says what the comma is", () => {
		const error = localeLiteralRefusal("1,234,567", "fr-FR", "second-decimal-mark");
		expect(error.code).toBe("INVALID_NUMBER_LITERAL");
		expect(error.message).toBe('"1,234,567" is not a number in the fr locale: "," marks the decimal there, so it appears once, with only digits after it.');
		expect(error.context).toEqual({ raw: "1,234,567", localeCode: "fr-FR", separator: "," });
	});
});

describe("a regional tag does not inherit a misreading of a second decimal mark", () => {
	test.each(["de", "de-DE", "fr", "fr-FR"])("%s refuses 1,234,567 rather than reading 1.234", (locale) => {
		expect(show("1,234,567", locale)).toMatch(/^INVALID_NUMBER_LITERAL: "1,234,567" is not a number in the (de|fr) locale: "," marks the decimal there/);
	});

	test("fr refuses a dot decimal beside a comma one, either way round", () => {
		expect(show("1,234.56", "fr")).toMatch(/^INVALID_NUMBER_LITERAL: /);
		expect(show("1.234,567", "fr")).toMatch(/^INVALID_NUMBER_LITERAL: /);
	});

	test("what each still reads", () => {
		expect(show("1.234,567", "de")).toBe("= 1,234.57");
		expect(show("1,000", "de")).toBe("= 1");
		expect(show("1,000", "fr")).toBe("= 1");
		expect(show("1.234.567", "fr")).toBe("= 1,234,567");
		expect(show("1,234,567", "en")).toBe("= 1,234,567");
		expect(show("1,234,567", "en-GB")).toBe("= 1,234,567");
	});

	test("a comma inside a call is still an argument separator", () => {
		expect(show("max(1,234,567)", "de")).toBe("= 567");
	});
});

describe("adversarial: a prototype-named locale builds a working English engine", () => {
	test.each([...PROTOTYPE_WORDS])("createEngine({ locale: %p })", (locale) => {
		expectPrototypeUntouched(() => {
			const engine = createEngine({ locale });
			try {
				expect(formatValue(engine.evaluateExpression("1,000 + 1.5"))).toBe("= 1,001.50");
				expect(lines(engine.parseDocument("x = 2\nx * 3"))).toEqual(["= 2", "= 6"]);
			} finally {
				engine.clear();
			}
		});
	});

	test("an absurdly long locale builds an English engine", () => {
		const engine = createEngine({ locale: "x".repeat(100_000) });
		try {
			expect(formatValue(engine.evaluateExpression("1.5 + 1"))).toBe("= 2.50");
		} finally {
			engine.clear();
		}
	});
});

describe("formatValue writes a date with the host's full tag", () => {
	const nov17 = new Date(2025, 10, 17).getTime();
	const date = (): Value => newTrackedEngine().evaluateExpression("2025-11-17");

	test("the issue's table: a regional tag gets its own names", () => {
		expect(formatValue(date(), tagged("de"))).toBe("= Montag, 17. November 2025");
		expect(formatValue(date(), tagged("de-DE"))).toBe("= Montag, 17. November 2025");
		expect(formatValue(date(), tagged("fr"))).toBe("= lundi 17 novembre 2025");
		expect(formatValue(date(), tagged("fr-FR"))).toBe("= lundi 17 novembre 2025");
		// en-GB's exact punctuation is the runtime's ICU data, so it is held to Intl's own rendering.
		expect(formatValue(date(), tagged("en-GB"))).toBe(`= ${intlLongDate(nov17, "en-GB")}`);
		expect(formatValue(date(), tagged("en-GB"))).toMatch(/17 November 2025/);
	});

	test("the default settings are unchanged", () => {
		expect(formatValue(date())).toBe("= Monday, November 17, 2025");
		expect(formatValue(date(), tagged(""))).toBe("= Monday, November 17, 2025");
	});

	test("digits and names now agree for a regional tag", () => {
		const settings = tagged("de-DE");
		expect(formatValue(newTrackedEngine().evaluateExpression("1234.5"), settings)).toBe("= 1.234,50");
		expect(formatValue(date(), settings)).toBe("= Montag, 17. November 2025");
	});

	test("a time of day follows the tag too", () => {
		const at = new Date(2025, 10, 17, 15, 30).getTime();
		const value = datetimeValue(at);
		expect(formatValue(value, tagged("de-DE"))).toBe(`= ${intlLongDate(at, "de-DE")}, ${new Date(at).toLocaleTimeString("de-DE")}`);
	});

	test("a tag Intl has no data for keeps English names, whatever locale the runtime runs in", () => {
		// Intl answers an unknown tag in the runtime's own locale, so passing
		// `xx` through would make the answer depend on the machine.
		for (const tag of ["xx", "zz-ZZ", "toString"]) {
			expect(formatValue(date(), tagged(tag))).toBe("= Monday, November 17, 2025");
		}
	});

	test("adversarial: a tag Intl cannot read keeps the language pack's names, and a number throws Intl's RangeError as it always has", () => {
		for (const tag of ["__proto__", "constructor", "x".repeat(300)]) {
			expect(() => formatValue(newTrackedEngine().evaluateExpression("1.5"), tagged(tag))).toThrow(RangeError);
			expect(formatValue(date(), tagged(tag))).toBe("= Monday, November 17, 2025");
		}
		// `de_DE` is the POSIX spelling: Intl refuses it, the German pack accepts it.
		expect(formatValue(date(), tagged("de_DE"))).toBe("= Montag, 17. November 2025");
	});

	test("adversarial: a tag of any length is not remembered, and still answers", () => {
		const tag = `de-${"x".repeat(100_000)}`;
		expect(formatValue(date(), tagged(tag))).toBe("= Montag, 17. November 2025");
		expect(formatValue(date(), tagged(tag))).toBe("= Montag, 17. November 2025");
	});

	test("adversarial: a prototype-named tag Intl accepts writes an answer, never an inherited property", () => {
		expectPrototypeUntouched(() => {
			const text = formatValue(newTrackedEngine().evaluateExpression("1234.5"), tagged("toString"));
			expect(text).toMatch(/^= /);
			expect(text).not.toMatch(/function|undefined|object/);
		});
	});
});
