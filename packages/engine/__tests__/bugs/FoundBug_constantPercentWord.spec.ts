import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { RATE_BEFORE, percentWordNormalizerRule } from "@solve-js/packages/percentage/normalizer/PercentWordNormalizerRules";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `pi percent` was a parse error ("Expected an operator or the end
 * of the line, but found "percent""), while `pi%` and `5 percent` answered.
 * The rule that reads the word `percent` as the `%` sign took it only after a
 * number, a bracket or a name, and `pi`, `e`, `tau`, `phi`, `golden ratio`,
 * `∞` and `prev` each lex as a token of their own. `π`, which lexes as a name,
 * always worked. The rule now reads the word after each of those as it reads
 * it after a number, and after a constant with a unit (`gravity`), which then
 * meets the refusal `%` gives it rather than a parse error.
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

function token(type: string, value: string, offset: number): Token {
	return new LexerToken(type, tokenTypeId(type), value, value, offset, 0, 1, offset + 1);
}

describe("the lines that exposed it", () => {
	test.each([
		["pi percent", "pi%", "3.14%"],
		["e percent", "e%", "2.72%"],
		["tau percent", "tau%", "6.28%"],
		["phi percent", "phi%", "1.62%"],
		["golden ratio percent", "golden ratio%", "1.62%"],
		["π percent", "π%", "3.14%"],
		["pi percentage", "pi%", "3.14%"],
		["PI percent", "PI%", "3.14%"],
		["pi PERCENT", "pi%", "3.14%"],
		["pi percent of 200", "pi% of 200", "6.28"],
		["200 + pi percent", "200 + pi%", "206.28"],
		["200 - e percent", "200 - e%", "194.56"],
		["pi percent off 200", "pi% off 200", "193.72"],
		["-pi percent", "-pi%", "-3.14%"],
		["pi percent of $50", "pi% of $50", "$1.57"],
		["100 km + pi percent", "100 km + pi%", "103.14 km"],
	])("%s answers as %s does", (words, sign, answer) => {
		expect(shown(words)).toBe(shown(sign));
		expect(shown(words)).toBe(answer);
	});

	test("a number before the constant binds as it does with the sign", () => {
		expect(shown("2 pi percent")).toBe(shown("2 pi%"));
		expect(shown("(2 pi) percent")).toBe("6.28%");
	});

	test("the converter after as, in and to is unchanged", () => {
		expect(shown("pi as percent")).toBe("314.16%");
		expect(shown("pi in percent")).toBe("314.16%");
		expect(shown("e as percentage")).toBe("271.83%");
		expect(shown("pi percent as %")).toBe("3.14%");
	});

	test("prev and ans are the line above, through both passes", () => {
		expect(both(["7", "prev percent", "ans percent"])).toEqual(["7", "7.00%", "0.07%"]);
		expect(both(["7", "prev percent of 200"])).toEqual(["7", "14"]);
	});

	test("on its own, prev percent says it needs a document, as prev does", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateLine(1, "prev percent");
		expect(value.type).toBe(ValueType.Error);
		expect(formatValue(value).toLowerCase()).toContain("document");
	});

	test("a constant with a unit meets the refusal the sign gives, not a parse error", () => {
		expect(shown("gravity percent")).toBe(shown("gravity%"));
		expect(shown("gravity percent")).toMatch(/^An acceleration is not a proportion/);
		expect(shown("speed of light percent")).toBe(shown("speed of light%"));
		expect(shown("boltzmann percent")).toBe(shown("boltzmann%"));
	});

	test("an infinity before the word is refused as the sign refuses it", () => {
		expect(shown("∞ percent")).toBe(shown("∞%"));
		expect(shown("∞ percent")).toMatch(/^This is too large to write as a percentage/);
	});
});

describe("the parts: RATE_BEFORE and percentWordNormalizerRule", () => {
	const rule = percentWordNormalizerRule();

	test("ordinary: a constant before the word gives the sign", () => {
		for (const type of ["PI", "E", "TAU", "PHI", "GOLDEN_RATIO", "INFINITY_SIGN", "PREV", "GRAVITY"]) {
			expect(RATE_BEFORE.has(type)).toBe(true);
			const match = rule.match([token(type, "c", 0), token("CONVERTER_NAME", "percent", 3)], 0);
			expect({ type, consumed: match?.consumed, sign: match?.replacement[1].type }).toEqual({ type, consumed: 2, sign: "PERCENT" });
		}
	});

	test("boundary: the number, bracket and name it always took are kept, and the conversion keyword still is not", () => {
		for (const type of ["NUMBER", "RPAREN", "IDENT"]) expect(rule.match([token(type, "5", 0), token("CONVERTER_NAME", "percent", 2)], 0)).not.toBeNull();
		for (const type of ["AS", "IN", "TO", "PLUS", "STAR"]) {
			expect({ type, match: rule.match([token(type, "as", 0), token("CONVERTER_NAME", "percent", 3)], 0) }).toEqual({ type, match: null });
		}
		// A word other than percent after a constant is not touched.
		expect(rule.match([token("PI", "pi", 0), token("CONVERTER_NAME", "hex", 3)], 0)).toBeNull();
		// Nothing after the constant.
		expect(rule.match([token("PI", "pi", 0)], 0)).toBeNull();
	});

	test("hostile: a prototype word as the token type or the word is not matched", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(RATE_BEFORE.has(word)).toBe(false);
			expect(rule.match([token("PI", "pi", 0), token("CONVERTER_NAME", word, 3)], 0)).toBeNull();
		}
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`${word} percent`, `pi percent of ${word}`, `${word} + pi percent`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a look-alike of pi is its own name, refused under its own spelling", () => {
		// Greek capital pi, the pi symbol variant, and a Cyrillic р.
		expect(shown("Π percent")).toBe("THROWS Undefined variable: Π");
		expect(shown("ϖ percent")).toBe("THROWS Undefined variable: ϖ");
		expect(shown("рi percent")).toMatch(/^THROWS Undefined variable: рi/);
	});

	test("a long sum of constant percentages is answered in time", () => {
		const line = Array.from({ length: 300 }, () => "pi percent").join(" + ");
		expectHonestLine(line, { budgetMs: 5_000 });
	});

	test.each(fill("pi percent X", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the word: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around the word is read as text", () => {
		expectHonestLine("<b>pi percent</b>");
		expectHonestLine("pi percent <script>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo of the constant or the word is refused, never read as a percentage of something else", () => {
		expect(shown("pie percent")).toMatch(/^THROWS Undefined variable: pie/);
		expect(shown("pi percnt")).toMatch(/^THROWS/);
	});

	test("a constant percentage from the line above, under a check and in a what-if", () => {
		expect(both(["r = pi percent", "200 + r"])).toEqual(["3.14%", "206.28"]);
		expectHonestDocument("r = pi percent\n200 + r\ncheck line 2 > 206");
		expect(both(["r = pi percent", "200 + r", "check line 2 > 206"])[2]).toMatch(/✓/);
		expectHonestDocument("base = 200\nbase + pi percent\nline 2 with base = 100");
	});

	test("a note that gives π a value of its own keeps it", () => {
		expect(both(["π = 50", "π percent"])).toEqual(["50", "50.00%"]);
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("X * pi percent", NUMERIC_EDGES))("a numeric edge times a constant percentage: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test.each(fill("X\nprev percent\nans percent of 200", NUMERIC_EDGES))("prev after a numeric edge: %j", (text) => {
		expectHonestDocument(text, { allowNaN: text.includes("0/0") });
	});

	test("prev at the top of a note, after a blank line, and with CRLF endings", () => {
		const [top] = both(["prev percent"]);
		expect(top).toMatch(/has not been evaluated yet|needs a document/);
		expectHonestDocument("5\n\nprev percent");
		expect(both(["5\r", "prev percent\r", ""])[1]).toBe("5.00%");
	});

	test("zero and negative zero before the constant", () => {
		expect(shown("0 * pi percent")).toBe("0");
		expect(shown("-0 * pi percent")).toBe(shown("-0 * pi%"));
	});
});
