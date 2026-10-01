import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { builtinArgumentRefused, calledByName, textArgumentRefused } from "@solve-js/vm/VMBuiltins";
import { intOfText } from "@solve-js/vm/PlainNumberForms";
import { numberValue, stringValue, ValueType } from "@solve-js/vm/Value";

/**
 * Found bug: a numeric builtin given text read it as a number. Every builtin
 * reads its arguments through `toNumber()`, which reads text through
 * `parseFloat`, so `sqrt("abc")` answered 0, `round("3.5")` answered 4 and
 * `gcd("a", 4)` answered 4: the text's leading digits, or 0, passed off as its
 * value. The cause was shared, so the fix is too: the one argument check the
 * VM makes at `CALL_BUILTIN` (`builtinArgumentRefused`) now refuses text with
 * `TEXT_ARITHMETIC`, as arithmetic does, and points at `as number`. The
 * builtins that read text as text (the algebra verbs' unknowns, the unit names
 * the phrase forms pass, `float`) keep it, the aggregates keep their own
 * refusal, and `int`, which reads text on purpose, now reads only text that is
 * a number (`intOfText`), where `int("abc")` answered 0.
 */

const takesText = (name: string): string =>
	`${name} takes a number, not text. To use a number held as text, convert it first with "as number".`;

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the line that exposed it", () => {
	test('sqrt("abc") is refused by name', () => {
		expect(shown('sqrt("abc")')).toBe(`TEXT_ARITHMETIC: ${takesText("sqrt")}`);
	});
});

describe("the other numeric builtins, at the same cause", () => {
	test.each([
		['abs("abc")', "abs"],
		['round("abc")', "round"],
		['round("3.5")', "round"],
		['floor("x")', "floor"],
		['ceil("1")', "ceil"],
		['sin("abc")', "sin"],
		['pow("2", 3)', "pow"],
		['pow(2, "3")', "pow"],
		['gcd("a", 4)', "gcd"],
		['hex("abc")', "hex"],
		['fact("5")', "fact"],
		['log10("100")', "log10"],
	])("%s is refused", (line, name) => {
		expect(shown(line)).toBe(`TEXT_ARITHMETIC: ${takesText(name)}`);
	});

	test("a builtin reached through a phrase says this calculation, not its internal name", () => {
		expect(shown('"abc" to 2 dp')).toBe(`TEXT_ARITHMETIC: ${takesText("This calculation")}`);
	});

	test("ln and max, which had refusals of their own for the wrong reason or the right one", () => {
		expect(shown('ln("abc")')).toBe(`TEXT_ARITHMETIC: ${takesText("ln")}`);
		expect(shown('max("abc", 2)')).toBe("AGGREGATE_NON_NUMERIC: Text cannot be compared: only numbers and quantities can.");
	});

	test("the builtins that read text as text keep it", () => {
		expect(shown('float("2.5")')).toBe("2.50");
		expect(shown("solve(x^2 - 4 = 0, x)")).toBe("[-2, 2]");
		expect(shown("der(x^2, x)")).toBe("2x");
		expect(shown("12.5 minutes in minutes and seconds")).toBe("12 minutes 30 seconds");
		expect(shown("3 hours / day")).toBe("3.00 hours/day");
		expect(shown('sqrt("abc" as number)')).toBe('TEXT_NOT_A_NUMBER: "abc" is not a number: "as number" reads text that is a number and nothing else.');
		expect(shown('sqrt("16" as number)')).toBe("4");
	});

	test("int reads text only when it is a number", () => {
		expect(shown('int("42")')).toBe("42");
		expect(shown('int("2.7")')).toBe("2");
		expect(shown('int(" 1,234.9 ")')).toBe("1,234");
		expect(shown('int("abc")')).toBe('TEXT_NOT_A_NUMBER: "abc" is not a number: int reads text that is a number and nothing else.');
		expect(shown('int("12abc")')).toBe('TEXT_NOT_A_NUMBER: "12abc" is not a number: int reads text that is a number and nothing else.');
	});
});

describe("textArgumentRefused", () => {
	test("ordinary: text in any position of a numeric builtin", () => {
		expect(textArgumentRefused(0, [stringValue("abc")])?.errorMessage).toBe(takesText("sqrt"));
		expect(textArgumentRefused(31, [numberValue(2), stringValue("3")])?.errorMessage).toBe(takesText("pow"));
	});

	test("boundary: no text, no arguments, and the builtins that take text", () => {
		expect(textArgumentRefused(0, [numberValue(4)])).toBeNull();
		expect(textArgumentRefused(0, [])).toBeNull();
		for (const index of [9, 10, 42, 44, 50, 69, 70, 71, 72, 94, 95, 100, 115, 116]) {
			expect(textArgumentRefused(index, [stringValue("x")])).toBeNull();
		}
	});

	test("hostile: an index no table lists, and prototype words as the text", () => {
		expect(textArgumentRefused(9999, [stringValue("x")])?.errorMessage).toBe(takesText("This calculation"));
		for (const word of PROTOTYPE_WORDS) expect(textArgumentRefused(0, [stringValue(word)])?.errorCode).toBe("TEXT_ARITHMETIC");
	});

	test("builtinArgumentRefused reaches it last, after a date, an address and a colour", () => {
		expect(builtinArgumentRefused(0, [stringValue("abc")])?.errorCode).toBe("TEXT_ARITHMETIC");
		expect(builtinArgumentRefused(115, [stringValue("abc")])).toBeNull();
	});
});

describe("calledByName, which decides whether a refusal may use the builtin's name", () => {
	test("ordinary: the named functions, ln, the two-argument log and float among them", () => {
		for (const index of [0, 8, 31, 62, 87, 109, 112, 113, 114, 115]) expect(calledByName(index)).toBe(true);
	});

	test("boundary and hostile: the phrase forms, the dice roll, and indices no table lists", () => {
		for (const index of [37, 80, 86, 93, 97, 108, 116, 9999, -1, Number.NaN]) expect(calledByName(index)).toBe(false);
	});
});

describe("intOfText", () => {
	test("ordinary: a whole number, a decimal cut toward zero, a grouped number", () => {
		expect(intOfText("42").value).toBe(42);
		expect(intOfText("2.7").value).toBe(2);
		expect(intOfText("-2.7").value).toBe(-2);
		expect(intOfText("1,234,567.8").value).toBe(1234567);
		expect(intOfText("1e3").value).toBe(1000);
	});

	test("boundary: padding, zero and negative zero, an empty text", () => {
		expect(intOfText("  7  ").value).toBe(7);
		expect(intOfText("0").value).toBe(0);
		expect(Object.is(intOfText("-0.5").value, -0)).toBe(true);
		expect(intOfText("").errorCode).toBe("TEXT_NOT_A_NUMBER");
		expect(intOfText("   ").errorCode).toBe("TEXT_NOT_A_NUMBER");
	});

	test("hostile: leading digits, look-alike digits, markup and a long text", () => {
		for (const text of ["12abc", "1,23", "٥", "５", "<b>5</b>", "0xZZ", "Infinity", "NaN", "constructor"]) {
			expect(intOfText(text).errorCode).toBe("TEXT_NOT_A_NUMBER");
		}
		// A base prefix is read as `as number` reads it (FoundBug_baseTextInIntAndFloat).
		expect(intOfText("0x10").toNumber()).toBe(16);
		const long = intOfText("a".repeat(10_000));
		expect(long.type).toBe(ValueType.Error);
		expect(String(long.errorMessage).length).toBeLessThan(120);
	});
});

describe("adversarial", () => {
	test("security: prototype words as text given to a builtin, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(expectHonestLine(`sqrt("${word}")`)).toEqual(expect.objectContaining({ kind: "error", code: "TEXT_ARITHMETIC" }));
				expectHonestLine(`int("${word}")`);
			}
		});
	});

	test("security: look-alike and markup-shaped text inside the quotes", () => {
		for (const edge of TEXT_EDGES) {
			const quoted = JSON.stringify(edge);
			expectHonestLine(`round(${quoted})`);
			expectHonestLine(`int(${quoted})`);
		}
	});

	test("security: a long text is refused within budget", () => {
		expectHonestLine(`sqrt(${RESOURCE_PROBES.longText(1_900)})`);
		expectHonestLine(`int(${RESOURCE_PROBES.longText(1_900)})`);
	});

	test("realistic: text from the line above, and the conversion the message points at", () => {
		const text = 'size = "16"\nsqrt(size)\nsqrt(size as number)\nint(size) + 1';
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch[1]).toBe(`ERROR ${takesText("sqrt")}`);
		expect(batch[2]).toBe("= 4");
		expect(batch[3]).toBe("= 17");
		expect(incremental).toEqual(batch);
	});

	test("edge: a number that is text at the limits", () => {
		expect(shown('int("9007199254740993")')).toBe("9,007,199,254,740,992");
		expect(shown('int("-0")')).toBe("0");
		expect(shown('int("1e400")')).toBe("∞");
		expect(shown('abs("")')).toBe(`TEXT_ARITHMETIC: ${takesText("abs")}`);
	});
});
