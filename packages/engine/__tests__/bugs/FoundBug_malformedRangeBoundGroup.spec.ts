import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
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
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { malformedRangeBoundGroupEnd } from "@solve-js/lexer/RangeBoundGrouping";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `sum(1,0000:1)` answered 2, a confident wrong number.
 *
 * Batch AA read a comma straight against a range's colon as a thousands group
 * (`sum(1,000:2,000)`), but only when exactly three digits follow it. A group
 * of any other size fell back to the argument reading: `sum(1, 0000:1)`, the
 * element form adding 1 once for each of 0 and 1. The reader wrote the number
 * the way a grouped bound is written, with no space after the comma, so the
 * lexer now refuses that shape by name (lexer/RangeBoundGrouping.ts,
 * `malformedRangeBoundGroupEnd`): a grouping comma needs exactly three digits
 * after it, and a space after the comma gives two values.
 */

/** The refusal of a malformed group, for its literal and the two values a space would give. */
function refusal(literal: string, spaced: string): string {
	return `RANGE_BOUND_GROUP_MALFORMED: "${literal}" is not a number: a grouping comma needs exactly three digits after it. To give two values, put a space after the comma: ${spaced}.`;
}

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

/** A line's tokens, spaces and line breaks left out. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

describe("the lines that exposed it", () => {
	test.each([
		["sum(1,0000:1)", refusal("1,0000", "1, 0000")],
		["sum(1,00:1)", refusal("1,00", "1, 00")],
		["sum(12,3456:1)", refusal("12,3456", "12, 3456")],
		["sum(1,000,00:1)", refusal("1,000,00", "1,000, 00")],
	])("%s is refused by name, through evaluateExpression and evaluateLine", (line, message) => {
		expect(outcome(line)).toBe(message);
		expect(single(line)).toBe(message);
	});

	test("through both document passes, which agree, and the lines around it still answer", () => {
		const message = refusal("1,0000", "1, 0000").replace(/^RANGE_BOUND_GROUP_MALFORMED: /, "ERROR ");
		expect(both(["x = 5", "sum(1,0000:1)", "x + 1"])).toEqual(["5", message, "6"]);
	});

	test("a space after the comma keeps the documented two-value reading", () => {
		expect(outcome("sum(1, 0000:1)")).toBe("2");
		expect(outcome("sum(1, 00:1)")).toBe("2");
		expect(single("sum(12, 3456:3457)")).toBe("24");
		expect(both(["sum(1, 0000:1)"])).toEqual(["2"]);
	});

	test("a whole group of three is still the grouped bound batch AA reads", () => {
		expect(outcome("sum(1,000:1,002)")).toBe("3,003");
		expect(outcome("sum(1,000:1)")).toBe('DESCENDING_RANGE: A range\'s min (1000) cannot be greater than its max (1). Did you mean "1:1000"?');
	});

	test("every call that takes a range refuses it the same way", () => {
		expect(outcome("total(1,0000:5)")).toBe(refusal("1,0000", "1, 0000"));
		expect(outcome("average(1,00:5)")).toBe(refusal("1,00", "1, 00"));
		expect(outcome("map(x, 1,0000:2)")).toBe(refusal("1,0000", "1, 0000"));
		expect(outcome("sum(x^2, 1,00:3)")).toBe(refusal("1,00", "1, 00"));
	});
});

describe("the parts: malformedRangeBoundGroupEnd", () => {
	test("ordinary: a group of two or of four or more digits straight against the colon", () => {
		expect(malformedRangeBoundGroupEnd("sum(1,0000:1)", 4)).toBe(10);
		expect(malformedRangeBoundGroupEnd("sum(1,00:1)", 4)).toBe(8);
		expect(malformedRangeBoundGroupEnd("sum(12,3456:1)", 4)).toBe(11);
		expect(malformedRangeBoundGroupEnd("sum(1,000,00:1)", 4)).toBe(12);
		expect(malformedRangeBoundGroupEnd("sum(123,45678:1)", 4)).toBe(13);
	});

	test("boundary: a whole group, one digit, a clock time's shape, a space, a long lead, no colon", () => {
		expect(malformedRangeBoundGroupEnd("sum(1,000:1)", 4)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1,1:3)", 4)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1,12:30)", 4)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("max(1,09:30)", 4)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1,12:3)", 4)).toBe(8);
		expect(malformedRangeBoundGroupEnd("sum(1,12:300)", 4)).toBe(8);
		expect(malformedRangeBoundGroupEnd("sum(1, 0000:1)", 4)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1,0000 :1)", 4)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1234,00:1)", 4)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1,0000)", 4)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1,0000, 1)", 4)).toBe(-1);
	});

	test("boundary: the second half of a time or a decimal is never weighed", () => {
		expect(malformedRangeBoundGroupEnd("max(9:30,1000:1)", 6)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1.5,0000:1)", 6)).toBe(-1);
	});

	test("hostile: out of range starts, empty text, a start that is not a digit, look-alike characters", () => {
		expect(malformedRangeBoundGroupEnd("", 0)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("1,0000:1", -1)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("1,0000:1", 99)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1,0000:1)", 3)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("sum(1,0000:1)", 5)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("1，0000:1", 0)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("1,٠٠٠٠:1", 0)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("1,00​00:1", 0)).toBe(-1);
		expect(malformedRangeBoundGroupEnd("1,0000：1", 0)).toBe(-1);
		// A long run is read in one walk.
		expect(malformedRangeBoundGroupEnd(`1,${"0".repeat(100_000)}:1`, 0)).toBe(100_002);
	});
});

describe("the parts: the lexer", () => {
	test("the lexer throws the refusal for the malformed group, and reads every other shape as before", () => {
		expect(() => lex("sum(1,0000:1)")).toThrow(/grouping comma needs exactly three digits/);
		expect(lex("sum(1,000:1)").map((t) => t.text)).toEqual(["sum", "(", "1,000", ":", "1", ")"]);
		expect(lex("sum(1, 0000:1)").map((t) => t.text)).toEqual(["sum", "(", "1", ",", "0000", ":", "1", ")"]);
		expect(lex("max(1,0000)").map((t) => t.text)).toEqual(["max", "(", "1", ",", "0000", ")"]);
		// A list's comma separates, whatever follows it, as batch AA left it.
		expect(lex("[1,0000:1]").map((t) => t.text)).toEqual(["[", "1", ",", "0000", ":", "1", "]"]);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the other bound is refused by name and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("sum(1,0000:X)", PROTOTYPE_WORDS)) {
				expect(outcome(line)).toBe(refusal("1,0000", "1, 0000"));
			}
			for (const line of fill("sum(X, 1,0000:1)", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
		});
	});

	test("a huge malformed group and a long run of groups are refused within the budget", () => {
		expect(expectHonestLine(`sum(1,${"0".repeat(50_000)}:1)`, { budgetMs: 5_000 }).kind).toBe("thrown");
		expect(expectHonestLine(`sum(1${",000".repeat(5_000)},00:1)`, { budgetMs: 5_000 }).kind).toBe("thrown");
	});

	test("look-alike commas, digits and invisible characters are not read as a group", () => {
		for (const line of ["sum(1，0000:1)", "sum(1,٠٠٠٠:1)", "sum(1,00​00:1)", "sum(1,0000‮:1)"]) {
			const o = expectHonestLine(line);
			expect(o.kind === "thrown" ? o.code : "").not.toBe("RANGE_BOUND_GROUP_MALFORMED");
		}
	});

	test("markup-shaped text after it is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`sum(1,0000:1) ${edge}`);
		expect(outcome('sum(1,0000:1) "<script>"')).toBe(refusal("1,0000", "1, 0000"));
	});
});

describe("adversarial: realistic breakage", () => {
	test("a label, a check, a name and a section around it", () => {
		const message = `ERROR ${refusal("1,0000", "1, 0000").replace(/^RANGE_BOUND_GROUP_MALFORMED: /, "")}`;
		expect(both(["a = 1", "Total: sum(1,0000:1)", "check sum(1,0000:1) == 2", "sum(a, 0000:1)"])).toEqual(["1", message, message, "2"]);
		expectHonestDocument("# Range\nsum(1,0000:1)\n## Fixed\nsum(1, 0000:1)");
	});

	test("the typo the refusal names, and its fix, are an edit apart", () => {
		expect(both(["sum(1,0000:1)", "sum(10000:1)", "sum(1, 0000:1)"])).toEqual([
			`ERROR ${refusal("1,0000", "1, 0000").replace(/^RANGE_BOUND_GROUP_MALFORMED: /, "")}`,
			'ERROR A range\'s min (10000) cannot be greater than its max (1). Did you mean "1:10000"?',
			"2",
		]);
	});

	test("a German engine reads the comma as its decimal mark, so nothing is refused", () => {
		const de = newTrackedEngine({ locale: "de" });
		expect(formatValue(de.evaluateExpression("sum(1,5; 2)"))).toBe("= 3.50");
	});

	test("a clock time after an unspaced comma keeps its reading", () => {
		expect(outcome("max(9:00,17:30)")).toBe(outcome("max(9:00, 17:30)"));
		expect(outcome("sum(9:30,10:15)")).toBe(outcome("sum(9:30, 10:15)"));
		expect(outcome("sum(1,12:30)")).toBe(outcome("sum(1, 12:30)"));
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negatives and a leading zero", () => {
		expect(outcome("sum(0,0000:1)")).toBe(refusal("0,0000", "0, 0000"));
		expect(outcome("sum(-1,0000:1)")).toBe(refusal("1,0000", "1, 0000"));
		expect(outcome("sum(1,00:-1)")).toBe(refusal("1,00", "1, 00"));
	});

	test("each numeric edge as the second bound is refused honestly", () => {
		for (const line of fill("sum(1,0000:X)", NUMERIC_EDGES)) expectHonestLine(line);
	});

	test("near 2^53 and past the decimal digit limit", () => {
		expect(outcome("sum(9,0071992547409930:1)")).toBe(refusal("9,0071992547409930", "9, 0071992547409930"));
		expect(expectHonestLine(`sum(1,${"9".repeat(40)}:1)`).kind).toBe("thrown");
	});

	test("CRLF and a trailing newline", () => {
		expectHonestDocument("sum(1,0000:1)\r\nsum(1, 0000:1)\r\n");
		expect(both(["sum(1, 0000:1)\r", ""])).toEqual(["2", ""]);
	});
});
