import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ExpressionLexer, spaceGroupEnd, withoutGroupSpaces } from "@solve-js/lexer/ExpressionLexer";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Issue #740: most of continental Europe writes one and a half as `1,5`, and the
 * engine refused it in every locale, `de` and `fr` included, whose packs declare
 * a comma decimal. Inside a call the comma was always an argument separator, so
 * under `de` a reader's `max(1,5, 2)` answered 5.
 *
 * Under a comma-decimal pack a comma between two digits is now the decimal
 * comma, inside a call or a bracket as much as outside one. Arguments are
 * separated by `;` (as a spreadsheet in that locale does) or by a comma with a
 * space after it, and a `[...]` separates its rows with `;` as before. A French
 * engine also reads thousands grouped with a space. An English engine is
 * unchanged.
 */

function show(line: string, locale = "de"): string {
	try {
		return formatValue(newTrackedEngine({ locale }).evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function tokens(line: string, locale: string): string[] {
	const lexer = new ExpressionLexer(locale);
	lexer.reset(line);
	return lexer.tokenizeAll().map((t) => `${t.type}:${t.value}`);
}

describe("the issue's lines, each comma-decimal locale against en", () => {
	test.each([
		// line, en, de, fr
		["1,5 + 1", 'THROWS Expected an operator or the end of the line, but found ","', "2.50", "2.50"],
		["2,5", 'THROWS Expected an operator or the end of the line, but found ","', "2.50", "2.50"],
		["1,5 km + 500 m", 'THROWS Expected an operator or the end of the line, but found ","', "2.00 km", "2.00 km"],
		["€9,99 * 2", 'THROWS Expected an operator or the end of the line, but found ","', "€19.98", "€19.98"],
		["max(1,5, 2)", "5", "2", "2"],
		["max(1,5; 2)", 'THROWS Expected ")", but found ";"', "2", "2"],
		["1,500", "1,500", "1.50", "1.50"],
	])("%s", (line, en, de, fr) => {
		expect(show(line, "en")).toBe(en);
		expect(show(line, "de")).toBe(de);
		expect(show(line, "fr")).toBe(fr);
	});

	test("a regional tag reads as its language", () => {
		for (const tag of ["de-DE", "de-AT", "de_CH", "fr-FR", "fr-CA"]) {
			expect(show("1,5 + 1", tag)).toBe("2.50");
			expect(show("max(1,5; 2)", tag)).toBe("2");
		}
	});

	test("a tag with no pack of its own reads as English, as before", () => {
		for (const tag of ["es", "it", "nl", "xx"]) {
			expect(show("max(1,5, 2)", tag)).toBe("5");
			expect(show("1,500", tag)).toBe("1,500");
		}
	});
});

describe("one, two, three and four digits after the comma, and two commas", () => {
	test.each([
		["1,5", "1.50"],
		["1,50", "1.50"],
		["1,500", "1.50"],
		["1,5000", "1.50"],
		["0,1 + 0,2", "0.30"],
		["-1,5", "-1.50"],
		["1,5e3", "1,500"],
	])("%s under de", (line, answer) => {
		expect(show(line, "de")).toBe(answer);
		expect(show(line, "fr")).toBe(answer);
	});

	test("a second decimal mark is refused by name, not cut short", () => {
		expect(show("1,500,000")).toBe('THROWS "1,500,000" is not a number in the de locale: "," marks the decimal there, so it appears once, with only digits after it.');
		expect(show("max(1,5,2)")).toBe('THROWS "1,5,2" is not a number in the de locale: "," marks the decimal there, so it appears once, with only digits after it.');
		expect(show("1,5.000")).toMatch(/^THROWS "1,5.000" is not a number in the de locale/);
	});

	test("a German thousands group before the decimal comma", () => {
		expect(show("1.500,5")).toBe("1,500.50");
		expect(show("1.234.567,25")).toBe("1,234,567.25");
		// A dot decimal is still refused under de, as it was (#654).
		expect(show("1.5 + 1")).toMatch(/^THROWS "1.5" is not a number in the de locale/);
	});

	test("the dot stays a decimal point under fr, as before", () => {
		expect(show("1.5 + 1", "fr")).toBe("2.50");
	});
});

describe("in money, a unit, a percentage and a list", () => {
	test.each([
		["€9,99 * 2", "€19.98"],
		["9,99 € * 2", "€19.98"],
		["12,5%", "12.50%"],
		["12,5% von 200", "25"],
		["1,5 km in m", "1,500.00 m"],
		["[1,5, 2,5]", "[1.50, 2.50]"],
		["3 × 1,5", "4.50"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});
});

describe("calls and brackets: a comma between digits is the decimal comma", () => {
	test.each([
		["max(1,5; 2)", "2"],
		["max(1,5, 2)", "2"],
		["max(1; 2)", "2"],
		["max(1, 2)", "2"],
		["max(1,2)", "1.20"],
		["max(min(1,5; 3); 2,25)", "2.25"],
		["sum(1,5; 2,5)", "4"],
		["rgb(255, 0, 0)", "rgb(255, 0, 0)"],
		["rgb(255; 0; 0)", "rgb(255, 0, 0)"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("a matrix keeps ; for its rows, and separates elements with a comma and a space", () => {
		expect(show("[1, 2; 3, 4]")).toBe("[1, 2; 3, 4]");
		expect(show("[1,5; 2,5]")).toBe("[1.50; 2.50]");
		expect(show("[1,5, 2,5; 3, 4]")).toBe("[1.50, 2.50; 3, 4]");
	});

	test("a ; in a call inside a matrix separates the call's arguments, and one in a matrix inside a call its rows", () => {
		expect(show("[max(1; 2), 3]")).toBe("[2, 3]");
		expect(show("max([1; 5])")).toBe(show("max([1; 5])", "en"));
	});

	test("rgb written without spaces is one decimal with two marks, and says so", () => {
		expect(show("rgb(255,0,0)")).toMatch(/^THROWS "255,0,0" is not a number in the de locale/);
	});

	test("a bare grouping bracket holds the decimal comma", () => {
		expect(show("(1,5)")).toBe("1.50");
		expect(show("(1,5) * 2")).toBe("3");
	});

	test("a ; outside a call is not an argument separator", () => {
		expect(show("1,5 + 2,5; 3")).toMatch(/^THROWS/);
		expect(show("(1; 2)")).toMatch(/^THROWS/);
	});

	test("en is unchanged: ; is not an argument separator and a comma in a call separates", () => {
		expect(show("max(1; 2)", "en")).toBe('THROWS Expected ")", but found ";"');
		expect(show("max(1,5, 2)", "en")).toBe("5");
		expect(show("[1, 2; 3, 4]", "en")).toBe("[1, 2; 3, 4]");
	});
});

describe("fr groups thousands with a space", () => {
	test.each([
		["1 500", "1,500"],
		["1 500,50 + 1", "1,501.50"],
		["1 500,50", "1,500.50"],
		["1 234 567,25", "1,234,567.25"],
		["5 000 000", "5,000,000"],
		["2 * 3 000", "6,000"],
		["3 100 km", "3,100.00 km"],
		["€1 500,50", "€1,500.50"],
		["max(1 500; 2)", "1,500"],
	])("%s", (line, answer) => {
		expect(show(line, "fr")).toBe(answer);
	});

	test("only groups of exactly three after a first group of one to three", () => {
		expect(show("12345 678", "fr")).toMatch(/^THROWS/);
		expect(show("1 50", "fr")).toMatch(/^THROWS/);
		expect(show("1 5000", "fr")).toMatch(/^THROWS/);
		expect(show("1  500", "fr")).toMatch(/^THROWS/);
	});

	test("de and en do not group with a space", () => {
		expect(show("1 500", "de")).toMatch(/^THROWS/);
		expect(show("1 500", "en")).toMatch(/^THROWS/);
	});
});

describe("what the formatter writes under each locale reads back", () => {
	const VALUES = ["1500.5", "1234567.25", "0.5", "-2.5", "€1500.5", "1500 km", "2.5%", "[1.5, 2.5]", "£1234.5"];

	test.each(["de", "fr", "de-DE", "fr-FR"])("%s", (locale) => {
		const english = newTrackedEngine();
		const engine = newTrackedEngine({ locale });
		for (const source of VALUES) {
			const value = english.evaluateExpression(source);
			const written = engine.formatValue(value).replace(/^=\s*/, "");
			const readBack = engine.evaluateExpression(written);
			expect({ source, written, readBack: formatValue(readBack) }).toEqual({ source, written, readBack: formatValue(value) });
		}
	});
});

describe("documents", () => {
	test("both document passes read the decimal comma the same way", () => {
		const text = "a = 1,5\nb = a * 2\nmax(a; b)\n\n1,5\n2,5\ntotal above";
		const read = (lines: { result: unknown; error: string | null }[]) => lines.map((l) => (l.error ? `ERROR ${l.error}` : l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine({ locale: "de" }).parseDocument(text, { inputType: "markdown" }).lines);
		expect(batch).toEqual(["= 1.50", "= 3", "= 3", "", "= 1.50", "= 2.50", "= 4"]);
		expect(read(evaluateDocument(newTrackedEngine({ locale: "de" }), text, { inputType: "markdown" }).lines)).toEqual(batch);
	});
});

describe("the lexer's reading, token by token", () => {
	test("de: a comma between digits is part of the number, inside a call or not", () => {
		expect(tokens("1,5", "de")).toEqual(["NUMBER:1,5"]);
		expect(tokens("max(1,5; 2)", "de")).toEqual(["FUNC:max", "LPAREN:(", "NUMBER:1,5", "COMMA:;", "NUMBER:2", "RPAREN:)"]);
		expect(tokens("max(1,5, 2)", "de")).toEqual(["FUNC:max", "LPAREN:(", "NUMBER:1,5", "COMMA:,", "NUMBER:2", "RPAREN:)"]);
		expect(tokens("[1,5; 2]", "de")).toEqual(["LBRACKET:[", "NUMBER:1,5", "SEMICOLON:;", "NUMBER:2", "RBRACKET:]"]);
		expect(tokens("1,500,000", "de")).toEqual(["NUMBER:1,500,000"]);
		expect(tokens("1.500,5", "de")).toEqual(["NUMBER:1.500,5"]);
	});

	test("en: unchanged", () => {
		expect(tokens("max(1,5, 2)", "en")).toEqual(["FUNC:max", "LPAREN:(", "NUMBER:1", "COMMA:,", "NUMBER:5", "COMMA:,", "NUMBER:2", "RPAREN:)"]);
		expect(tokens("max(1; 2)", "en")).toEqual(["FUNC:max", "LPAREN:(", "NUMBER:1", "SEMICOLON:;", "NUMBER:2", "RPAREN:)"]);
		expect(tokens("1,000", "en")).toEqual(["NUMBER:1,000"]);
	});

	test("fr: the value leaves out the group spaces and the token still spans them", () => {
		const lexer = new ExpressionLexer("fr");
		lexer.reset("1 500,5 + 2");
		const [first] = lexer.tokenizeAll();
		expect(first.value).toBe("1500,5");
		expect(first.text).toBe("1 500,5");
		expect(first.offset).toBe(0);
	});
});

describe("spaceGroupEnd and withoutGroupSpaces", () => {
	test("a space, a no-break space or a narrow no-break space, then exactly three digits", () => {
		expect(spaceGroupEnd("1 500", 1, 5)).toBe(5);
		expect(spaceGroupEnd("1 500", 1, 5)).toBe(5);
		expect(spaceGroupEnd("1 500", 1, 5)).toBe(5);
		expect(spaceGroupEnd("1 500 km", 1, 8)).toBe(5);
	});

	test("not two digits, not four, not two spaces, not another space character", () => {
		expect(spaceGroupEnd("1 50", 1, 4)).toBe(-1);
		expect(spaceGroupEnd("1 5000", 1, 6)).toBe(-1);
		expect(spaceGroupEnd("1  500", 1, 6)).toBe(-1);
		expect(spaceGroupEnd("1\t500", 1, 5)).toBe(-1);
		expect(spaceGroupEnd("1 500", 1, 5)).toBe(-1);
		expect(spaceGroupEnd("1 5a0", 1, 5)).toBe(-1);
	});

	test("the end of the line bounds the look-ahead", () => {
		expect(spaceGroupEnd("1 500", 1, 4)).toBe(-1);
		expect(spaceGroupEnd("", 0, 0)).toBe(-1);
		expect(spaceGroupEnd("1 500", 5, 5)).toBe(-1);
	});

	test("digits from other scripts are not digits", () => {
		expect(spaceGroupEnd("1 ٥٠٠", 1, 5)).toBe(-1);
		expect(spaceGroupEnd("1 ５００", 1, 5)).toBe(-1);
	});

	test("withoutGroupSpaces drops only the group spaces", () => {
		expect(withoutGroupSpaces("1 500 000 000,5")).toBe("1500000000,5");
		expect(withoutGroupSpaces("1500")).toBe("1500");
		expect(withoutGroupSpaces("")).toBe("");
		expect(withoutGroupSpaces("1\t5")).toBe("1\t5");
	});
});

describe("adversarial", () => {
	function engineIn(locale: string): ExpressionEngine {
		return newTrackedEngine({ locale });
	}

	test("prototype words as locale tags build an English engine that reads English", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(show("max(1,5, 2)", word)).toBe("5");
			}
		});
	});

	test("prototype words beside a decimal comma are names", () => {
		for (const word of PROTOTYPE_WORDS) {
			expectHonestLine(`${word} + 1,5`, { engine: engineIn("de") });
			expectHonestLine(`max(${word}; 1,5)`, { engine: engineIn("de") });
		}
	});

	test("a long sum of decimal commas, deep calls and many separators answer within budget", () => {
		const engine = newTrackedEngine({ locale: "de", config: { validation: { maxExpressionLength: 200_000, maxComplexity: 200_000 } } });
		const sum = Array.from({ length: 2_000 }, (_, i) => `${i},5`).join(" + ");
		expectHonestLine(sum, { engine });
		expectHonestLine(`max(${Array.from({ length: 2_000 }, (_, i) => `${i},5`).join("; ")})`, { engine });
		expectHonestLine(`${"1,".repeat(5_000)}5`, { engine });
		expectHonestLine(RESOURCE_PROBES.deepParens(40).replace("1", "1,5"), { engine });
	});

	test("look-alike commas and digits are not the decimal comma", () => {
		// A fullwidth comma, an Arabic comma, a single low quotation mark, and digits from other scripts.
		for (const line of ["1，5", "1،5", "1‚5", "١,٥", "１,５"]) {
			expectHonestLine(line, { engine: engineIn("de") });
			expect(show(line)).not.toBe("1.50");
		}
		// A zero-width space splits the number.
		expect(show("1​,5")).toMatch(/^THROWS/);
	});

	test("markup and injection-shaped text under de is read as text", () => {
		for (const text of TEXT_EDGES) expectHonestLine(text, { engine: engineIn("de") });
		expect(show('"1,5; DROP TABLE"')).toBe("1,5; DROP TABLE");
	});

	test("edge numbers written with a decimal comma", () => {
		expect(show("0,0")).toBe("0");
		expect(show("-0,0")).toBe(show("-0.0", "en"));
		expect(show("9007199254740993,5")).toBe(show("9007199254740993.5", "en"));
		expect(show("0,1234567890123456789012345678901234567")).toBe(show("0.1234567890123456789012345678901234567", "en"));
		expect(show("1,5e308 * 10")).toBe(show("1.5e308 * 10", "en"));
		expect(show("1,5 / 0")).toBe(show("1.5 / 0", "en"));
	});

	test("a comma with nothing after it, a comma before the digits, and one at the end", () => {
		for (const line of ["1,", ",5", "1, ", "max(1,; 2)", "max(;)", "max(1;)"]) {
			expectHonestLine(line, { engine: engineIn("de") });
		}
		expect(show(",5")).toMatch(/^THROWS/);
	});

	test("CRLF and a trailing newline in a document", () => {
		const result = newTrackedEngine({ locale: "de" }).parseDocument("1,5\r\n2,5\r\ntotal above\r\n", { inputType: "markdown" });
		expect(result.lines.slice(0, 3).map((l) => (l.result ? formatValue(l.result) : l.error))).toEqual(["= 1.50", "= 2.50", "= 4"]);
	});
});
