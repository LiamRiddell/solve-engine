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
import { colonLabelFault, labelSubject, visibleText } from "@solve-js/engine/ColonLabel";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `(24):00` answered 0.
 *
 * A line that does not parse whole is retried with the text before a colon set
 * aside as a label. A label is a name, and a calculation with no word in it
 * (`(1+2): 5`) was already refused as naming nothing, but a bracketed figure
 * with no operator inside was not: `(24):00` was the label `(24)` and
 * answered the `00` after the colon, and `[24]:00`, `(9):30` and
 * `Total: (24):00` did the same. A bracket with no word beside it now makes
 * the text a bracketed expression, refused as a calculation is
 * (`colonLabelFault` in engine/ColonLabel.ts, `LABEL_NOT_A_NAME`). A bracket
 * beside a word is still part of a name (`Total (2026): 500`, `(net): 5`).
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

/** The message for a calculation before a colon, without its code. */
const WORDS = (label: string): string => `"${label}" before the colon is a calculation, not a label: a label names the figure in words`;

/** The refusal, with its code. */
const NOT_A_NAME = (label: string): string => `LABEL_NOT_A_NAME: ${WORDS(label)}`;

describe("the lines that exposed it", () => {
	test.each([
		["(24):00", "(24)"],
		["(9):30", "(9)"],
		["[24]:00", "[24]"],
		["((24)):00", "((24))"],
		["[(24)]:00", "[(24)]"],
		["(24) :00", "(24)"],
		["(24): 5", "(24)"],
		["(1): 5", "(1)"],
		["Total: (24):00", "(24)"],
		["1 + (24):00", "1 + (24)"],
		["(24)(1):00", "(24)*(1)"],
		["24):00", "24)"],
	])("%s is refused by name, never 0, through evaluateExpression and evaluateLine", (line, label) => {
		expect(outcome(line)).toBe(NOT_A_NAME(label));
		expect(single(line)).toBe(NOT_A_NAME(label));
	});

	test("a bracket beside a word is part of a name, as labels.md promises", () => {
		expect(outcome("Total (2026): 500")).toBe("500");
		expect(outcome("Total (net): 5")).toBe("5");
		expect(outcome("(net): 5")).toBe("5");
		expect(outcome("(x):00")).toBe("0");
		expect(outcome("Week (2): 75")).toBe("75");
	});

	test("the calculation refusal it follows, and the same figure with no colon, are unchanged", () => {
		expect(outcome("(1+2): 5")).toBe(NOT_A_NAME("(1+2)"));
		expect(outcome("(24)")).toBe("24");
		expect(outcome("(9) + 1")).toBe("10");
		expect(outcome("24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("Total: total(1000:1002)")).toBe("3,003");
	});

	test("through both document passes, which agree", () => {
		expect(both(["(24):00", "[24]:00", "Total (2026): 500", "(1e308):00"])).toEqual([
			`ERROR ${WORDS("(24)")}`,
			`ERROR ${WORDS("[24]")}`,
			"500",
			`ERROR ${WORDS("(1e308)")}`,
		]);
	});
});

describe("the parts: colonLabelFault, labelSubject and visibleText", () => {
	test("ordinary: a bracketed figure with no word is a calculation", () => {
		const tokens = lay(["LPAREN", "("], ["NUMBER", "24"], ["RPAREN", ")"], ["COLON", ":"], ["NUMBER", "00"]);
		expect(colonLabelFault(tokens, 3)).toEqual({ code: "LABEL_NOT_A_NAME", message: WORDS("(24)") });
		const list = lay(["LBRACKET", "["], ["NUMBER", "24"], ["RBRACKET", "]"], ["COLON", ":"], ["NUMBER", "00"]);
		expect(colonLabelFault(list, 3)?.code).toBe("LABEL_NOT_A_NAME");
	});

	test("boundary: a word beside the bracket, a lone number, a date and only the text since a label's colon", () => {
		const word = lay(["IDENT", "Total"], ["LPAREN", " ("], ["NUMBER", "2026"], ["RPAREN", ")"], ["COLON", ":"], ["NUMBER", " 500"]);
		expect(colonLabelFault(word, 4)).toBeNull();
		const named = lay(["LPAREN", "("], ["IDENT", "net"], ["RPAREN", ")"], ["COLON", ":"], ["NUMBER", " 5"]);
		expect(colonLabelFault(named, 3)).toBeNull();
		const after = lay(["IDENT", "Note"], ["COLON", ":"], ["LPAREN", " ("], ["NUMBER", "24"], ["RPAREN", ")"], ["COLON", ":"], ["NUMBER", "00"]);
		expect(colonLabelFault(after, 5)).toEqual({ code: "LABEL_NOT_A_NAME", message: WORDS("(24)") });
		const date = lay(["DATETIME_LITERAL", "2026-01-04"], ["COLON", ":"], ["NUMBER", " 45"]);
		expect(colonLabelFault(date, 1)).toBeNull();
	});

	test("hostile: an unbalanced bracket, and markup or invisible characters in what the message quotes", () => {
		expect(colonLabelFault(lay(["RPAREN", ")"], ["COLON", ":"], ["NUMBER", "00"]), 1)?.code).toBe("LABEL_NOT_A_NAME");
		const markup = lay(["LPAREN", "("], ["NUMBER", "1"], ["RPAREN", ")"], ["LT", "<"], ["COLON", ":"], ["NUMBER", "1"]);
		expect(colonLabelFault(markup, 4)?.code).toBe("LABEL_NOT_A_NAME");
		expect(labelSubject(lay(["IDENT", "‍"], ["LPAREN", "("], ["NUMBER", "24"], ["RPAREN", ")"]))).toBe('"<U+200D>(24)" before the colon');
		expect(labelSubject(lay(["NUMBER", "1".repeat(100)]))).toBe(`"${"1".repeat(40)}..." before the colon`);
	});

	test("visibleText writes each invisible character as its code point, and leaves the rest", () => {
		expect(visibleText("(24)")).toBe("(24)");
		expect(visibleText("‮24")).toBe("<U+202E>24");
		expect(visibleText("a­b‌c\u0007")).toBe("a<U+00AD>b<U+200C>c<U+0007>");
		expect(visibleText("\u{E0001}x")).toBe("<U+E0001>x");
		expect(visibleText("<b>x</b> ٢٤ 🙂")).toBe("<b>x</b> ٢٤ 🙂");
		expect(visibleText("")).toBe("");
	});
});

describe("adversarial: security", () => {
	test("a prototype word in the brackets is a name, and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("(X):00", PROTOTYPE_WORDS)) expect(expectHonestLine(line)).toEqual(expect.objectContaining({ kind: "value" }));
			for (const line of fill("(24):X", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const word of PROTOTYPE_WORDS) expectHonestDocument(`${word} = 2\n(${word}):00\n(24):00`);
		});
	});

	test("deep brackets, a long sum in brackets and many such lines are refused within the budget", () => {
		expect(outcome(`${RESOURCE_PROBES.deepParens(40)}:00`)).toMatch(/^LABEL_NOT_A_NAME: /);
		expectHonestLine(`${RESOURCE_PROBES.deepParens(2_000)}:00`, { budgetMs: 5_000 });
		expect(outcome(`(${RESOURCE_PROBES.longSum(150)}):00`)).toMatch(/^LABEL_NOT_A_NAME: /);
		expectHonestDocument(Array.from({ length: 500 }, (_, i) => `(${i}):00`).join("\n"), { budgetMs: 10_000 });
	});

	test("look-alike, invisible and markup-shaped text in the brackets is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`(${edge}):00`);
		expect(outcome("(<b>24</b>):00")).not.toBe("0");
		expect(outcome("(‌24):00")).toBe(NOT_A_NAME("(<U+200C>24)"));
		expect(outcome("(٢٤):00")).not.toBe("0");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check and a section around it", () => {
		const doc = both(["# Shift", "(24):00", "start = 9", "(start):30", "check (24):00 == 0"]);
		expect(doc[1]).toBe(`ERROR ${WORDS("(24)")}`);
		expect(doc[3]).toBe("30");
		expect(doc[4]).toMatch(/^ERROR /);
	});

	test("an edit that writes the time without brackets answers it", () => {
		expect(both(["(9):30"])).toEqual([`ERROR ${WORDS("(9)")}`]);
		expect(both(["9:30"])[0]).toBe(outcome("9:30"));
		expect(both(["Total: (9):30", "Total: 9:30"])[1]).toBe(outcome("9:30"));
	});
});

describe("adversarial: edge cases", () => {
	test("zero, a negative, the last minute of a day and every numeric edge", () => {
		expect(outcome("(0):00")).toBe(NOT_A_NAME("(0)"));
		expect(outcome("(-1):00")).toBe(NOT_A_NAME("(-1)"));
		expect(outcome("(23):59")).toBe(NOT_A_NAME("(23)"));
		for (const line of fill("(X):00", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const edge of NUMERIC_EDGES) expect({ edge, answer: outcome(`(${edge}):00`) }).not.toEqual({ edge, answer: "0" });
	});

	test("CRLF, a trailing newline and padding", () => {
		expect(both(["(24):00\r", ""])).toEqual([`ERROR ${WORDS("(24)")}`, ""]);
		expect(outcome("   (24):00   ")).toBe(NOT_A_NAME("(24)"));
	});
});
