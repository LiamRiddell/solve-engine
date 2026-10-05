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
import { OPERAND_BEFORE, colonLabelFault, timeAtColon } from "@solve-js/engine/ColonLabel";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `Total: 24:00` answered 0 and `Total: 1000:1002` answered 1,002.
 *
 * A line that does not parse whole is retried with the text before a colon set
 * aside as a label. A colon pair the clock rules declined is refused when the
 * number before it is an operand, which `timeAtColon` decided from the token
 * before that number: an operator, a bracket or a comma. A label's colon was
 * not on that list, so in `Total: 24:00` the `24` was read as a second label,
 * and the line answered whatever followed the time's colon. A label's colon is
 * now an operand's lead (`OPERAND_BEFORE` in engine/ColonLabel.ts): the figure
 * after it starts the expression, so `Total: 24:00` is the time 24:00 and is
 * refused as `24:00` alone is, and `Total: 1000:1002`, which is no time and,
 * at the top of a line, no range, is refused by name in the same words as the
 * bare `1000:1002`.
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

const NOT_A_TIME = (time: string): string => `INVALID_TIME_LITERAL: "${time}" is not a valid time`;

describe("the lines that exposed it", () => {
	test.each([
		["Total: 24:00", "24:00"],
		["Total: 1000:1002", "1000:1002"],
		["Total: 24:30", "24:30"],
		["Total: 9:60", "9:60"],
		["Total:24:00", "24:00"],
		["Total (net): 24:00", "24:00"],
		["Total: 1000:1002 + 1", "1000:1002"],
		["Total: 100:5", "100:5"],
	])("%s is refused as the time %s, as the bare pair is, through evaluateExpression and evaluateLine", (line, time) => {
		expect(outcome(line)).toBe(NOT_A_TIME(time));
		expect(single(line)).toBe(NOT_A_TIME(time));
		expect(outcome(time)).toBe(NOT_A_TIME(time));
	});

	test("a real time after a label is the time", () => {
		const half = outcome("9:30");
		expect(outcome("Total: 9:30")).toBe(half);
		expect(single("Total: 9:30")).toBe(half);
		expect(outcome("Total: 12:00")).toBe(outcome("12:00"));
	});

	test("through both document passes, which agree", () => {
		const doc = both(["Total: 24:00", "Total: 1000:1002", "Total: 5", "Total: total(1000:1002)"]);
		expect(doc).toEqual(['ERROR "24:00" is not a valid time', 'ERROR "1000:1002" is not a valid time', "5", "3,003"]);
	});

	test("every label form on the labels page still answers", () => {
		expect(outcome("Rent: $1200")).toBe("$1,200.00");
		expect(outcome("Week 12: 75")).toBe("75");
		expect(outcome("Week 12:75")).toBe("75");
		expect(outcome("Room 4: 12")).toBe("12");
		expect(outcome("Item 2: 45")).toBe("45");
		expect(outcome("Note: total: total(1:3)")).toBe("6");
		expect(outcome("x:3")).toBe("3");
		expect(outcome("Total: total(1000:1002)")).toBe("3,003");
		expect(outcome("1 + 24:00")).toBe(NOT_A_TIME("24:00"));
		expect(outcome("1:23:99")).toBe(NOT_A_TIME("1:23:99"));
	});
});

describe("the parts: OPERAND_BEFORE and timeAtColon", () => {
	test("ordinary: a label's colon leads an operand", () => {
		expect(OPERAND_BEFORE.has("COLON")).toBe(true);
		expect(OPERAND_BEFORE.has("PLUS")).toBe(true);
		expect(OPERAND_BEFORE.has("IDENT")).toBe(false);
		const labelled = lay(["IDENT", "Total"], ["COLON", ":"], ["NUMBER", " 24"], ["COLON", ":"], ["NUMBER", "00"]);
		expect(timeAtColon(labelled, 3)).toBe("24:00");
		expect(colonLabelFault(labelled, 3)).toEqual({ code: "INVALID_TIME_LITERAL", message: '"24:00" is not a valid time' });
	});

	test("boundary: a word before the number keeps it in the name, and a space after the colon makes it a label's", () => {
		expect(timeAtColon(lay(["IDENT", "Week"], ["NUMBER", " 12"], ["COLON", ":"], ["NUMBER", "75"]), 2)).toBeNull();
		expect(timeAtColon(lay(["IDENT", "Note"], ["COLON", ":"], ["NUMBER", " 12"], ["COLON", ":"], ["NUMBER", " 30"]), 3)).toBeNull();
		expect(timeAtColon(lay(["NUMBER", "24"], ["COLON", ":"], ["NUMBER", "00"]), 1)).toBe("24:00");
		expect(timeAtColon(lay(["IDENT", "Total"], ["COLON", ":"]), 1)).toBeNull();
	});

	test("hostile: a colon at the start, a run of colons and a word after the colon", () => {
		expect(timeAtColon(lay(["COLON", ":"], ["NUMBER", "5"]), 0)).toBeNull();
		const run = lay(...Array.from({ length: 2_000 }, (_, k): [string, string] => (k % 2 === 0 ? ["NUMBER", "1"] : ["COLON", ":"])));
		expect(timeAtColon(run, 1_997)).toBe("1:1");
		expect(timeAtColon(lay(["IDENT", "a"], ["COLON", ":"], ["NUMBER", " 1"], ["COLON", ":"], ["IDENT", "b"]), 3)).toBeNull();
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the label is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(outcome(`${word}: 24:00`)).toBe(NOT_A_TIME("24:00"));
			for (const line of fill("Total: X:00", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const line of fill("X: 1000:1002", PROTOTYPE_WORDS)) expect(outcome(line)).toBe(NOT_A_TIME("1000:1002"));
		});
	});

	test("many labels, deep brackets and a long sum are answered within the budget", () => {
		expectHonestLine(`${"a: ".repeat(500)}24:00`, { budgetMs: 5_000 });
		expectHonestLine(`Total: ${RESOURCE_PROBES.deepParens(500)} + 24:00`, { budgetMs: 5_000 });
		expectHonestLine(`Total: ${RESOURCE_PROBES.longSum(2_000)}:00`, { budgetMs: 5_000 });
	});

	test("markup-shaped and look-alike labels are read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`${edge}: 24:00`);
		expect(outcome("<b>Total</b>: 24:00")).not.toBe("0");
		expect(outcome("Total <b>: 24:00")).not.toBe("0");
		expectHonestLine("Total: ٢٤:00");
	});

	// Found here and fixed since: digits from another script (Arabic-Indic
	// ٢٤ for 24) lex as a word, so the text before the colon was a label and
	// the line answered the 00 after it. The figure is now refused by name;
	// see FoundBug_otherScriptDigitsLabel.spec.ts.
	test("other-script digits before a colon are refused by name, so ٢٤:00 is never 0", () => {
		expect(outcome("٢٤:00")).toBe('OTHER_SCRIPT_DIGITS: "٢٤" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in 24');
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check and a section around it", () => {
		expect(both(["# Hours", "a = 2", "Total: a", "Total: 24:00", "check 1 == 1"])).toEqual(["", "2", "2", 'ERROR "24:00" is not a valid time', "✓"]);
		expectHonestDocument("# Shift\nStart: 9:00\nEnd: 24:00\nLength: 8 hours");
	});

	test("an edit that fixes the time answers it", () => {
		expect(both(["End: 24:00"])).toEqual(['ERROR "24:00" is not a valid time']);
		expect(both(["End: 23:00"])).toEqual([outcome("23:00")]);
	});

	test("a pair with a space after the colon reads as the figure does on its own", () => {
		expect(outcome("Total: 12: 30")).toBe(outcome("12: 30"));
		expect(outcome("Total: 5")).toBe("5");
	});
});

describe("adversarial: edge cases", () => {
	test("zero, the last minute of a day and a negative", () => {
		expect(outcome("Total: 0:00")).toBe(outcome("0:00"));
		expect(outcome("Total: 23:59")).toBe(outcome("23:59"));
		expect(outcome("Total: -24:00")).toBe(outcome("-24:00"));
	});

	test("each numeric edge as the hour after a label is honest", () => {
		for (const line of fill("Total: X:00", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["Total: 24:00\r", ""])).toEqual(['ERROR "24:00" is not a valid time', ""]);
	});
});
