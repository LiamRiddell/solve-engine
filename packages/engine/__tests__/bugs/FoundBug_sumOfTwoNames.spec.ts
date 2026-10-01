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
import {
	aggregateCallNormalizerRule,
	isMapReduceSum,
	mentionsElement,
} from "@solve-js/packages/mathphrases/normalizer/AggregateCallNormalizerRule";

/**
 * Found bug: `sum(a, b)`, where `a` and `b` are values on the lines above, was
 * refused with MAP_REDUCE_REQUIRES_COLLECTION ("sum adds up the items of a
 * list ... to add values one by one, list them, as in sum(5, 6)"), which is
 * what the reader had done; `total(a, b)` added them. A bare name as the first
 * argument made the call map-reduce's `sum(<element>, <list>)`, and with a
 * single value in `b` there was no list.
 *
 * The element of `sum(<element>, <list>)` is worked out for each item with `x`
 * standing for it. A first argument that does not use `x` is the same value
 * for every item, so `sum(a, b)` read as an element meant `a` once for each
 * item of `b`, which no one writes. A two-argument `sum` is now map-reduce
 * when its second argument is written as a list or a range, or its first uses
 * `x`; otherwise it adds its two values, as `total(a, b)` does.
 */

/** Both document passes, each line's code or answer, as written. */
function both(text: string): { batch: string[]; incremental: string[] } {
	const lines = (result: ReturnType<ReturnType<typeof newTrackedEngine>["parseDocument"]>): string[] =>
		result.lines.map((l) => {
			if (l.result == null) return l.error ? `ERROR ${String(l.errorCode)}` : "";
			if (l.result.isError()) return `ERROR ${String(l.result.errorCode)}`;
			return formatValue(l.result);
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
	test("sum(a, b) of two times answers as total(a, b) does, through both document passes", () => {
		const { batch, incremental } = both("a = 9:30\nb = 10:15\nsum(a, b)\ntotal(a, b)");
		expect(batch.slice(2)).toEqual(["ERROR AGGREGATE_NON_NUMERIC", "ERROR AGGREGATE_NON_NUMERIC"]);
		expect(incremental).toEqual(batch);
	});

	test("sum(a, b) of two numbers, two quantities and two amounts of money adds them", () => {
		const { batch, incremental } = expectHonestDocument(
			"a = 2\nb = 3\nsum(a, b)\nh = 2 hours\nm = 30 min\nsum(h, m)\nprice = $5\nfee = $7\nsum(price, fee)\nsum(a, 5)\nsum(5, b)",
		);
		expect(batch[2]).toBe("= 5");
		expect(batch[5]).toBe("= 2.50 hours");
		expect(batch[8]).toBe("= $12.00");
		expect(batch[9]).toBe("= 7");
		expect(batch[10]).toBe("= 8");
		expect(incremental).toEqual(batch);
	});

	test("evaluateLine has no lines above, so the names are refused as undefined, by name", () => {
		const o = evaluateLine("sum(a, b)");
		expect(o.kind).toBe("thrown");
		expect(o.kind !== "value" && o.kind !== "crashed" ? `${o.code}: ${o.message}` : "").toBe("UNDEFINED_VARIABLE: Undefined variable: a");
		const shown = evaluateLine("sum(2, 3)");
		expect(shown.kind === "value" ? shown.text : "").toBe("= 5");
	});

	test("the element form stays the element form: x, a list or a range written out", () => {
		const { batch, incremental } = expectHonestDocument(
			"xs = [1, 2, 3]\nsum(x, xs)\nsum(x * 2, xs)\nsum(x^2, 1:3)\nsum(2, [1, 2, 3])\nsum(5, 1:3)\nsum(max(x, 2), xs)",
		);
		expect(batch.slice(1)).toEqual(["= 6", "= 12", "= 14", "= 6", "= 15", "= 7"]);
		expect(incremental).toEqual(batch);
	});

	test("the boundary: x is the element's name, so sum(x, y) is the element form even with x defined above", () => {
		const { batch, incremental } = both("x = 2\ny = 3\nsum(x, y)\ntotal(x, y)\nx + y");
		expect(batch.slice(2)).toEqual(["ERROR MAP_REDUCE_REQUIRES_COLLECTION", "= 5", "= 5"]);
		expect(incremental).toEqual(batch);
	});

	test("the boundary: a name holding a list is not written as one, so sum(a, xs) is total's, which refuses a list", () => {
		const { batch, incremental } = both("xs = [1, 2, 3]\na = 2\nsum(a, xs)\ntotal(a, xs)\nsum(x, xs) + a");
		expect(batch.slice(2)).toEqual(["ERROR AGGREGATE_NON_NUMERIC", "ERROR AGGREGATE_NON_NUMERIC", "= 8"]);
		expect(incremental).toEqual(batch);
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("mentionsElement", () => {
	test("ordinary: x alone, in an expression, and in a nested call", () => {
		expect(mentionsElement(lex("x"))).toBe(true);
		expect(mentionsElement(lex("x^2 + 1"))).toBe(true);
		expect(mentionsElement(lex("max(x, 2)"))).toBe(true);
		expect(mentionsElement(lex("a"))).toBe(false);
	});

	test("boundary: a capital X, a longer name holding an x, and nothing", () => {
		expect(mentionsElement(lex("X"))).toBe(false);
		expect(mentionsElement(lex("xs"))).toBe(false);
		expect(mentionsElement(lex("max"))).toBe(false);
		expect(mentionsElement([])).toBe(false);
	});

	test("hostile: prototype words, markup and look-alike letters are not the element", () => {
		for (const word of PROTOTYPE_WORDS) expect(mentionsElement(lex(word))).toBe(false);
		expect(mentionsElement(lex("<x>"))).toBe(true);
		expect(mentionsElement(lex("х"))).toBe(false); // Cyrillic ha
		expect(mentionsElement(lex(RESOURCE_PROBES.longIdentifier(5_000)))).toBe(false);
	});
});

describe("isMapReduceSum", () => {
	test("ordinary: a list or range written out, or an element using x, is map-reduce", () => {
		expect(isMapReduceSum(lex("x"), lex("xs"))).toBe(true);
		expect(isMapReduceSum(lex("a"), lex("[1, 2]"))).toBe(true);
		expect(isMapReduceSum(lex("a"), lex("1:3"))).toBe(true);
		expect(isMapReduceSum(lex("x * 2"), lex("5"))).toBe(true);
	});

	test("boundary: two names, a name and a number, a number and a name are two values", () => {
		expect(isMapReduceSum(lex("a"), lex("b"))).toBe(false);
		expect(isMapReduceSum(lex("a"), lex("5"))).toBe(false);
		expect(isMapReduceSum(lex("5"), lex("b"))).toBe(false);
		expect(isMapReduceSum(lex("a + b"), lex("b"))).toBe(false);
		expect(isMapReduceSum(lex("9:30"), lex("xs"))).toBe(false);
	});

	test("hostile: empty arguments and prototype words never throw", () => {
		expect(isMapReduceSum([], [])).toBe(false);
		expect(isMapReduceSum(lex("x"), [])).toBe(true);
		for (const word of PROTOTYPE_WORDS) {
			expect(isMapReduceSum(lex(word), lex(word))).toBe(false);
			expect(isMapReduceSum(lex("x"), lex(word))).toBe(true);
		}
	});
});

describe("aggregateCallNormalizerRule", () => {
	test("claims sum(a, b), and leaves sum(x, xs) and sum(a, [1, 2]) to map-reduce", () => {
		expect(claimed("sum(a, b)")).toBe(true);
		expect(claimed("sum(a, 5)")).toBe(true);
		expect(claimed("Sum(price, fee)")).toBe(true);
		expect(claimed("sum(x, xs)")).toBe(false);
		expect(claimed("sum(a, [1, 2])")).toBe(false);
		expect(claimed("sum(a)")).toBe(false);
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words as both names, sized input, look-alike names and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`sum(${word}, ${word})`);
				expectHonestDocument(`${word} = 4\nb = 5\nsum(${word}, b)\nsum(b, ${word})`);
			}
		});
		const { batch } = expectHonestDocument("constructor = 4\nb = 5\nsum(constructor, b)");
		expect(batch[2]).toBe("= 9");
		expectHonestDocument(`a = ${RESOURCE_PROBES.longSum(2_000)}\nb = 1\nsum(a, b)`, { budgetMs: 10_000 });
		expectHonestLine(`sum(${RESOURCE_PROBES.longIdentifier()}, b)`, { budgetMs: 5_000 });
		expectHonestDocument("а = 2\nb = 3\nsum(а, b)"); // Cyrillic a
		expectHonestDocument("a = 2\nb = 3\nsum(a​, b)\nsum(<b>a</b>, b)");
		for (const line of fill("sum(2, 3) X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a typo, a unit that does not fit, a check, a what-if style edit and the two passes", () => {
		const { batch, incremental } = expectHonestDocument(
			"a = 2 m\nb = 3 kg\nsum(a, b)\nc = 30 cm\nsum(a, c)\ncheck sum(a, c) == 2.3 m\nsum(a, bb)\nsum(a, c) in cm",
		);
		expect(batch[2]).toMatch(/^ERROR length and mass cannot be added/);
		expect(batch[4]).toBe("= 2.30 m");
		expect(batch[6]).toBe("ERROR Undefined variable: bb");
		expect(batch[7]).toBe("= 230.00 cm");
		expect(incremental).toEqual(batch);
		const edited = both("a = 2\nb = 3\nsum(a, b)").batch[2];
		expect(edited).toBe("= 5");
		expect(both("a = 20\nb = 3\nsum(a, b)").batch[2]).toBe("= 23");
	});

	test("edge: the numeric edges as each value, a percentage, CRLF and a trailing newline", () => {
		for (const edge of NUMERIC_EDGES) {
			expectHonestDocument(`a = ${edge}\nb = 1\nsum(a, b)\ntotal(a, b)`, { allowNaN: true });
			const { batch } = both(`a = ${edge}\nb = 1\nsum(a, b)\ntotal(a, b)`);
			expect({ edge, sum: batch[2] }).toEqual({ edge, sum: batch[3] });
		}
		expect(both("a = 5%\nb = 3\nsum(a, b)").batch[2]).toBe(both("a = 5%\nb = 3\ntotal(a, b)").batch[2]);
		const { batch, incremental } = both("a = 2\r\nb = 3\r\nsum(a, b)\r\n");
		expect(batch[2]).toBe("= 5");
		expect(incremental).toEqual(batch);
	});
});
