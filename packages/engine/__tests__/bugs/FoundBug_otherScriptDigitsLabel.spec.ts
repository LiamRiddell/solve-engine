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
import { colonLabelFault, digitValue, otherScriptFigure, otherScriptFigureAtColon } from "@solve-js/engine/ColonLabel";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `٢٤:00` answered 0.
 *
 * The engine reads numbers in the digits 0 to 9 only, and the lexer reads a
 * figure in another script's digits (Arabic-Indic `٢٤` for 24) as a word. A
 * line that does not parse whole is retried with the text before a colon set
 * aside as a label, so `٢٤:00` was the label `٢٤` and answered the `00` after
 * it, and `Total: ٢٤:00` did the same. Elsewhere such a figure is refused as a
 * word the engine does not know (`٢٤ + 1` names `٢٤` as an undefined name),
 * never read as a number. The label reading now agrees: a figure that stands
 * before the colon where a number would be an operand (the rule `timeAtColon`
 * follows) is refused by name and spelled in 0 to 9
 * (`otherScriptFigureAtColon` in engine/ColonLabel.ts, `OTHER_SCRIPT_DIGITS`).
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

/** The message for a figure in another script's digits, without its code. */
const WORDS = (written: string, reading: string): string =>
	`"${written}" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in ${reading}`;

/** The refusal for a figure in another script's digits, with its code. */
const UNREAD = (written: string, reading: string): string => `OTHER_SCRIPT_DIGITS: ${WORDS(written, reading)}`;

describe("the lines that exposed it", () => {
	test.each([
		["٢٤:00", "٢٤", "24"],
		["Total: ٢٤:00", "٢٤", "24"],
		["Total (net): ٢٤:00", "٢٤", "24"],
		["x: ٢٤:00", "٢٤", "24"],
		["٢٤:٠٠", "٢٤", "24"],
		["٩:٣٠", "٩", "9"],
		["٢٤: 5", "٢٤", "24"],
		["Total: ٢٤ :00", "٢٤", "24"],
		["1 + ٢٤:00", "٢٤", "24"],
		["२४:00", "२४", "24"],
		["１２:00", "１２", "12"],
		["𝟐𝟒:00", "𝟐𝟒", "24"],
		["٢٫٥:00", "٢٫٥", "2.5"],
		["٢4:00", "٢4", "24"],
		["2٤:00", "2٤", "24"],
	])("%s is refused by name, never 0, through evaluateExpression and evaluateLine", (line, written, reading) => {
		expect(outcome(line)).toBe(UNREAD(written, reading));
		expect(single(line)).toBe(UNREAD(written, reading));
	});

	test("a figure after a word is part of the name, as a number is", () => {
		expect(outcome("Week ٢: 5")).toBe("5");
		expect(outcome("Week 2: 5")).toBe("5");
		expect(outcome("Label ٢: 5")).toBe("5");
		expect(outcome("Week 2٤: 5")).toBe("5");
		expect(outcome("٢٤ hours: 5")).toBe("5");
		expect(outcome("٢٠٢٦ budget: 500")).toBe("500");
	});

	test("the same figure elsewhere is refused as a word the engine does not know, never read as a number", () => {
		expect(outcome("٢٤")).toBe("UNDEFINED_VARIABLE: Undefined variable: ٢٤");
		expect(outcome("٢٤ + 1")).toBe("UNDEFINED_VARIABLE: Undefined variable: ٢٤");
		expect(outcome("Total: ٢٤")).toBe("UNDEFINED_VARIABLE: Undefined variable: ٢٤");
		expect(outcome("24:٠٠")).toBe('INVALID_TIME_LITERAL: "24:٠٠" is not a valid time');
	});

	test("the time written in 0 to 9 is answered as the refusal says", () => {
		expect(outcome("Total: 9:30")).toBe(outcome("9:30"));
		expect(outcome("24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
	});

	test("through both document passes, which agree", () => {
		expect(both(["٢٤:00", "Total: ٢٤:00", "Week ٢: 5", "Total: 5"])).toEqual([
			`ERROR ${WORDS("٢٤", "24")}`,
			`ERROR ${WORDS("٢٤", "24")}`,
			"5",
			"5",
		]);
	});
});

describe("the parts: digitValue", () => {
	test("ordinary: a digit of each script is its value", () => {
		expect(digitValue("٢")).toBe(2);
		expect(digitValue("۴")).toBe(4);
		expect(digitValue("४")).toBe(4);
		expect(digitValue("５")).toBe(5);
		expect(digitValue("𝟗")).toBe(9);
		expect(digitValue("7")).toBe(7);
	});

	test("boundary: zero and nine at each end of a run, and the runs that touch", () => {
		expect(digitValue("0")).toBe(0);
		expect(digitValue("٠")).toBe(0);
		expect(digitValue("٩")).toBe(9);
		expect(digitValue("𝟎")).toBe(0);
		expect(digitValue("𝟘")).toBe(0);
		expect(digitValue("𝟿")).toBe(9);
	});

	test("boundary: every decimal digit Unicode has sits in a run of ten from 0", () => {
		let seen = 0;
		for (let code = 0; code <= 0x10ffff; code++) {
			if (code >= 0xd800 && code <= 0xdfff) continue;
			const ch = String.fromCodePoint(code);
			if (!/\p{Nd}/u.test(ch)) continue;
			seen++;
			const previous = code > 0 && /\p{Nd}/u.test(String.fromCodePoint(code - 1)) ? digitValue(String.fromCodePoint(code - 1)) : 9;
			expect({ code, value: digitValue(ch) }).toEqual({ code, value: (previous + 1) % 10 });
		}
		expect(seen % 10).toBe(0);
	});

	test("hostile: not one digit", () => {
		expect(digitValue("")).toBe(-1);
		expect(digitValue("a")).toBe(-1);
		expect(digitValue("12")).toBe(-1);
		expect(digitValue("٢٤")).toBe(-1);
		expect(digitValue("\uD835")).toBe(-1);
		expect(digitValue("٫")).toBe(-1);
		expect(digitValue("Ⅻ")).toBe(-1);
	});
});

describe("the parts: otherScriptFigure", () => {
	test("ordinary: a figure in another script, spelled in 0 to 9", () => {
		expect(otherScriptFigure("٢٤")).toBe("24");
		expect(otherScriptFigure("२०२६")).toBe("2026");
		expect(otherScriptFigure("٢٫٥")).toBe("2.5");
		expect(otherScriptFigure("١٬٠٠٠")).toBe("1,000");
		expect(otherScriptFigure("٢4")).toBe("24");
	});

	test("boundary: a figure already in 0 to 9, and a mark on its own, are not one", () => {
		expect(otherScriptFigure("24")).toBeNull();
		expect(otherScriptFigure("٫")).toBeNull();
		expect(otherScriptFigure("٠")).toBe("0");
		expect(otherScriptFigure("")).toBeNull();
	});

	test("hostile: a word, a mixed word, markup, a prototype word and a long figure", () => {
		expect(otherScriptFigure("Total")).toBeNull();
		expect(otherScriptFigure("٢a")).toBeNull();
		expect(otherScriptFigure("<b>٢</b>")).toBeNull();
		expect(otherScriptFigure("٢\u200B٤")).toBe("24");
		expect(otherScriptFigure("\u202E٢٤")).toBe("24");
		expect(otherScriptFigure("\u202E24")).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(otherScriptFigure(word)).toBeNull();
		expect(otherScriptFigure("٢".repeat(10_000))).toBe("2".repeat(10_000));
	});
});

describe("the parts: otherScriptFigureAtColon and colonLabelFault", () => {
	test("ordinary: a figure at the start of the line, and after a label's colon", () => {
		const bare = lay(["IDENT", "٢٤"], ["COLON", ":"], ["NUMBER", "00"]);
		expect(otherScriptFigureAtColon(bare, 1)).toEqual({ written: "٢٤", reading: "24" });
		const labelled = lay(["IDENT", "Total"], ["COLON", ":"], ["IDENT", " ٢٤"], ["COLON", ":"], ["NUMBER", "00"]);
		expect(otherScriptFigureAtColon(labelled, 3)).toEqual({ written: "٢٤", reading: "24" });
		expect(colonLabelFault(labelled, 3)).toEqual({ code: "OTHER_SCRIPT_DIGITS", message: WORDS("٢٤", "24") });
	});

	test("boundary: a number in 0 to 9 before it, touching, through the product the normaliser puts between, and with a space", () => {
		expect(otherScriptFigureAtColon(lay(["NUMBER", "2"], ["IDENT", "٤"], ["COLON", ":"], ["NUMBER", "00"]), 2)).toEqual({ written: "2٤", reading: "24" });
		const implicit = lay(["NUMBER", "2"], ["IDENT", "٤"], ["COLON", ":"], ["NUMBER", "00"]);
		implicit.splice(1, 0, { ...implicit[1], type: "STAR", text: "*", value: "*" } as Token);
		expect(otherScriptFigureAtColon(implicit, 3)).toEqual({ written: "2٤", reading: "24" });
		expect(otherScriptFigureAtColon(lay(["NUMBER", "2"], ["IDENT", " ٤"], ["COLON", ":"], ["NUMBER", "00"]), 2)).toEqual({ written: "2 ٤", reading: "2 4" });
	});

	test("boundary: a figure after a word is part of the name, and a word before the colon is no figure", () => {
		expect(otherScriptFigureAtColon(lay(["IDENT", "Week"], ["IDENT", " ٢"], ["COLON", ":"], ["NUMBER", " 5"]), 2)).toBeNull();
		expect(otherScriptFigureAtColon(lay(["IDENT", "Week"], ["NUMBER", " 2"], ["IDENT", "٤"], ["COLON", ":"], ["NUMBER", " 5"]), 3)).toBeNull();
		expect(otherScriptFigureAtColon(lay(["IDENT", "Total"], ["COLON", ":"], ["NUMBER", " 5"]), 1)).toBeNull();
		expect(colonLabelFault(lay(["IDENT", "Week"], ["IDENT", " ٢"], ["COLON", ":"], ["NUMBER", " 5"]), 2)).toBeNull();
	});

	test("hostile: a colon first, a colon that ends the line, and a long figure quoted short", () => {
		expect(otherScriptFigureAtColon(lay(["COLON", ":"], ["NUMBER", "5"]), 0)).toBeNull();
		expect(otherScriptFigureAtColon(lay(["IDENT", "٢٤"], ["COLON", ":"]), 1)).toBeNull();
		const long = "٢".repeat(10_000);
		const fault = colonLabelFault(lay(["IDENT", long], ["COLON", ":"], ["NUMBER", "00"]), 1)!;
		expect(fault.code).toBe("OTHER_SCRIPT_DIGITS");
		expect(fault.message.length).toBeLessThan(200);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the label is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(outcome(`${word}: ٢٤:00`)).toBe(UNREAD("٢٤", "24"));
			for (const line of fill("X: ٢٤:00", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const line of fill("٢٤:X", PROTOTYPE_WORDS)) expectHonestLine(line);
		});
	});

	test("a long figure, many labels and a long sum are answered within the budget", () => {
		expectHonestLine(`${"٢".repeat(10_000)}:00`, { budgetMs: 5_000 });
		expectHonestLine(`${"a: ".repeat(500)}٢٤:00`, { budgetMs: 5_000 });
		expectHonestLine(`Total: ${RESOURCE_PROBES.longSum(2_000)} + ٢٤:00`, { budgetMs: 5_000 });
		expectHonestLine(`Total: ${RESOURCE_PROBES.deepParens(500)} + ٢٤:00`, { budgetMs: 5_000 });
	});

	test("look-alike, invisible and markup-shaped text around the figure is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`${edge}: ٢٤:00`);
		expect(outcome("\u200B٢٤:00")).toBe(UNREAD("٢٤", "24"));
		expect(outcome("\u202E٢٤:00")).toMatch(/^DIRECTION_CONTROL_IN_NAME: /);
		expect(outcome("<b>٢٤</b>:00")).not.toBe("0");
		expect(outcome("٢\u200B٤:00")).toBe(UNREAD("٢ ٤", "2 4"));
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check and a section around it", () => {
		expect(both(["# Shift", "a = 2", "Start: ٩:٣٠", "End: 17:00", "check a == 2"])).toEqual([
			"",
			"2",
			`ERROR ${WORDS("٩", "9")}`,
			both(["End: 17:00"])[0],
			"✓",
		]);
		expectHonestDocument("# Hours\nStart: ٩:٣٠\nEnd: ٢٤:00\nLength: 8 hours");
	});

	test("an edit that retypes the figure in 0 to 9 answers it", () => {
		expect(both(["End: ٢٣:00"])).toEqual([`ERROR ${WORDS("٢٣", "23")}`]);
		expect(both(["End: 23:00"])).toEqual([outcome("23:00")]);
	});

	test("the other colon refusals keep their own wording", () => {
		expect(outcome("1 + 24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("a > b: 1")).toBe('LABEL_NOT_A_NAME: "a > b" before the colon is a comparison, not a label: a label names the figure in words, and a choice is written if ... then ... else');
		expect(outcome("true ? ٢ : 3")).not.toBe("3");
	});
});

describe("adversarial: edge cases", () => {
	test("zero, a negative and the last minute of a day", () => {
		expect(outcome("٠:٠٠")).toBe(UNREAD("٠", "0"));
		expect(outcome("-٢٤:00")).toBe(UNREAD("٢٤", "24"));
		expect(outcome("٢٣:٥٩")).toBe(UNREAD("٢٣", "23"));
	});

	test("each numeric edge after the figure is honest", () => {
		for (const line of fill("٢٤:X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("Total: ٢٤:X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF, a trailing newline and whitespace around the figure", () => {
		expect(both(["٢٤:00\r", ""])).toEqual([`ERROR ${WORDS("٢٤", "24")}`, ""]);
		expect(outcome("   ٢٤:00   ")).toBe(UNREAD("٢٤", "24"));
	});

	// Open, found by this sweep and not this change's: a bracketed number
	// before a time's colon is read as a label, so (24):00 answers 0, the 00
	// after the colon. Reported with this batch; the fix turns this red.
	test.failing("found bug: (24):00 reads (24) as a label and answers 0", () => {
		expect(outcome("(24):00")).not.toBe("0");
	});

	// Open, found by this sweep and not this change's: a direction override
	// before a time in 0 to 9 makes the pair a word and a label, so the line
	// answers 0, where the same override before a figure in another script's
	// digits is refused. Reported with this batch; the fix turns this red.
	test.failing("found bug: a direction override before 24:00 makes it a label that answers 0", () => {
		expect(outcome("\u202E24:00")).not.toBe("0");
	});
});
