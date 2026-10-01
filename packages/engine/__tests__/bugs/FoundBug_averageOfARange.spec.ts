import { describe, expect, test } from "@jest/globals";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, evaluateLine, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import type { Parser } from "@solve-js/parser/Parser";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { aggregateRangeRefusal, rangeShapedArgument } from "@solve-js/packages/mathphrases/parselets/AggregateRangeArgument";

/**
 * Found bug: `average(1:3)` answered `Expected a line reference such as line 1,
 * but found "1:3"`, and `mean(1:3)`, `median(1:3)` and `stdev(1:3)` said a date
 * or time cannot be averaged. Neither said what had happened. A colon between
 * two numbers is a range only as the list of `sum`, `prod`, `map` and `reduce`
 * (the map-reduce page's rule, and why `sum(1:3)` is 6); everywhere else the
 * normaliser reads it as a clock time, so `average(1:3)` reached the line-range
 * call as 1:03 AM where a line reference was wanted, and `mean(1:3)` reached
 * the aggregate as a time.
 *
 * The aggregates keep the documented reading, since a bracketed list is
 * refused by them too and a range is a list: making only the range work would
 * leave `average([1, 2, 3])` refused beside it. Instead a call whose only
 * argument is written like a range (`rangeShapedArgument`) is refused by name
 * (`aggregateRangeRefusal`, code `AGGREGATE_CALL_RANGE`): what the colon is
 * here, where it is a range, and the spelling that answers.
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

const RULE = "a colon between two numbers is a range only as the list of sum, prod, map or reduce.";

describe("the lines that exposed it", () => {
	test.each([
		["average(1:3)", `ERROR In average(...), 1:3 is a clock time, not a range, and a time cannot be averaged: ${RULE} To average numbers, list them with commas, as in average(1, 2, 3).`],
		["mean(1:3)", `ERROR In mean(...), 1:3 is a clock time, not a range, and a time cannot be averaged: ${RULE} To average numbers, list them with commas, as in mean(1, 2, 3).`],
		["median(1:3)", `ERROR In median(...), 1:3 is a clock time, not a range, and a time cannot be used in a median: ${RULE} To find a median, list the numbers with commas, as in median(1, 2, 3).`],
		["stdev(10:20)", `ERROR In stdev(...), 10:20 is a clock time, not a range, and a time cannot be used in a standard deviation: ${RULE} To find a standard deviation, list the numbers with commas, as in stdev(1, 2, 3).`],
		["average(x:3)", `ERROR In average(...), x:3 is not a range: ${RULE} To average numbers, list them with commas, as in average(1, 2, 3).`],
		["average(1 : 3)", `ERROR In average(...), 1:3 is a clock time, not a range, and a time cannot be averaged: ${RULE} To average numbers, list them with commas, as in average(1, 2, 3).`],
	])("%s is refused by name", (line, expected) => {
		expect(shown(line)).toBe(expected);
		expect(code(line)).toBe("AGGREGATE_CALL_RANGE");
	});

	test("what was right stays right", () => {
		expect(shown("sum(1:3)")).toBe("6");
		// `total` is `sum`'s synonym, so its one-argument call reads the range too
		// (see FoundBug_totalOfARange.spec.ts).
		expect(shown("total(1:3)")).toBe("6");
		expect(shown("prod(1:4)")).toBe("24");
		expect(shown("average(1, 2, 3)")).toBe("2");
		expect(shown("mean(4, 8)")).toBe("6");
		expect(shown("average of 1, 2, 3")).toBe("2");
		expect(shown("max(9:30, 10:15)")).toMatch(/10:15:00 AM$/);
		expect(shown("average(1:3, 4)")).toBe("ERROR A date or time cannot be averaged: only numbers and quantities can.");
		expect(shown("mean()")).toContain("has no values to work on");
	});

	test("a line range keeps its reading through every entry point", () => {
		const { batch, incremental } = expectHonestDocument("1\n2\n3\naverage(line 1 : line 3)\ntotal(line 1 : line 3)\naverage(1:3)");
		expect(batch.slice(3, 5)).toEqual(["= 2", "= 6"]);
		expect(batch[5]).toMatch(/^ERROR In average\(\.\.\.\), 1:3 is a clock time/);
		expect(incremental).toEqual(batch);
	});
});

describe("rangeShapedArgument", () => {
	function tok(type: string, text = type): Token {
		return { type, typeId: tokenTypeId(type), value: text, text, offset: 0 } as Token;
	}
	/** A parser that only answers peekAt, positioned after a call's `(`. */
	function after(...tokens: Token[]): Parser {
		return { peekAt: (i: number) => tokens[i] } as unknown as Parser;
	}

	test("ordinary: a clock time spelled like a range, signed or not, and a bare colon", () => {
		expect(rangeShapedArgument(after(tok("CLOCK_TIME", "1:3"), tok("RPAREN")))).toEqual({ text: "1:3", clock: true });
		expect(rangeShapedArgument(after(tok("MINUS", "-"), tok("CLOCK_TIME", "2:2"), tok("RPAREN")))).toEqual({ text: "-2:2", clock: true });
		expect(rangeShapedArgument(after(tok("IDENT", "x"), tok("COLON", ":"), tok("NUMBER", "3"), tok("RPAREN")))).toEqual({ text: "x:3", clock: false });
	});

	test("not the shape: several arguments, a time with seconds or a meridiem, a plain value", () => {
		expect(rangeShapedArgument(after(tok("CLOCK_TIME", "1:3"), tok("COMMA"), tok("NUMBER", "4"), tok("RPAREN")))).toBeUndefined();
		expect(rangeShapedArgument(after(tok("CLOCK_TIME", "1:3pm"), tok("RPAREN")))).toBeUndefined();
		expect(rangeShapedArgument(after(tok("LAPTIME", "1:30:00"), tok("RPAREN")))).toBeUndefined();
		expect(rangeShapedArgument(after(tok("NUMBER", "5"), tok("RPAREN")))).toBeUndefined();
		expect(rangeShapedArgument(after(tok("RPAREN")))).toBeUndefined();
	});

	test("a comma or a colon inside a nested call or list belongs to it", () => {
		expect(rangeShapedArgument(after(tok("IDENT", "f"), tok("LPAREN"), tok("NUMBER", "1"), tok("COMMA"), tok("NUMBER", "2"), tok("RPAREN"), tok("RPAREN")))).toBeUndefined();
		expect(rangeShapedArgument(after(tok("LBRACKET", "["), tok("NUMBER", "1"), tok("COLON", ":"), tok("NUMBER", "3"), tok("RBRACKET", "]"), tok("RPAREN")))).toBeUndefined();
		expect(rangeShapedArgument(after(tok("IDENT", "f"), tok("LPAREN"), tok("CLOCK_TIME", "1:3"), tok("RPAREN"), tok("RPAREN")))).toBeUndefined();
	});

	test("boundary and hostile: a line that ends inside the call, nothing at all, unbalanced brackets, a very long call", () => {
		expect(rangeShapedArgument(after())).toBeUndefined();
		expect(rangeShapedArgument(after(tok("CLOCK_TIME", "1:3")))).toBeUndefined();
		expect(rangeShapedArgument(after(tok("RBRACKET"), tok("COMMA"), tok("RPAREN")))).toBeUndefined();
		const long = [...Array.from({ length: 20_000 }, () => tok("NUMBER", "1")), tok("RPAREN")];
		const started = Date.now();
		expect(rangeShapedArgument(after(...long))).toBeUndefined();
		expect(Date.now() - started).toBeLessThan(2_000);
		for (const word of PROTOTYPE_WORDS) expect(rangeShapedArgument(after(tok("IDENT", word), tok("RPAREN")))).toBeUndefined();
	});
});

describe("aggregateRangeRefusal", () => {
	function after(...texts: Array<[string, string]>): Parser {
		const tokens = texts.map(([type, text]) => ({ type, typeId: tokenTypeId(type), value: text, text, offset: 0 }) as Token);
		return { peekAt: (i: number) => tokens[i] } as unknown as Parser;
	}

	test("ordinary: each aggregate names what it does and the spelling that answers", () => {
		const range = after(["CLOCK_TIME", "1:3"], ["RPAREN", ")"]);
		expect(aggregateRangeRefusal(range, "average")?.code).toBe("AGGREGATE_CALL_RANGE");
		expect(aggregateRangeRefusal(range, "TOTAL")?.message).toContain("write sum(1:3)");
		expect(aggregateRangeRefusal(range, "stdev")?.message).toContain("standard deviation");
	});

	test("null when the argument is not range-shaped", () => {
		expect(aggregateRangeRefusal(after(["NUMBER", "5"], ["RPAREN", ")"]), "average")).toBeNull();
	});

	test("hostile: an unknown name reads as an average, and prototype words find no entry", () => {
		const range = after(["CLOCK_TIME", "1:3"], ["RPAREN", ")"]);
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const refused = aggregateRangeRefusal(range, word);
				expect(refused?.message).toContain("cannot be averaged");
				expect(refused?.message).not.toContain("[object");
			}
		});
	});
});

describe("adversarial", () => {
	test("security: a huge range, deep brackets, prototype words, look-alike and markup text", () => {
		expect(code(`average(${RESOURCE_PROBES.hugeRange()})`)).toBe("AGGREGATE_CALL_RANGE");
		expectHonestLine(`mean(${RESOURCE_PROBES.deepParens(200)}:3)`, { budgetMs: 5_000 });
		expectHonestLine(`average(${RESOURCE_PROBES.longSum(1_000).replace(/ \+ /g, ":")})`, { budgetMs: 5_000 });
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`average(${word}:3)`);
				expectHonestLine(`mean(1:${word})`);
				expectHonestDocument(`${word} = 2\ntotal(${word}:3)`);
			}
		});
		for (const line of fill("average(X:3)", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("mean(1:3) X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a typo, an unclosed call, the bound from the line above, a check, both passes", () => {
		expect(shown("average(1:3")).toMatch(/^ERROR/);
		expect(shown("averge(1:3)")).not.toMatch(/^CRASH/);
		const { batch, incremental } = expectHonestDocument("n = 3\naverage(1:n)\nsum(1:n) / n\ncheck sum(1:n) / n == 2");
		expect(batch[1]).toMatch(/^ERROR In average\(\.\.\.\), 1:n is not a range/);
		expect(batch.slice(2)).toEqual(["= 2", "= ✓"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge on each side of the colon, and the document edges around it", () => {
		for (const line of fill("average(X:3)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("median(1:X)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(code("average(0:0)")).toBe("AGGREGATE_CALL_RANGE");
		for (const doc of DOCUMENT_EDGES) expectHonestDocument(`${doc}\naverage(1:3)`);
		expectHonestDocument("average(1:3)\r\nmean(1:3)\r\n");
	});
});
