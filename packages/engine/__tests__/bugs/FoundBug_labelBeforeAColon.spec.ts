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
import { EngineError } from "@solve-js/errors/EngineError";
import type { Token } from "@solve-js/lexer/Token";
import {
	QUOTE_LIMIT,
	colonLabelFault,
	conditionStart,
	labelSubject,
	quoted,
	ternaryAtQuestion,
	ternaryFault,
	ternaryMessage,
	textOf,
	timeAtColon,
	tokenEnd,
} from "@solve-js/engine/ColonLabel";

/**
 * Found bug: the label reading took any text before a colon as a label, so a
 * colon that belonged to something else made the text before it vanish and
 * the line answered with whatever followed it.
 *
 * - `1 + 24:00` answered 0: `1 + 24` was the label. Now refused as the time
 *   that does not exist, as `24:00` alone is.
 * - `1:23:99` answered 99: the clock time `1:23` was the label. Now refused as
 *   a time whose seconds are out of range.
 * - `true ? 25 : 30` answered 30: `true ? 25` was the label. There is no
 *   `?` and `:` choice; now refused with the line spelled as
 *   `if true then 25 else 30`.
 * - `a > b: 1` answered 1 whatever `a` and `b` held: a comparison is not a
 *   name. `(1+2): 5` answered 5: a calculation with no word names nothing.
 *
 * The rule lives in engine/ColonLabel.ts. A label is a name: words, with the
 * numbers and joining marks a name has (`Week 12`, `Year-end`, `Food + drink`).
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

/** The engine's normalised tokens for a line, as the parser is given them. */
function tokens(source: string): Token[] {
	return newTrackedEngine().tokenizeForClassification(source);
}

/** The index of the first token of a type. */
function at(list: readonly Token[], type: string, from = 0): number {
	for (let k = from; k < list.length; k++) if (list[k].type === type) return k;
	return -1;
}

const TERNARY = 'TERNARY_UNSUPPORTED: There is no choice written with "?" and ":": write if true then 25 else 30';

describe("the lines that exposed it", () => {
	test("1 + 24:00 is refused as the time that does not exist, not answered 0", () => {
		expect(outcome("1 + 24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("9:30 + 24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("2 * 24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("1 plus 24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
	});

	test("1:23:99 is refused as a time whose seconds are out of range, not answered 99", () => {
		for (const line of ["1:23:99", "1:23:99 + 1", "1 + 1:23:99", "Lap 1:23:99", "a = 1:23:99", "x: 1:23:99", "9:30:99"]) {
			expect({ line, shown: outcome(line) }).toEqual({ line, shown: expect.stringMatching(/^INVALID_TIME_LITERAL: "\d+:\d\d:99" is not a valid time$/) });
		}
		expect(outcome("1:23:99")).toBe('INVALID_TIME_LITERAL: "1:23:99" is not a valid time');
	});

	test("true ? 25 : 30 is refused with the line spelled as if ... then ... else, not answered 30", () => {
		expect(outcome("true ? 25 : 30")).toBe(TERNARY);
		expect(outcome("a > b ? 1 : 2")).toBe('TERNARY_UNSUPPORTED: There is no choice written with "?" and ":": write if a > b then 1 else 2');
		expect(outcome("5 > 3 ? 1 : 2")).toBe('TERNARY_UNSUPPORTED: There is no choice written with "?" and ":": write if 5 > 3 then 1 else 2');
		expect(outcome("Note: a ? b : c")).toBe('TERNARY_UNSUPPORTED: There is no choice written with "?" and ":": write Note: if a then b else c');
		expect(outcome("true ? 9:30 : 10:00")).toBe('TERNARY_UNSUPPORTED: There is no choice written with "?" and ":": write if ... then ... else ...');
		// The form the refusal names works, with the answer the reader meant.
		expect(outcome("if true then 25 else 30")).toBe("25");
		expect(outcome("if 5 > 3 then 1 else 2")).toBe("1");
	});

	test("the other operator-before-colon cases the sweep found are each honest", () => {
		expect(outcome("a > b: 1")).toBe('LABEL_NOT_A_NAME: "a > b" before the colon is a comparison, not a label: a label names the figure in words, and a choice is written if ... then ... else');
		expect(outcome("Score >= 90: 12")).toMatch(/^LABEL_NOT_A_NAME: "Score >= 90" before the colon is a comparison/);
		expect(outcome("a ≥ b: 1")).toMatch(/^LABEL_NOT_A_NAME: "a ≥ b"/);
		expect(outcome("(1+2): 5")).toBe('LABEL_NOT_A_NAME: "(1+2)" before the colon is a calculation, not a label: a label names the figure in words');
		expect(outcome("1 + 24: 00")).toMatch(/^LABEL_NOT_A_NAME: "1 \+ 24" before the colon is a calculation/);
		// These never were labels: the colon between two numbers is a clock
		// time's, and the time is read (and refused where it cannot be used).
		expect(outcome("2*3: 4")).toMatch(/^INVALID_DATETIME_OP: A date or time cannot be multiplied/);
		expect(outcome("-1: 2")).toMatch(/^INVALID_DATETIME_OP: A date or time cannot be negated/);
		expect(outcome("x = 5: 6")).toMatch(/5:06:00 AM$/);
	});

	test("every documented label form still answers its figure", () => {
		const forms: [string, string][] = [
			["Rent: $1200", "$1,200.00"],
			["pi approximation: 355/113", "3.14"],
			["total: 5 + 3", "8"],
			["Groceries: 45", "45"],
			["Week 12: 75", "75"],
			["Week 12:75", "75"],
			["x:3", "3"],
			["2026-01-04: 45", "45"],
			["input value: :x = 5", "5"],
			["Refund: -$50", "-$50.00"],
			["Rent $1200", "$1,200.00"],
			["Rent: $5", "$5.00"],
			// Names that hold a joining mark or a number stay labels.
			["Food + drink: $40", "$40.00"],
			["Year-end: 5", "5"],
			["Cost/unit: 3", "3"],
			["Q1/Q2: 5", "5"],
			["Q1-Q2: 40", "40"],
			["Mortgage - fixed: 900", "900"],
			["Profit & loss: 5", "5"],
			["Step 1.5: 3", "3"],
			["10%: 5", "5"],
			["Done?: 5", "5"],
			["9:30 pm: 5", "5"],
			["Orders over $100: 12", "12"],
			["Note: see above: 5", "5"],
		];
		for (const [line, answer] of forms) expect({ line, shown: outcome(line) }).toEqual({ line, shown: answer });
	});
});

describe("through every entry point", () => {
	test("the single-line evaluateLine refuses each with the same code", () => {
		expect(single("1 + 24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(single("1:23:99")).toBe('INVALID_TIME_LITERAL: "1:23:99" is not a valid time');
		expect(single("true ? 25 : 30")).toBe(TERNARY);
		expect(single("a > b: 1")).toMatch(/^LABEL_NOT_A_NAME: /);
		expect(single("Week 12: 75")).toBe("75");
	});

	test("parseDocument and evaluateDocument refuse each with the code, keep the labels, and agree", () => {
		const { batch, incremental } = both("1 + 24:00\n1:23:99\ntrue ? 25 : 30\na > b: 1\n(1+2): 5\nWeek 12: 75\nRent: $1200\nFood + drink: $40");
		expect(batch).toEqual([
			"ERROR INVALID_TIME_LITERAL",
			"ERROR INVALID_TIME_LITERAL",
			"ERROR TERNARY_UNSUPPORTED",
			"ERROR LABEL_NOT_A_NAME",
			"ERROR LABEL_NOT_A_NAME",
			"75",
			"$1,200.00",
			"$40.00",
		]);
		expect(incremental).toEqual(batch);
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("tokenEnd and textOf", () => {
	test("ordinary: the text as typed, spaces where the line had them", () => {
		expect(textOf(tokens("(1+2)"))).toBe("(1+2)");
		expect(textOf(tokens("a > b"))).toBe("a > b");
		const list = tokens("Rent: $1200");
		expect(tokenEnd(list[0])).toBe(4);
	});

	test("boundary: no tokens, one token, a fused token's end", () => {
		expect(textOf([])).toBe("");
		expect(textOf(tokens("x"))).toBe("x");
		const clock = tokens("1:23:99")[0];
		expect(clock.type).toBe("CLOCK_TIME");
		expect(tokenEnd(clock)).toBe(4);
	});

	test("hostile: a long run of tokens is joined in one pass, prototype words are text", () => {
		const long = tokens(Array.from({ length: 2_000 }, () => "a").join(" + "));
		expect(textOf(long)?.length).toBe(2_000 * 4 - 3);
		// A fused token whose text is the engine's reading has nothing to quote.
		expect(textOf(tokens("line 3"))).toBeNull();
		expect(textOf(tokens("true ? 1 : 2"))).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(textOf(tokens(`${word} > 1`))).toBe(`${word} > 1`);
	});
});

describe("labelSubject", () => {
	test("ordinary: the label quoted as typed", () => {
		expect(labelSubject(tokens("a > b"))).toBe('"a > b" before the colon');
	});

	test("boundary: an empty label, and a fused token whose text is the engine's reading", () => {
		expect(labelSubject([])).toBe('"" before the colon');
		expect(labelSubject(tokens("line 3 > line 4"))).toBe("The text before the colon");
	});

	test("hostile: a long label is quoted short, markup is quoted as text", () => {
		expect(labelSubject(tokens(Array.from({ length: 500 }, () => "a").join(" + "))).length).toBeLessThan(QUOTE_LIMIT + 30);
		// The tags are fused by the engine's own markup reading, so the run has no
		// text of the reader's to quote and is named in words.
		expect(labelSubject(tokens("<b>a</b>"))).toBe("The text before the colon");
		expect(labelSubject(tokens("a < b"))).toBe('"a < b" before the colon');
	});
});

describe("quoted", () => {
	test("ordinary, boundary and hostile lengths", () => {
		expect(quoted("a > b")).toBe("a > b");
		expect(quoted("")).toBe("");
		expect(quoted("x".repeat(QUOTE_LIMIT))).toBe("x".repeat(QUOTE_LIMIT));
		expect(quoted("x".repeat(QUOTE_LIMIT + 1))).toBe(`${"x".repeat(QUOTE_LIMIT)}...`);
		expect(quoted("<script>".repeat(50)).length).toBe(QUOTE_LIMIT + 3);
	});
});

describe("timeAtColon", () => {
	const time = (line: string): string | null => {
		const list = tokens(line);
		return timeAtColon(list, at(list, "COLON"));
	};

	test("ordinary: a pair after an operator, a clock time with a third field", () => {
		expect(time("1 + 24:00")).toBe("24:00");
		expect(time("9:30 + 24:00")).toBe("24:00");
		expect(time("(1) * 24:00")).toBe("24:00");
		expect(time("1:23:99")).toBe("1:23:99");
		expect(time("Lap 1:23:99")).toBe("1:23:99");
		expect(time("24:00")).toBe("24:00");
	});

	test("boundary: a number after a word is a name's, a spaced colon is a label's, an am or pm takes no seconds", () => {
		expect(time("Week 12: 75")).toBeNull();
		expect(time("Week 12:75")).toBeNull();
		expect(time("Score >= 90: 12")).toBeNull();
		expect(time("9:30 pm: 5")).toBeNull();
		expect(time("1:23 :99")).toBeNull();
		expect(time("Rent: 5")).toBeNull();
		expect(timeAtColon([], 1)).toBeNull();
	});

	test("hostile: a colon at the end, a word after the colon, a prototype word before it", () => {
		const list = tokens("1 + 24:");
		expect(timeAtColon(list, list.length - 1)).toBeNull();
		expect(time("1 + 24:x")).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(time(`${word} 24:61`)).toBeNull();
	});
});

describe("colonLabelFault", () => {
	const fault = (line: string, which: "first" | "last" = "last") => {
		const list = tokens(line);
		let colon = at(list, "COLON");
		if (which === "last") for (let k = list.length - 1; k >= 0; k--) if (list[k].type === "COLON") { colon = k; break; }
		return colonLabelFault(list, colon);
	};

	test("ordinary: each shape that is not a name, with its code", () => {
		expect(fault("1 + 24:00")).toEqual({ code: "INVALID_TIME_LITERAL", message: '"24:00" is not a valid time' });
		expect(fault("true ? 25 : 30")?.code).toBe("TERNARY_UNSUPPORTED");
		expect(fault("a > b: 1")?.code).toBe("LABEL_NOT_A_NAME");
		expect(fault("x != y: 1")?.code).toBe("LABEL_NOT_A_NAME");
		expect(fault("(1+2): 5")?.message).toBe('"(1+2)" before the colon is a calculation, not a label: a label names the figure in words');
	});

	test("boundary: names stay labels, a question mark ending the label, a comparison word, a date", () => {
		for (const line of ["Rent: 5", "Week 12: 75", "Food + drink: 5", "Year-end: 5", "Done?: 5", "Orders over 100: 5", "2026-01-04: 45", "10%: 5", "x: 3"]) {
			expect({ line, fault: fault(line) }).toEqual({ line, fault: null });
		}
		// Only the text since the colon before is this colon's label.
		expect(fault("a > b: Note: 5")).toBeNull();
		expect(fault("Note: a > b: 5")?.message).toMatch(/^"a > b" before the colon/);
	});

	test("hostile: prototype words and markup as the label, a long comparison is quoted short", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(fault(`${word}: 5`)).toBeNull();
			expect(fault(`${word} > 100: 5`)?.code).toBe("LABEL_NOT_A_NAME");
		}
		const long = fault(`${Array.from({ length: 500 }, () => "a").join(" + ")} > b: 1`);
		expect(long?.message.length).toBeLessThan(200);
	});
});

describe("ternaryFault, ternaryAtQuestion, conditionStart and ternaryMessage", () => {
	test("ordinary: the reader's parts in the if ... then ... else spelling", () => {
		const list = tokens("true ? 25 : 30");
		expect(ternaryFault(list, at(list, "QUESTION"), at(list, "COLON")).message).toBe(TERNARY.replace(/^TERNARY_UNSUPPORTED: /, ""));
		const fused = tokens("a > b ? 1 : 2");
		expect(ternaryAtQuestion(fused, at(fused, "QUESTION"))?.message).toMatch(/write if a > b then 1 else 2$/);
		expect(ternaryMessage("x =", "a", "1", "2").message).toMatch(/write x = if a then 1 else 2$/);
	});

	test("boundary: no colon after the question mark, a question mark first, an empty part", () => {
		const open = tokens("true ? 25");
		expect(ternaryAtQuestion(open, at(open, "QUESTION"))).toBeNull();
		expect(ternaryAtQuestion(tokens("? 1 : 2"), 0)).toBeNull();
		expect(ternaryAtQuestion(tokens("1 + 2"), 1)).toBeNull();
		expect(ternaryMessage("", "", "1", "2").message).toMatch(/write if \.\.\. then \.\.\. else \.\.\.$/);
		expect(conditionStart(tokens("Note: a ? b"), 3)).toBe(2);
		expect(conditionStart(tokens("a ? b"), 1)).toBe(0);
		expect(conditionStart(tokens("x = a ? b"), 3)).toBe(2);
	});

	test("hostile: a part too long to quote gives the shape, prototype words are text", () => {
		expect(ternaryMessage("", "a".repeat(QUOTE_LIMIT + 1), "1", "2").message).toMatch(/write if \.\.\. then \.\.\. else \.\.\.$/);
		for (const word of PROTOTYPE_WORDS) {
			const list = tokens(`${word} ? 25 : 30`);
			expect(colonLabelFault(list, at(list, "COLON"))?.message).toBe(`There is no choice written with "?" and ":": write if ${word} then 25 else 30`);
		}
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words as the label and the condition, sized input, look-alike characters and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(outcome(`${word}: 5`)).toBe("5");
				expect(outcome(`${word} ? 25 : 30`)).toMatch(/^TERNARY_UNSUPPORTED: /);
				expect(outcome(`${word} > 100: 5`)).toMatch(/^LABEL_NOT_A_NAME: /);
				expectHonestDocument(`${word} = 5\n${word} + 24:00\n${word}: 7\ntotal above`);
			}
		});
		expectHonestLine(`${Array.from({ length: 2_000 }, () => "a").join(" + ")} > b: 1`, { budgetMs: 5_000 });
		expectHonestLine(`${Array.from({ length: 2_000 }, () => "a ? b").join(" : ")} : c`, { budgetMs: 5_000 });
		expectHonestLine(`${Array.from({ length: 500 }, () => "1").join(" + ")} + 24:00`, { budgetMs: 5_000 });
		expectHonestLine(`${"(".repeat(200)}1${")".repeat(200)}: 5`, { budgetMs: 5_000 });
		expectHonestLine(`x: ${RESOURCE_PROBES.hugeRange()}`, { budgetMs: 5_000 });
		// Digits from another script, a zero-width space, a fullwidth colon, a
		// direction override, markup: each is honest, never a wrong figure.
		for (const line of ["1 + ٢٤:٠٠", "1 + 24​:00", "1 + 24：00", "‮a > b: 1", "<b>a > b</b>: 1", "true ？ 25 : 30"]) expectHonestLine(line);
		for (const line of fill("true ? X : 30", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("Rent: X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a time from the line above, a check, a tag, a section, a line reference and an edit", () => {
		const { batch, incremental } = expectHonestDocument(
			"start = 9:30\nstart + 24:00\nRent: $1200 #home\nFood + drink: $40 #home\ntotal of #home\ncheck line 3 > line 4\ntrue ? line 3 : 0\nline 3 > line 4: 1",
		);
		expect(batch[1]).toBe('ERROR "24:00" is not a valid time');
		expect(batch[2]).toBe("= $1,200.00");
		expect(batch[3]).toBe("= $40.00");
		expect(batch[4]).toBe("= $1,240.00");
		expect(batch[5]).toBe("= ✓");
		expect(batch[6]).toMatch(/^ERROR There is no choice written with "\?" and ":"/);
		// A line reference is read before the parser runs, so the refusal names
		// the text rather than quoting the engine's reading of it.
		expect(batch[7]).toMatch(/^ERROR The text before the colon is a comparison/);
		expect(incremental).toEqual(batch);

		const sectioned = both("# Budget\nRent: $1200\nWeek 12: 75\n1 + 24:00\nsum");
		// The total refuses over the refused line, where it used to add the 0
		// the label reading gave it into a confident $1,275.
		expect(sectioned.batch.slice(1)).toEqual(["$1,200.00", "75", "ERROR INVALID_TIME_LITERAL", "ERROR LINE_RESULT_ERROR"]);
		expect(sectioned.incremental).toEqual(sectioned.batch);

		// A typo of a real time, and the edit that mends it.
		const engine = newTrackedEngine();
		expect(evaluateLine("1 + 1:23:99", engine).kind).toBe("thrown");
		expect(outcome("1:23:59")).toBe("5,039.00 s");
	});

	test("edge: zero, the numeric edges before the colon, CRLF, a trailing newline, blank lines", () => {
		expect(outcome("0 + 24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		expect(outcome("0:00:60")).toBe('INVALID_TIME_LITERAL: "0:00:60" is not a valid time');
		expect(outcome("23:59:59")).toBe("86,399.00 s");
		expect(outcome("true ? 0 : -0")).toMatch(/^TERNARY_UNSUPPORTED: /);
		for (const line of fill("X > 0: 1", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("1 + X:00", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		const { batch, incremental } = both("1 + 24:00\r\n\r\ntrue ? 25 : 30\r\nRent: $5\r\n");
		expect(batch.slice(0, 4)).toEqual(["ERROR INVALID_TIME_LITERAL", "", "ERROR TERNARY_UNSUPPORTED", "$5.00"]);
		expect(incremental).toEqual(batch);
	});
});
