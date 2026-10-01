import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, RESOURCE_PROBES, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { EngineError } from "@solve-js/errors/EngineError";
import { TokenTypes } from "@solve-js/lexer/Token";
import {
	MAX_QUOTED_LENGTH,
	describeTokenType,
	endOfLineWording,
	quoteToken,
	safeText,
	tokenSpan,
	trailingTokenWording,
	unclosedBrackets,
	unexpectedTokenWording,
	valueExpectedWording,
	variableNameWording,
} from "@solve-js/parser/ParseMessages";

/**
 * Issue #768: a parse failure named the parser's internals. `(5 km) -> miles`
 * said `No prefix parselet found for token: GT (">")`, `roll 1d6` said
 * `Expected token type "MINUS" but got "STAR"`, and none of the nineteen lines
 * in the issue that threw carried a `suggestion`. Each message now names what
 * the reader typed and what the engine expected there, and sets `suggestion`
 * where there is an obvious next step. Every code is unchanged: a host
 * branches on the code, and the message is for the reader.
 */

interface Thrown {
	readonly code: string;
	readonly message: string;
	readonly suggestion?: string;
	readonly span?: { start: number; end: number; line?: number; col?: number };
}

/** What a line threw, or a failure of the test if it answered. */
function thrown(line: string): Thrown {
	try {
		newTrackedEngine().evaluateExpression(line);
	} catch (error) {
		if (!(error instanceof EngineError)) throw error;
		return { code: error.code, message: error.message, suggestion: error.suggestion, span: error.span };
	}
	throw new Error(`expected ${JSON.stringify(line)} to throw`);
}

/**
 * The words of a message outside its quotes, where a token type name would be
 * the engine's own vocabulary: inside quotes is what the reader typed, which
 * may well be upper case (`"PI"`).
 */
function unquoted(message: string): string {
	return message.replace(/"[^"]*"/g, '""');
}

/** Every token type name the engine registers, the words a message must not use. */
const TYPE_NAMES: ReadonlySet<string> = new Set<string>(Object.values(TokenTypes).filter((type) => type.length > 1));

/** The token type names a message uses as words of its own. */
function typeNamesIn(message: string): string[] {
	return (unquoted(message).match(/\b[A-Z][A-Z_]+\b/g) ?? []).filter((word) => TYPE_NAMES.has(word) || word.includes("_"));
}

/** Each line of the issue that throws, with the code it throws (unchanged) and the message it now gives. */
const ISSUE_LINES: readonly [string, string, string, string][] = [
	["(5 km) -> miles", "NO_PREFIX_PARSELET", 'Expected a value after "-", but found ">"', '"->" is not a conversion here; to convert, write "in miles"'],
	["5 +", "UNEXPECTED_END_OF_INPUT", 'The line ends after "+", where a value was expected', 'Write a value after "+"'],
	["(2 + 3", "UNEXPECTED_END_OF_INPUT", 'The line ends where ")" was expected', 'Close the bracket with ")"'],
	["2 + * 3", "NO_PREFIX_PARSELET", 'Expected a value after "+", but found "*"', 'Write a value between "+" and "*", or remove one of them'],
	["sqrt(", "UNEXPECTED_END_OF_INPUT", 'The line ends after "(", where a value was expected', 'Write a value after "(", then close the bracket with ")"'],
	["10 USD to", "UNEXPECTED_END_OF_INPUT", 'The line ends after "to", where a value was expected', 'Write a value after "to"'],
	["if 5 > 3 then", "UNEXPECTED_END_OF_INPUT", 'The line ends after "then", where a value was expected', 'Write a value after "then"'],
	["sum(1, 2", "UNEXPECTED_END_OF_INPUT", 'The line ends where ")" was expected', 'Close the bracket with ")"'],
	["3 ** 2", "NO_PREFIX_PARSELET", 'Expected a value after "*", but found "*"', 'Write a power with "^", as in 2 ^ 3'],
	["x := 5", "UNEXPECTED_TRAILING_TOKEN", 'Expected an operator or the end of the line, but found ":"', 'Assign with "=" on its own'],
	["5 % of", "UNEXPECTED_END_OF_INPUT", 'The line ends after "of", where a value was expected', 'Write a value after "of"'],
	["round(3.14159, )", "NO_PREFIX_PARSELET", 'Expected a value after ",", but found ")"', 'Write a value after the ",", or remove the ","'],
	["[1, 2", "UNEXPECTED_END_OF_INPUT", 'The line ends where "]" was expected', 'Close the bracket with "]"'],
	["roll 1d6", "UNEXPECTED_TOKEN_TYPE", 'Expected "-" between the two ends of the range, but found "d6"', "Write the range as roll 1-6, roll(1, 6) or roll between 1 and 6"],
	["2 ^", "UNEXPECTED_END_OF_INPUT", 'The line ends after "^", where a value was expected', 'Write a value after "^"'],
	["total above +", "UNEXPECTED_END_OF_INPUT", 'The line ends after "+", where a value was expected', 'Write a value after "+"'],
	["1,5 + 1", "UNEXPECTED_TRAILING_TOKEN", 'Expected an operator or the end of the line, but found ","', "Write a decimal with a point, as in 1.5; a comma separates the items of a list"],
];

describe("the lines in the issue, each in the reader's terms", () => {
	test.each(ISSUE_LINES)("%s", (line, code, message, suggestion) => {
		expect(thrown(line)).toMatchObject({ code, message, suggestion });
	});

	test("none of them names a token type, and every one carries a suggestion", () => {
		for (const [line] of ISSUE_LINES) {
			const error = thrown(line);
			expect({ line, names: typeNamesIn(error.message), suggested: typeof error.suggestion === "string" && error.suggestion.length > 0 }).toEqual({ line, names: [], suggested: true });
		}
	});

	test("the lines the issue lists as already answering still answer", () => {
		for (const line of ["5 km in", "12 in in cm", "average(1, 2, 3)", "2024-03-10 09:00"]) {
			expect(() => newTrackedEngine().evaluateExpression(line)).not.toThrow();
		}
	});

	test("the span still names the character the message quotes", () => {
		const cases: [string, number][] = [["(5 km) -> miles", 8], ["2 + * 3", 4], ["round(3.14159, )", 15], ["1,5 + 1", 1]];
		for (const [line, start] of cases) expect(thrown(line).span?.start).toBe(start);
		// A line that stops short is pointed at just past its last character.
		expect(thrown("5 +").span).toEqual({ start: 3, end: 3, line: 1, col: 4 });
	});
});

describe("the other messages that named a token type", () => {
	test("a phrase form names the words it expected", () => {
		expect(thrown("roll between 1 6")).toMatchObject({ code: "PHRASE_KEYWORD_MISMATCH", message: 'Expected "and", but found "6"' });
		expect(thrown("roll from 1 6")).toMatchObject({ code: "PHRASE_KEYWORD_MISMATCH", message: 'Expected "to", but found "6"' });
	});

	test("a name after a colon", () => {
		expect(thrown(":= 5")).toMatchObject({ code: "EXPECTED_IDENTIFIER", message: 'Expected a name after ":", but found "="' });
		// A word the engine reads as something else is a name to a reader, and the message says why it is refused.
		expect(thrown(":gcd = 4")).toMatchObject({ code: "EXPECTED_IDENTIFIER", message: '"gcd" is a word the engine already reads, so it cannot name a variable' });
	});

	test("a function parameter that is not a name", () => {
		expect(thrown("f(1) = 1")).toMatchObject({ code: "USER_FUNCTION_INVALID_PARAM_NAME", message: 'Expected a parameter name, but found "1"' });
	});

	test("a token that needed a particular partner", () => {
		expect(thrown("log 20 4")).toMatchObject({ code: "UNEXPECTED_TOKEN_TYPE", message: 'Expected "(", but found "20"' });
	});
});

describe("unit: describeTokenType", () => {
	test("operators and brackets by the character typed, kinds of value by a description", () => {
		expect(describeTokenType("GT")).toBe('">"');
		expect(describeTokenType("RPAREN")).toBe('")"');
		expect(describeTokenType("NUMBER")).toBe("a number");
		expect(describeTokenType("LINE_REF")).toBe("a line reference such as line 1");
	});

	test("a type it does not know is read as words, and never as a type name", () => {
		expect(describeTokenType("FRAME_COUNT")).toBe('"frame count"');
		expect(describeTokenType("BETWEEN")).toBe('"between"');
		expect(describeTokenType("")).toBe("something else");
		expect(describeTokenType("___")).toBe("something else");
	});

	test("hostile: an inherited property name is not read from the table", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(describeTokenType(word)).toBe(`"${word.toLowerCase().replace(/_+/g, " ").trim()}"`);
		});
	});

	test("every registered type is described without an upper-case type name", () => {
		for (const type of Object.values(TokenTypes)) expect(typeNamesIn(describeTokenType(type))).toEqual([]);
	});
});

describe("unit: safeText and quoteToken", () => {
	test("ordinary text is kept as typed", () => {
		expect(safeText("miles")).toBe("miles");
		expect(quoteToken({ text: ">", value: ">" })).toBe('">"');
	});

	test("the typed text is quoted, not the engine's reading of it", () => {
		expect(quoteToken({ text: "3pm", value: "900" })).toBe('"3pm"');
		// A token the normaliser inserted has no typed text; its value is the operator.
		expect(quoteToken({ text: "", value: "*" })).toBe('"*"');
	});

	test("the boundary: exactly the limit is kept whole, one past it is cut", () => {
		expect(safeText("a".repeat(MAX_QUOTED_LENGTH))).toBe("a".repeat(MAX_QUOTED_LENGTH));
		expect(safeText("a".repeat(MAX_QUOTED_LENGTH + 1))).toBe(`${"a".repeat(MAX_QUOTED_LENGTH)}...`);
		expect(safeText("")).toBe("");
	});

	test("hostile: invisible characters, direction overrides and lone surrogates are written as code points", () => {
		expect(safeText("a​b")).toBe("a<U+200B>b");
		expect(safeText("‮5")).toBe("<U+202E>5");
		expect(safeText("﻿")).toBe("<U+FEFF>");
		expect(safeText("\u0000\u0007\u007F")).toBe("<U+0000><U+0007><U+007F>");
		expect(safeText("\uD800")).toBe("<U+D800>");
		expect(safeText("x\uDC00")).toBe("x<U+DC00>");
		// A whole surrogate pair is one character, and kept.
		expect(safeText("𝟓")).toBe("𝟓");
	});

	test("hostile: markup is quoted as text", () => {
		expect(quoteToken({ text: "<script>", value: "<script>" })).toBe('"<script>"');
	});
});

describe("unit: the wordings", () => {
	const t = (type: string, text: string) => ({ type, text, value: text });

	test("valueExpectedWording: at the start of a line, after an operator, after a value", () => {
		expect(valueExpectedWording(t("STAR", "*"), undefined, t("NUMBER", "3"))).toEqual({ message: 'Expected a value, but found "*"', suggestion: 'Write a value before "*", or remove it' });
		expect(valueExpectedWording(t("STAR", "*"), t("PLUS", "+"), undefined).suggestion).toBe('Write a value between "+" and "*", or remove one of them');
		expect(valueExpectedWording(t("RPAREN", ")"), t("LPAREN", "("), undefined).suggestion).toBe("Write a value between the brackets, or remove them");
		expect(valueExpectedWording(t("STAR", "*"), t("NUMBER", "5"), undefined).suggestion).toBe('Remove "*", or write a value in its place');
	});

	test("valueExpectedWording: an arrow echoes a plain word as its target, and nothing else", () => {
		expect(valueExpectedWording(t("GT", ">"), t("MINUS", "-"), t("UNIT", "miles")).suggestion).toBe('"->" is not a conversion here; to convert, write "in miles"');
		// A number or an operator after the arrow is not echoed, so the suggestion cannot read as an answer.
		expect(valueExpectedWording(t("GT", ">"), t("MINUS", "-"), t("NUMBER", "42")).suggestion).toBe('"->" is not a conversion here; to convert, write "in followed by the unit"');
		expect(valueExpectedWording(t("GT", ">"), t("MINUS", "-"), t("EQUALS", "=")).suggestion).not.toContain("=");
	});

	test("endOfLineWording: an empty line, a line owing brackets, a line owing a token", () => {
		expect(endOfLineWording([])).toEqual({ message: "The line ends before a value", suggestion: "Write a value" });
		expect(endOfLineWording([t("LBRACKET", "["), t("LPAREN", "("), t("NUMBER", "1"), t("PLUS", "+")]).suggestion).toBe('Write a value after "+", then close the bracket with ")"');
		expect(endOfLineWording([t("NUMBER", "1")], "RBRACKET")).toEqual({ message: 'The line ends where "]" was expected', suggestion: 'Close the bracket with "]"' });
		expect(endOfLineWording([t("NUMBER", "1")], "LINE_REF").suggestion).toBe("Finish the line with a line reference such as line 1");
	});

	test("unclosedBrackets: nesting, a closer with no opener, a mismatched closer", () => {
		expect(unclosedBrackets([t("LPAREN", "("), t("LBRACKET", "[")])).toEqual([")", "]"]);
		expect(unclosedBrackets([t("LPAREN", "("), t("RPAREN", ")")])).toEqual([]);
		expect(unclosedBrackets([t("RPAREN", ")")])).toEqual([]);
		expect(unclosedBrackets([t("LPAREN", "("), t("RBRACKET", "]")])).toEqual([")"]);
	});

	test("unexpectedTokenWording and trailingTokenWording", () => {
		expect(unexpectedTokenWording("RPAREN", t("COMMA", ","))).toEqual({ message: 'Expected ")", but found ","', suggestion: 'Close the bracket with ")" before ","' });
		expect(unexpectedTokenWording("OF", t("NUMBER", "3")).suggestion).toBe('Write "of" where "3" is');
		expect(trailingTokenWording(t("COMMA", ","), t("NUMBER", "1"), t("NUMBER", "5")).suggestion).toContain("decimal with a point");
		expect(trailingTokenWording(t("COLON", ":"), t("IDENT", "x"), t("EQUALS", "=")).suggestion).toBe('Assign with "=" on its own');
		expect(trailingTokenWording(t("IDENT", "km"), t("NUMBER", "5"), undefined).suggestion).toBe('Join "km" to the expression with an operator such as "+", or remove it');
	});

	test("variableNameWording: a word the engine reads, and something that is not a word", () => {
		expect(variableNameWording({ text: "gcd", value: "gcd" }, ":", ":total = 5").message).toBe('"gcd" is a word the engine already reads, so it cannot name a variable');
		expect(variableNameWording({ text: "5", value: "5" }, ":", ":total = 5").message).toBe('Expected a name after ":", but found "5"');
	});

	test("tokenSpan: a plain token, and a fused one whose source runs past its text", () => {
		expect(tokenSpan({ offset: 4, text: "*", line: 1, col: 5 })).toEqual({ start: 4, end: 5, line: 1, col: 5 });
		expect(tokenSpan({ offset: 0, text: "10", sourceEnd: 9, line: 2, col: 1 })).toEqual({ start: 0, end: 9, line: 2, col: 1 });
	});
});

describe("adversarial", () => {
	test("a 10,000-character line that fails at its end: the message stays bounded, the span names the position", () => {
		const line = `${Array.from({ length: 2_500 }, () => "1").join(" + ")} +`;
		const error = (() => {
			try {
				newTrackedEngine({ config: { validation: { maxExpressionLength: 20_000, maxComplexity: 100_000 } } }).evaluateExpression(line);
			} catch (e) {
				return e as EngineError;
			}
			throw new Error("expected a throw");
		})();
		expect(error.code).toBe("UNEXPECTED_END_OF_INPUT");
		expect(error.message.length).toBeLessThan(120);
		expect(error.span?.start).toBe(line.length);
	});

	test("a long number left over after an expression is quoted cut short", () => {
		const word = "9".repeat(1_500);
		const error = thrown(`5 ${word}`);
		expect(error.code).toBe("UNEXPECTED_TRAILING_TOKEN");
		expect(error.message).toContain(`"${"9".repeat(MAX_QUOTED_LENGTH)}..."`);
		expect(error.message.length).toBeLessThan(160);
	});

	test("a failing token that is a control character, a direction override or a lone surrogate never reaches a parse message raw", () => {
		// The lexer passes over control characters, so through the whole pipeline
		// they never become the failing token; the wordings are proven on such a
		// token directly, above and here.
		const PARSE_CODES = new Set(["NO_PREFIX_PARSELET", "UNEXPECTED_END_OF_INPUT", "UNEXPECTED_TOKEN_TYPE", "UNEXPECTED_TRAILING_TOKEN"]);
		for (const line of ["2 + \u0001", "(\u0007", "5 ‮ 3", "2 + \uD800", "​*", "5 ﻿ +"]) {
			const outcome = expectHonestLine(line);
			if (outcome.kind === "thrown" && PARSE_CODES.has(outcome.code)) {
				const raw = [...outcome.message].some((ch) => {
					const code = ch.codePointAt(0) ?? 0;
					return code < 0x20 || (code >= 0x202a && code <= 0x202e) || (code >= 0x200b && code <= 0x200f) || code === 0xfeff || (code >= 0xd800 && code <= 0xdfff);
				});
				expect({ line, raw }).toEqual({ line, raw: false });
			}
		}
		expect(valueExpectedWording({ type: "IDENT", text: "‮", value: "‮" }, { type: "PLUS", text: "+", value: "+" }, undefined).message).toBe('Expected a value after "+", but found "<U+202E>"');
		expect(trailingTokenWording({ type: "IDENT", text: "\uD800", value: "\uD800" }, undefined, undefined).message).toBe('Expected an operator or the end of the line, but found "<U+D800>"');
	});

	test("a suggestion never echoes text that could be mistaken for a result", () => {
		for (const line of ["5 -> = 10", "5 -> 42", "(1) -> 2 + 2", "1,5 = 99", "x := 7", "2 + * = 4"]) {
			let suggestion: string | undefined;
			try {
				newTrackedEngine().evaluateExpression(line);
			} catch (error) {
				suggestion = (error as EngineError).suggestion;
			}
			if (suggestion !== undefined) expect({ line, suggestion, echoes: /= ?\d|\b(10|42|99|4|7)\b/.test(suggestion.replace("2 ^ 3", "").replace("1.5", "")) }).toMatchObject({ echoes: false });
		}
	});

	test("prototype words and markup where a value was expected are quoted as text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectHonestLine(`2 + * ${word}`);
			expect(thrown("2 + * <b>")).toMatchObject({ message: 'Expected a value after "+", but found "*"' });
		});
	});

	test("realistic: the text edges each come back honestly, and none names a token type", () => {
		for (const edge of TEXT_EDGES) {
			for (const line of [`${edge} +`, `(${edge}`, `2 + * ${edge}`]) {
				const outcome = expectHonestLine(line);
				if (outcome.kind === "thrown") expect({ line, names: typeNamesIn(outcome.message) }).toEqual({ line, names: [] });
			}
		}
	});

	test("resource probes that fail to parse still fail inside the budget, by name", () => {
		for (const line of [`${RESOURCE_PROBES.longSum(600)} +`, `${RESOURCE_PROBES.deepParens(40).slice(0, -1)}`]) {
			const outcome = expectHonestLine(line);
			expect(["thrown", "error"]).toContain(outcome.kind);
		}
	});

	test("edge: a failure in a document line carries the same message, in the line's own position", () => {
		const doc = newTrackedEngine().parseDocument("x = 1\n  2 + * 3", { inputType: "markdown" });
		expect(doc.lines[1]).toMatchObject({ error: 'Expected a value after "+", but found "*"', errorCode: "NO_PREFIX_PARSELET", errorSpan: { start: 6, end: 7, line: 2, col: 7 } });
	});
});
