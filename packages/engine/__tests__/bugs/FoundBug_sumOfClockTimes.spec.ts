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
	aggregateCallNormalizerRule,
	hasOwnColon,
	isMapReduceSum,
} from "@solve-js/packages/mathphrases/normalizer/AggregateCallNormalizerRule";

/**
 * Found bug: `sum(9:30, 10:15)` answered with the parser's wording, `Expected
 * "," but found ":"`. A colon inside `sum(...)` is a range, since `sum` walks a
 * range (`sum(x^2, 1:3)`), and a two-argument `sum` whose second argument held
 * a colon was left to map-reduce, which read `9` as the element expression
 * and stopped at the colon. `total(9:30, 10:15)` and `max(9:30, 10:15)` read
 * the two clock times.
 *
 * The element of `sum(<element>, <list>)` is worked out for each item, so it is
 * never a range: a first argument written with a colon of its own makes the
 * call the aggregate over its values, as three arguments or two plain values
 * already did. The colons are then clock times, and the call answers as
 * `total(9:30, 10:15)` does: times of day are refused by name, since a moment
 * is not an amount to add up.
 */

const TIMES_REFUSED = "AGGREGATE_NON_NUMERIC: A date or time cannot be added: only numbers and quantities can.";

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
			if (l.result == null) return l.error ? `ERROR ${l.error}` : "";
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

/** Whether the aggregate rule claims the call at the start of a line. */
function claimed(source: string): boolean {
	return aggregateCallNormalizerRule().match(lex(source), 0) !== null;
}

describe("the line that exposed it", () => {
	test("sum(9:30, 10:15) answers as total(9:30, 10:15) does, through every entry point", () => {
		expect(outcome("total(9:30, 10:15)")).toBe(TIMES_REFUSED);
		expect(outcome("sum(9:30, 10:15)")).toBe(TIMES_REFUSED);
		expect(outcome("sum(9:30,10:15)")).toBe(TIMES_REFUSED);
		const { batch, incremental } = both("sum(9:30, 10:15)\ntotal(9:30, 10:15)\nmax(9:30, 10:15)");
		expect(batch.slice(0, 2)).toEqual(["ERROR AGGREGATE_NON_NUMERIC", "ERROR AGGREGATE_NON_NUMERIC"]);
		expect(batch[2]).not.toMatch(/^ERROR/);
		expect(incremental).toEqual(batch);
	});

	test("no parser wording about the colon reaches the reader", () => {
		for (const line of ["sum(9:30, 10:15)", "sum(9:30, 1:3)", "sum(1:3, 4:6)", "sum(9:30, x)", "sum(12:00, 13:00)"]) {
			expect({ line, shown: outcome(line) }).not.toEqual({ line, shown: expect.stringMatching(/Expected|but found ":"/) });
		}
	});

	test("what was right stays right: the element form, a range as the list, lengths of time", () => {
		expect(outcome("sum(x^2, 1:3)")).toBe("14");
		expect(outcome("sum(x, 1:3)")).toBe("6");
		expect(outcome("sum(x*2, 0:3)")).toBe("12");
		expect(outcome("sum(x, 9:30)")).toBe("429");
		expect(outcome("sum(1:3)")).toBe("6");
		expect(outcome("sum(1, 2, 3)")).toBe("6");
		expect(outcome("sum(3, 4)")).toBe("7");
		expect(outcome("sum(5, 1:3)")).toBe("15");
		expect(outcome("sum(2 hours, 3 hours)")).toBe("5 hours");
		expect(outcome("sum(9:30, 10:15, 11:00)")).toBe(TIMES_REFUSED);
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("hasOwnColon", () => {
	test("ordinary: a colon form has one, a plain value does not", () => {
		expect(hasOwnColon(lex("9:30"))).toBe(true);
		expect(hasOwnColon(lex("1:3"))).toBe(true);
		expect(hasOwnColon(lex("x^2"))).toBe(false);
	});

	test("boundary: a colon inside a bracket is not the argument's own; nothing has none", () => {
		expect(hasOwnColon(lex("[1:3]"))).toBe(false);
		expect(hasOwnColon(lex("f(1:3)"))).toBe(false);
		expect(hasOwnColon(lex("(9:30)"))).toBe(false);
		expect(hasOwnColon(lex("f(1) : 3"))).toBe(true);
		expect(hasOwnColon([])).toBe(false);
	});

	test("hostile: unbalanced brackets and deep nesting never throw", () => {
		expect(hasOwnColon(lex(") ) 9:30"))).toBe(false);
		expect(hasOwnColon(lex("((( 9:30"))).toBe(false);
		expect(hasOwnColon(lex(`${RESOURCE_PROBES.deepParens(2_000)}:1`))).toBe(true);
	});
});

describe("isMapReduceSum", () => {
	test("ordinary: a bare name or a list after the element is map-reduce", () => {
		expect(isMapReduceSum(lex("x"), lex("5"))).toBe(true);
		expect(isMapReduceSum(lex("x^2"), lex("1:3"))).toBe(true);
		expect(isMapReduceSum(lex("x"), lex("[1, 2]"))).toBe(true);
		expect(isMapReduceSum(lex("3"), lex("4"))).toBe(false);
	});

	test("boundary: an element written with a colon is never map-reduce", () => {
		expect(isMapReduceSum(lex("9:30"), lex("10:15"))).toBe(false);
		expect(isMapReduceSum(lex("9:30"), lex("x"))).toBe(false);
		expect(isMapReduceSum(lex("[1:3]"), lex("1:3"))).toBe(true);
	});

	test("hostile: empty arguments and prototype words", () => {
		expect(isMapReduceSum([], [])).toBe(false);
		for (const word of PROTOTYPE_WORDS) expect(typeof isMapReduceSum(lex(word), lex("1:3"))).toBe("boolean");
	});
});

describe("aggregateCallNormalizerRule", () => {
	test("claims sum(9:30, 10:15), and leaves the element form and the one-argument form alone", () => {
		expect(claimed("sum(9:30, 10:15)")).toBe(true);
		expect(claimed("sum(1:3, 4)")).toBe(true);
		expect(claimed("sum(x^2, 1:3)")).toBe(false);
		expect(claimed("sum(x, 9:30)")).toBe(false);
		expect(claimed("sum(9:30)")).toBe(false);
		expect(claimed("sum(line 1 : line 3)")).toBe(false);
	});

	test("hostile: an unclosed call and a long argument list are bounded", () => {
		expect(claimed("sum(9:30, 10:15")).toBe(false);
		expect(claimed(`sum(9:30, ${Array.from({ length: 2_000 }, () => "10:15").join(", ")})`)).toBe(true);
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words, a long list of times, look-alike digits and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`sum(9:30, ${word})`);
				expectHonestLine(`sum(${word}, 9:30)`);
				expectHonestDocument(`${word} = 9:30\nsum(${word}, 10:15)\nsum(9:30, ${word})`);
			}
		});
		expectHonestLine(`sum(9:30, ${Array.from({ length: 2_000 }, () => "10:15").join(", ")})`, { budgetMs: 5_000 });
		expectHonestLine(`sum(9:30, ${RESOURCE_PROBES.hugeRange()})`, { budgetMs: 5_000 });
		for (const line of ["sum(٩:٣٠, 10:15)", "sum(9​:30, 10:15)", "sum(9:30, <b>10:15</b>)", "sum(‮9:30, 10:15)"]) expectHonestLine(line);
		for (const line of fill("sum(9:30, 10:15) X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: times on the lines above, a typo, durations instead, a check and the two passes", () => {
		const { batch, incremental } = expectHonestDocument(
			"start = 9:30\nend = 10:15\nsum(start, end)\nsum(9:30, 10:15)\nend - start\nsum(45 min, 30 min)\ncheck sum(9:30, 10:15) == 5",
		);
		expect(batch[3]).toMatch(/^ERROR /);
		expect(batch[4]).toBe("= 0:45");
		expect(batch[5]).toBe("= 75.00 min");
		expect(incremental).toEqual(batch);
		expectHonestLine("sum(9:30, 10:1 5)");
		expectHonestLine("sum(9:30,, 10:15)");
	});

	test("edge: midnight and the end of the day, numeric edges beside a time, CRLF", () => {
		expect(outcome("sum(0:00, 23:59)")).toBe(TIMES_REFUSED);
		// `24:00` is no clock time, so it is not fused as one anywhere in a
		// bracket, `(24:00)` included; that wording is outside this fix (noted
		// in its changeset). Here it is a structured refusal, never a crash.
		expect(evaluateLine("sum(24:00, 0:00)").kind).toBe("thrown");
		expectHonestLine("sum(24:00, 0:00)");
		for (const line of fill("sum(9:30, X)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		const { batch, incremental } = both("sum(9:30, 10:15)\r\ntotal(9:30, 10:15)\r\n");
		expect(batch[0]).toBe(batch[1]);
		expect(incremental).toEqual(batch);
	});
});
