import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { withUnit } from "@solve-js/packages/converters/NumberNotation";
import { reversedConversionNormalizerRule } from "@solve-js/packages/uom/normalizer/ReversedConversionNormalizerRule";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

/**
 * Two faults found beside the unit-algebra issues (#737, #738, #758, #834).
 *
 * - `$15/hour as compact` wrote `15 USD/hour`: `as compact` and `as
 *   engineering` looked the whole rate unit up in the currency display table,
 *   where `USD/hour` is not a currency, so a price per unit lost its symbol
 *   though the full answer (`$15.00/hour`) has it. The short form is now
 *   written as the full one is (`NumberNotation.ts`'s `withUnit`).
 * - `km in -1 mile`, the reversed conversion with a signed count, threw
 *   `Undefined variable: km`: the rule read only an unsigned number after
 *   `in`, so it did not match and the leading unit was read as a variable. A
 *   sign in front of the count is now kept in front of it (`-1 mile in km`).
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function token(type: string, value: string): Token {
	return new LexerToken(type, tokenTypeId(type), value, value, 0, 0, 1, 1);
}

describe("a price per unit keeps its symbol when written short", () => {
	test.each([
		["$15/hour as compact", "= $15/hour"],
		["$15 per hour as compact", "= $15/hour"],
		["-$1500/month as compact", "= -$1.5k/month"],
		["£1200/month as compact", "= £1.2k/month"],
		["$15/hour as engineering", "= $15e+0/hour"],
		["$3300000 as compact", "= $3.3M"],
		["-$1500 as compact", "= -$1.5k"],
		["5000 m as compact", "= 5k m"],
		["15 SEK/hour as compact", "= 15 SEK/hour"],
		["5000 km/h as compact", "= 5k km/h"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("withUnit", () => {
	test("money with its symbol, a rate with its unit after a slash", () => {
		expect(withUnit("3.3M", "USD")).toBe("$3.3M");
		expect(withUnit("-1.5k", "USD")).toBe("-$1.5k");
		expect(withUnit("15", "USD/hour")).toBe("$15/hour");
		expect(withUnit("-15", "GBP/hour")).toBe("-£15/hour");
		expect(withUnit("15", "usd/hour")).toBe("$15/hour");
	});

	test("a currency with no prefix symbol keeps its code, and any other unit follows a space", () => {
		expect(withUnit("15", "SEK/hour")).toBe("15 SEK/hour");
		expect(withUnit("5k", "m")).toBe("5k m");
		expect(withUnit("5k", "km/h")).toBe("5k km/h");
		expect(withUnit("5", "/s")).toBe("5 /s");
	});

	test("a word naming an inherited property is an ordinary unit", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(withUnit("5", word)).toBe(`5 ${word}`);
				expect(withUnit("5", `${word}/hour`)).toBe(`5 ${word}/hour`);
			}
		});
	});
});

describe("a reversed conversion with a signed count", () => {
	test.each([
		["km in -1 mile", "= -1.61 km"],
		["km in - 1 mile", "= -1.61 km"],
		["km in +2 miles", "= 3.22 km"],
		["km in -0 mile", "= 0.00 km"],
		["days in -3 weeks", "= -21 days"],
		["km in 1 mile", "= 1.61 km"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("it asks the forward question", () => {
		expect(shown("km in -1 mile")).toBe(shown("-1 mile in km"));
	});

	test("the rule keeps the sign in front of the count", () => {
		const rule = reversedConversionNormalizerRule();
		const match = rule.match([token("UNIT", "km"), token("IN", "in"), token("MINUS", "-"), token("NUMBER", "1"), token("UNIT", "mile")], 0);
		expect(match?.replacement.map((t) => t.value)).toEqual(["-", "1", "mile", "in", "km"]);
		expect(match?.consumed).toBe(5);
	});

	test("and declines a sign with no count, two signs, or a sign before a word", () => {
		const rule = reversedConversionNormalizerRule();
		expect(rule.match([token("UNIT", "km"), token("IN", "in"), token("MINUS", "-"), token("UNIT", "mile")], 0)).toBeNull();
		expect(rule.match([token("UNIT", "km"), token("IN", "in"), token("MINUS", "-"), token("MINUS", "-"), token("NUMBER", "1"), token("UNIT", "mile")], 0)).toBeNull();
		expect(rule.match([token("UNIT", "km"), token("IN", "in"), token("MINUS", "-"), token("NUMBER", "1"), token("IDENT", "constructor")], 0)).toBeNull();
		expect(rule.match([token("NUMBER", "5"), token("UNIT", "km"), token("IN", "in"), token("MINUS", "-"), token("NUMBER", "1"), token("UNIT", "mile")], 1)).toBeNull();
	});
});

describe("adversarial", () => {
	test.each([...fill("km in -1 X", PROTOTYPE_WORDS), ...fill("$15/X as compact", PROTOTYPE_WORDS)])("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test.each([...fill("$X/hour as compact", NUMERIC_EDGES), ...fill("km in -X mile", NUMERIC_EDGES)])("%s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("text edges, and both document passes", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`km in -1 mile ${edge}`);
		const { batch } = expectHonestDocument("pay = $15/hour\npay as compact\nkm in -1 mile");
		expect(batch).toEqual(["= $15.00/hour", "= $15/hour", "= -1.61 km"]);
	});
});
