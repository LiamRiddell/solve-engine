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
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import {
	INVALID_CLOCK_TIME,
	colonPairAt,
	invalidClockTimeNormalizerRule,
	invalidTimeMessage,
	isInsideBrackets,
} from "@solve-js/packages/time/normalizer/InvalidClockTimeNormalizerRule";

/**
 * Found bug: a colon pair that is no clock time, written inside a bracket,
 * answered with the parser's wording. `24:00` on its own line is refused with
 * INVALID_TIME_LITERAL, but `(24:00)`, `total(24:00, 0:00)`, `sum(24:00, 0:00)`
 * and `max(24:00, 1)` each said `Expected ")", but found ":"`.
 *
 * The clock-time rule declines an hour past 23 or a minute past 59 and leaves
 * the colon as it was. At the top level of a line the engine's label reading
 * then refuses a colon between numbers by name; inside a bracket no label can
 * stand, so the bracket's parselet met the colon where it wanted its `)`. A
 * rule below every time rule now fuses the pair inside a bracket into one
 * token, which the parser refuses with the same code and words as the line on
 * its own. Where a colon is a range (the collection of a map-reduce call, a
 * matrix slice) it is left alone.
 */

/** One line through evaluateLine: its code and message, or its answer. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** Both document passes, each line's code or answer. */
function both(text: string): { batch: string[]; incremental: string[] } {
	const lines = (result: ReturnType<ReturnType<typeof newTrackedEngine>["parseDocument"]>): string[] =>
		result.lines.map((l) => {
			if (l.result == null) return l.error ? `ERROR ${String(l.errorCode)}` : "";
			if (l.result.isError()) return `ERROR ${String(l.result.errorCode)}`;
			return String(l.result.toNumber());
		});
	return { batch: lines(newTrackedEngine().parseDocument(text)), incremental: lines(evaluateDocument(newTrackedEngine(), text)) };
}

/** The lexer's tokens for a line, without spaces. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

const REFUSED_24 = 'INVALID_TIME_LITERAL: "24:00" is not a valid time';

describe("the lines that exposed it", () => {
	test("each bracketed form is refused as the line on its own is, through evaluateLine", () => {
		expect(outcome("24:00")).toBe(REFUSED_24);
		expect(outcome("(24:00)")).toBe(REFUSED_24);
		expect(outcome("total(24:00, 0:00)")).toBe(REFUSED_24);
		expect(outcome("sum(24:00, 0:00)")).toBe(REFUSED_24);
		expect(outcome("max(24:00, 1)")).toBe(REFUSED_24);
		expect(outcome("[24:00]")).toBe(REFUSED_24);
		expect(outcome("abs(9:60)")).toBe('INVALID_TIME_LITERAL: "9:60" is not a valid time');
	});

	test("both document passes refuse it with the code, and agree", () => {
		const { batch, incremental } = both("(24:00)\ntotal(24:00, 0:00)\nmax(24:00, 1)\n24:00\n(9:30) - (8:30)");
		expect(batch.slice(0, 4)).toEqual(Array(4).fill("ERROR INVALID_TIME_LITERAL"));
		expect(batch[4]).not.toMatch(/^ERROR/);
		expect(incremental).toEqual(batch);
	});

	test("no parser wording about the colon reaches the reader", () => {
		for (const line of ["(24:00)", "(25:61)", "(12:60)", "(1920:1080)", "(1.5:3)", "(13:00pm)", "(2026-01-04 24:00)", "(5 + 24:00) * 2", "[1, 24:00]"]) {
			const shown = outcome(line);
			expect({ line, shown }).toEqual({ line, shown: expect.stringMatching(/^INVALID_TIME_LITERAL: "[^"]+" is not a valid time$/) });
		}
	});

	test("what was right stays right: valid times, ranges where a range belongs, labels at the top level", () => {
		expect(outcome("(9:30)")).toMatch(/9:30:00 AM$/);
		expect(outcome("max(9:30, 10:15)")).toMatch(/10:15:00 AM$/);
		expect(outcome("sum(24:30)")).toBe("189");
		expect(outcome("total(24:30)")).toBe("189");
		expect(outcome("sum(x, 24:30)")).toBe("189");
		expect(outcome("(1:23:45)")).toBe("5,025.00 s");
		expect(outcome("(25:00 /km)")).toBe("25:00 /km");
		expect(outcome("Week 12: 75")).toBe("75");
		expect(outcome("average(24:30)")).toMatch(/^AGGREGATE_CALL_RANGE: In average\(\.\.\.\), 24:30 is not a range/);
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("isInsideBrackets", () => {
	test("ordinary: inside a call or a list, and not at the top level", () => {
		expect(isInsideBrackets(lex("(24:00)"), 1)).toBe(true);
		expect(isInsideBrackets(lex("[24:00]"), 1)).toBe(true);
		expect(isInsideBrackets(lex("24:00"), 0)).toBe(false);
	});

	test("boundary: after a bracket has closed, and at position 0", () => {
		expect(isInsideBrackets(lex("(1) 24:00"), 3)).toBe(false);
		expect(isInsideBrackets(lex("(24:00)"), 0)).toBe(false);
		expect(isInsideBrackets([], 0)).toBe(false);
	});

	test("hostile: unbalanced closes never go below zero, a position past the end is bounded", () => {
		expect(isInsideBrackets(lex(")) ( 24:00"), 3)).toBe(true);
		expect(isInsideBrackets(lex("(1"), 99)).toBe(true);
		const deep = lex(`${"(".repeat(3_000)}24:00`);
		expect(isInsideBrackets(deep, 3_000)).toBe(true);
	});
});

describe("colonPairAt", () => {
	test("ordinary: a pair, and a pair with its am or pm", () => {
		expect(colonPairAt(lex("24:00"), 0)).toEqual({ literal: "24:00", consumed: 3 });
		expect(colonPairAt(lex("13:00pm"), 0)).toEqual({ literal: "13:00pm", consumed: 4 });
	});

	test("boundary: three fields, a decimal, and no pair at all", () => {
		expect(colonPairAt(lex("1:23:99"), 0)).toEqual({ literal: "1:23:99", consumed: 5 });
		expect(colonPairAt(lex("1.5:3"), 0)).toEqual({ literal: "1.5:3", consumed: 3 });
		expect(colonPairAt(lex("24"), 0)).toBeNull();
		expect(colonPairAt(lex("24:x"), 0)).toBeNull();
		expect(colonPairAt(lex("x:24"), 0)).toBeNull();
		expect(colonPairAt([], 0)).toBeNull();
	});

	test("hostile: a long run of colons takes a bounded number of tokens", () => {
		const run = colonPairAt(lex(Array.from({ length: 500 }, () => "99").join(":")), 0);
		expect(run).not.toBeNull();
		expect(run!.consumed).toBeLessThanOrEqual(15);
	});
});

describe("invalidTimeMessage", () => {
	test("names the pair as written, the same words as the line on its own", () => {
		expect(invalidTimeMessage("24:00")).toBe('"24:00" is not a valid time');
		expect(invalidTimeMessage("")).toBe('"" is not a valid time');
		expect(invalidTimeMessage("constructor")).toBe('"constructor" is not a valid time');
	});
});

describe("invalidClockTimeNormalizerRule", () => {
	const rule = invalidClockTimeNormalizerRule();
	const at = (source: string, pos: number) => rule.match(lex(source), pos);

	test("ordinary: fuses a pair inside a bracket, with the refusal on the token", () => {
		const match = at("(24:00)", 1);
		expect(match?.consumed).toBe(3);
		expect(match?.replacement[0].type).toBe(INVALID_CLOCK_TIME);
		expect(match?.replacement[0].value).toBe("24:00");
		expect(match?.replacement[0].fault).toEqual({ code: "INVALID_TIME_LITERAL", message: '"24:00" is not a valid time' });
	});

	test("boundary: not at the top level, not where a colon is a range, not part-way through a longer literal", () => {
		expect(at("24:00", 0)).toBeNull();
		expect(at("sum(24:30)", 2)).toBeNull();
		expect(at("sum(x, 24:30)", 4)).toBeNull();
		expect(at("m[24:30, 0:1]", 2)).toBeNull();
		expect(at("(1:23:99)", 3)).toBeNull();
		// The first argument of a call is not its collection, so it is fused there.
		expect(at("sum(24:00, 1:3)", 2)?.replacement[0].value).toBe("24:00");
	});

	test("hostile: words, prototype words and markup are not pairs", () => {
		for (const word of PROTOTYPE_WORDS) expect(at(`(${word}:00)`, 1)).toBeNull();
		expect(at("(<b>24</b>:00)", 1)).toBeNull();
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words beside the pair, sized input, look-alike digits and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`(${word}:00)`);
				expectHonestLine(`max(24:00, ${word})`);
				expectHonestDocument(`${word} = 5\n(24:00) + ${word}\n${word}(24:00)`);
			}
		});
		expectHonestLine(`total(${Array.from({ length: 2_000 }, () => "24:00").join(", ")})`, { budgetMs: 5_000 });
		expectHonestLine(`${"(".repeat(500)}24:00${")".repeat(500)}`, { budgetMs: 5_000 });
		expectHonestLine(`(${Array.from({ length: 2_000 }, () => "99").join(":")})`, { budgetMs: 5_000 });
		expectHonestLine(`max(24:00, ${RESOURCE_PROBES.hugeRange()})`, { budgetMs: 5_000 });
		for (const line of ["(٢٤:٠٠)", "(24​:00)", "(<b>24:00</b>)", "(‮24:00)", "(24：00)"]) expectHonestLine(line);
		for (const line of fill("(24:00) X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a typo of a real time, the end of a day from the line above, a check, and the two passes", () => {
		const { batch, incremental } = expectHonestDocument(
			"start = 9:30\nend = (24:00)\nmax(start, 24:00)\ncheck (24:00) > start\n(23:59) - start\nlength = (17:00) - (9:00)",
		);
		expect(batch[1]).toBe('ERROR "24:00" is not a valid time');
		expect(batch[2]).toBe('ERROR "24:00" is not a valid time');
		expect(batch[4]).toBe("= 14:29");
		expect(batch[5]).toBe("= 8:00");
		expect(incremental).toEqual(batch);
		expectHonestLine("(9:600)");
		expectHonestLine("(9::30)");
		expectHonestLine("(24:00 + 1 hour)");
	});

	test("edge: midnight both ways, the last minute, numeric edges as the hour, CRLF and a trailing newline", () => {
		expect(outcome("(0:00)")).not.toMatch(/^INVALID/);
		expect(outcome("(23:59)")).toMatch(/11:59:00 PM$/);
		expect(outcome("(24:00)")).toBe(REFUSED_24);
		expect(outcome("(-24:00)")).toBe(REFUSED_24);
		expect(outcome("(00:60)")).toBe('INVALID_TIME_LITERAL: "00:60" is not a valid time');
		for (const line of fill("(X:00)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		const { batch, incremental } = both("(24:00)\r\nmax(24:00, 1)\r\n");
		expect(batch.slice(0, 2)).toEqual(["ERROR INVALID_TIME_LITERAL", "ERROR INVALID_TIME_LITERAL"]);
		expect(incremental).toEqual(batch);
	});
});
