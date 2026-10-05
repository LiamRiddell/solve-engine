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
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import {
	MAX_NAME_NUMBERS,
	TIME_LEAD_WORDS,
	isLabelColon,
	numberFollowsName,
	spaceAfterColon,
} from "@solve-js/packages/time/normalizer/LabelColon";
import { clockTimeNormalizerRule } from "@solve-js/packages/time/normalizer/ClockTimeNormalizerRule";
import { laptimeNormalizerRule } from "@solve-js/packages/time/normalizer/LaptimeNormalizerRule";
import { videoTimecodeNormalizerRule } from "@solve-js/packages/time/normalizer/VideoTimecodeNormalizerRule";
import { paceNotationNormalizerRule } from "@solve-js/packages/time/normalizer/PaceNotationNormalizerRule";

/**
 * Found bug: a label whose name ends on a number was refused when the number
 * and the figure after the colon made a real clock time.
 *
 * `Item 2: 45`, `Room 4: 12`, `Week 12: 30` and `Weeks 1-2: 40` were each
 * refused with the parser's `found "2:45"`: the clock-time rule joined the
 * number before the colon to the one after it whenever the pair was a valid
 * time, so the label lost its number and nothing was left for the label
 * reading to find. `Week 12: 75` only worked because 12:75 is no time.
 *
 * The cause was the time rules (clock time, lap time, timecode, pace), which
 * now leave a colon alone when it has a space after it and a name stands
 * before the number (packages/time/normalizer/LabelColon.ts). The boundary: a
 * spaced pair with no name before it (`9: 30`, `x = 5: 6`, `2*3: 4`) and an
 * unspaced one after a name (`Item 2:45`) are still times.
 */

/** One line through evaluateExpression: its code and message, or its answer. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** One line through the single-line entry point `evaluateLine`. */
function single(line: string): string {
	let value;
	try {
		value = newTrackedEngine().evaluateLine(1, line);
	} catch (error) {
		if (error instanceof EngineError) return `${error.code}: ${error.message}`;
		throw error;
	}
	return value.isError() ? `${String(value.errorCode)}: ${String(value.errorMessage)}` : formatValue(value).replace(/^=\s*/, "");
}

type DocumentResult = ReturnType<ReturnType<typeof newTrackedEngine>["parseDocument"]>;

/** Both document passes, each line's code or answer. */
function both(text: string): { batch: string[]; incremental: string[] } {
	const lines = (result: DocumentResult): string[] =>
		result.lines.map((l) => {
			if (l.result == null) return l.error ? `ERROR ${String(l.errorCode)}` : "";
			if (l.result.isError()) return `ERROR ${String(l.result.errorCode)}`;
			return formatValue(l.result).replace(/^=\s*/, "");
		});
	return { batch: lines(newTrackedEngine().parseDocument(text)), incremental: lines(evaluateDocument(newTrackedEngine(), text)) };
}

/** The lexer's tokens for a line, as the normaliser's rules are first given them. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

/** The index of the first token of a type. */
function at(list: readonly Token[], type: string, from = 0): number {
	for (let k = from; k < list.length; k++) if (list[k].type === type) return k;
	return -1;
}

/** Whether a rule fuses anything at the first number of a line. */
function fuses(rule: NormalizerRule, line: string, numberIndex = 0): boolean {
	const list = lex(line);
	let pos = -1;
	for (let k = 0, seen = 0; k < list.length; k++) {
		if (list[k].type !== "NUMBER") continue;
		if (seen++ === numberIndex) {
			pos = k;
			break;
		}
	}
	expect(pos).toBeGreaterThanOrEqual(0);
	return rule.match(list, pos, undefined as never) !== null;
}

describe("the lines that exposed it", () => {
	test("a label whose name ends on a number answers its figure when the pair is also a time", () => {
		expect(outcome("Item 2: 45")).toBe("45");
		expect(outcome("Room 4: 12")).toBe("12");
		expect(outcome("Week 12: 30")).toBe("30");
		expect(outcome("Weeks 1-2: 40")).toBe("40");
		// The one that already worked, because 12:75 is no time, still does.
		expect(outcome("Week 12: 75")).toBe("75");
		expect(outcome("Week 12:75")).toBe("75");
	});

	test("the other time rules leave the label's colon alone too", () => {
		// Lap time: `1: 9:30` was read as one three-field duration.
		expect(outcome("Day 1: 9:30")).toBe("9:30:00 AM");
		expect(outcome("Shift 2: 9:30 to 17:00")).toBe("450 minutes");
		// Timecode, pace, and a bare hour with am or pm after the figure.
		expect(outcome("Scene 1: 2:03:04")).toBe("7,384.00 s");
		expect(outcome("Run 2: 30/km")).toBe("30.00 /km");
		expect(outcome("Item 2: 4 pm")).toMatch(/4:00:00 PM$/);
		expect(outcome("Item 2: 45 + 5")).toBe("50");
	});

	test("the boundary: a spaced pair with no name before it, and an unspaced one after a name, are still times", () => {
		for (const line of ["9:30", "9: 30", "9 : 30", "9: 30 am"]) expect({ line, shown: outcome(line) }).toEqual({ line, shown: expect.stringMatching(/9:30:00 AM$/) });
		// As batch Y pinned them: an operator or `=` before the pair is no name.
		expect(outcome("x = 5: 6")).toMatch(/5:06:00 AM$/);
		expect(outcome("2*3: 4")).toMatch(/^INVALID_DATETIME_OP: A date or time cannot be multiplied/);
		expect(outcome("-1: 2")).toMatch(/^INVALID_DATETIME_OP: A date or time cannot be negated/);
		// A word that leads into a time is no name.
		expect(outcome("before 9: 30")).toBe('UNEXPECTED_TRAILING_TOKEN: Expected an operator or the end of the line, but found "9:30"');
		// Without the space the pair is a time, beside a word the line cannot use.
		expect(outcome("Item 2:45")).toBe('UNEXPECTED_TRAILING_TOKEN: Expected an operator or the end of the line, but found "2:45"');
		// The ternary refusal, which reads `1 : 2` as a fused time, is unchanged.
		expect(outcome("a > b ? 1 : 2")).toBe('TERNARY_UNSUPPORTED: There is no choice written with "?" and ":": write if a > b then 1 else 2');
	});
});

describe("through every entry point", () => {
	test("the single-line evaluateLine answers the figure", () => {
		expect(single("Item 2: 45")).toBe("45");
		expect(single("Weeks 1-2: 40")).toBe("40");
		expect(single("9: 30")).toMatch(/9:30:00 AM$/);
	});

	test("parseDocument and evaluateDocument answer each figure, total them, and agree", () => {
		const { batch, incremental } = both("Item 2: 45\nRoom 4: 12\nWeek 12: 30\nWeeks 1-2: 40\nsum");
		expect(batch).toEqual(["45", "12", "30", "40", "127"]);
		expect(incremental).toEqual(batch);
	});
});

// ── The parts ──────────────────────────────────────────────────────────────

describe("spaceAfterColon", () => {
	test("ordinary: a space, a tab or several after the colon; none before the minutes of a time", () => {
		expect(spaceAfterColon(lex("Item 2: 45"), 2)).toBe(true);
		expect(spaceAfterColon(lex("Item 2:\t45"), 2)).toBe(true);
		expect(spaceAfterColon(lex("Item 2:   45"), 2)).toBe(true);
		expect(spaceAfterColon(lex("Item 2:45"), 2)).toBe(false);
		expect(spaceAfterColon(lex("Item 2 :45"), 2)).toBe(false);
	});

	test("boundary: no colon there, nothing after it, or an index past the end", () => {
		expect(spaceAfterColon(lex("Item 2: 45"), 1)).toBe(false);
		expect(spaceAfterColon(lex("Item 2:"), 2)).toBe(false);
		expect(spaceAfterColon(lex("Item 2: 45"), 99)).toBe(false);
		expect(spaceAfterColon([], 0)).toBe(false);
		expect(spaceAfterColon(lex("Item 2: 45"), -1)).toBe(false);
	});
});

describe("numberFollowsName", () => {
	test("ordinary: a word before the number, with a name's numbers and joining marks between", () => {
		expect(numberFollowsName(lex("Item 2: 45"), 1)).toBe(true);
		expect(numberFollowsName(lex("Weeks 1-2: 40"), 3)).toBe(true);
		expect(numberFollowsName(lex("Part 1/2: 30"), 3)).toBe(true);
		expect(numberFollowsName(lex("x 5: 6"), 1)).toBe(true);
	});

	test("boundary: the start of the line, an operator, a bracket, `=`, or a mark straight after the word", () => {
		expect(numberFollowsName(lex("9: 30"), 0)).toBe(false);
		expect(numberFollowsName(lex("x = 5: 6"), 2)).toBe(false);
		expect(numberFollowsName(lex("2*3: 4"), 2)).toBe(false);
		expect(numberFollowsName(lex("(5: 6"), 1)).toBe(false);
		expect(numberFollowsName(lex("Item -2: 45"), 2)).toBe(false);
		// Not a number at all.
		expect(numberFollowsName(lex("Item 2: 45"), 0)).toBe(false);
		expect(numberFollowsName([], 0)).toBe(false);
	});

	test("a word that leads into a time, or into what follows it, is no name", () => {
		for (const word of TIME_LEAD_WORDS) {
			const list = lex(`${word} 9: 30`);
			const n = at(list, "NUMBER");
			expect({ word, name: numberFollowsName(list, n) }).toEqual({ word, name: false });
		}
		expect(numberFollowsName(lex("the 9: 30"), 1)).toBe(false);
		expect(numberFollowsName(lex("BEFORE 9: 30"), 1)).toBe(false);
	});

	test("hostile: a run of numbers longer than a name holds is no name, and the walk is bounded", () => {
		const fits = `Item ${Array.from({ length: MAX_NAME_NUMBERS + 1 }, (_, k) => String(k + 1)).join(" ")}: 45`;
		const fitsList = lex(fits);
		expect(numberFollowsName(fitsList, at(fitsList, "COLON") - 1)).toBe(true);
		const long = `Item ${Array.from({ length: 5_000 }, () => "1").join("-")}: 45`;
		const list = lex(long);
		const started = Date.now();
		expect(numberFollowsName(list, at(list, "COLON") - 1)).toBe(false);
		expect(Date.now() - started).toBeLessThan(500);
		// Prototype words are words like any other: a name.
		for (const word of PROTOTYPE_WORDS) expect(numberFollowsName(lex(`${word} 2: 45`), 1)).toBe(true);
		// A name may hold digits and underscores beside its letters, in any script.
		expect(numberFollowsName(lex("Zimmer 4: 12"), 1)).toBe(true);
		expect(numberFollowsName(lex("Q1 2: 45"), 1)).toBe(true);
		expect(numberFollowsName(lex("my_total 2: 45"), 1)).toBe(true);
		expect(numberFollowsName(lex("Комната 4: 12"), 1)).toBe(true);
	});
});

describe("isLabelColon", () => {
	test("both marks together, and neither alone", () => {
		expect(isLabelColon(lex("Item 2: 45"), 1)).toBe(true);
		expect(isLabelColon(lex("Item 2:45"), 1)).toBe(false);
		expect(isLabelColon(lex("9: 30"), 0)).toBe(false);
		expect(isLabelColon(lex("x = 5: 6"), 2)).toBe(false);
		expect(isLabelColon(lex("Item 2"), 1)).toBe(false);
		expect(isLabelColon([], 0)).toBe(false);
	});
});

describe("the time rules, called directly", () => {
	test("clock time: no fusion of a label's pair, and every time form still fuses", () => {
		const rule = clockTimeNormalizerRule();
		expect(fuses(rule, "Item 2: 45")).toBe(false);
		expect(fuses(rule, "Weeks 1-2: 40", 1)).toBe(false);
		for (const line of ["9:30", "9: 30", "9 : 30", "9:30 am", "Item 2:45", "x = 5: 6", "before 9: 30"]) expect({ line, fuses: fuses(rule, line) }).toEqual({ line, fuses: true });
		// The bare hour with am or pm after a label's figure is the figure's own time.
		expect(fuses(rule, "Item 2: 4 pm", 1)).toBe(true);
	});

	test("lap time, timecode and pace: no fusion across a label's colon, and their own forms still fuse", () => {
		expect(fuses(laptimeNormalizerRule(), "Day 1: 9:30")).toBe(false);
		expect(fuses(laptimeNormalizerRule(), "1:23:45")).toBe(true);
		expect(fuses(laptimeNormalizerRule(), "Lap 1:23:45")).toBe(true);
		expect(fuses(videoTimecodeNormalizerRule(), "Scene 1: 2:03:04")).toBe(false);
		expect(fuses(videoTimecodeNormalizerRule(), "1:02:03:04")).toBe(true);
		expect(fuses(paceNotationNormalizerRule(), "Run 2: 30/km")).toBe(false);
		expect(fuses(paceNotationNormalizerRule(), "5:30/km")).toBe(true);
		expect(fuses(paceNotationNormalizerRule(), "Pace 5:30/km")).toBe(true);
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words as the name, sized input, look-alike characters and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(outcome(`${word} 2: 45`)).toBe("45");
				expectHonestDocument(`${word} 2: 45\n${word} 4: 12\nsum`);
			}
		});
		expectHonestLine(Array.from({ length: 2_000 }, () => "Item 2: 45").join(" "), { budgetMs: 5_000 });
		expectHonestLine(`Item ${Array.from({ length: 5_000 }, () => "1").join("-")}: 45`, { budgetMs: 5_000 });
		expectHonestDocument(Array.from({ length: 2_000 }, (_, k) => `Item ${k % 24}: ${k % 60}`).join("\n"), { budgetMs: 20_000 });
		// A fullwidth colon, a zero-width space after the colon, digits from
		// another script, a direction override and markup: each is honest.
		for (const line of ["Item 2：45", "Item 2:​45", "Item 2: ​45", "Item ٢: ٤٥", "‮Item 2: 45", "<b>Item 2</b>: 45", "Item 2: <i>45</i>"]) expectHonestLine(line);
		for (const line of fill("Item 2: X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("X 2: 45", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a typo, a figure from the line above, a check, a tag, a section, a what-if and an edit", () => {
		const { batch, incremental } = expectHonestDocument(
			"n = 40\nItem 2: n + 5\nRoom 4: 12 #rooms\nRoom 5: 13 #rooms\ntotal of #rooms\ncheck line 2 > line 3\nItme 2: 45",
		);
		expect(batch[1]).toBe("= 45");
		expect(batch[4]).toBe("= 25");
		expect(batch[5]).toBe("= ✓");
		expect(batch[6]).toBe("= 45");
		expect(incremental).toEqual(batch);

		const sectioned = both("# Stock\nItem 2: 45\nItem 3: 15\nsum\n# Times\n9: 30");
		expect(sectioned.batch.slice(1, 4)).toEqual(["45", "15", "60"]);
		expect(sectioned.batch[5]).toMatch(/9:30:00 AM$/);
		expect(sectioned.incremental).toEqual(sectioned.batch);

		// A unit that does not fit is the figure's own refusal, not a time's.
		expect(outcome("Item 2: 45 pm")).toBe("UNDEFINED_VARIABLE: Undefined variable: pm");
		// The edit that adds the space turns the time back into a label.
		const engine = newTrackedEngine();
		expect(evaluateLine("Item 2:45", engine).kind).toBe("thrown");
		expect(evaluateLine("Item 2: 45", engine).kind).toBe("value");
	});

	test("edge: the clock's bounds, zero and negatives, the numeric edges, CRLF and blank lines", () => {
		expect(outcome("Item 0: 0")).toBe("0");
		expect(outcome("Item 0: 00")).toBe("0");
		expect(outcome("Item 23: 59")).toBe("59");
		expect(outcome("Item 24: 00")).toBe("0");
		expect(outcome("Item 2: -0")).toBe("0");
		expect(outcome("Item 2: -45")).toBe("-45");
		for (const line of fill("Item 2: X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("Item X: 45", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		const { batch, incremental } = both("Item 2: 45\r\n\r\nRoom 4: 12\r\nsum\r\n");
		expect(batch.slice(0, 4)).toEqual(["45", "", "12", "12"]);
		expect(incremental).toEqual(batch);
	});
});
