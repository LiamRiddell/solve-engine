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
import { formatValue } from "@solve-js/format/FormatEngine";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { digitsBefore, firstBoundBefore, groupsEnd, groupsRangeBoundInCall } from "@solve-js/lexer/RangeBoundGrouping";
import { isPlainNumber } from "@solve-js/packages/mapreduce/MapReduceShared";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `sum(1,000:1)` answered 2, a confident wrong number.
 *
 * Inside a call's brackets a comma separates arguments, so the comma of
 * `1,000:1` split the call into `1` and `000:1`: the element form of `sum`,
 * adding 1 once for each whole number from 0 to 1. `sum(1,000:2,000)` was
 * refused as the clock time "000:2". A range bound written with its thousands
 * grouped, the comma straight against the range's colon, is now read as the
 * grouped number (lexer/RangeBoundGrouping.ts): `sum(1,000:2,000)` adds the
 * whole numbers from 1,000 to 2,000, and `sum(1,000:1)` is refused as a range
 * that counts down. A plain number keeps the separator reading, as the
 * currency page documents (`max(1,000, 2)` is 2).
 */

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A line's answer through the single-line entry point evaluateLine. */
function single(line: string): string {
	const value = newTrackedEngine().evaluateLine(1, line);
	if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
	return formatValue(value).replace(/^=\s*/, "");
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

/** A line's tokens, spaces and line breaks left out. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

/** The refusal of `sum(1,000:1)`, a range that counts down. */
const COUNTS_DOWN = 'DESCENDING_RANGE: A range\'s min (1000) cannot be greater than its max (1). Did you mean "1:1000"?';

describe("the lines that exposed it", () => {
	test.each([
		["sum(1,000:1)", COUNTS_DOWN],
		["sum(1,000:2,000)", "1,501,500"],
		["total(1,000:5)", 'DESCENDING_RANGE: A range\'s min (1000) cannot be greater than its max (5). Did you mean "5:1000"?'],
		["sum(1,000:1,005)", "6,015"],
		["total(1,000:1,002)", "3,003"],
	])("%s", (line, answer) => {
		expect(outcome(line)).toBe(answer);
	});

	test("the grouped bound is the same range as the bound written without the comma", () => {
		expect(outcome("sum(1,000:2,000)")).toBe(outcome("sum(1000:2000)"));
		expect(outcome("sum(1,000:1)")).toBe(outcome("sum(1000:1)"));
	});

	test("every form that takes a range reads it", () => {
		expect(outcome("sum(x, 1,000:1,002)")).toBe("3,003");
		expect(outcome("sum(x^2, 1,000:1,002)")).toBe("3,006,005");
		expect(outcome("prod(1,000:1,001)")).toBe("1,001,000");
		expect(outcome("map(x*2, 1,000:1,002)")).toBe("[2,000, 2,002, 2,004]");
		expect(outcome("reduce(acc+x, 1,000:1,002)")).toBe("3,003");
		expect(outcome("sum(1,000,000:1,000,002)")).toBe("3,000,003");
		expect(outcome("sum(100:1,000)")).toBe("495,550");
	});

	test("through the three entry points", () => {
		expect(single("sum(1,000:1)")).toBe(COUNTS_DOWN);
		expect(single("sum(1,000:2,000)")).toBe("1,501,500");
		expect(both(["sum(1,000:2,000)", "sum(1,000:1)", "total(1,000:1,002)"])).toEqual([
			"1,501,500",
			`ERROR ${COUNTS_DOWN.replace(/^DESCENDING_RANGE: /, "")}`,
			"3,003",
		]);
	});
});

describe("where the comma still separates", () => {
	test("a plain number in a call keeps the separator reading the currency page documents", () => {
		expect(outcome("max(1,000, 2)")).toBe("2");
		expect(outcome("sum(1,000, 2)")).toBe("3");
		expect(outcome("max(1,000, 5)")).toBe("5");
		expect(outcome("sum(1,000)")).toBe("1");
		expect((lex("rgb(255,255,255)").filter((t) => t.type === "NUMBER")).map((t) => t.text)).toEqual(["255", "255", "255"]);
	});

	test("a space after the comma says two arguments", () => {
		expect(outcome("sum(1, 100:200)")).toBe("101");
		expect(outcome("sum(1, 0:1)")).toBe("2");
	});

	test("a clock time before the comma keeps it a separator", () => {
		expect(outcome("max(9:30,100)")).toBe("AGGREGATE_NON_NUMERIC: A date or time cannot be compared: only numbers and quantities can.");
		expect(outcome("sum(1:2,000)")).toBe("AGGREGATE_NON_NUMERIC: A date or time cannot be added: only numbers and quantities can.");
	});

	test("outside a call the comma groups as it always has", () => {
		expect(outcome("1,000 + 1")).toBe("1,001");
		expect(outcome("(1,000)")).toBe("1,000");
	});
});

describe("the parts: groupsRangeBoundInCall", () => {
	/** The decision for the first comma after the number starting at `start`. */
	const at = (text: string, start: number): boolean => groupsRangeBoundInCall(text, start, text.indexOf(",", start));

	test("ordinary: a first bound whose groups end at the colon, and a second after a long first", () => {
		expect(at("sum(1,000:1)", 4)).toBe(true);
		expect(at("sum(12,345:1)", 4)).toBe(true);
		expect(at("sum(123,456,789:1)", 4)).toBe(true);
		expect(at("sum(100:1,000)", 8)).toBe(true);
		expect(at("sum(1,000:2,000)", 10)).toBe(true);
		// The second group of a bound is weighed too.
		expect(groupsRangeBoundInCall("sum(1,000,000:1)", 4, 9)).toBe(true);
	});

	test("boundary: a plain argument, a time before the colon, a group of other than three digits", () => {
		expect(at("max(1,000, 2)", 4)).toBe(false);
		expect(at("max(1,000)", 4)).toBe(false);
		expect(at("max(9:30,100)", 6)).toBe(false);
		expect(at("sum(1:2,000)", 6)).toBe(false);
		expect(at("sum(10:2,000)", 7)).toBe(false);
		expect(at("sum(1,0000:1)", 4)).toBe(false);
		expect(at("sum(1,00:1)", 4)).toBe(false);
		expect(at("sum(1234,000:1)", 4)).toBe(false);
		expect(at("sum(1,000 :1)", 4)).toBe(false);
		expect(at("sum(1,000,5:7)", 4)).toBe(false);
		// A second bound must end the argument.
		expect(at("sum(100:1,000x)", 8)).toBe(false);
		expect(at("sum(100:1,000)", 8)).toBe(true);
		expect(at("sum(100:1,000 )", 8)).toBe(true);
		expect(at("sum(100:1,000", 8)).toBe(true);
	});

	test("hostile: not a comma, out of range positions, empty text, look-alike characters", () => {
		expect(groupsRangeBoundInCall("", 0, 0)).toBe(false);
		expect(groupsRangeBoundInCall("1,000:1", 0, 5)).toBe(false);
		expect(groupsRangeBoundInCall("1,000:1", -3, 1)).toBe(false);
		expect(groupsRangeBoundInCall("1,000:1", 0, 99)).toBe(false);
		expect(groupsRangeBoundInCall("1，000:1", 0, 1)).toBe(false);
		expect(groupsRangeBoundInCall("1,٠٠٠:1", 0, 1)).toBe(false);
		expect(groupsRangeBoundInCall("1,0​00:1", 0, 1)).toBe(false);
		expect(groupsRangeBoundInCall(`1${",000".repeat(5_000)}:1`, 0, 1)).toBe(true);
	});
});

describe("the parts: groupsEnd and digitsBefore", () => {
	test("groupsEnd: past the last whole group, or -1", () => {
		expect(groupsEnd("1,000:1", 1)).toBe(5);
		expect(groupsEnd("1,000,000)", 1)).toBe(9);
		expect(groupsEnd("1,000,00)", 1)).toBe(5);
		expect(groupsEnd("1,0000", 1)).toBe(-1);
		expect(groupsEnd("1,00", 1)).toBe(-1);
		expect(groupsEnd("", 0)).toBe(-1);
		expect(groupsEnd("1:000", 1)).toBe(-1);
	});

	test("firstBoundBefore: three or more digits, a name or a closing bracket, never an hour", () => {
		expect(firstBoundBefore("sum(100:", 7)).toBe(true);
		expect(firstBoundBefore("sum(1,000:", 9)).toBe(true);
		expect(firstBoundBefore("sum(a:", 5)).toBe(true);
		expect(firstBoundBefore("sum((1):", 7)).toBe(true);
		expect(firstBoundBefore("max(9:", 5)).toBe(false);
		expect(firstBoundBefore("max(10:", 6)).toBe(false);
		expect(firstBoundBefore(":", 0)).toBe(false);
		expect(firstBoundBefore("", 0)).toBe(false);
		expect(firstBoundBefore("abc", 2)).toBe(false);
		expect(firstBoundBefore("é:", 1)).toBe(false);
	});

	test("digitsBefore: digits counted through grouping commas, stopping at anything else", () => {
		expect(digitsBefore("sum(100:", 7)).toBe(3);
		expect(digitsBefore("sum(1,000:", 9)).toBe(4);
		expect(digitsBefore("sum(9:", 5)).toBe(1);
		expect(digitsBefore("sum(1, 000:", 10)).toBe(3);
		expect(digitsBefore("", 0)).toBe(0);
		expect(digitsBefore(":", 0)).toBe(0);
		expect(digitsBefore("12,", 3)).toBe(0);
	});
});

describe("the parts: the lexer and isPlainNumber", () => {
	test("the lexer reads a grouped bound in a call as one number", () => {
		expect(lex("sum(1,000:2,000)").map((t) => t.text)).toEqual(["sum", "(", "1,000", ":", "2,000", ")"]);
		expect(lex("sum(1,000:1)").map((t) => t.text)).toEqual(["sum", "(", "1,000", ":", "1", ")"]);
		expect(lex("max(1,000, 2)").map((t) => t.text)).toEqual(["max", "(", "1", ",", "000", ",", "2", ")"]);
		// A list's comma separates, whatever follows it.
		expect(lex("[1,000:3]").map((t) => t.text)).toEqual(["[", "1", ",", "000", ":", "3", "]"]);
	});

	test("isPlainNumber takes a grouped whole number as plain, so a refusal shows it as a number", () => {
		expect(isPlainNumber(lex("1,000"))).toBe(true);
		expect(isPlainNumber(lex("1,000,000"))).toBe(true);
		expect(isPlainNumber(lex("0,000"))).toBe(false);
		expect(isPlainNumber(lex("1,000.5"))).toBe(false);
		expect(isPlainNumber(lex("01,000"))).toBe(false);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as a bound is refused by name and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of [...fill("sum(1,000:X)", PROTOTYPE_WORDS), ...fill("sum(X:1,000)", PROTOTYPE_WORDS)]) {
				const o = expectHonestLine(line);
				expect(o.kind).not.toBe("value");
			}
		});
	});

	test("a huge grouped range is refused within its budget, as the ungrouped one is", () => {
		const grouped = expectHonestLine("sum(0:9,999,999)", { budgetMs: 5_000 });
		const plain = expectHonestLine(RESOURCE_PROBES.hugeRange().replace(/^/, "sum(").replace(/$/, ")"), { budgetMs: 5_000 });
		expect(grouped.kind).toBe(plain.kind);
		expectHonestLine(`sum(1${",000".repeat(2_000)}:1)`);
	});

	test("look-alike commas and digits are not grouped", () => {
		for (const line of ["sum(1，000:1)", "sum(1,٠٠٠:1)", "sum(1,0​00:1)", "sum(1,000‮:1)"]) {
			expect(expectHonestLine(line).kind).not.toBe("value");
		}
		// A zero-width space before the comma ends the number, as a space does,
		// so the comma separates there as it does in `sum(1 ,000:1)`.
		expect(outcome("sum(1​,000:1)")).toBe(outcome("sum(1 ,000:1)"));
	});

	test("markup-shaped text around a grouped range is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`sum(1,000:1,002) ${edge}`);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a bound from the line above, a check, a name and a section around it", () => {
		expect(both(["a = 1,000", "sum(a:1,002)", "check sum(1,000:1,002) == 3,003", "t = total(1,000:1,002)", "t as hex"])).toEqual([
			"1,000",
			"3,003",
			"✓",
			"3,003",
			"0xBBB",
		]);
		expect(outcome("sum((999 + 1):1,002)")).toBe("3,003");
		expectHonestDocument("# Range\nsum(1,000:1,002)\n## Down\nsum(1,000:1)");
	});

	test("a space before the colon keeps the comma a separator, and the line is refused", () => {
		expect(outcome("sum(1,000 : 1,002)")).toBe('INVALID_TIME_LITERAL: "000:1" is not a valid time');
	});

	test("a German engine reads the comma as its decimal mark, so no thousands are grouped", () => {
		const de = newTrackedEngine({ locale: "de" });
		const answer = formatValue(de.evaluateExpression("sum(1,000; 2)"));
		expect(answer).toBe("= 3");
	});

	test("an edit from the grouped range to the plain one gives the same answer", () => {
		expect(both(["sum(1,000:1,002)", "sum(1000:1002)"])).toEqual(["3,003", "3,003"]);
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negatives and a leading zero group", () => {
		expect(outcome("sum(-1,000:1)")).toBe("-500,499");
		expect(outcome("sum(0,000:1)")).toBe("1");
		expect(outcome("sum(-1,000:-999)")).toBe("-1,999");
	});

	test("near 2^53 the bounds are exact", () => {
		expect(outcome("sum(9,007,199,254,740,990:9,007,199,254,740,991)")).toBe(outcome("sum(9007199254740990:9007199254740991)"));
	});

	test("each numeric edge as the other bound is answered honestly", () => {
		for (const line of [...fill("sum(1,000:X)", NUMERIC_EDGES), ...fill("sum(X:1,000)", NUMERIC_EDGES)]) expectHonestLine(line);
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["sum(1,000:1,002)\r", ""])).toEqual(["3,003", ""]);
		expectHonestDocument("sum(1,000:1,002)\r\nsum(1,000:1)\r\n");
	});
});
