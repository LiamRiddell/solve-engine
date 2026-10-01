import { describe, expect, test } from "@jest/globals";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, evaluateLine, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import type { Parser } from "@solve-js/parser/Parser";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { stringValue, numberValue, ValueType } from "@solve-js/vm/Value";
import { countedWord } from "@solve-js/packages/finance/parselets/InflationQueryParselet";
import { countedAmountRefusal, poundSterlingHint } from "@solve-js/packages/finance/data/InflationAmount";
import { inflationCountedAmountHandler } from "@solve-js/packages/finance/parselets/InflationPluginFunctions";

/**
 * Found bug: `what is 100 apples from 1990` answered `Expected "from <year>" or
 * "in <year> worth in <year>" after "what is <amount>", but found "*"`, a star
 * the reader never typed. The normaliser reads `100 apples` as `100 * apples`,
 * and the inflation phrase read its amount at the `*` level (`Product`), so
 * the amount stopped at the inserted star and the parselet named it. The same
 * level stopped a typed `*`: `what is $100 * 2 from 1990` was refused too.
 *
 * The amount is now read just above the conversion `in` (`AMOUNT_BINDING_POWER`),
 * so `*` and `/` belong to it, and a number with a word straight after it
 * (`countedWord`, told apart from a typed star by where the star sits) is
 * refused by that word with `INFLATION_NO_INDEX`, the code `100 kg` already
 * answers, through `inflationCountedAmount`. `100 pounds` is the weight, and
 * its refusal now points at the sterling spelling (`poundSterlingHint`).
 */

/** A line's answer or its refusal, as the reader sees it. */
function shown(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	return `${o.kind === "crashed" ? "CRASH" : "ERROR"} ${o.message}`;
}

/** The code a line answers with, or the kind of answer. */
function code(line: string): string {
	const o = evaluateLine(line);
	return o.kind === "error" || o.kind === "thrown" ? o.code : o.kind;
}

const REFUSED = "a price index adjusts money, and apples is not a currency: give an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100";

describe("the lines that exposed it", () => {
	test.each([
		["what is 100 apples from 1990", `ERROR ${REFUSED}`],
		["what was 100 apples worth in 1990", `ERROR ${REFUSED}`],
		["what is 100 apples in 1990 worth in 2020", `ERROR ${REFUSED}`],
		["what is 100 from 1990", "ERROR a price index measures one currency, and this amount has none: write it with its currency, in US dollars, pounds sterling or euros, such as $100, £100 or €100"],
		["what is 100 kg from 1990", "ERROR a price index adjusts money, and kg is a mass: give an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100"],
		["what is 100 pounds from 1990", "ERROR a price index adjusts money, and pounds is a mass: give an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100 (for pounds sterling, write £100 or 100 GBP)"],
		["what is $100 from 1990", "$253.39"],
		["what is $100 * 2 from 1990", "$506.78"],
		["what is 2 * $100 from 1990", "$506.78"],
		["what is ($300 + $50) from 2003", "$629.96"],
		["what is £100 from 1990", "£327.52"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the refusal is a structured error with the code a non-money amount already answers", () => {
		expect(code("what is 100 apples from 1990")).toBe("INFLATION_NO_INDEX");
		expect(code("what is 100 kg from 1990")).toBe("INFLATION_NO_INDEX");
		expect(evaluateLine("what is 100 apples from 1990").kind).toBe("error");
	});

	test("no refusal names a token the reader did not type", () => {
		for (const line of ["what is 100 apples from 1990", "what was 100 apples worth in 1990", "what is $100 apples from 1990"]) {
			expect(shown(line)).not.toContain('"*"');
		}
	});

	test("the three entry points agree", () => {
		const { batch, incremental } = expectHonestDocument("what is 100 apples from 1990\nwhat is $100 * 2 from 1990\nwhat is 100 kg from 1990");
		expect(batch).toEqual([`ERROR ${REFUSED}`, "= $506.78", "ERROR a price index adjusts money, and kg is a mass: give an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100"]);
		expect(incremental).toEqual(batch);
	});

	test("the boundary: a typed star reads a name's value, and a sum reads as its bracketed form", () => {
		const { batch, incremental } = expectHonestDocument("apples = £2\nwhat is 100 * apples from 1990\nwhat is 100 apples from 1990");
		expect(batch).toEqual(["= £2.00", "= £655.04", `ERROR ${REFUSED}`]);
		expect(incremental).toEqual(batch);
		// A sum is read now, as its bracketed form is (see FoundBug_inflationAmountSum.spec.ts).
		expect(shown("what is $300 + $50 from 2003")).toBe(shown("what is ($300 + $50) from 2003"));
		expect(shown("what is 100 apples")).toBe("ERROR Undefined variable: apples");
		expect(shown("$100 from 1990")).toContain('found "from"');
	});
});

describe("countedWord", () => {
	/** A token of a type at a source offset. */
	function tok(type: string, value: string, offset: number): Token {
		return { type, typeId: tokenTypeId(type), value, text: value, offset } as Token;
	}
	/** A parser that only answers peekAt, positioned on the amount. */
	function at(...tokens: Token[]): Parser {
		return { peekAt: (i: number) => tokens[i] } as unknown as Parser;
	}

	test("ordinary: a number, the inserted star and a word, before each keyword", () => {
		for (const keyword of ["FROM", "IN", "WORTH_IN"]) {
			expect(countedWord(at(tok("NUMBER", "100", 0), tok("STAR", "*", 4), tok("IDENT", "apples", 4), tok(keyword, "from", 11)))).toBe("apples");
		}
	});

	test("a star the reader typed, a unit, or a word away from the keyword is not a counted word", () => {
		expect(countedWord(at(tok("NUMBER", "100", 0), tok("STAR", "*", 4), tok("IDENT", "apples", 6), tok("FROM", "from", 13)))).toBeUndefined();
		expect(countedWord(at(tok("NUMBER", "100", 0), tok("UNIT", "kg", 4), tok("FROM", "from", 7)))).toBeUndefined();
		expect(countedWord(at(tok("NUMBER", "100", 0), tok("STAR", "*", 4), tok("IDENT", "apples", 4), tok("PLUS", "+", 11)))).toBeUndefined();
		expect(countedWord(at(tok("DOLLAR", "$", 0), tok("NUMBER", "100", 1)))).toBeUndefined();
	});

	test("boundary and hostile: a line that ends early, nothing at all, prototype words", () => {
		expect(countedWord(at())).toBeUndefined();
		expect(countedWord(at(tok("NUMBER", "100", 0)))).toBeUndefined();
		expect(countedWord(at(tok("NUMBER", "100", 0), tok("STAR", "*", 4), tok("IDENT", "apples", 4)))).toBeUndefined();
		for (const word of PROTOTYPE_WORDS) {
			expect(countedWord(at(tok("NUMBER", "1", 0), tok("STAR", "*", 2), tok("IDENT", word, 2), tok("FROM", "from", 20)))).toBe(word);
		}
	});
});

describe("countedAmountRefusal, poundSterlingHint and inflationCountedAmountHandler", () => {
	test("ordinary: the word is named where the currency would be", () => {
		expect(countedAmountRefusal("apples")).toBe(REFUSED);
		const v = inflationCountedAmountHandler([stringValue("apples")]);
		expect(v.type).toBe(ValueType.Error);
		expect(v.errorCode).toBe("INFLATION_NO_INDEX");
		expect(v.errorMessage).toBe(REFUSED);
	});

	test("the sterling hint is for the weight's spellings only", () => {
		for (const unit of ["pounds", "pound", "lb", "lbs", "Pounds", "LB"]) expect(poundSterlingHint(unit)).toBe(" (for pounds sterling, write £100 or 100 GBP)");
		for (const unit of ["kg", "GBP", "", "poundsterling", "oz"]) expect(poundSterlingHint(unit)).toBe("");
	});

	test("boundary and hostile: an empty word, no argument, a number, markup and prototype words", () => {
		expect(countedAmountRefusal("")).toContain("and  is not a currency");
		expect(inflationCountedAmountHandler([]).errorCode).toBe("INFLATION_NO_INDEX");
		expect(inflationCountedAmountHandler([numberValue(5)]).errorMessage).toContain("5 is not a currency");
		expect(countedAmountRefusal("<b>x</b>")).toContain("<b>x</b>");
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(countedAmountRefusal(word)).toContain(`${word} is not a currency`);
				expect(poundSterlingHint(word)).toBe("");
			}
		});
		expect(poundSterlingHint(undefined as unknown as string)).toBe("");
	});
});

describe("adversarial", () => {
	test("security: prototype words as the counted word, huge and deep amounts, look-alike and markup text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(code(`what is 100 ${word} from 1990`)).toBe("INFLATION_NO_INDEX");
				expectHonestLine(`what was 5 ${word} worth in 1990`);
				expectHonestDocument(`${word} = £2\nwhat is 100 * ${word} from 1990`);
			}
		});
		expectHonestLine(`what is ${RESOURCE_PROBES.deepParens(200)} apples from 1990`, { budgetMs: 5_000 });
		expectHonestLine(`what is (${RESOURCE_PROBES.longSum(500)}) * $1 from 1990`, { budgetMs: 5_000 });
		expectHonestLine(`what is 100 ${RESOURCE_PROBES.longIdentifier(5_000)} from 1990`, { budgetMs: 5_000 });
		for (const line of fill("what is 100 X from 1990", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("what is X apples from 1990", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a typo in the keyword, the line above as the amount, a check over it, an edit", () => {
		expect(shown("what is 100 apples frm 1990")).not.toContain('"*"');
		const { batch, incremental } = expectHonestDocument("price = $100\nwhat is price * 2 from 1990\nwhat is 3 apples from 1990\ncheck what is $100 from 1990 > $100");
		expect(batch.slice(0, 2)).toEqual(["= $100.00", "= $506.78"]);
		expect(batch[2]).toBe(`ERROR ${REFUSED}`);
		expect(incremental).toEqual(batch);
		expect(shown("what is 100 apples from 1990 + 1")).toBe(`ERROR ${REFUSED}`);
	});

	test("edge: every numeric edge as the count and the year, and the document edges around it", () => {
		for (const line of fill("what is X apples from 1990", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("what is $100 * X from 1990", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("what is 100 apples from X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const doc of DOCUMENT_EDGES) expectHonestDocument(`${doc}\nwhat is 100 apples from 1990`);
		expectHonestDocument("what is 100 apples from 1990\r\nwhat is $100 * 2 from 1990\r\n");
	});
});
