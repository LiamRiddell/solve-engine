import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { readLocaleNumber, unreadableInLocale } from "@solve-js/parser/LocaleNumberLiteral";
import type { Value } from "@solve-js/vm/Value";

/**
 * Issues #805 and #806, found while fixing #654 to #657. An English engine read
 * a German number (`1.234,567`) by dropping its comma, 1.23. A German engine let
 * a first group longer than three digits through (`12345.678` was twelve
 * million), and read a frame rate's number the English way (`2.5 fps` was 2.5
 * frames a second, where `2.5` alone is refused).
 */

function answer(locale: string, text: string): string {
	try {
		return formatValue(createEngine({ locale }).evaluateExpression(text) as Value);
	} catch (error) {
		return `refused: ${(error as { code?: string }).code}`;
	}
}

describe("unreadableInLocale", () => {
	test.each([
		["1.234,567", ".", ",", "grouped-decimal"],
		["1,234.567", ".", ",", null],
		["1.5", ".", ",", null],
		["12345.678", ",", ".", "misplaced-group"],
		["1234.567", ",", ".", "misplaced-group"],
		["123.456", ",", ".", null],
		["-12345.678", ",", ".", "misplaced-group"],
		["12345.678", ",", " ", null],
	])("%s with decimal %j and grouping %j is %j", (raw, decimal, group, expected) => {
		expect(unreadableInLocale(raw, decimal, group)).toBe(expected);
	});
});

describe("readLocaleNumber", () => {
	test("reads a number in its locale", () => {
		expect(readLocaleNumber("2.500", "de")).toBe(2500);
		expect(readLocaleNumber("2.5", "en")).toBe(2.5);
		expect(readLocaleNumber("1,234.5", "en")).toBe(1234.5);
	});

	test("refuses what the locale cannot read", () => {
		expect(() => readLocaleNumber("2.5", "de")).toThrow(/is not a number in the de locale/);
		expect(() => readLocaleNumber("1.234,567", "en")).toThrow(/is not a number in the en locale/);
	});
});

describe("the engine", () => {
	test.each([
		["en", "1.234,567", "refused: INVALID_NUMBER_LITERAL"],
		["en", "1,234.567", "= 1,234.57"],
		["de", "12345.678", "refused: INVALID_NUMBER_LITERAL"],
		["de", "12345.678.901", "refused: INVALID_NUMBER_LITERAL"],
		["de", "123.456", "= 123,456"],
		["de", "1.234.567", "= 1,234,567"],
		["de", "2.5 fps", "refused: INVALID_NUMBER_LITERAL"],
		["de", "2.500 fps", "= 2,500.00 frames/s"],
		["en", "29.97 fps", "= 29.97 frames/s"],
		["fr", "12345.678", "= 12,345.68"],
	])("%s: %s", (locale, text, expected) => {
		expect(answer(locale, text)).toBe(expected);
	});

	test("a comma inside a list or a call is a separator, not a group", () => {
		expect(answer("en", "[1.5,234]")).toBe("= [1.50, 234]");
		expect(answer("en", "max(1.5,234)")).toBe("= 234");
	});

	test("the refusal names the locale and the rule", () => {
		try {
			createEngine({ locale: "de" }).evaluateExpression("12345.678");
			throw new Error("not refused");
		} catch (error) {
			expect((error as Error).message).toBe('"12345.678" is not a number in the de locale: "." groups thousands there, in threes, as in 12.345.678.');
		}
	});
});
