import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	DOCUMENT_EDGES,
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
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { isInsideRangeContext, isSingleArgumentCall } from "@solve-js/normalizer/BuiltinNormalizerRules";
import { mapReduceCallNormalizerRule } from "@solve-js/packages/mapreduce/normalizer/MapReduceCallNormalizerRule";

/**
 * Found bug: `total(1:3)` was refused (AGGREGATE_CALL_RANGE, "write
 * sum(1:3)") although `total` is documented as `sum`'s synonym: `sum of` is
 * `total of`, a line that is only `sum` or `total` totals the block above, and
 * `sum(line 1 : line 4)` and `total(line 1 : line 4)` are the same span. The
 * map-reduce rule fused only the word `sum` before a bracket, and only `sum`
 * opened a bracket in which `1:3` is a range rather than a clock time, so
 * `total(...)` fell to the line-range call and its range was 1:03 AM.
 *
 * `total(...)` with one argument now reads as `sum(...)`: a range, a
 * bracketed list or a name holding one is added up. With commas it is the
 * aggregate it was (`total(1, 2, 3)`), and over lines the line range. The
 * element form `sum(x^2, 1:3)` stays `sum`'s alone.
 */

/** One line through evaluateLine, as the reader sees it. */
function shown(line: string): string {
	const outcome = evaluateLine(line);
	if (outcome.kind === "value") return outcome.text.replace(/^=\s*/, "");
	if (outcome.kind === "crashed") return `CRASHED ${outcome.name}`;
	return `ERROR ${outcome.message}`;
}

/** The code a line is refused with, or "" for an answer. */
function code(line: string): string {
	const outcome = evaluateLine(line);
	return outcome.kind === "error" || outcome.kind === "thrown" ? outcome.code : "";
}

/** The lexer's tokens for a line, without spaces. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

/** Both document passes, each line as the reader sees it. */
function both(text: string): { batch: string[]; incremental: string[] } {
	const lines = (result: ReturnType<ReturnType<typeof newTrackedEngine>["parseDocument"]>): string[] =>
		result.lines.map((l) => {
			if (l.result == null) return l.error ? `ERROR ${l.error}` : "";
			if (l.result.isError()) return `ERROR ${String(l.result.errorMessage)}`;
			return formatValue(l.result).replace(/^=\s*/, "");
		});
	return { batch: lines(newTrackedEngine().parseDocument(text)), incremental: lines(evaluateDocument(newTrackedEngine(), text)) };
}

describe("the line that exposed it", () => {
	test("total(1:3) is 6, as sum(1:3) is, through every entry point", () => {
		expect(shown("total(1:3)")).toBe("6");
		const { batch, incremental } = both("1\n2\n3\ntotal(1:3)\nsum(1:3)");
		expect(batch).toEqual(["1", "2", "3", "6", "6"]);
		expect(incremental).toEqual(batch);
	});

	test.each([
		["total(1:3)", "6"],
		["Total(1:3)", "6"],
		["TOTAL(1:3)", "6"],
		["total (1:3)", "6"],
		["total(-2:2)", "0"],
		["total(1:10)", "55"],
		["total([10, 20, 30])", "60"],
		["total(1, 2, 3)", "6"],
		["total($5, $7)", "$12.00"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("a name holding a list or a range, from the line above", () => {
		const { batch, incremental } = both("a = [1, 2, 3]\nr = 1:4\ntotal(a)\nsum(a)\nn = 3\ntotal(1:n)");
		expect(batch.slice(2)).toEqual(["6", "6", "3", "6"]);
		expect(incremental).toEqual(batch);
	});

	test("the line range and the bare word keep their readings", () => {
		const { batch, incremental } = both("1\n2\n3\ntotal(line 1 : line 3)\ntotal");
		expect(batch.slice(3)).toEqual(["6", "6"]);
		expect(incremental).toEqual(batch);
	});

	test("a range that is not one is refused as sum refuses it", () => {
		expect(code("total(3:1)")).toBe("DESCENDING_RANGE");
		expect(code("total(1.5:3)")).toBe(code("sum(1.5:3)"));
		expect(code("total(5)")).toBe("MAP_REDUCE_REQUIRES_COLLECTION");
		expect(code(`total(${RESOURCE_PROBES.hugeRange()})`)).toBe("COLLECTION_TOO_LARGE");
	});

	test("the boundary: the element form is sum's, and other aggregates still refuse a range", () => {
		expect(shown("sum(x^2, 1:3)")).toBe("14");
		expect(code("total(x^2, 1:3)")).toBe("UNDEFINED_VARIABLE");
		expect(code("average(1:3)")).toBe("AGGREGATE_CALL_RANGE");
		expect(shown("total(9:30, 10:15)")).toBe("ERROR A date or time cannot be added: only numbers and quantities can.");
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("isSingleArgumentCall", () => {
	test("ordinary: one argument, a range, a list, a nested call", () => {
		expect(isSingleArgumentCall(lex("total(1:3)"), 1)).toBe(true);
		expect(isSingleArgumentCall(lex("total([1, 2, 3])"), 1)).toBe(true);
		expect(isSingleArgumentCall(lex("total(max(1, 2))"), 1)).toBe(true);
		expect(isSingleArgumentCall(lex("total(a)"), 1)).toBe(true);
	});

	test("not one: commas at its own depth, nothing at all, not a bracket", () => {
		expect(isSingleArgumentCall(lex("total(1, 2)"), 1)).toBe(false);
		expect(isSingleArgumentCall(lex("total(x, 1:3)"), 1)).toBe(false);
		expect(isSingleArgumentCall(lex("total()"), 1)).toBe(false);
		expect(isSingleArgumentCall(lex("total(1:3)"), 0)).toBe(false);
		expect(isSingleArgumentCall(lex("total(1:3)"), 99)).toBe(false);
		expect(isSingleArgumentCall([], 0)).toBe(false);
	});

	test("hostile: an unclosed call, unbalanced brackets and a call past the scan limit", () => {
		expect(isSingleArgumentCall(lex("total(1:3"), 1)).toBe(false);
		expect(isSingleArgumentCall(lex("total((1:3)"), 1)).toBe(false);
		expect(isSingleArgumentCall(lex("total(1])"), 1)).toBe(false);
		const long = lex(`total(${RESOURCE_PROBES.longSum(6_000)})`);
		const started = performance.now();
		expect(isSingleArgumentCall(long, 1)).toBe(false);
		expect(performance.now() - started).toBeLessThan(200);
	});
});

describe("isInsideRangeContext with total", () => {
	test("inside a one-argument total(...), a colon is a range", () => {
		const tokens = lex("total(1:3)");
		expect(isInsideRangeContext(tokens, 2)).toBe(true);
	});

	test("inside total(...) with commas, or after a word that is not an aggregate, it is not", () => {
		expect(isInsideRangeContext(lex("total(9:30, 10:15)"), 2)).toBe(false);
		expect(isInsideRangeContext(lex("totals(1:3)"), 2)).toBe(false);
		expect(isInsideRangeContext(lex("(1:3)"), 1)).toBe(false);
	});
});

describe("mapReduceCallNormalizerRule with total", () => {
	const rule = mapReduceCallNormalizerRule();

	test("a one-argument total( becomes sum's token, keeping its spelling", () => {
		const match = rule.match(lex("Total(1:3)"), 0);
		expect(match?.replacement[0].type).toBe("SUM_FN");
		expect(match?.replacement[0].value).toBe("Total");
	});

	test("declines with commas, before a line reference, and without a bracket", () => {
		expect(rule.match(lex("total(1, 2)"), 0)).toBeNull();
		expect(rule.match(lex("total(line 1 : line 3)"), 0)).toBeNull();
		expect(rule.match(lex("total = 5"), 0)).toBeNull();
		expect(rule.match(lex("total"), 0)).toBeNull();
	});

	test("hostile: prototype words are not call words", () => {
		for (const word of PROTOTYPE_WORDS) expect(rule.match(lex(`${word}(1:3)`), 0)).toBeNull();
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words as the range's ends or the list, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`total(${word}:3)`);
				expectHonestLine(`total(${word})`);
				expectHonestDocument(`${word} = [1, 2]\ntotal(${word})`);
			}
		});
	});

	test("security: sized input, deep brackets, look-alike and markup text", () => {
		expectHonestLine(`total(${RESOURCE_PROBES.deepParens(200)}:3)`, { budgetMs: 5_000 });
		expectHonestLine(`total(1:${"9".repeat(400)})`);
		expectHonestLine(`total([${RESOURCE_PROBES.longSum(2_000).replace(/ \+ /g, ", ")}])`, { budgetMs: 5_000 });
		for (const line of fill("total(X:3)", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("total(X)", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a typo, an unclosed call, a check, a what-if and a tag around it", () => {
		expect(shown("totl(1:3)")).toMatch(/^ERROR/);
		expect(shown("total(1:3")).toMatch(/^ERROR/);
		const { batch, incremental } = expectHonestDocument("n = 4\ntotal(1:n)\ncheck total(1:n) == sum(1:n)\ntotal(1:n) #range\nwhat if n = 3: line 2");
		expect(batch.slice(1, 3)).toEqual(["= 10", "= ✓"]);
		expect(incremental).toEqual(batch);
		expect(shown("total(1:3) + total(4:5)")).toBe("15");
		expect(shown("total(1:3) * 2")).toBe("12");
	});

	test("edge: every numeric edge at each end, and the document edges around it", () => {
		for (const line of fill("total(X:3)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("total(1:X)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("total(0:0)")).toBe("0");
		expect(shown("total(-3:-1)")).toBe("-6");
		for (const doc of DOCUMENT_EDGES) expectHonestDocument(`${doc}\ntotal(1:3)`);
		expect(both("total(1:3)\r\ntotal(2:3)\r\n").batch.slice(0, 2)).toEqual(["6", "5"]);
	});
});
