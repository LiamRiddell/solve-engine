import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Parser } from "@solve-js/parser/Parser";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { callHasOwnComma } from "@solve-js/packages/mapreduce/MapReduceShared";

/**
 * Found bug: `sum(1:3)` threw `Expected ","`, though the ratios page said a
 * colon inside an aggregate is a range. The colon inside `sum(` was already a
 * range, not a clock time (the normaliser's range context), but `sum` and
 * `prod` had only their two-argument form, `sum(expression, list)`, so the
 * range's start was read as the expression and the parser stopped at its colon.
 *
 * `sum` and `prod` with a single argument now fold the list's own elements
 * (`parseElementFold`), as `sum(x, list)` does, once `callHasOwnComma` has seen
 * that the call has no comma of its own. The pages now say where a colon is a
 * range (the list of map, reduce, sum and prod) and where it is a clock time
 * (everywhere else, `max(9:30, 10:15)` included).
 */

function shown(line: string, engine = newTrackedEngine()): string {
	try {
		const v = engine.evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["sum(1:3)", "6"],
		["sum(0:4)", "10"],
		["sum(-2:2)", "0"],
		["sum(1:10)", "55"],
		["prod(1:4)", "24"],
		["prod(1:5)", "120"],
		["sum([1,2,3])", "6"],
		["sum([10, 20, 30])", "60"],
		["prod([2,3,4])", "24"],
		["sum([1 m, 2 m])", "3.00 m"],
		["sum([£1, £2])", "£3.00"],
		["sum(max(1, 2):4)", "9"],
		["sum(1:3) + 1", "7"],
		["sum(1:100000)", "5,000,050,000"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("the two-argument and spreadsheet forms read as they did", () => {
		expect(shown("sum(x, 1:3)")).toBe("6");
		expect(shown("sum(x^2, 1:3)")).toBe("14");
		expect(shown("prod(x, [2,3,4])")).toBe("24");
		expect(shown("sum(10, 20, 30)")).toBe("60");
		expect(shown("sum(5, 5)")).toBe("10");
	});

	test("a list held in a variable", () => {
		const { batch, incremental } = expectHonestDocument("xs = [1, 2, 3]\nsum(xs)\nprod(xs)");
		expect(batch).toEqual(["= [1, 2, 3]", "= 6", "= 6"]);
		expect(incremental).toEqual(batch);
	});

	test("the boundary: what is not a list, or not a whole-number range, is refused by name", () => {
		expect(shown("sum(5)")).toContain("requires a Matrix or Range collection");
		expect(shown('sum("abc")')).toContain("requires a Matrix or Range collection");
		expect(shown("sum(3:1)")).toContain("cannot be greater than its max");
		expect(shown("sum(1.5:3)")).toContain("must be whole numbers");
		expect(shown("sum(1:3 m)")).toContain("must be plain numbers");
		expect(shown("sum()")).toMatch(/^THROWS Expected a value/);
	});

	test("outside map, reduce, sum and prod a colon is still a clock time", () => {
		expect(shown("max(9:30, 10:15)")).toMatch(/10:15:00 AM$/);
		expect(shown("(0:3)")).toMatch(/12:03:00 AM$/);
	});
});

describe("callHasOwnComma", () => {
	function tok(type: string, value = type): Token {
		return { type, typeId: tokenTypeId(type), value, text: value, offset: 0 } as Token;
	}
	/** A parser that only answers peekAt, positioned after a call's `(`. */
	function after(...types: string[]): Parser {
		const tokens = types.map((t) => tok(t));
		return { peekAt: (i: number) => tokens[i] } as unknown as Parser;
	}

	test("ordinary: a comma of the call's own, and none", () => {
		expect(callHasOwnComma(after("IDENT", "COMMA", "NUMBER", "COLON", "NUMBER", "RPAREN"))).toBe(true);
		expect(callHasOwnComma(after("NUMBER", "COLON", "NUMBER", "RPAREN"))).toBe(false);
	});

	test("a comma inside a list or a nested call is not the call's own", () => {
		expect(callHasOwnComma(after("LBRACKET", "NUMBER", "COMMA", "NUMBER", "RBRACKET", "RPAREN"))).toBe(false);
		expect(callHasOwnComma(after("IDENT", "LPAREN", "NUMBER", "COMMA", "NUMBER", "RPAREN", "COLON", "NUMBER", "RPAREN"))).toBe(false);
		expect(callHasOwnComma(after("LBRACKET", "NUMBER", "RBRACKET", "COMMA", "LBRACKET", "RBRACKET", "RPAREN"))).toBe(true);
	});

	test("a comma after the call's close belongs to the line, not the call", () => {
		expect(callHasOwnComma(after("NUMBER", "RPAREN", "COMMA", "NUMBER"))).toBe(false);
	});

	test("boundary and hostile: an empty call, a line that ends inside it, unbalanced brackets", () => {
		expect(callHasOwnComma(after("RPAREN"))).toBe(false);
		expect(callHasOwnComma(after())).toBe(false);
		expect(callHasOwnComma(after("NUMBER", "COLON"))).toBe(false);
		expect(callHasOwnComma(after("LPAREN", "LPAREN", "COMMA"))).toBe(false);
		expect(callHasOwnComma(after("RBRACKET", "COMMA"))).toBe(false);
		expect(callHasOwnComma(after("COMMA"))).toBe(true);
		for (const word of PROTOTYPE_WORDS) expect(callHasOwnComma(after("IDENT", word))).toBe(false);
	});

	test("a long call is read once, in linear time", () => {
		const tokens = [...Array.from({ length: 100_000 }, () => "NUMBER"), "RPAREN"];
		const started = Date.now();
		expect(callHasOwnComma(after(...tokens))).toBe(false);
		expect(Date.now() - started).toBeLessThan(2_000);
	});
});

describe("adversarial", () => {
	test("security: a huge range, deep brackets inside the call, and prototype words as the list", () => {
		expect(shown(`sum(${RESOURCE_PROBES.hugeRange()})`)).toContain("past the limit");
		expect(shown("prod(1:1000000000)")).toContain("past the limit");
		expectHonestLine(`sum(${RESOURCE_PROBES.deepParens(200)}:3)`, { budgetMs: 5_000 });
		expectHonestLine(`sum([${RESOURCE_PROBES.longSum(1_000).replace(/ \+ /g, ", ")}])`, { budgetMs: 5_000 });
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`sum(${word})`);
				expectHonestDocument(`${word} = [1, 2]\nsum(${word})`);
			}
		});
		for (const line of fill("sum(1:3) X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("sum(X:3)", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a typo, an unclosed call, a sum over the line above, and both passes", () => {
		expect(shown("sum(1:3")).toMatch(/^THROWS/);
		expect(shown("sum(1;3)")).not.toBe("6");
		const { batch, incremental } = expectHonestDocument("n = 4\nsum(1:n)\nprod(1:n)\ncheck sum(1:n) == 10\nline 2 with n = 5");
		expect(batch.slice(0, 4)).toEqual(["= 4", "= 10", "= 24", "= ✓"]);
		expect(batch[4]).toBe("= 15");
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge as a bound and as an element", () => {
		for (const line of fill("sum(X:3)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("prod(1:X)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("sum([X, 1])", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("sum(0:0)")).toBe("0");
		expect(shown("prod(0:3)")).toBe("0");
	});
});
