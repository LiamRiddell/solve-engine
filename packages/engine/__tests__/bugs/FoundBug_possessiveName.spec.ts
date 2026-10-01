import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionLexer, wordApostropheEnd } from "@solve-js/lexer/ExpressionLexer";
import { isNameWord, multiWordNameRefusal, quoteMarkInWord } from "@solve-js/packages/variables/MultiWordNames";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a name of several words with a possessive in it did not parse.
 * `Alice's food = £30` answered `Expected an operator or the end of the line,
 * but found "food"`, though the word pattern of `MultiWordNames.ts` allows an
 * apostrophe inside a word (#743).
 *
 * The lexer skipped a straight `'` as an unknown character, so `Alice's` was
 * the identifier `Alice` and the unit `s` (seconds), and the run of plain words
 * before the `=` was broken. A straight apostrophe after a letter is now part
 * of the word, inside it (`Alice's`, `O'Brien`) or ending it (`the Smiths'
 * rent`), as a typographic `’` always was (`wordApostropheEnd`). A name's value
 * reads either apostrophe as `'`, so a name typed with one is read when typed
 * with the other. A mark shaped like an apostrophe that is not one (`‘`, `′`),
 * and an apostrophe before a word's first letter, are refused by name
 * (`quoteMarkInWord`).
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

/** The tokens the lexer gives a line, as `TYPE:text`. */
function lexed(line: string): string[] {
	return tokensOf(line).map((t) => `${t.type}:${t.text}`);
}

/** The lexer's tokens for a line. */
function tokensOf(line: string): Token[] {
	const lexer = new ExpressionLexer();
	lexer.reset(line);
	return lexer.tokenizeAll().filter((t) => t.type !== "EOF");
}

const QUOTE_MARK_REFUSAL = (name: string, mark: string, word: string) =>
	`THROWS "${name}" cannot be a name: "${mark}" in "${word}" is a quotation mark, not an apostrophe. Write the apostrophe as ' or ’.`;

describe("the lines that exposed it", () => {
	test("the reported line defines the name, and a later line reads it, through both passes", () => {
		expect(both(["Alice's food = £30", "Alice's food * 2"])).toEqual(["£30.00", "£60.00"]);
	});

	test("the definition answers on the single-expression path too", () => {
		expect(shown("Alice's food = £30")).toBe("£30.00");
	});

	test("a typographic apostrophe works the same way", () => {
		expect(both(["Alice’s food = £30", "Alice’s food * 2"])).toEqual(["£30.00", "£60.00"]);
	});

	test("either apostrophe reads a name the other defined", () => {
		expect(both(["Alice's food = £30", "Alice’s food * 2"])).toEqual(["£30.00", "£60.00"]);
		expect(both(["Alice’s food = £30", "Alice's food + £1"])).toEqual(["£30.00", "£31.00"]);
	});

	test("a plural possessive, with the apostrophe ending the word", () => {
		expect(both(["the Smiths' rent = £900", "the Smiths' rent / 3"])).toEqual(["£900.00", "£300.00"]);
		expect(both(["the Smiths’ rent = £900", "the Smiths’ rent / 3"])).toEqual(["£900.00", "£300.00"]);
	});

	test("two possessive names side by side", () => {
		expect(both(["Alice's food = £30", "Bob's food = £20", "Alice's food + Bob's food"])).toEqual(["£30.00", "£20.00", "£50.00"]);
	});

	test("a name of one word with an apostrophe", () => {
		expect(both(["Alice's = 5", "Alice's * 2", "O'Brien rate = 4", "O'Brien rate + 1"])).toEqual(["5", "10", "4", "5"]);
	});

	test("a quote mark that is not an apostrophe is refused by name", () => {
		expect(shown("Alice‘s food = 3")).toBe(QUOTE_MARK_REFUSAL("Alice‘s food", "‘", "Alice‘s"));
		expect(shown("Alice′s food = 3")).toBe(QUOTE_MARK_REFUSAL("Alice′s food", "′", "Alice′s"));
	});

	test("an apostrophe before a word's first letter is refused by name", () => {
		expect(shown("’tis rate = 5")).toBe(`THROWS "’tis rate" cannot be a name: "’tis" starts with an apostrophe, and a word in a name starts with a letter.`);
	});

	test("the refusal carries its code", () => {
		let code = "";
		try {
			newTrackedEngine().evaluateExpression("Alice‘s food = 3");
		} catch (e) {
			code = (e as { code: string }).code;
		}
		expect(code).toBe("NAME_HAS_QUOTE_MARK");
	});
});

describe("the parts: wordApostropheEnd", () => {
	test("ordinary: an apostrophe inside a word is the word's", () => {
		expect(wordApostropheEnd("Alice's", 0, 5)).toBe(6);
		expect(wordApostropheEnd("O'Brien", 0, 1)).toBe(2);
		expect(wordApostropheEnd("don't", 0, 3)).toBe(4);
		expect(wordApostropheEnd("x + Zoë's", 4, 7)).toBe(8);
	});

	test("ordinary: an apostrophe ending a word is the word's", () => {
		expect(wordApostropheEnd("Smiths'", 0, 6)).toBe(7);
		expect(wordApostropheEnd("Smiths' rent", 0, 6)).toBe(7);
		expect(wordApostropheEnd("Smiths'+1", 0, 6)).toBe(7);
		expect(wordApostropheEnd("Smiths' rent", 0, 6)).toBe(7);
	});

	test("boundary: after a digit, an underscore or nothing it is not", () => {
		expect(wordApostropheEnd("5'", 0, 1)).toBe(1);
		expect(wordApostropheEnd("x1's", 0, 2)).toBe(2);
		expect(wordApostropheEnd("x_'s", 0, 2)).toBe(2);
		expect(wordApostropheEnd("'tis", 0, 0)).toBe(0);
	});

	test("boundary: before a digit, an underscore, a second apostrophe or another mark it is not", () => {
		expect(wordApostropheEnd("a'1", 0, 1)).toBe(1);
		expect(wordApostropheEnd("a'_", 0, 1)).toBe(1);
		expect(wordApostropheEnd("a''b", 0, 1)).toBe(1);
		expect(wordApostropheEnd("a'’", 0, 1)).toBe(1);
	});

	test("boundary: the closing mark of a word quoted with apostrophes is not a possessive", () => {
		expect(wordApostropheEnd("'hello'", 1, 6)).toBe(6);
		expect(wordApostropheEnd("'don't'", 1, 4)).toBe(5);
	});

	test("hostile: a position that is not an apostrophe, or past the line, is left alone", () => {
		expect(wordApostropheEnd("Alice", 0, 2)).toBe(2);
		expect(wordApostropheEnd("Alice'", 0, 99)).toBe(99);
		expect(wordApostropheEnd("", 0, 0)).toBe(0);
	});

	test("the lexer reads a possessive as one word and leaves feet and quotes as they were", () => {
		expect(lexed("Alice's food")).toEqual(["IDENT:Alice's", "IDENT:food"]);
		expect(lexed("the Smiths' rent")).toEqual(["IDENT:the", "IDENT:Smiths'", "IDENT:rent"]);
		expect(lexed("5' + 1")).toEqual(["NUMBER:5", "PLUS:+", "NUMBER:1"]);
		expect(lexed("'hello'")).toEqual(["IDENT:hello"]);
	});

	test("the lexer gives a typographic apostrophe the straight one's value and keeps its text", () => {
		const [token] = tokensOf("Alice’s");
		expect({ text: token.text, value: token.value }).toEqual({ text: "Alice’s", value: "Alice's" });
		const [plain] = tokensOf("Alice");
		expect({ text: plain.text, value: plain.value }).toEqual({ text: "Alice", value: "Alice" });
	});
});

describe("the parts: quoteMarkInWord and the name refusal", () => {
	test("ordinary: a name's word passes", () => {
		for (const word of ["Alice's", "Alice’s", "Smiths'", "O'Brien", "rate", "well-known"]) {
			expect({ word, reason: quoteMarkInWord(word) }).toEqual({ word, reason: null });
		}
	});

	test("ordinary: each look-alike mark is named", () => {
		for (const mark of ["‘", "′", "‛", "`", "´"]) {
			expect(quoteMarkInWord(`Alice${mark}s`)).toBe(`"${mark}" in "Alice${mark}s" is a quotation mark, not an apostrophe. Write the apostrophe as ' or ’`);
		}
	});

	test("boundary: an apostrophe first is named, and text that is not word-shaped is not this refusal's", () => {
		expect(quoteMarkInWord("’tis")).toBe(`"’tis" starts with an apostrophe, and a word in a name starts with a letter`);
		expect(quoteMarkInWord("x1")).toBeNull();
		expect(quoteMarkInWord("5")).toBeNull();
		expect(quoteMarkInWord("")).toBeNull();
		expect(quoteMarkInWord("a b")).toBeNull();
	});

	test("hostile: a prototype word is checked as text", () => {
		for (const word of PROTOTYPE_WORDS) expect(quoteMarkInWord(word)).toBeNull();
		expect(quoteMarkInWord("constructor‘s")).toMatch(/is a quotation mark/);
	});

	test("isNameWord reads a possessive as a plain word", () => {
		expect(isNameWord(tokensOf("Alice's")[0])).toBe(true);
		expect(isNameWord(tokensOf("Alice’s")[0])).toBe(true);
		expect(isNameWord(tokensOf("Alice‘s")[0])).toBe(false);
	});

	test("multiWordNameRefusal: the quote mark refusal only for a definition of two to four words", () => {
		const refusal = (line: string) => {
			const tokens = tokensOf(line);
			return multiWordNameRefusal(tokens, tokens.findIndex((t) => t.type === "EQUALS"))?.message ?? null;
		};
		expect(refusal("Alice‘s food = 3")).toMatch(/^"Alice‘s food" cannot be a name/);
		expect(refusal("Alice's food = 3")).toBeNull();
		expect(refusal("Alice‘s = 3")).toBeNull();
		expect(refusal("a b c d Alice‘s = 3")).toBeNull();
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a prototype word with a possessive: %s", (word) => {
		expectPrototypeUntouched(() => {
			expectHonestDocument(`${word}'s rate = 5\n${word}'s rate * 2`);
			// A word of letters makes a name; one with an underscore never was a
			// name's word, and stays the parse error it was.
			const answers = both([`${word}'s rate = 5`, `${word}'s rate * 2`]);
			if (/^\p{L}+$/u.test(word)) expect(answers).toEqual(["5", "10"]);
			else expect(answers[0]).toMatch(/^THREW: /);
		});
	});

	test("a long run of apostrophes and letters is lexed and refused in time", () => {
		const line = `${"a'".repeat(20_000)}b food = 5`;
		expectHonestLine(line, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.longIdentifier(10_000)}'s food = 5`, { budgetMs: 5_000 });
	});

	test.each(fill("AliceX's food = 5", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge inside the possessive: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup and injection shaped text with an apostrophe is read as text", () => {
		expectHonestLine("'; DROP TABLE notes; --");
		expectHonestLine("<b>Alice's</b> food = 5");
		expectHonestDocument("Bobby's'); DROP TABLE = 5\nBobby's");
	});

	test("a look-alike apostrophe from another script is not an apostrophe", () => {
		// U+02BC, the modifier letter apostrophe, is a letter, so it is part of
		// the word and makes another name.
		expect(both(["Aliceʼs food = 3", "Alice's food"])[1]).toMatch(/^THREW: /);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo in the possessive is the parse error it always was", () => {
		expect(both(["Alice's food = £30", "Alices food * 2"])[1]).toMatch(/^THREW: Expected an operator/);
	});

	test("a label with a possessive still reads as a label", () => {
		expect(shown("Bob's share: 30")).toBe("30");
		expect(shown("Alice's rent $30")).toBe("$30.00");
	});

	test("a check, a what-if and a tag over a possessive name", () => {
		expect(both(["Alice's food = £30", "check Alice's food == £30"])).toEqual(["£30.00", "✓"]);
		expectHonestDocument("Alice's food = £30\nAlice's food * 2\nline 2 with Alice's food = £10");
		expectHonestDocument("Alice's food = £30 #food\ntotal of #food");
	});

	test("a section around it and an edit of the definition", () => {
		expect(both(["# Food", "Alice's food = £30", "Alice's food * 2"])).toEqual(["", "£30.00", "£60.00"]);
		expect(both(["Alice's food = £40", "Alice's food * 2"])).toEqual(["£40.00", "£80.00"]);
	});

	test("a name holding an operator word with a possessive is refused as before", () => {
		expect(shown("Alice's take = 5")).toBe(`THROWS "Alice's take" cannot be a name: "take" is a spelling of minus. Choose other words, or join them as Alice's_take.`);
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("Alice's food = X\nAlice's food * 2", NUMERIC_EDGES))("a possessive name over a numeric edge: %j", (text) => {
		expectHonestDocument(text, { allowNaN: text.includes("0/0") });
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["Alice's food = £30\r", "Alice's food * 2\r", ""]).slice(0, 2)).toEqual(["£30.00", "£60.00"]);
	});

	test("an empty name before the apostrophe and an apostrophe alone", () => {
		expectHonestLine("' = 5");
		expectHonestLine("'s food = 5");
		expectHonestLine("'");
	});

	test("five words with a possessive are more than a name, and stay the error they were", () => {
		expect(shown("my friend Alice's weekly food = 5")).toMatch(/^THROWS Expected an operator/);
	});
});
