/**
 * Numbers, patterns and fields from pasted text (issue #520): `numbers in`,
 * `amounts in`, the aggregates over them, `match`, `matches`, `matchcount` and
 * `field`, through the engine.
 *
 * Every form either answers correctly or refuses with a named Error value.
 * None throws, none answers with a guessed number, and each is bounded, so the
 * big-paste cases here check the refusal arrives and arrives quickly.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { MAX_NUMBERS_READ, TextExtractionErrorCodes } from "@solve-js/packages/text/TextExtractionFunctions";
import { scanNumbers, numberFormatFor } from "@solve-js/packages/text/TextExtraction";

const value = (source: string, locale?: string): Value =>
	(locale === undefined ? newTrackedEngine() : newTrackedEngine({ locale })).evaluateExpression(source);
const shown = (source: string, locale?: string): string => formatValue(value(source, locale)).replace(/^=\s*/, "");
const list = (source: string, locale?: string): number[] => {
	const v = value(source, locale);
	if (v.type !== ValueType.Matrix) throw new Error(`${source} gave ${formatValue(v)}`);
	return (v.value as { data: number[] }).data.slice();
};
const errorCode = (source: string, locale?: string): string => {
	const v = value(source, locale);
	if (v.type !== ValueType.Error) throw new Error(`${source} answered ${formatValue(v)}`);
	return String(v.value);
};

/** The numbers and currencies found, straight from the scanner. */
const scanned = (text: string, locale = "en") => scanNumbers(text, numberFormatFor(locale), MAX_NUMBERS_READ);

describe("numbers in", () => {
	test("the receipt from the issue: every number, ready to total", () => {
		expect(list('numbers in "Coffee 3.20, lunch 12.50, taxi 18"')).toEqual([3.2, 12.5, 18]);
		expect(shown('total of numbers in "Coffee 3.20, lunch 12.50, taxi 18"')).toBe("33.70");
	});

	test("thousands are grouped only in threes, after a first group of one to three digits", () => {
		expect(list('numbers in "1,234,567.89 and 7"')).toEqual([1234567.89, 7]);
		expect(list('numbers in "1,2345 and 12345,678"')).toEqual([1, 2345, 12345, 678]);
		expect(list('numbers in "a list 1,2,3"')).toEqual([1, 2, 3]);
	});

	test("a fraction may stand alone after a space or a currency sign, not after a word or a number", () => {
		expect(list('numbers in "costs .50 or $.75"')).toEqual([0.5, 0.75]);
		expect(list('numbers in "v1.2.3"')).toEqual([1.2, 3]);
	});

	test("a minus sign counts in front of a number, not between two words or numbers", () => {
		expect(list('numbers in "a -5 b 10-20 (−3) x-4 =-2"')).toEqual([-5, 10, 20, -3, 4, -2]);
		expect(list('numbers in "-0"')).toEqual([0]);
	});

	test("only the number is read: percentages, units, exponents and dates are their digits", () => {
		expect(list('numbers in "15% of 3 kg"')).toEqual([15, 3]);
		expect(list('numbers in "1.5e3"')).toEqual([1.5, 3]);
		expect(list('numbers in "2026-09-23 at 14:05"')).toEqual([2026, 9, 23, 14, 5]);
	});

	test("the text is read in the engine's number format, not guessed", () => {
		// German marks the decimal with a comma and groups with a point.
		expect(list('numbers in "Kaffee 3,20, Mittag 12,50, Taxi 18"', "de")).toEqual([3.2, 12.5, 18]);
		expect(list('numbers in "1.234,56 und 3.5"', "de")).toEqual([1234.56, 3, 5]);
		expect(shown('total of numbers in "Kaffee 3,20, Mittag 12,50, Taxi 18"', "de")).toBe("33.70");
		// The same text read as English is a different set of numbers.
		expect(list('numbers in "1.234,56"')).toEqual([1.234, 56]);
		// French groups with a space, and a copied French number carries a
		// narrow no-break space, which reads the same.
		expect(list('numbers in "Total 1 234,56 €"', "fr")).toEqual([1234.56]);
		expect(scanned("Total 1 234,56 €", "fr")).toEqual([{ value: 1234.56, currency: "EUR" }]);
		expect(list('numbers in "Total 1 234,56"')).toEqual([1, 234, 56]);
	});

	test("a list feeds the functions that take one", () => {
		expect(shown('sum(x, numbers in "1 2 3")')).toBe("6");
		expect(shown('map(x * 2, numbers in "1 2 3")')).toBe("[2, 4, 6]");
	});

	test("the text can come from a variable or another text form", () => {
		expect(list('numbers in field(query("a=1 2 3"), "a")')).toEqual([1, 2, 3]);
	});

	test("refusals: not text, and no numbers", () => {
		expect(errorCode("numbers in 42")).toBe(TextExtractionErrorCodes.TEXT_EXPECTED);
		expect(errorCode('numbers in "nothing here"')).toBe(TextExtractionErrorCodes.TEXT_NO_NUMBERS);
	});

	test("a big paste: up to the limit is read, past it is refused, and neither takes long", () => {
		const started = Date.now();
		expect(value(`count of numbers in ("7 " repeated ${MAX_NUMBERS_READ} times)`).toNumber()).toBe(MAX_NUMBERS_READ);
		expect(errorCode(`numbers in ("7 " repeated ${MAX_NUMBERS_READ + 1} times)`)).toBe(TextExtractionErrorCodes.TEXT_TOO_MANY_NUMBERS);
		expect(errorCode('total of numbers in ("7 " repeated 900000 times)')).toBe(TextExtractionErrorCodes.TEXT_TOO_MANY_NUMBERS);
		expect(Date.now() - started).toBeLessThan(5000);
	});
});

describe("amounts in", () => {
	test("a number with a currency sign or code beside it is an amount; any other number is not", () => {
		expect(list('amounts in "2 coffees £3.20, 1 cake £2.50"')).toEqual([3.2, 2.5]);
		expect(shown('total of amounts in "2 coffees £3.20, 1 cake £2.50"')).toBe("£5.70");
	});

	test("signs and codes, before or after, touching or one space away", () => {
		expect(scanned("€3.20 and 4 EUR and USD 5 and 6USD and 7 €")).toEqual([
			{ value: 3.2, currency: "EUR" },
			{ value: 4, currency: "EUR" },
			{ value: 5, currency: "USD" },
			{ value: 6, currency: "USD" },
			{ value: 7, currency: "EUR" },
		]);
	});

	test("a sign between two numbers goes to the one it touches, then to the one without a currency", () => {
		expect(scanned("2 £5 coffees")).toEqual([{ value: 2 }, { value: 5, currency: "GBP" }]);
		expect(scanned("5 USD 6 EUR")).toEqual([{ value: 5, currency: "USD" }, { value: 6, currency: "EUR" }]);
		expect(shown('total of amounts in "3,20 € 12,50 €"', "de")).toBe("€15.70");
	});

	test("a minus in front of the sign or after it makes the amount negative", () => {
		expect(list('amounts in "-£5 and £-6 and $7"')).toEqual([-5, -6, 7]);
	});

	test("only the common three-letter codes are read, since many capitals are also codes", () => {
		expect(errorCode('amounts in "TOP 10 ALL 3 AMD 7950X"')).toBe(TextExtractionErrorCodes.TEXT_NO_AMOUNTS);
		expect(list('amounts in "CHF 12 and 3 JPY"')).toEqual([12, 3]);
		expect(errorCode('amounts in "12 EURO"')).toBe(TextExtractionErrorCodes.TEXT_NO_AMOUNTS);
	});
});

describe("the aggregates over a text", () => {
	const numbers = "2, 4, 4, 4, 5, 5, 7, 9";
	test.each([
		"total of", "average of", "median of", "count of", "standard deviation of",
		"sample standard deviation of", "variance of", "sample variance of", "spread of", "mode of",
	])("%s numbers in X agrees with %s written out", (aggregate) => {
		expect(shown(`${aggregate} numbers in "${numbers}"`)).toBe(shown(`${aggregate} ${numbers}`));
	});

	test("sum of is total of", () => {
		expect(shown('sum of numbers in "1 and 2"')).toBe("3");
	});

	test("the aggregate keeps an amount's currency, and refuses a mix it has no rate for", () => {
		expect(shown('average of amounts in "$10, $20"')).toBe("$15.00");
		expect(errorCode('total of amounts in "€3 and $4"')).toBe("INCOMPATIBLE_UNITS");
		expect(shown('count of amounts in "$10, 20, $30"')).toBe("2");
	});

	test("an empty text has a count of zero and no other aggregate", () => {
		expect(shown('count of numbers in "no digits"')).toBe("0");
		expect(errorCode('total of numbers in "no digits"')).toBe(TextExtractionErrorCodes.TEXT_NO_NUMBERS);
		expect(errorCode('average of amounts in "no money"')).toBe(TextExtractionErrorCodes.TEXT_NO_AMOUNTS);
	});

	test("the text is the next value, so arithmetic after it applies to the aggregate", () => {
		expect(shown('total of numbers in "1 2 3" * 2')).toBe("12");
	});

	test("a list among other values is one value, and the aggregate says so", () => {
		expect(errorCode('total of 1, numbers in "2 3"')).toBe("AGGREGATE_NON_NUMERIC");
	});

	test("a non-text operand is refused by name", () => {
		expect(errorCode("total of numbers in 5")).toBe(TextExtractionErrorCodes.TEXT_EXPECTED);
	});
});

describe("match, matches and matchcount", () => {
	test("the order number from the issue", () => {
		expect(shown('match("Order #4471 shipped", "#(\\d+)")')).toBe("4471");
		expect(value('match("Order #4471 shipped", "#(\\d+)")').type).toBe(ValueType.String);
		expect(shown('match("Order #4471 shipped", "#(\\d+)") as number')).toBe("4,471");
	});

	test("the first group that took part, or the whole match when none did", () => {
		expect(shown('match("abc", "(x)|(b)")')).toBe("b");
		expect(shown('match("abc", "a(x)?b")')).toBe("ab");
		expect(shown('match("Total: £12.50 paid", "Total: (\\S+)")')).toBe("£12.50");
	});

	test("(?i) at the start ignores case", () => {
		expect(shown('match("TOTAL: 42", "(?i)total: (\\d+)")')).toBe("42");
		expect(errorCode('match("TOTAL: 42", "total")')).toBe(TextExtractionErrorCodes.TEXT_NO_MATCH);
	});

	test("matches answers whether the pattern occurs; matchcount how often", () => {
		expect(shown('matches("2026-09-23", "^\\d{4}-\\d{2}-\\d{2}$")')).toBe("true");
		expect(shown('matches("23/09/2026", "^\\d{4}")')).toBe("false");
		expect(shown('matchcount("GET 200, GET 404, POST 200", "\\b200\\b")')).toBe("2");
		expect(shown('matchcount("banana", "an")')).toBe("2");
	});

	test("a pattern the matcher does not run is refused by name", () => {
		expect(errorCode('match("abab", "(ab)\\1")')).toBe(TextExtractionErrorCodes.TEXT_PATTERN_UNSUPPORTED);
		expect(errorCode('match("abc", "a(?=b)")')).toBe(TextExtractionErrorCodes.TEXT_PATTERN_UNSUPPORTED);
		expect(errorCode('match("abc", "(a")')).toBe(TextExtractionErrorCodes.TEXT_PATTERN_INVALID);
		expect(errorCode('match("abc", "a{2000}")')).toBe(TextExtractionErrorCodes.TEXT_PATTERN_TOO_LARGE);
		expect(shown('match("abc", "(a")')).toContain('never closed');
	});

	test("arguments are checked: two of them, both text", () => {
		expect(errorCode('match("a1")')).toBe(TextExtractionErrorCodes.TEXT_ARGUMENT_COUNT);
		expect(errorCode('matchcount("a1", "a", "b")')).toBe(TextExtractionErrorCodes.TEXT_ARGUMENT_COUNT);
		expect(errorCode('matches("a1", 5)')).toBe(TextExtractionErrorCodes.TEXT_EXPECTED);
	});

	test("a pattern that backtracks exponentially elsewhere answers at once here", () => {
		const started = Date.now();
		expect(shown(`matches(("a" repeated 5000 times) + "!", "(a+)+$")`)).toBe("false");
		expect(shown(`matches("a" repeated 5000 times, "(a|aa)*b")`)).toBe("false");
		expect(Date.now() - started).toBeLessThan(3000);
	});

	test("the step budget is refused by name, and is shared by every call on one line", () => {
		expect(errorCode('matchcount("a" repeated 1000000 times, "a")')).toBe(TextExtractionErrorCodes.TEXT_PATTERN_TOO_COSTLY);
		// One of these is within the budget; three on one line are not.
		const one = 'matchcount("a" repeated 400000 times, "a")';
		expect(value(one).toNumber()).toBe(400000);
		expect(errorCode(`${one} + ${one} + ${one}`)).toBe(TextExtractionErrorCodes.TEXT_PATTERN_TOO_COSTLY);
	});

	test("the budget starts afresh on the next line", () => {
		const engine = newTrackedEngine();
		const one = 'matchcount("a" repeated 400000 times, "a")';
		expect(engine.evaluateLine(1, one).toNumber()).toBe(400000);
		expect(engine.evaluateLine(2, one).toNumber()).toBe(400000);
	});
});

describe("field", () => {
	const order = '"{\\"total\\": 12.5, \\"paid\\": true, \\"note\\": null, \\"items\\": [{\\"name\\": \\"tea\\", \\"price\\": 3}]}"';

	test("a number, text, a boolean, and an object or list as its JSON", () => {
		expect(shown(`field(${order}, "total")`)).toBe("12.50");
		expect(value(`field(${order}, "total")`).type).toBe(ValueType.Number);
		expect(shown(`field(${order}, "paid")`)).toBe("true");
		expect(shown(`field(${order}, "items[0].name")`)).toBe("tea");
		expect(shown(`field(${order}, "items.0.price")`)).toBe("3");
		expect(shown(`field(${order}, "items")`)).toBe('[{"name":"tea","price":3}]');
	});

	test("reads what jwt and query return", () => {
		const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
		expect(shown(`field(jwt("${token}"), "name")`)).toBe("John Doe");
		expect(value(`field(jwt("${token}"), "iat")`).toNumber()).toBe(1516239022);
		expect(shown('field(query("a=1&b=two"), "b")')).toBe("two");
		// A query string holds its values as text, so a count is converted
		// before it is added to (text in arithmetic is refused, #549).
		expect(shown('field(query("a=1&b=two"), "a") as number + 1')).toBe("2");
	});

	test("a missing field names what is there", () => {
		expect(shown(`field(${order}, "totl")`)).toContain('its fields are "total", "paid", "note", "items"');
		expect(errorCode(`field(${order}, "totl")`)).toBe(TextExtractionErrorCodes.TEXT_FIELD_NOT_FOUND);
		expect(shown(`field(${order}, "items[3]")`)).toContain("a list of 1, numbered 0 to 0");
		expect(errorCode(`field(${order}, "total.x")`)).toBe(TextExtractionErrorCodes.TEXT_FIELD_NOT_FOUND);
	});

	test("an inherited name is not a field", () => {
		expect(errorCode(`field(${order}, "constructor")`)).toBe(TextExtractionErrorCodes.TEXT_FIELD_NOT_FOUND);
		expect(shown('field("{\\"__proto__\\": 5}", "__proto__")')).toBe("5");
	});

	test("null, an inexact number, a bad path and text that is not JSON are refused", () => {
		expect(errorCode(`field(${order}, "note")`)).toBe(TextExtractionErrorCodes.TEXT_FIELD_NULL);
		expect(errorCode('field("{\\"id\\": 12345678901234567890}", "id")')).toBe(TextExtractionErrorCodes.TEXT_FIELD_INEXACT_NUMBER);
		expect(errorCode(`field(${order}, "a..b")`)).toBe(TextExtractionErrorCodes.TEXT_FIELD_PATH_INVALID);
		expect(errorCode(`field(${order}, "")`)).toBe(TextExtractionErrorCodes.TEXT_FIELD_PATH_INVALID);
		expect(errorCode('field("Total: 12", "Total")')).toBe(TextExtractionErrorCodes.TEXT_NOT_JSON);
		expect(errorCode('field("{\\"a\\":1}")')).toBe(TextExtractionErrorCodes.TEXT_ARGUMENT_COUNT);
		expect(errorCode('field(5, "a")')).toBe(TextExtractionErrorCodes.TEXT_EXPECTED);
	});

	test("JSON nested past what can be shown is refused, not thrown", () => {
		const deep = '("[" repeated 100000 times) + ("]" repeated 100000 times)';
		expect(errorCode(`field(${deep}, "[0]")`)).toBe(TextExtractionErrorCodes.TEXT_NOT_JSON);
	});

	test("the depth limit is the engine's, the same on every runtime (#621)", () => {
		// Node 26 reads a hundred thousand levels that Node 22 refuses, so the
		// limit is set here rather than left to the runtime's JSON.parse.
		const nested = (depth: number) => `("[" repeated ${depth} times) + "1" + ("]" repeated ${depth} times)`;
		expect(errorCode(`field(${nested(513)}, "[0]")`)).toBe(TextExtractionErrorCodes.TEXT_NOT_JSON);
		expect(value(`field(${nested(512)}, "[0]")`).type).not.toBe(ValueType.Error);
		// Brackets inside a string are text, not nesting.
		const inString = `"{\\"a\\": \\"" + ("[" repeated 2000 times) + "\\"}"`;
		expect(value(`field(${inString}, "a")`).type).toBe(ValueType.String);
	});
});

describe("in a document", () => {
	const source = [
		'receipt = "Coffee £3.20, lunch £12.50, taxi £18"',
		"total of amounts in receipt",
		"average of numbers in receipt",
		'request = "GET /api/orders 200 35ms"',
		'match(request, "(\\d+)ms") as number',
		'body = query("id=7&state=paid")',
		'field(body, "state")',
	].join("\n");

	test("the batch and incremental passes agree, value for value", () => {
		const batch = newTrackedEngine().parseDocument(source).lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		const incremental = evaluateDocument(newTrackedEngine(), source).lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		expect(batch).toEqual(incremental);
		expect(batch.slice(1, 3)).toEqual(["= £33.70", "= 11.23"]);
		expect(batch[4]).toBe("= 35");
		expect(batch[6]).toBe("= paid");
	});
});

describe("the words stay free", () => {
	test("numbers, amounts, match and field are still ordinary names", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "numbers = 5");
		expect(engine.evaluateLine(2, "numbers * 2").toNumber()).toBe(10);
		engine.evaluateLine(3, "match = 3");
		expect(engine.evaluateLine(4, "match + 1").toNumber()).toBe(4);
		engine.evaluateLine(5, "field = 2");
		expect(engine.evaluateLine(6, "field * field").toNumber()).toBe(4);
	});

	test("without the text package, the phrases are not read", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-text") });
		let answered = false;
		try {
			answered = slim.evaluateLine(1, 'total of numbers in "1 2"').toNumber() === 3;
		} catch {
			answered = false;
		}
		slim.clear();
		expect(answered).toBe(false);
	});
});
