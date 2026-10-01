import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, NUMERIC_EDGES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, boolValue, numberValue, stringValue, uomValue, errorValue } from "@solve-js/vm/Value";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { logicalNot, kindOfOperand } from "@solve-js/packages/conditionals/NotFunctions";
import { isNotWord, negates, notWordNormalizerRule } from "@solve-js/packages/conditionals/normalizer/NotNormalizerRule";
import { NotParselet } from "@solve-js/packages/conditionals/parselets/NotParselet";

/**
 * Issue #751: there was no way to negate a condition. `not` was not a word the
 * engine knew, and `!` was only the factorial after a number, so `!(1 > 2)`
 * failed with a message naming an internal parser token. Now `not` and a
 * prefix `!` negate a boolean, and anything else is refused by name.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const shown = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${shown}` : shown;
	});
}

const batch = (text: string) => read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
const incremental = (text: string) => read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));

/** The raw tokens the lexer gives a line, before the normaliser. */
function lexed(line: string): Token[] {
	const lexer = newTrackedEngine().getLexer();
	lexer.resetExpression(line);
	return Array.from(lexer);
}

describe("not and ! negate a boolean", () => {
	test.each([
		["!true", "false"],
		["!false", "true"],
		["!(1 > 2)", "true"],
		["not true", "false"],
		["not false", "true"],
		["not (1 > 2)", "true"],
		["Not true", "false"],
		["NOT true", "false"],
		["!!true", "true"],
		["not not true", "true"],
		["!true == false", "true"],
		["(5 > 3) == false", "false"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("if not reads as it says", () => {
		expect(show("if not 5 > 3 then 1 else 2")).toBe("2");
		expect(show("if not 5 < 3 then 1 else 2")).toBe("1");
		expect(show("if !(5 > 3) then 1 else 2")).toBe("2");
	});

	test("what must keep working", () => {
		expect(show("5!")).toBe("120");
		expect(show("3 != 4")).toBe("true");
		expect(show("~5")).toBe("-6");
		expect(show("true and false")).toBe("false");
	});
});

describe("how tightly each spelling binds", () => {
	test("not takes a comparison and stops at and, or, && and ||", () => {
		expect(show("not 1 > 2")).toBe("true");
		expect(show("not true and false")).toBe("false");
		expect(show("not false and false")).toBe("false");
		expect(show("not false or true")).toBe("true");
		expect(show("not true && true")).toBe("false");
		expect(show("not true || true")).toBe("true");
	});

	test("! takes the one value after it, as in C", () => {
		// `!1 > 2` negates 1, which is refused, rather than negating the comparison.
		expect(show("!1 > 2")).toMatch(/^"!" works on true or false, and 1 is a number/);
		expect(show("!(1 > 2) and true")).toBe("true");
	});

	test("between variables, in a document", () => {
		expect(batch("a = 4\nb = 2\nnot a > b\nnot a < b and b > 1\nif not a > b then \"small\" else \"big\"")).toEqual(["4", "2", "false", "true", "big"]);
	});
});

describe("negation of anything but a boolean is refused by name", () => {
	test.each([
		["!5", '"!" works on true or false, and 5 is a number: compare it first, as in not (x > 3).'],
		["not 5", '"not" works on true or false, and 5 is a number: compare it first, as in not (x > 3).'],
		["not 0", '"not" works on true or false, and 0 is a number: compare it first, as in not (x > 3).'],
		["not $5", '"not" works on true or false, and $5.00 is an amount: compare it first, as in not (x > 3).'],
		['not "yes"', '"not" works on true or false, and yes is text: compare it first, as in not (x > 3).'],
		["!(2 km)", '"!" works on true or false, and 2.00 km is an amount: compare it first, as in not (x > 3).'],
	])("%s", (line, message) => {
		const value = newTrackedEngine().evaluateExpression(line);
		expect(value.type).toBe(ValueType.Error);
		expect(value.errorCode).toBe("NOT_NEEDS_BOOLEAN");
		expect(show(line)).toBe(message);
	});

	test("~ stays the bit complement and ! after a value stays the factorial", () => {
		expect(show("~0")).toBe("-1");
		expect(show("x!")).toMatch(/Undefined variable: x/);
		expect(batch("x = 5\nx!")).toEqual(["5", "120"]);
		expect(show("5!!")).not.toMatch(/works on true or false/);
	});

	test("a stray ! says what is missing, in words", () => {
		expect(show("!")).toBe('THROWS The line ends after "!", where a value was expected');
		expect(show("5 + !")).toBe('THROWS The line ends after "!", where a value was expected');
		expect(show("5 + !")).not.toMatch(/BANG|parselet/);
	});
});

describe("prose and the variable called not stay as they were", () => {
	test("a sentence that starts with not is still a non-answer", () => {
		for (const line of ["not now", "not sure", "not yet", "not really, no", "not today"]) {
			expect(show(line)).toMatch(/^THROWS /);
		}
	});

	test("not is still a name where no condition follows it", () => {
		expect(batch("not = 3\nnot + 1\nnot * 2\nnot")).toEqual(["3", "4", "6", "3"]);
		expect(show("not")).toBe("THROWS Undefined variable: not");
	});

	test("not inside a label is the label's word", () => {
		expect(show("Not paid: $5")).toBe("$5.00");
		expect(show("not paid: $5")).toBe("$5.00");
	});

	test("a check over a negation", () => {
		expect(show("check !(1 > 2)")).toMatch(/^THROWS a check compares two things/);
		expect(show("check not (1 > 2)")).toMatch(/^THROWS a check compares two things/);
	});
});

describe("logicalNot", () => {
	test("ordinary: negates a boolean", () => {
		expect(logicalNot([boolValue(true), stringValue("not")]).value).toBe(false);
		expect(logicalNot([boolValue(false), stringValue("!")]).value).toBe(true);
		expect(logicalNot([boolValue(false), stringValue("!")]).type).toBe(ValueType.Boolean);
	});

	test("boundary: a missing operand and a missing spelling", () => {
		expect(logicalNot([]).errorCode).toBe("NOT_NEEDS_BOOLEAN");
		expect(logicalNot([boolValue(true)]).value).toBe(false);
		expect(logicalNot([numberValue(1)]).errorMessage).toMatch(/^"not" works/);
	});

	test("hostile: numbers, zero, text, money and an error-looking text are refused", () => {
		for (const v of [numberValue(0), numberValue(-0), numberValue(NaN), numberValue(Infinity), stringValue("true"), uomValue(5, "USD")]) {
			const r = logicalNot([v, stringValue("not")]);
			expect(r.type).toBe(ValueType.Error);
			expect(r.errorCode).toBe("NOT_NEEDS_BOOLEAN");
		}
		const long = logicalNot([stringValue("x".repeat(500)), stringValue("not")]);
		expect(String(long.errorMessage).length).toBeLessThan(200);
		expect(logicalNot([stringValue("[object Object]"), stringValue("not")]).errorMessage).toMatch(/is text/);
	});

	test("kindOfOperand names every kind in words", () => {
		expect(kindOfOperand(numberValue(1))).toBe("a number");
		expect(kindOfOperand(uomValue(1, "km"))).toBe("an amount");
		expect(kindOfOperand(stringValue(""))).toBe("text");
		expect(kindOfOperand(errorValue("X", "y"))).toBe("another kind of value");
	});
});

describe("the not normaliser rule", () => {
	const rule = notWordNormalizerRule();

	test("isNotWord", () => {
		expect(isNotWord(lexed("not")[0])).toBe(true);
		expect(isNotWord(lexed("NOT")[0])).toBe(true);
		expect(isNotWord(lexed("note")[0])).toBe(false);
		expect(isNotWord(undefined)).toBe(false);
	});

	test("ordinary: fuses a not at the start of a line or after if, before a condition", () => {
		expect(negates(lexed("not true"), 0)).toBe(true);
		expect(negates(lexed("not (1 > 2)"), 0)).toBe(true);
		expect(negates(lexed("if not x then 1 else 2"), 1)).toBe(true);
		expect(rule.match(lexed("not true"), 0)?.replacement[0].type).toBe("NOT");
	});

	test("boundary: nothing after it, an = after it, an operator after it", () => {
		expect(negates(lexed("not"), 0)).toBe(false);
		expect(negates(lexed("not = 3"), 0)).toBe(false);
		expect(negates(lexed("not + 1"), 0)).toBe(false);
		expect(negates(lexed("not x = 5"), 0)).toBe(false);
		expect(negates(lexed("x not y"), 1)).toBe(false);
		expect(rule.match(lexed("not = 3"), 0)).toBeNull();
	});

	test("hostile: another word at the position, an empty line, a past-the-end position", () => {
		expect(negates(lexed("knot true"), 0)).toBe(false);
		expect(negates([], 0)).toBe(false);
		expect(negates(lexed("not true"), 5)).toBe(false);
		expect(rule.match(lexed("constructor true"), 0)).toBeNull();
	});
});

describe("NotParselet", () => {
	test("each spelling compiles to the one plugin call and quotes itself", () => {
		const engine = newTrackedEngine();
		expect(show("not 5")).toMatch(/^"not"/);
		expect(show("!5")).toMatch(/^"!"/);
		expect(new NotParselet("not", 16).category).toBe("Conditionals");
		expect(engine.evaluateExpression("!true").type).toBe(ValueType.Boolean);
	});
});

describe("adversarial", () => {
	test.each(fill("not (X > 0)", NUMERIC_EDGES))("not over a numeric edge: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test.each(fill("!X", NUMERIC_EDGES))("! over a numeric edge: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test.each(TEXT_EDGES.map((t) => `not ${t}`))("not before a text edge: %j", (line) => {
		expectHonestLine(line);
	});

	test.each(PROTOTYPE_WORDS)("a prototype word after not and after !: %s", (word) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(`not ${word}`);
			expectHonestLine(`!${word}`);
			expectHonestDocument(`${word} = true\nnot ${word}`);
		});
	});

	test("a long chain of negations answers in time", () => {
		expectHonestLine(`${"not ".repeat(500)}true`, { budgetMs: 5_000 });
		expectHonestLine(`${"!".repeat(2_000)}true`, { budgetMs: 5_000 });
	});

	test("look-alike characters are not the operator", () => {
		// A fullwidth exclamation mark and the letters of `not` with a zero-width space.
		expectHonestLine("！true");
		expectHonestLine("n​ot true");
	});

	test("the two document passes agree", () => {
		const text = "a = 4\nb = 2\nnot a > b\n!(a > b)\nnot 5\nnot now\nnot = 3\nnot + 1";
		expect(incremental(text)).toEqual(batch(text));
		expectHonestDocument(text);
	});

	test("3 ! = 4 with spaces stays a non-answer", () => {
		expect(show("3 ! = 4")).toMatch(/^THROWS /);
	});
});
