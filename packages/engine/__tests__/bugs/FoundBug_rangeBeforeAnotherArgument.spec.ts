import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Token } from "@solve-js/lexer/Token";
import { isRangeShapedPair, rangeBeforeLaterArgument, rangeCallWord, restOfCall } from "@solve-js/normalizer/RangeArgumentOrder";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `sum(100:200,50)` was refused as '"100:200" is not a valid
 * time'.
 *
 * A colon between two numbers is a range only as the list `sum`, `prod`, `map`
 * and `reduce` work through, their last argument; the first of several is the
 * expression worked out for each element, where a colon pair is a clock time.
 * So a range followed by more items is not a form (the map-reduce page says so),
 * and the pair was refused as the time it cannot be, which answered a question
 * the reader never asked. A whole-number pair in a range's shape, written as
 * the first of several arguments, is now refused by name as a range in the
 * wrong place (`RANGE_BEFORE_ANOTHER_ARGUMENT`, from `rangeBeforeLaterArgument`
 * in normalizer/RangeArgumentOrder.ts), with the call that answers. A real time
 * (`sum(10:12, 5)`) and a pair in a clock's shape (`sum(24:30, 1)`) are still
 * times.
 */

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A line's answer through the single-line entry point evaluateLine, or `CODE: message`. */
function single(line: string): string {
	try {
		const value = newTrackedEngine().evaluateLine(1, line);
		if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (error) {
		if (error instanceof EngineError) return `${error.code}: ${error.message}`;
		throw error;
	}
}

/** A document line's answer, or `ERROR <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "ERROR no line";
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	if (line.result.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** Each line of a document through both document passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** Tokens laid out from `[type, text]` pairs, with a space wherever the text of a pair starts with one. */
function lay(...pairs: [string, string][]): Token[] {
	const out: Token[] = [];
	let offset = 0;
	for (const [type, raw] of pairs) {
		const text = raw.trimStart();
		offset += raw.length - text.length;
		out.push({ type, value: text, text, offset, line: 1, col: offset + 1, lineBreaks: 0 } as unknown as Token);
		offset += text.length;
	}
	return out;
}

const SUM_REFUSAL =
	"RANGE_BEFORE_ANOTHER_ARGUMENT: In sum(...), 100:200 is a range, and a range is read only as the last argument, the list sum works through. To add other numbers in as well, write them outside the call: sum(100:200) + 50.";

describe("the lines that exposed it", () => {
	test.each(["sum(100:200,50)", "sum(100:200, 50)"])("%s names the range, through evaluateExpression and evaluateLine", (line) => {
		expect(outcome(line)).toBe(SUM_REFUSAL);
		expect(single(line)).toBe(SUM_REFUSAL);
	});

	test("the other calls a range is the list of", () => {
		expect(outcome("prod(100:200, 50)")).toBe(
			"RANGE_BEFORE_ANOTHER_ARGUMENT: In prod(...), 100:200 is a range, and a range is read only as the last argument, the list prod works through. To multiply other numbers in as well, write them outside the call: prod(100:200) * 50.",
		);
		expect(outcome("map(100:200, 5)")).toBe(
			"RANGE_BEFORE_ANOTHER_ARGUMENT: In map(...), 100:200 is a range, and a range is read only as the last argument, the list map works through. Write the expression first and the range last, as in map(x * 2, 100:200).",
		);
		expect(outcome("reduce(100:200, 1)")).toMatch(/as in reduce\(acc \+ x, 100:200\)\.$/);
		expect(outcome("total(100:200, 50)")).toMatch(/^RANGE_BEFORE_ANOTHER_ARGUMENT: In total\(\.\.\.\), 100:200 is a range/);
		expect(outcome("sum(100:200, 50, 3)")).toMatch(/sum\(100:200\) \+ 50 \+ 3\.$/);
	});

	test("the call the refusal names answers", () => {
		expect(outcome("sum(100:200) + 50")).toBe("15,200");
		expect(outcome("sum(x, 100:200)")).toBe("15,150");
		expect(outcome("sum(1, 100:200)")).toBe("101");
	});

	test("through both document passes, which agree", () => {
		expect(both(["sum(100:200, 50)", "sum(100:200) + 50"])).toEqual([`ERROR ${SUM_REFUSAL.replace(/^[A-Z_]+: /, "")}`, "15,200"]);
	});

	test("a time, a pair in a clock's shape and a countdown are still times", () => {
		expect(outcome("sum(10:12, 5)")).toBe("AGGREGATE_NON_NUMERIC: A date or time cannot be added: only numbers and quantities can.");
		expect(outcome("sum(24:30, 1)")).toBe('INVALID_TIME_LITERAL: "24:30" is not a valid time');
		expect(outcome("sum(9:60, 1)")).toBe('INVALID_TIME_LITERAL: "9:60" is not a valid time');
		expect(outcome("sum(24:00, 1)")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("sum(1.5:3, 2)")).toBe('INVALID_TIME_LITERAL: "1.5:3" is not a valid time');
	});
});

describe("the parts: isRangeShapedPair", () => {
	test("ordinary: whole numbers counting up, not in a clock's shape", () => {
		expect(isRangeShapedPair("100", "200")).toBe(true);
		expect(isRangeShapedPair("1", "100")).toBe(true);
		expect(isRangeShapedPair("123", "45")).toBe(false);
	});

	test("boundary: a clock's shape, equal bounds, zero", () => {
		expect(isRangeShapedPair("24", "30")).toBe(false);
		expect(isRangeShapedPair("9", "60")).toBe(false);
		expect(isRangeShapedPair("100", "100")).toBe(true);
		expect(isRangeShapedPair("0", "100")).toBe(true);
	});

	test("hostile: decimals, signs, other scripts, empty and very long digits", () => {
		expect(isRangeShapedPair("1.5", "300")).toBe(false);
		expect(isRangeShapedPair("-100", "200")).toBe(false);
		expect(isRangeShapedPair("١٠٠", "200")).toBe(false);
		expect(isRangeShapedPair("", "200")).toBe(false);
		expect(isRangeShapedPair("1".repeat(17), "9".repeat(17))).toBe(false);
	});
});

describe("the parts: rangeCallWord", () => {
	test("ordinary, boundary and hostile calls", () => {
		expect(rangeCallWord(lay(["IDENT", "sum"], ["LPAREN", "("]), 1)).toBe("sum");
		expect(rangeCallWord(lay(["IDENT", "Total"], ["LPAREN", "("]), 1)).toBe("total");
		expect(rangeCallWord(lay(["SUM_FN", "sum"], ["LPAREN", "("]), 1)).toBe("sum");
		expect(rangeCallWord(lay(["MAP", "map"], ["LPAREN", "("]), 1)).toBe("map");
		expect(rangeCallWord(lay(["IDENT", "max"], ["LPAREN", "("]), 1)).toBeUndefined();
		expect(rangeCallWord(lay(["LPAREN", "("]), 0)).toBeUndefined();
		expect(rangeCallWord(lay(["IDENT", "sum"], ["NUMBER", "1"]), 1)).toBeUndefined();
		expect(rangeCallWord(lay(["IDENT", "constructor"], ["LPAREN", "("]), 1)).toBeUndefined();
		expect(rangeCallWord(lay(["toString", "x"], ["LPAREN", "("]), 1)).toBeUndefined();
	});
});

describe("the parts: restOfCall and rangeBeforeLaterArgument", () => {
	const call = lay(["IDENT", "sum"], ["LPAREN", "("], ["NUMBER", "100"], ["COLON", ":"], ["NUMBER", "200"], ["COMMA", ","], ["NUMBER", " 50"], ["COMMA", ","], ["NUMBER", " 3"], ["RPAREN", ")"]);

	test("ordinary: each later argument, and the refusal", () => {
		expect(restOfCall(call, 6)).toEqual(["50", "3"]);
		expect(rangeBeforeLaterArgument(call, 2, 3)?.code).toBe("RANGE_BEFORE_ANOTHER_ARGUMENT");
	});

	test("boundary: no later argument, an empty one, a call left open, a pair not first", () => {
		expect(restOfCall(lay(["RPAREN", ")"]), 0)).toBeNull();
		expect(restOfCall(lay(["NUMBER", "5"], ["COMMA", ","], ["RPAREN", ")"]), 0)).toBeNull();
		expect(restOfCall(lay(["NUMBER", "5"]), 0)).toBeNull();
		expect(rangeBeforeLaterArgument(call, 2, 5)).toBeNull();
		const alone = lay(["IDENT", "sum"], ["LPAREN", "("], ["NUMBER", "100"], ["COLON", ":"], ["NUMBER", "200"], ["RPAREN", ")"]);
		expect(rangeBeforeLaterArgument(alone, 2, 3)).toBeNull();
		const later = lay(["IDENT", "sum"], ["LPAREN", "("], ["NUMBER", "1"], ["COMMA", ","], ["NUMBER", "100"], ["COLON", ":"], ["NUMBER", "200"], ["COMMA", ","], ["NUMBER", "5"], ["RPAREN", ")"]);
		expect(rangeBeforeLaterArgument(later, 4, 3)).toBeNull();
	});

	test("hostile: nested brackets, a long rest, and a rest too long to quote", () => {
		expect(restOfCall(lay(["LPAREN", "("], ["NUMBER", "1"], ["COMMA", ","], ["NUMBER", "2"], ["RPAREN", ")"], ["RPAREN", ")"]), 0)).toEqual(["(1,2)"]);
		const long = lay(...Array.from({ length: 40 }, (_, k): [string, string] => (k % 2 === 0 ? ["NUMBER", "12345"] : ["COMMA", ","])), ["RPAREN", ")"]);
		expect(restOfCall(long, 0)).toBeNull();
		const runaway = lay(...Array.from({ length: 30_000 }, (): [string, string] => ["LPAREN", "("]));
		expect(restOfCall(runaway, 0)).toBeNull();
	});
});

describe("adversarial: security", () => {
	test("a prototype word as a later argument is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("sum(100:200, X)", PROTOTYPE_WORDS)) expect(outcome(line)).toMatch(/^RANGE_BEFORE_ANOTHER_ARGUMENT: /);
			for (const line of fill("X(100:200, 50)", PROTOTYPE_WORDS)) expect(outcome(line)).not.toMatch(/^RANGE_BEFORE_ANOTHER_ARGUMENT: /);
		});
	});

	test("a long rest, many arguments and deep brackets are refused within the budget", () => {
		expectHonestLine(`sum(100:200, ${RESOURCE_PROBES.longSum(2_000)})`, { budgetMs: 5_000 });
		expectHonestLine(`sum(100:200, ${Array.from({ length: 2_000 }, () => "1").join(", ")})`, { budgetMs: 5_000 });
		expectHonestLine(`sum(100:200, ${RESOURCE_PROBES.deepParens(500)})`, { budgetMs: 5_000 });
	});

	test("markup-shaped and look-alike text as a later argument is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`sum(100:200, ${edge})`);
		expect(outcome("sum(١٠٠:200, 50)")).not.toMatch(/^RANGE_BEFORE_ANOTHER_ARGUMENT: /);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a bound from the line above is no literal pair, a check and a section around it", () => {
		expect(both(["# Totals", "a = 100", "sum(a:200, 50)", "check sum(100:200) + 50 == 15,200"])).toEqual([
			"",
			"100",
			// A name as a bound is no pair of numbers for the rule to read, so
			// the parser's own wording stands (the boundary in the changeset).
			'ERROR Expected ")", but found ":"',
			"✓",
		]);
		expectHonestDocument("sum(100:200, 50)\nprod(1:5, 2)\nmap(1:3, 2)\nsum(1:3)");
	});

	test("a label before the call keeps the refusal", () => {
		expect(outcome("Total: sum(100:200, 50)")).toBe(SUM_REFUSAL);
	});
});

describe("adversarial: edge cases", () => {
	test("zero, equal bounds, a grouped bound and the largest whole numbers", () => {
		expect(outcome("sum(0:100, 1)")).toMatch(/^RANGE_BEFORE_ANOTHER_ARGUMENT: In sum\(\.\.\.\), 0:100 is a range/);
		expect(outcome("sum(100:100, 1)")).toMatch(/^RANGE_BEFORE_ANOTHER_ARGUMENT: /);
		expect(outcome("sum(1,000:1,002, 5)")).toMatch(/^RANGE_BEFORE_ANOTHER_ARGUMENT: In sum\(\.\.\.\), 1,000:1,002 is a range/);
		expectHonestLine("sum(9007199254740992:9007199254740993, 1)");
	});

	test("each numeric edge as a later argument is honest", () => {
		for (const line of fill("sum(100:200, X)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["sum(100:200, 50)\r", ""])).toEqual([`ERROR ${SUM_REFUSAL.replace(/^[A-Z_]+: /, "")}`, ""]);
	});
});
