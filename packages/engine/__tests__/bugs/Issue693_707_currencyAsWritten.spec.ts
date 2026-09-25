import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import {
	CURRENCY_DISPLAY,
	CURRENCY_LETTER_SYMBOLS,
	CURRENCY_LOWERCASE_CODES,
	CURRENCY_SYMBOL_ALIASES,
	CURRENCY_WORD_ALIASES,
	resolveCurrencyAlias,
} from "@solve-js/uom/CurrencyAliases";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";
import { enLocale, deLocale, frLocale } from "@solve-js/constants/locales";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";

/**
 * Issues #693 and #707: the engine wrote currency it could not read back
 * (`12 SEK` showed `12.00 kr`, and `12.00 kr + 1 SEK` was an undefined
 * variable), and read neither a symbol after the amount (`100 €`), a dollar
 * named by its country (`A$100`), nor a code in lower case (`100 usd`).
 */

function read(line: string, engine = newTrackedEngine()): { shown: string; currency: string | undefined } {
	try {
		const value = engine.evaluateExpression(line);
		return { shown: formatValue(value).replace(/^=\s*/, ""), currency: value.unit };
	} catch (e) {
		return { shown: `THROWS ${(e as Error).message}`, currency: undefined };
	}
}

/** The codes whose written symbol reads back as another code: the symbol's default. */
const SHARED_SYMBOL_DEFAULTS: Record<string, string> = {
	AUD: "USD", CAD: "USD", NZD: "USD", HKD: "USD", SGD: "USD", MXN: "USD",
	CNY: "JPY",
	NOK: "SEK", DKK: "SEK",
};

describe("what the engine writes, it reads back", () => {
	test.each(Object.keys(CURRENCY_DISPLAY))("%s, as 12, 1,234.56 and -12", (code) => {
		for (const amount of ["12", "1234.56", "-12"]) {
			const written = read(`${amount} ${code}`).shown;
			const back = read(written);
			expect(back.shown).toBe(written);
			expect(back.currency).toBe(SHARED_SYMBOL_DEFAULTS[code] ?? code);
		}
	});

	test("the issue's line: kronor typed back add to kronor", () => {
		expect(read("12 SEK").shown).toBe("12.00 kr");
		expect(read("12.00 kr + 1 SEK").shown).toBe("13.00 kr");
	});

	test("a symbol several currencies share reads as its default, and a code names the others", () => {
		expect(read("12 kr").currency).toBe("SEK");
		expect(read("12 NOK").currency).toBe("NOK");
		expect(read("$12").currency).toBe("USD");
		expect(read("$12 CAD").currency).toBe("CAD");
	});
});

describe("a symbol after the amount", () => {
	test.each([
		["100 €", "€100.00", "EUR"],
		["100€", "€100.00", "EUR"],
		["-100 €", "-€100.00", "EUR"],
		["1,000 ₹", "₹1,000.00", "INR"],
		["12 ₽", "12.00 ₽", "RUB"],
		["12₫", "12.00₫", "VND"],
		["100 $", "$100.00", "USD"],
		["100 £", "£100.00", "GBP"],
		["100 ¥", "¥100.00", "JPY"],
		["5 € + 3 €", "€8.00", "EUR"],
	])("%s is %s", (line, shown, currency) => {
		expect(read(line)).toEqual({ shown, currency });
	});

	test("reads the same as the symbol before the amount", () => {
		for (const symbol of Object.keys(CURRENCY_SYMBOL_ALIASES).filter((s) => !s.endsWith("$") || s === "$")) {
			expect(read(`100 ${symbol}`)).toEqual(read(`${symbol}100`));
		}
	});

	test("a symbol with another amount after it is that amount's, and stays unread", () => {
		expect(read("100 $200").shown).toBe('THROWS Unexpected token after expression: "$"');
	});
});

describe("letter symbols after the amount", () => {
	test.each([
		["12 kr", "SEK"],
		["12 zł", "PLN"],
		["12 Ft", "HUF"],
		["12 Kč", "CZK"],
		["12 Fr", "CHF"],
	])("%s is %s", (line, currency) => {
		expect(read(line).currency).toBe(currency);
	});

	test("matched exactly as written: Ft is the forint, ft the foot", () => {
		expect(read("5 Ft").currency).toBe("HUF");
		expect(read("5 ft")).toEqual({ shown: "5.00 ft", currency: "ft" });
	});

	test("a letter symbol is still a name where no amount comes before it", () => {
		const engine = newTrackedEngine();
		const result = engine.parseDocument(":Fr = 5\nFr * 2\n12 Fr", { inputType: "markdown" });
		expect(formatValue(result.lines[1].result!)).toBe("= 10");
		// After an amount it is the currency, as a unit name is (`5 m` is metres).
		expect(result.lines[2].result?.unit).toBe("CHF");
	});
});

describe("a dollar named by its country", () => {
	test.each([
		["A$100", "AUD"],
		["C$100", "CAD"],
		["US$100", "USD"],
		["HK$100", "HKD"],
		["NZ$100", "NZD"],
		["S$100", "SGD"],
		["MX$100", "MXN"],
		["R$100", "BRL"],
		["A$1,234.56", "AUD"],
		["-A$100", "AUD"],
	])("%s is %s", (line, currency) => {
		expect(read(line).currency).toBe(currency);
	});

	test("only written touching: the letters stay what they are on their own", () => {
		expect(read("A $100").shown).toMatch(/^THROWS/);
		expect(read("5 A")).toEqual({ shown: "5.00 A", currency: "A" });
		expect(read("5 C")).toEqual({ shown: "5.00 C", currency: "C" });
	});

	test("a name A or C defined above changes nothing", () => {
		const engine = newTrackedEngine();
		const result = engine.parseDocument(":A = 2\n:C = 3\nA$100\nC$100\nA * C", { inputType: "markdown" });
		expect(result.lines[2].result?.unit).toBe("AUD");
		expect(result.lines[3].result?.unit).toBe("CAD");
		expect(formatValue(result.lines[4].result!)).toBe("= 6");
	});
});

describe("the rand, as the engine writes it", () => {
	test.each([
		["R12.00", "R12.00"],
		["R0.50", "R0.50"],
		["R1,234.56", "R1,234.56"],
		["R1,234,567.00", "R1,234,567.00"],
		["-R12.00", "-R12.00"],
	])("%s", (line, shown) => {
		expect(read(line)).toEqual({ shown, currency: "ZAR" });
	});

	test("R stays a name: after an amount, and without a fraction", () => {
		const engine = newTrackedEngine();
		const result = engine.parseDocument("R = 5\n12 R\n:R12 = 3\nR12 * 2", { inputType: "markdown" });
		expect(formatValue(result.lines[1].result!)).toBe("= 60");
		expect(formatValue(result.lines[3].result!)).toBe("= 6");
		expect(read("R12").shown).toBe("THROWS Undefined variable: R12");
	});

	test("a fraction or group that is not touching is not the rand's", () => {
		expect(read("R12 .00").currency).not.toBe("ZAR");
		expect(read("R1, 234.56").currency).not.toBe("ZAR");
		expect(read("R1234,567.00").currency).not.toBe("ZAR");
	});
});

describe("codes in lower case", () => {
	test.each(Object.entries(CURRENCY_LOWERCASE_CODES))("100 %s is %s", (lower, code) => {
		expect(read(`100 ${lower}`).currency).toBe(code);
	});

	test("inside a conversion, on either side", () => {
		expect(read("100 eur in USD").shown).not.toMatch(/^THROWS/);
		expect(read("100 EUR in usd").shown).not.toMatch(/^THROWS/);
	});

	test("the words that are codes in capitals are left alone", () => {
		expect(read("100 try").shown).toBe("THROWS Undefined variable: try");
		expect(read("100 rub").shown).toBe("THROWS Undefined variable: rub");
		expect(read("100 php").shown).toBe("THROWS Undefined variable: php");
		expect(read("100 cup")).toEqual({ shown: "100.00 cup", currency: "cup" });
		expect(read("100 Usd").shown).toBe("THROWS Undefined variable: Usd");
	});

	test("no curated spelling was a unit, a keyword or a function before it was added", () => {
		const keywords = new Set<string>();
		for (const locale of [enLocale, deLocale, frLocale]) for (const word of Object.keys(locale.keywordMap)) keywords.add(word);
		const packageUnits = new Set<string>();
		for (const pkg of BUILTIN_PACKAGES) {
			for (const word of Object.keys(pkg.lexerVocabulary?.keywords ?? {})) keywords.add(word);
			for (const unit of pkg.lexerVocabulary?.units ?? []) packageUnits.add(unit);
		}
		const added = [...Object.keys(CURRENCY_LOWERCASE_CODES), ...Object.keys(CURRENCY_LETTER_SYMBOLS)];
		for (const word of added) {
			expect([word, keywords.has(word)]).toEqual([word, false]);
			expect([word, Object.prototype.hasOwnProperty.call(UNIT_TABLE, word)]).toEqual([word, false]);
			expect([word, Object.prototype.hasOwnProperty.call(EXTENDED_UNITS, word)]).toEqual([word, false]);
			expect([word, packageUnits.has(word)]).toEqual([word, false]);
			expect([word, Object.prototype.hasOwnProperty.call(CURRENCY_WORD_ALIASES, word.toLowerCase())]).toEqual([word, false]);
		}
	});
});

describe("adversarial", () => {
	test("prototype words resolve to no currency", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(resolveCurrencyAlias(word)).toBeUndefined();
			expect(resolveCurrencyAlias(`${word}$`)).toBeUndefined();
		}
	});

	test("prototype words before a dollar are not a country", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(read(`${word}$100`).currency ?? "").not.toMatch(/^[A-Z]{3}$/);
		}
	});

	test("a symbol after something that is not an amount is left as written", () => {
		expect(read("(5) €").shown).toMatch(/^THROWS/);
		expect(read("€").shown).toMatch(/^THROWS/);
	});

	test("a long line of suffix amounts adds up", () => {
		const line = Array.from({ length: 60 }, () => "1 €").join(" + ");
		expect(read(line)).toEqual({ shown: "€60.00", currency: "EUR" });
	});
});
