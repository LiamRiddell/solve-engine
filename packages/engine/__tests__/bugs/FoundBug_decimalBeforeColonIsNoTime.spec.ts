import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { clockTimeNormalizerRule, isClockDigits } from "@solve-js/packages/time/normalizer/ClockTimeNormalizerRule";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

/**
 * Found bug: `1.5:3` answered the time 1:03. The clock-time rule read each half
 * with `parseInt`, which keeps the whole part of a decimal and drops the rest,
 * so `1.5` was the hour 1. Both halves of a clock time are now whole numbers as
 * written (`isClockDigits`: one or two plain digits); a decimal on either side
 * is not read as a time, and the line is refused as the time it is not.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function token(type: string, text: string, offset: number): Token {
	return new LexerToken(type, tokenTypeId(type), text, text, offset, 0, 1, offset + 1);
}

describe("the lines that exposed it", () => {
	test.each([
		["1.5:3", 'THROWS "1.5:3" is not a valid time'],
		["1:3.5", 'THROWS "1:3.5" is not a valid time'],
		["1.5:30", 'THROWS "1.5:30" is not a valid time'],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("whole-number times still read", () => {
		expect(shown("12:30")).toMatch(/12:30:00 PM$/);
		expect(shown("9:05am")).toMatch(/9:05:00 AM$/);
		expect(shown("1:3")).toMatch(/1:03:00 AM$/);
		expect(shown("3.30pm")).toMatch(/3:30:00 PM$/);
	});
});

describe("the parts", () => {
	test("isClockDigits: one or two plain digits only", () => {
		expect(isClockDigits({ text: "9", value: "9" })).toBe(true);
		expect(isClockDigits({ text: "09", value: "9" })).toBe(true);
		expect(isClockDigits({ text: "30", value: "30" })).toBe(true);
		expect(isClockDigits({ text: "1.5", value: "1.5" })).toBe(false);
		expect(isClockDigits({ text: "123", value: "123" })).toBe(false);
		expect(isClockDigits({ text: "1e1", value: "10" })).toBe(false);
		expect(isClockDigits({ text: "-1", value: "-1" })).toBe(false);
		expect(isClockDigits({ text: "", value: "5" })).toBe(true);
		expect(isClockDigits({ text: "", value: "" })).toBe(false);
		expect(isClockDigits({ text: "٥", value: "5" })).toBe(false);
	});

	test("the rule declines a decimal on either side, and fuses a whole-number time", () => {
		const rule = clockTimeNormalizerRule();
		expect(rule.match([token("NUMBER", "1.5", 0), token("COLON", ":", 3), token("NUMBER", "3", 4)], 0)).toBeNull();
		expect(rule.match([token("NUMBER", "1", 0), token("COLON", ":", 1), token("NUMBER", "3.5", 2)], 0)).toBeNull();
		expect(rule.match([token("NUMBER", "1", 0), token("COLON", ":", 1), token("NUMBER", "30", 2)], 0)?.replacement[0].value).toBe("90");
		expect(rule.match([token("NUMBER", "1", 0)], 0)).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: prototype words either side of the colon", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`1.5:${word}`);
				expectHonestLine(`${word}:3`);
			}
		});
	});

	test("security: look-alike digits and markup-shaped text", () => {
		for (const line of fill("1.5:X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of ["١.٥:٣", "１.５:３", "1.5:3".repeat(200)]) expectHonestLine(line);
	});

	test("realistic: a ratio-shaped line and a range in brackets are left alone, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("x = 1.5\n[1, 2, 3, 4][1:2]\n1.5:3");
		expect(incremental).toEqual(batch);
		expect(batch[2]).toBe('ERROR "1.5:3" is not a valid time');
	});

	test("edge: numeric edges on each side", () => {
		for (const line of fill("X:30", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("1:X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("0.0:00")).toBe('THROWS "0.0:00" is not a valid time');
	});
});
