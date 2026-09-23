/**
 * Values with no single amount, in the places that used to read one anyway.
 *
 * `Value.toNumber()` answers 0 for a list, a colour or a piece of text with no
 * leading digits, and the parsed leading digits for text that has some. Three
 * places took that reading as the value: a list cell (`[(1, 2), 3]` was
 * `[0, 3]`, issue #546), a conversion (`(1, 2) in miles` was `0.00 miles`,
 * issue #547), and arithmetic with text (`"11:00 PM" + 2` was 13, issue #549).
 * Each is now a named error, the way an aggregate has refused the same values
 * since #530.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";

/** One line through a real engine. */
function evaluate(source: string): Value {
	return newTrackedEngine().evaluateExpression(source);
}

/** The error code a line answers with, failing when it answers a value. */
function codeOf(source: string): string {
	const value = evaluate(source);
	if (value.type !== ValueType.Error) throw new Error(`expected "${source}" to be refused, got ${formatValue(value)}`);
	return value.errorCode ?? "";
}

describe("a list cell holds one number (#546)", () => {
	test("a list inside a list is refused, not read as 0", () => {
		expect(codeOf("[(1, 2), 3]")).toBe("MATRIX_CELL_NON_NUMERIC");
		expect(evaluate("[(1, 2), 3]").errorMessage).toMatch(/cannot hold a list inside it/);
	});

	test("so is text, a date, a colour", () => {
		expect(evaluate('["a", 1]').errorMessage).toMatch(/^Text cannot be a cell of a list/);
		expect(codeOf("[today, 1]")).toBe("MATRIX_CELL_NON_NUMERIC");
		expect(codeOf("[#ff0000, 1]")).toBe("MATRIX_CELL_NON_NUMERIC");
	});

	test("numbers, booleans and quantities are still cells", () => {
		expect(formatValue(evaluate("[1, 2, 3]"))).toBe("= [1, 2, 3]");
		expect(formatValue(evaluate("[true, 1]"))).toBe("= [true, 1]");
		expect(evaluate("[1 + 1, 2 * 3]").type).toBe(ValueType.Matrix);
	});
});

describe("a conversion needs a single amount (#547)", () => {
	test("a list converted to a unit is refused, not 0 of that unit", () => {
		expect(codeOf("(1, 2) in miles")).toBe("CONVERT_NON_NUMERIC");
		expect(evaluate("(1, 2) in miles").errorMessage)
			.toBe("A bracketed list has no single amount to convert to miles: only a number or a quantity can be converted.");
	});

	test("so is text", () => {
		expect(codeOf('"hi" in m')).toBe("CONVERT_NON_NUMERIC");
	});

	test("a number, a quantity and a date still convert", () => {
		expect(formatValue(evaluate("5 km in miles"))).toBe("= 3.11 miles");
		expect(formatValue(evaluate("5 in km"))).toBe("= 5.00 km");
		expect(evaluate("2026-04-03 in Tokyo").type).toBe(ValueType.Datetime);
	});
});

describe("text in arithmetic is refused (#549)", () => {
	test("a quoted time plus a number is not the time's leading digits plus it", () => {
		expect(codeOf('"11:00 PM" + 2')).toBe("TEXT_ARITHMETIC");
		expect(evaluate('"11:00 PM" + 2').errorMessage)
			.toBe("Text and a number cannot be added: + joins text only to other text. Write the number without quotes to add it.");
	});

	test("on either side, and for every operator", () => {
		for (const source of ['"hello" + 5', '5 + "hello"', '"5" + 5', '"5" - 1', '"5" * 2', '10 / "2"', '"7" mod 2']) {
			expect(codeOf(source)).toBe("TEXT_ARITHMETIC");
		}
	});

	test("text still joins to text", () => {
		expect(evaluate('"hello" + " world"').value).toBe("hello world");
	});

	test("and a number without quotes is still arithmetic", () => {
		expect(evaluate("5 + 5").toNumber()).toBe(10);
	});
});
