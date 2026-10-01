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
import { colonLabelFault, figureRunAtColon, hiddenFigure, hiddenFigureAtColon, otherScriptFigure } from "@solve-js/engine/ColonLabel";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a right-to-left override before `24:00` answered 0.
 *
 * The lexer reads every character past ASCII as part of a word, so an
 * invisible character written against a number (a direction override, a
 * direction mark, a zero-width joiner, a word joiner, a soft hyphen) makes it
 * a word: `<U+202E>24`. A line that does not parse whole is retried with the
 * text before a colon set aside as a label, so `<U+202E>24:00` was the label
 * `<U+202E>24` and answered the `00` after it; `Total: <U+202E>24:00` and
 * `<U+202E>9:30` did the same. Elsewhere such a word is refused (a direction
 * control in a name, a number or a unit is `DIRECTION_CONTROL_IN_NAME`). A
 * figure in 0 to 9 with such a character in it, standing before the colon
 * where a number would be an operand, is now refused by name
 * (`hiddenFigureAtColon` in engine/ColonLabel.ts): a direction control as any
 * name holding one is, any other invisible character as
 * `INVISIBLE_CHARACTER_IN_NUMBER`.
 *
 * The boundary, kept from engine/DirectionControls.ts: a label of words keeps
 * these characters (`Rent<U+200F>: 5`, `Tot<U+202E>al: 5`), since a label is
 * text and a right-to-left script needs them, and a figure after a word is
 * part of the name (`Week <U+202E>12: 5`).
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

const RLO = "‮";
const ZWJ = "‍";

/** The direction-control refusal's message, as engine/DirectionControls.ts words it. */
const DIRECTION = (word: string, character: string): string =>
	`"${word}" holds ${character}, an invisible character that changes the direction text is shown in, so it would not read as what it is. A name, a number or a unit cannot hold one: delete it and type the word again.`;

/** The refusal for any other invisible character in a figure, without its code. */
const INVISIBLE = (word: string, character: string, figure: string): string =>
	`"${word}" holds ${character}, an invisible character, so it is read as a word and not as the number ${figure}. A number cannot hold one: delete it and type the number again.`;

describe("the lines that exposed it", () => {
	test.each([
		["‮24:00", "<U+202E>24", "U+202E (right-to-left override)"],
		["‭24:00", "<U+202D>24", "U+202D (left-to-right override)"],
		["‪24:00", "<U+202A>24", "U+202A (left-to-right embedding)"],
		["‫24:00", "<U+202B>24", "U+202B (right-to-left embedding)"],
		["‬24:00", "<U+202C>24", "U+202C (pop directional formatting)"],
		["⁦24:00", "<U+2066>24", "U+2066 (left-to-right isolate)"],
		["⁧24:00", "<U+2067>24", "U+2067 (right-to-left isolate)"],
		["⁨24:00", "<U+2068>24", "U+2068 (first strong isolate)"],
		["⁩24:00", "<U+2069>24", "U+2069 (pop directional isolate)"],
		["‎24:00", "<U+200E>24", "U+200E (left-to-right mark)"],
		["‏24:00", "<U+200F>24", "U+200F (right-to-left mark)"],
		["؜24:00", "<U+061C>24", "U+061C (arabic letter mark)"],
		["‮9:30", "<U+202E>9", "U+202E (right-to-left override)"],
		["‮9: 30", "<U+202E>9", "U+202E (right-to-left override)"],
		["Total: ‮24:00", "<U+202E>24", "U+202E (right-to-left override)"],
		["1 + ‮24:00", "<U+202E>24", "U+202E (right-to-left override)"],
		["(‮24):00", "<U+202E>24", "U+202E (right-to-left override)"],
	])("%s is refused as a direction control, never 0, through evaluateExpression and evaluateLine", (line, word, character) => {
		expect(outcome(line)).toBe(`DIRECTION_CONTROL_IN_NAME: ${DIRECTION(word, character)}`);
		expect(single(line)).toBe(`DIRECTION_CONTROL_IN_NAME: ${DIRECTION(word, character)}`);
	});

	test.each([
		["‍24:00", "<U+200D>24", "U+200D (zero width joiner)", "24"],
		["‌24:00", "<U+200C>24", "U+200C (zero width non-joiner)", "24"],
		["⁠24:00", "<U+2060>24", "U+2060 (word joiner)", "24"],
		["­24:00", "<U+00AD>24", "U+00AD (soft hyphen)", "24"],
		["⁢24:00", "<U+2062>24", "U+2062 (invisible times)", "24"],
		["᠎24:00", "<U+180E>24", "U+180E", "24"],
		["2‍4:00", "2<U+200D>4", "U+200D (zero width joiner)", "24"],
		["­9:30", "<U+00AD>9", "U+00AD (soft hyphen)", "9"],
		["Total: ‍24:00", "<U+200D>24", "U+200D (zero width joiner)", "24"],
	])("%s is refused as an invisible character in a number, never 0", (line, word, character, figure) => {
		expect(outcome(line)).toBe(`INVISIBLE_CHARACTER_IN_NUMBER: ${INVISIBLE(word, character, figure)}`);
		expect(single(line)).toBe(`INVISIBLE_CHARACTER_IN_NUMBER: ${INVISIBLE(word, character, figure)}`);
	});

	test("a zero-width space and a byte-order mark are read as a space, so the time stands as typed", () => {
		expect(outcome("​24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("﻿24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("​9:30")).toBe(outcome("9:30"));
	});

	test("the boundary: a label of words keeps these characters, and a figure after a word is part of the name", () => {
		expect(outcome(`Tot${RLO}al: 5`)).toBe("5");
		expect(outcome(`${RLO}Total: 5`)).toBe("5");
		expect(outcome("Rent‏: 5")).toBe("5");
		expect(outcome("שכר ‏: 5")).toBe("5");
		expect(outcome(`Week ${RLO}12: 5`)).toBe("5");
		expect(outcome(`Week ${ZWJ}12: 5`)).toBe("5");
	});

	test("the same characters outside a label keep the refusals they had", () => {
		expect(outcome(`${RLO}24`)).toBe(`DIRECTION_CONTROL_IN_NAME: ${DIRECTION("<U+202E>24", "U+202E (right-to-left override)")}`);
		expect(outcome(`24:${RLO}00`)).toBe(`DIRECTION_CONTROL_IN_NAME: ${DIRECTION("<U+202E>00", "U+202E (right-to-left override)")}`);
		expect(outcome(`${ZWJ}24 + 1`)).toBe("UNDEFINED_VARIABLE: Undefined variable: <U+200D>24");
		expect(outcome(`${RLO}٢٤:00`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: /);
	});

	test("through both document passes, which agree", () => {
		expect(both([`${RLO}24:00`, `${ZWJ}24:00`, "Rent‏: 5", "Total: 5"])).toEqual([
			`ERROR ${DIRECTION("<U+202E>24", "U+202E (right-to-left override)")}`,
			`ERROR ${INVISIBLE("<U+200D>24", "U+200D (zero width joiner)", "24")}`,
			"5",
			"5",
		]);
	});
});

describe("the parts: hiddenFigure", () => {
	test("ordinary: a figure in 0 to 9 with one invisible character, anywhere in it", () => {
		expect(hiddenFigure(`${RLO}24`)).toEqual({ reading: "24", code: 0x202e });
		expect(hiddenFigure(`2${ZWJ}4`)).toEqual({ reading: "24", code: 0x200d });
		expect(hiddenFigure(`24${ZWJ}`)).toEqual({ reading: "24", code: 0x200d });
		expect(hiddenFigure(`${RLO}1,000.5`)).toEqual({ reading: "1,000.5", code: 0x202e });
		expect(hiddenFigure(`‎‍7`)).toEqual({ reading: "7", code: 0x200e });
		expect(hiddenFigure(`${RLO}1e308`)).toEqual({ reading: "1e308", code: 0x202e });
		expect(hiddenFigure(`${RLO}1e`)).toBeNull();
	});

	test("boundary: no invisible character, a word, only invisible characters, another script's digits", () => {
		expect(hiddenFigure("24")).toBeNull();
		expect(hiddenFigure(`${RLO}rent`)).toBeNull();
		expect(hiddenFigure(RLO)).toBeNull();
		expect(hiddenFigure("")).toBeNull();
		expect(hiddenFigure(`${RLO}٢٤`)).toBeNull();
		expect(otherScriptFigure(`${RLO}٢٤`)).toBe("24");
		expect(hiddenFigure(`${RLO}.5`)).toBeNull();
	});

	test("hostile: markup, a prototype word, an astral format character and a long run", () => {
		expect(hiddenFigure(`${RLO}<b>24</b>`)).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(hiddenFigure(`${RLO}${word}`)).toBeNull();
		expect(hiddenFigure("\u{E0001}24")).toEqual({ reading: "24", code: 0xe0001 });
		expect(hiddenFigure(`${RLO}${"9".repeat(10_000)}`)?.reading.length).toBe(10_000);
	});
});

describe("the parts: figureRunAtColon and hiddenFigureAtColon", () => {
	const read = (text: string): string | null => hiddenFigure(text)?.reading ?? null;

	test("ordinary: the figure at the line's start, after an operator and after a label's colon", () => {
		const start = lay(["IDENT", `${RLO}24`], ["COLON", ":"], ["NUMBER", "00"]);
		expect(figureRunAtColon(start, 1, read)).toEqual({ run: [start[0]], written: `${RLO}24`, reading: "24" });
		expect(hiddenFigureAtColon(start, 1)).toEqual({ code: "DIRECTION_CONTROL_IN_NAME", message: DIRECTION("<U+202E>24", "U+202E (right-to-left override)") });
		const plus = lay(["NUMBER", "1"], ["PLUS", " +"], ["IDENT", ` ${ZWJ}24`], ["COLON", ":"], ["NUMBER", "00"]);
		expect(hiddenFigureAtColon(plus, 3)?.code).toBe("INVISIBLE_CHARACTER_IN_NUMBER");
		const label = lay(["IDENT", "Total"], ["COLON", ":"], ["IDENT", ` ${RLO}24`], ["COLON", ":"], ["NUMBER", "00"]);
		expect(colonLabelFault(label, 3)?.code).toBe("DIRECTION_CONTROL_IN_NAME");
	});

	test("ordinary: a run of a word and a number, with the normaliser's product passed over", () => {
		const split = lay(["IDENT", `${RLO}1`], ["NUMBER", ".5"], ["COLON", ":"], ["NUMBER", "00"]);
		expect(figureRunAtColon(split, 2, read)?.reading).toBe("1.5");
		expect(hiddenFigureAtColon(split, 2)?.code).toBe("DIRECTION_CONTROL_IN_NAME");
		const product: Token[] = lay(["NUMBER", "2"], ["IDENT", `${ZWJ}4`], ["COLON", ":"], ["NUMBER", "00"]);
		product.splice(1, 0, { ...product[1], type: "STAR", text: "*", value: "*" } as Token);
		expect(figureRunAtColon(product, 3, read)?.reading).toBe("24");
		expect(hiddenFigureAtColon(product, 3)?.message).toBe(INVISIBLE("2<U+200D>4", "U+200D (zero width joiner)", "24"));
	});

	test("boundary: after a word, with no figure, with no token after the colon, and a plain number", () => {
		const week = lay(["IDENT", "Week"], ["IDENT", ` ${RLO}12`], ["COLON", ":"], ["NUMBER", " 5"]);
		expect(hiddenFigureAtColon(week, 2)).toBeNull();
		expect(figureRunAtColon(week, 2, read)).toBeNull();
		expect(hiddenFigureAtColon(lay(["IDENT", `Tot${RLO}al`], ["COLON", ":"], ["NUMBER", " 5"]), 1)).toBeNull();
		expect(hiddenFigureAtColon(lay(["IDENT", `${RLO}24`], ["COLON", ":"]), 1)).toBeNull();
		expect(hiddenFigureAtColon(lay(["NUMBER", "24"], ["COLON", ":"], ["NUMBER", " 5"]), 1)).toBeNull();
		expect(figureRunAtColon(lay(["IDENT", "x"], ["COLON", ":"], ["NUMBER", "5"]), 1, read)).toBeNull();
	});

	test("hostile: a long figure is quoted short, and a prototype word is not a figure", () => {
		const long = lay(["IDENT", `${RLO}${"9".repeat(100)}`], ["COLON", ":"], ["NUMBER", "00"]);
		expect(hiddenFigureAtColon(long, 1)?.code).toBe("DIRECTION_CONTROL_IN_NAME");
		const zwj = lay(["IDENT", `${ZWJ}${"9".repeat(100)}`], ["COLON", ":"], ["NUMBER", "00"]);
		expect(hiddenFigureAtColon(zwj, 1)?.message).toBe(INVISIBLE(`<U+200D>${"9".repeat(39)}...`, "U+200D (zero width joiner)", `${"9".repeat(40)}...`));
		for (const word of PROTOTYPE_WORDS) expect(hiddenFigureAtColon(lay(["IDENT", `${RLO}${word}`], ["COLON", ":"], ["NUMBER", "00"]), 1)).toBeNull();
	});
});

describe("adversarial: security", () => {
	test("a prototype word with an override is a label of words, and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(outcome(`${RLO}${word}: 5`)).toBe("5");
				expectHonestDocument(`${word} = 24\n${RLO}${word}:00\n${RLO}24:00`);
			}
		});
	});

	test("a long figure, many lines and deep brackets are refused within the budget", () => {
		expect(outcome(`${RLO}${"9".repeat(1_000)}:00`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: /);
		expectHonestLine(`${RLO}${RESOURCE_PROBES.longIdentifier(1_900).replace(/x/g, "9")}:00`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(40).replace("1", `${RLO}24`)}:00`, { budgetMs: 5_000 });
		expectHonestDocument(Array.from({ length: 500 }, (_, i) => `${RLO}${i}:00`).join("\n"), { budgetMs: 10_000 });
	});

	test("every text edge before the figure, and markup after it, is honest", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`${edge}${RLO}24:00`);
		for (const edge of TEXT_EDGES) expectHonestLine(`${RLO}24:${edge}`);
		expect(outcome(`${RLO}24:<script>alert(1)</script>`)).not.toBe("0");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check and a section around it", () => {
		const doc = both(["# Shift", "start = 9", `${RLO}9:30`, "check start == 9", "start"]);
		expect(doc[2]).toBe(`ERROR ${DIRECTION("<U+202E>9", "U+202E (right-to-left override)")}`);
		expect(doc[3]).not.toMatch(/^ERROR/);
		expect(doc[4]).toBe("9");
	});

	test("an edit that deletes the character answers the time", () => {
		expect(both([`${ZWJ}9:30`])[0]).toMatch(/^ERROR "<U\+200D>9" holds/);
		expect(both(["9:30"])[0]).toBe(outcome("9:30"));
	});

	test("the other colon refusals are unchanged", () => {
		expect(outcome("24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("٢٤:00")).toMatch(/^OTHER_SCRIPT_DIGITS: /);
		expect(outcome("(1+2): 5")).toMatch(/^LABEL_NOT_A_NAME: /);
		expect(outcome("true ? 25 : 30")).toMatch(/^TERNARY_UNSUPPORTED: /);
		expect(outcome("Week 12: 75")).toBe("75");
	});
});

describe("adversarial: edge cases", () => {
	test("zero, a negative, the last minute of a day and every numeric edge after the override", () => {
		expect(outcome(`${RLO}0:00`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: /);
		expect(outcome(`-${RLO}1:00`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: /);
		expect(outcome(`${RLO}23:59`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: /);
		for (const line of fill(`${RLO}X:00`, NUMERIC_EDGES)) expect({ line, answer: outcome(line) }).not.toEqual({ line, answer: "0" });
		for (const line of fill(`${ZWJ}X:00`, NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF, a trailing newline and padding", () => {
		expect(both([`${RLO}24:00\r`, ""])).toEqual([`ERROR ${DIRECTION("<U+202E>24", "U+202E (right-to-left override)")}`, ""]);
		expect(outcome(`   ${ZWJ}24:00   `)).toMatch(/^INVISIBLE_CHARACTER_IN_NUMBER: /);
	});
});
