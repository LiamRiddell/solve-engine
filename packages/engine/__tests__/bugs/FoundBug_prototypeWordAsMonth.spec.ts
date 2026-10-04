import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { monthNameDateNormalizerRule } from "@solve-js/packages/datetime/normalizer/MonthNameDateNormalizerRule";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

/**
 * Found bug: `5 constructor` and `5 __proto__/m^3` answered "not a real date:
 * undefined 2026 has NaN days". The rule that reads `5 March` as a date looked
 * the word up in its month table without an own-property guard, so a word that
 * names an inherited property found `Object.prototype.constructor` (a
 * function) or the prototype itself instead of missing, and the day check ran
 * on a month that was not a number.
 *
 * The lookup now reads own keys only, in the date rule and in the stocks
 * package's date phrase, which had the same shape. A prototype word after a
 * number is an ordinary name again, and an undefined one says so.
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
		["5 constructor", "THROWS Undefined variable: constructor"],
		["5 __proto__/m^3", "THROWS Undefined variable: __proto__"],
		["5 toString", "THROWS Undefined variable: toString"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("no prototype word after a number is read as a month", () => {
		for (const word of PROTOTYPE_WORDS) {
			for (const line of [`5 ${word}`, `5 ${word} 2026`, `${word} 5`, `${word} 5, 2026`, `5 ${word}/m^3`]) {
				expect({ line, month: /not a real date|NaN days|undefined \d/.test(shown(line)) }).toEqual({ line, month: false });
			}
		}
	});

	test("real months still read", () => {
		expect(shown("5 march 2026")).toBe("Thursday, March 5, 2026");
		expect(shown("31 feb 2026")).toBe('"31 feb 2026" is not a real date: February 2026 has 28 days.');
	});
});

describe("monthNameDateNormalizerRule, the part that read the inherited key", () => {
	const rule = monthNameDateNormalizerRule();

	test("an ordinary month fuses", () => {
		const match = rule.match([token("NUMBER", "5", 0), token("IDENT", "march", 2), token("NUMBER", "2026", 8)], 0);
		expect(match).not.toBeNull();
	});

	test("every prototype word declines, in either order", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(rule.match([token("NUMBER", "5", 0), token("IDENT", word, 2)], 0)).toBeNull();
			expect(rule.match([token("IDENT", word, 0), token("NUMBER", "5", word.length + 1)], 0)).toBeNull();
		}
	});

	test("boundary arguments decline rather than throw", () => {
		expect(rule.match([], 0)).toBeNull();
		expect(rule.match([token("NUMBER", "5", 0)], 0)).toBeNull();
		expect(rule.match([token("NUMBER", "5", 0), token("IDENT", "", 2)], 0)).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: every prototype word, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`5 ${word}`);
				expectHonestLine(`5 ${word} 2026`);
				expectHonestDocument(`${word} = 3\n5 ${word}`);
			}
		});
	});

	test("security: look-alike and markup-shaped text after the day", () => {
		for (const line of fill("5 X 2026", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a variable named like a property, used after a number", () => {
		const { batch, incremental } = expectHonestDocument("valueOf = 3\n5 * valueOf");
		expect(batch[1]).toBe("= 15");
		expect(incremental).toEqual(batch);
	});

	test("edge: numeric edges as the day before a prototype word", () => {
		for (const line of fill("X constructor", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
