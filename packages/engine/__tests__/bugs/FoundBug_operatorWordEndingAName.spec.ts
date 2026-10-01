import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { multiWordNameRefusal } from "@solve-js/packages/variables/MultiWordNames";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a name of several words ending in an operator word got the wrong
 * refusal. `monthly take = 4000` failed with `The line ends after "take", where
 * a value was expected`, which reads as a slip in arithmetic, rather than the
 * refusal by name that `MultiWordNames.ts` gives a word like `take` at the
 * start of a name (`take home = 5`).
 *
 * A word the engine already reads is never part of a name, so that a name
 * cannot hide an operator (#743): `take` is a spelling of minus. Allowing it
 * last would let `monthly take` and `monthly take - 1` disagree about what
 * `take` is, so the line is refused by name, saying which word and why. The
 * refusal covered only an operator word first; `multiWordNameRefusal` now
 * covers one last as well. An operator with nothing on its right is no
 * arithmetic, so no equation is offered. One between names (`my take home =
 * 5`) is an equation's, as it always was.
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

/** The refusal's message for a line, straight from the function, or null. */
function refusal(line: string): string | null {
	const lexer = new ExpressionLexer();
	lexer.reset(line);
	const tokens: Token[] = lexer.tokenizeAll().filter((t) => t.type !== "EOF");
	return multiWordNameRefusal(tokens, tokens.findIndex((t) => t.type === "EQUALS"))?.message ?? null;
}

const REFUSED = (name: string, word: string, meaning: string) =>
	`"${name}" cannot be a name: "${word}" is a spelling of ${meaning}. Choose other words, or join them as ${name.replace(/ /g, "_")}.`;

describe("the lines that exposed it", () => {
	test("the reported line is refused by name, through every path", () => {
		const message = REFUSED("monthly take", "take", "minus");
		expect(shown("monthly take = 4000")).toBe(`THROWS ${message}`);
		expect(both(["monthly take = 4000"])).toEqual([`THREW: ${message}`]);
	});

	test.each([
		["monthly plus = 5", "monthly plus", "plus", "plus"],
		["monthly minus = 5", "monthly minus", "minus", "minus"],
		["daily times = 5", "daily times", "times", "times"],
		["share mod = 5", "share mod", "mod", "modulo"],
		["my weekly take = 5", "my weekly take", "take", "minus"],
	])("%s is refused naming its word", (line, name, word, meaning) => {
		expect(shown(line)).toBe(`THROWS ${REFUSED(name, word, meaning)}`);
	});

	test("the refusal carries the code the first-word refusal has", () => {
		let code = "";
		try {
			newTrackedEngine().evaluateExpression("monthly take = 4000");
		} catch (e) {
			code = (e as { code: string }).code;
		}
		expect(code).toBe("NAME_HAS_RESERVED_WORD");
	});

	test("the joined name it suggests works", () => {
		expect(both(["monthly_take = 4000", "monthly_take / 4"])).toEqual(["4,000", "1,000"]);
		expect(both(["monthly pay = 4000", "monthly pay / 4"])).toEqual(["4,000", "1,000"]);
	});

	test("the first-word refusal is unchanged", () => {
		expect(shown("take home = 5")).toBe(`THROWS "take home" cannot be a name: "take" is a spelling of minus. Choose other words, or join them as take_home. For the equation, write -home = 5.`);
	});
});

describe("the parts: multiWordNameRefusal", () => {
	test("ordinary: an operator word last, after plain words", () => {
		expect(refusal("monthly take = 4000")).toBe(REFUSED("monthly take", "take", "minus"));
		expect(refusal("one two take = 1")).toBe(REFUSED("one two take", "take", "minus"));
	});

	test("boundary: an operator word alone, or between names, is not a name's", () => {
		expect(refusal("take = 5")).toBeNull();
		expect(refusal("x plus y = 10")).toBeNull();
		expect(refusal("my take home = 5")).toBeNull();
	});

	test("boundary: a symbol is not a word, and more than four words are not a name", () => {
		expect(refusal("monthly - = 5")).toBeNull();
		expect(refusal("one two three four take = 5")).toBeNull();
	});

	test("boundary: no = at all, or an = first", () => {
		const lexer = new ExpressionLexer();
		lexer.reset("monthly take");
		expect(multiWordNameRefusal(lexer.tokenizeAll().filter((t) => t.type !== "EOF"), -1)).toBeNull();
		expect(refusal("= 5")).toBeNull();
	});

	test("hostile: a word before the operator word that is not a plain word leaves the line alone", () => {
		expect(refusal("x1 take = 5")).toBeNull();
		expect(refusal("5 take = 5")).toBeNull();
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a prototype word before the operator word: %s", (word) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(`${word} take = 5`);
			expectHonestDocument(`${word} take = 5\n${word} take`);
		});
	});

	test("a long run of words ending in take is refused in time", () => {
		expectHonestLine(`${"monthly ".repeat(5_000)}take = 5`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.longIdentifier()} take = 5`, { budgetMs: 5_000 });
	});

	test.each(fill("monthlyX take = 5", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge inside the name: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text is read as text", () => {
		expectHonestLine("<b>monthly</b> take = 5");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a later line that reads the refused words is the error it would be anyway", () => {
		const answers = both(["monthly take = 4000", "monthly take * 12"]);
		expect(answers[0]).toMatch(/^THREW: "monthly take" cannot be a name/);
		expect(answers[1]).toMatch(/^THREW: /);
	});

	test("subtraction with take still reads as subtraction", () => {
		expect(both(["monthly = 4000", "monthly take 500"])).toEqual(["4,000", "3,500"]);
	});

	test("a what-if and a check around the refused line stay honest", () => {
		expectHonestDocument("monthly take = 4000\ncheck 1 == 1\nline 1 with x = 2");
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("monthly take = X", NUMERIC_EDGES))("over a numeric edge: %s", (line) => {
		expect(shown(line)).toBe(`THROWS ${REFUSED("monthly take", "take", "minus")}`);
	});

	test("an empty right-hand side is refused the same way", () => {
		expect(shown("monthly take =")).toMatch(/^THROWS /);
		expectHonestLine("monthly take =");
	});

	test("CRLF and padding change nothing", () => {
		expect(both(["  monthly take = 4000\r", ""])[0]).toBe(`THREW: ${REFUSED("monthly take", "take", "minus")}`);
	});
});
