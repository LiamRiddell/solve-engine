import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { valueKindName } from "@solve-js/vm/VMConversion";
import { sourceTextOf } from "@solve-js/packages/datetime/normalizer/NthWeekdayNormalizerRule";
import { safeText } from "@solve-js/parser/ParseMessages";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId } from "@solve-js/lexer/Token";
import {
	Value, ValueType, numberValue, uomValue, percentageValue, boolValue, stringValue, errorValue, bigIntValue, symbolicValue, datetimeValue,
} from "@solve-js/vm/Value";

/**
 * Found bug: three refusals showed the reader what the engine calls things
 * rather than what the reader wrote.
 *
 * - The date and working-day refusals named the value's internal type: `workdays
 *   between 5 and 10` said "got Number and Number", `workdays between 5 m and
 *   10` "got Uom and Number". They now name the kind in words
 *   (`valueKindName`): "a number", "an amount in m".
 * - An undefined name was printed as typed, so a direction override (U+202E)
 *   inside it reversed the rest of the message on screen. It is now written as
 *   its code point, `<U+202E>`, by the same `safeText` every parse message uses.
 * - `the 2nd tuesday of 5` quoted "2:2", the fused token's internal value
 *   (ordinal and weekday), because the token's text was set to its value. The
 *   text is now the words the reader wrote (`sourceTextOf`).
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function token(type: string, text: string, offset: number): LexerToken {
	return new LexerToken(type, tokenTypeId(type), text, text, offset, 0, 1, offset + 1);
}

/** The internal type names a message must never carry. */
const INTERNAL_TYPE = /\b(?:got|but got) (?:Number|Uom|Datetime|String|Percentage|Boolean|Matrix|Symbolic|BigInt|Hex|Range|Colour|Split|Chart|IpCidr|Pending|Error)\b/;

describe("the lines that exposed it", () => {
	test.each([
		["workdays between 5 and 10", '"working days between" expects two dates, but got a number and a number.'],
		["workdays between 5 m and 10", '"working days between" expects two dates, but got an amount in m and a number.'],
		["2nd tuesday of 5", '"nth weekday of month" expects a date, but got a number.'],
		["the 2nd tuesday of 5", 'THROWS Expected an operator or the end of the line, but found "2nd tuesday"'],
		["‮foo + 1", "THROWS \"<U+202E>foo\" holds U+202E (right-to-left override), an invisible character that changes the direction text is shown in, so it would not read as what it is. A name, a number or a unit cannot hold one: delete it and type the word again."],
	])("%s says %s", (line, message) => {
		expect(shown(line)).toBe(message);
	});

	test("no date or working-day refusal names an internal type", () => {
		const lines = [
			"workdays between 5 and 10", "workdays between 5 m and 10", "workdays between 5% and true", "workdays between \"a\" and [1, 2]",
			"2nd tuesday of 5", "2nd tuesday of 5 kg", "2nd tuesday of true", "2nd tuesday of \"March\"",
		];
		for (const line of lines) expect({ line, internal: INTERNAL_TYPE.test(shown(line)) }).toEqual({ line, internal: false });
	});
});

describe("the parts", () => {
	test("valueKindName: ordinary kinds", () => {
		expect(valueKindName(numberValue(5))).toBe("a number");
		expect(valueKindName(uomValue(5, "m"))).toBe("an amount in m");
		expect(valueKindName(percentageValue(0.05))).toBe("a percentage");
		expect(valueKindName(boolValue(true))).toBe("true or false");
		expect(valueKindName(stringValue("a"))).toBe("text");
		expect(valueKindName(datetimeValue(0))).toBe("a date or time");
		expect(valueKindName(symbolicValue({ kind: "var", name: "x" }))).toBe("an unknown");
		expect(valueKindName(bigIntValue(5n))).toBe("a whole number");
	});

	test("valueKindName: boundary and hostile values", () => {
		expect(valueKindName(errorValue("X", "y"))).toBe("an error");
		expect(valueKindName(new Value(ValueType.Uom, 5))).toBe("a number");
		expect(valueKindName(new Value(99 as ValueType, 5))).toBe("a value of another kind");
		for (const word of PROTOTYPE_WORDS) expect(valueKindName(uomValue(1, word))).toBe(`an amount in ${word}`);
	});

	test("sourceTextOf: the words as written, with their spacing", () => {
		expect(sourceTextOf([token("NUMBER", "2", 4), token("UNIT", "nd", 5), token("TUESDAY", "tuesday", 8)])).toBe("2nd tuesday");
		expect(sourceTextOf([token("LAST", "last", 0), token("FRIDAY", "Friday", 7)])).toBe("last   Friday");
		expect(sourceTextOf([])).toBe("");
		expect(sourceTextOf([token("NUMBER", "2", 0), token("UNIT", "nd", 10_000)]).length).toBe(1 + 64 + 2);
	});

	test("safeText writes invisible and direction characters as code points", () => {
		expect(safeText("‮foo")).toBe("<U+202E>foo");
		expect(safeText("a​b")).toBe("a<U+200B>b");
		expect(safeText("plain")).toBe("plain");
	});
});

describe("adversarial", () => {
	test("security: prototype words as the name, the count or the month", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} + 1`);
				expectHonestLine(`workdays between ${word} and 10`);
				expectHonestLine(`2nd tuesday of ${word}`);
			}
		});
	});

	test("security: every look-alike character in an undefined name is shown, not obeyed", () => {
		for (const ch of ["‮", "‭", "⁦", "⁩", "‏", "﻿"]) {
			const text = shown(`${ch}foo + 1`);
			expect({ ch: ch.codePointAt(0), raw: text.includes(ch) }).toEqual({ ch: ch.codePointAt(0), raw: false });
		}
		for (const line of fill("workdays between X and 10", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: the value from the line above, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("start = 5\nworkdays between start and 10");
		expect(batch[1]).toBe('ERROR "working days between" expects two dates, but got a number and a number.');
		expect(incremental[1]).toBe(batch[1]);
		expectHonestDocument("m = 5\n2nd tuesday of m");
	});

	test("edge: numeric edges as the dates", () => {
		for (const line of fill("workdays between X and 10", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("2nd tuesday of X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
