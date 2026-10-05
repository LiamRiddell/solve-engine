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
import { isInsideRangeContext, opensIndex } from "@solve-js/normalizer/BuiltinNormalizerRules";

/**
 * Found bug: `prod(9:30, 10:15)` and `sum(x, [9:30, 10:15])` answered with the
 * parser's wording (`Expected "," but found ":"`, `Expected "]" but found
 * ":"`). The normaliser read every colon between two numbers inside a
 * `map`, `reduce`, `sum` or `prod` bracket, and inside every `[...]`, as a
 * range, so neither clock time was read; the element parsed `9` and stopped
 * at the colon, and a list has no range items, so it stopped there too.
 *
 * Only the collection a call works through is a range. The element (or the
 * transform) before it is worked out for each item, so a colon there is a
 * clock time, and a list's items are values, so a colon inside `[...]` is one
 * too; only a matrix slice, `m[0:1, 0:1]`, keeps its ranges. `prod(9:30,
 * 10:15)` now multiplies a time and is refused by name, as `sum(9:30, 10:15)`
 * is refused as an aggregate, and a list of clock times is refused as a list
 * that cannot hold a time.
 */

const LIST_REFUSED = "MATRIX_CELL_NON_NUMERIC: A date or time cannot be a cell of a list: each cell holds one number.";
const PROD_REFUSED = "INVALID_DATETIME_OP: A date or time cannot be multiplied: it is a moment, not an amount. A length of time is written 1h30m, 90 minutes or 1:30:00.";

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

/** The position of the n-th token of a type in a line's tokens. */
function nth(tokens: readonly Token[], type: string, n = 1): number {
	let seen = 0;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type === type && ++seen === n) return i;
	}
	return -1;
}

describe("the lines that exposed it", () => {
	test("prod(9:30, 10:15) and a list of times are refused by name, through evaluateLine", () => {
		expect(outcome("prod(9:30, 10:15)")).toBe(PROD_REFUSED);
		expect(outcome("sum(x, [9:30, 10:15])")).toBe(LIST_REFUSED);
		expect(outcome("prod(x, [9:30, 10:15])")).toBe(LIST_REFUSED);
		expect(outcome("max([9:30, 10:15])")).toBe(LIST_REFUSED);
		expect(outcome("[9:30, 10:15]")).toBe(LIST_REFUSED);
	});

	test("both document passes refuse them with the code, and agree", () => {
		const { batch, incremental } = both("prod(9:30, 10:15)\nsum(x, [9:30, 10:15])\nprod(x, [9:30, 10:15])\nsum(x, [1, 2])");
		expect(batch).toEqual(["ERROR INVALID_DATETIME_OP", "ERROR MATRIX_CELL_NON_NUMERIC", "ERROR MATRIX_CELL_NON_NUMERIC", "3"]);
		expect(incremental).toEqual(batch);
	});

	test("no parser wording about the colon reaches the reader", () => {
		for (const line of ["prod(9:30, 10:15)", "prod(1:3, 4:6)", "sum(x, [9:30, 10:15])", "map(x * 2, [9:30])", "reduce(acc + x, [9:30, 10:15])", "sum([1:3])", "[1:3]", "[1, 2:3]"]) {
			expect({ line, shown: outcome(line) }).not.toEqual({ line, shown: expect.stringMatching(/Expected|but found ":"/) });
		}
	});

	test("what was right stays right: ranges as the collection, the element form, a matrix slice", () => {
		expect(outcome("sum(x, 9:30)")).toBe("429");
		expect(outcome("prod(x, 1:3)")).toBe("6");
		expect(outcome("prod(x^2, 1:3)")).toBe("36");
		expect(outcome("prod(1:5)")).toBe("120");
		expect(outcome("map(10*x, 0:3)")).toBe("[0, 10, 20, 30]");
		expect(outcome("reduce(acc+x, 1:3)")).toBe("6");
		expect(outcome("reduce(acc + x, 1:3, 10)")).toBe("16");
		expect(outcome("total(1:3)")).toBe("6");
		expect(outcome("sum(9:30, 10:15)")).toBe("AGGREGATE_NON_NUMERIC: A date or time cannot be added: only numbers and quantities can.");
		const { batch, incremental } = expectHonestDocument("m = [1, 2; 3, 4]\nm[0:1, 0:1]\nm[0:1, 1]\nsum(x, m[0:1, 0:0])");
		expect(batch.slice(1)).toEqual(["= [1, 2; 3, 4]", "= [2; 4]", "= 4"]);
		expect(incremental).toEqual(batch);
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("opensIndex", () => {
	test("ordinary: after a name or a closing bracket it indexes, after an operator or a comma it opens a list", () => {
		expect(opensIndex(lex("m[0:1, 0:1]"), 1)).toBe(true);
		expect(opensIndex(lex("f(x)[0]"), 4)).toBe(true);
		expect(opensIndex(lex("x = [1, 2]"), 2)).toBe(false);
		expect(opensIndex(lex("sum(x, [1, 2])"), 4)).toBe(false);
		expect(opensIndex(lex("1 + [1, 2]"), 2)).toBe(false);
	});

	test("boundary: at the start of a line, nested, and after a semicolon", () => {
		expect(opensIndex(lex("[1, 2]"), 0)).toBe(false);
		expect(opensIndex(lex("[[1, 2]]"), 1)).toBe(false);
		expect(opensIndex(lex("[1; [2]]"), 3)).toBe(false);
		expect(opensIndex([], 0)).toBe(false);
	});

	test("hostile: a prototype word before the bracket is a name, and indexes", () => {
		for (const word of PROTOTYPE_WORDS) expect(opensIndex(lex(`${word}[0:1, 0:1]`), 1)).toBe(true);
	});
});

describe("isInsideRangeContext", () => {
	test("ordinary: the collection is a range context, the element is not", () => {
		const prod = lex("prod(9:30, 10:15)");
		expect(isInsideRangeContext(prod, nth(prod, "NUMBER", 1))).toBe(false);
		expect(isInsideRangeContext(prod, nth(prod, "NUMBER", 3))).toBe(true);
		const map = lex("map(f, 0:3)");
		expect(isInsideRangeContext(map, nth(map, "NUMBER", 1))).toBe(true);
	});

	test("boundary: a one-argument call's argument is its collection; a list is not a range context, a slice is", () => {
		const one = lex("sum(1:3)");
		expect(isInsideRangeContext(one, nth(one, "NUMBER"))).toBe(true);
		const list = lex("sum(x, [9:30, 10:15])");
		expect(isInsideRangeContext(list, nth(list, "NUMBER"))).toBe(false);
		const slice = lex("m[0:1, 0:1]");
		expect(isInsideRangeContext(slice, nth(slice, "NUMBER", 3))).toBe(true);
		const nested = lex("sum(x, m[0:1, 0:0])");
		expect(isInsideRangeContext(nested, nth(nested, "NUMBER"))).toBe(true);
		const third = lex("reduce(acc + x, 1:3, 10)");
		expect(isInsideRangeContext(third, nth(third, "NUMBER", 3))).toBe(true);
		const plain = lex("(9:30)");
		expect(isInsideRangeContext(plain, 1)).toBe(false);
		expect(isInsideRangeContext([], 0)).toBe(false);
	});

	test("hostile: unbalanced brackets, a position past the end, and a call left open", () => {
		expect(isInsideRangeContext(lex(")) ] 9:30"), 3)).toBe(false);
		expect(isInsideRangeContext(lex("sum(1:3"), 2)).toBe(false);
		expect(isInsideRangeContext(lex("sum(1:3)"), 999)).toBe(false);
		const deep = lex(`sum(${"[".repeat(1_000)}9:30`);
		expect(isInsideRangeContext(deep, deep.length - 3)).toBe(false);
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words in each argument, sized input, look-alike digits and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`prod(9:30, ${word})`);
				expectHonestLine(`prod(${word}, 10:15)`);
				expectHonestLine(`sum(x, [9:30, ${word}])`);
				expectHonestDocument(`${word} = [9:30]\nsum(x, ${word})\nprod(${word}, 1:3)`);
			}
		});
		expectHonestLine(`sum(x, [${Array.from({ length: 2_000 }, () => "9:30").join(", ")}])`, { budgetMs: 5_000 });
		expectHonestLine(`prod(9:30, ${RESOURCE_PROBES.hugeRange()})`, { budgetMs: 5_000 });
		expectHonestLine(`prod(${"(".repeat(300)}9:30${")".repeat(300)}, 1:3)`, { budgetMs: 5_000 });
		for (const line of ["prod(٩:٣٠, 10:15)", "sum(x, [9​:30])", "sum(x, [<i>9:30</i>])", "prod(‮9:30, 1:3)"]) expectHonestLine(line);
		for (const line of fill("sum(x, [9:30, 10:15]) X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: times from the lines above, lengths of time instead, a check and the two passes", () => {
		const { batch, incremental } = expectHonestDocument(
			"times = [9:30, 10:15]\nprod(9:30, 10:15)\nsum(x, [1 hour, 30 min])\nmap(x * 2, [9:30])\ncheck prod(9:30, 10:15) == 1\nsum(x, [45, 30])",
		);
		expect(batch[0]).toMatch(/^ERROR /);
		expect(batch[1]).toMatch(/^ERROR /);
		expect(batch[5]).toBe("= 75");
		expect(incremental).toEqual(batch);
		expectHonestLine("prod(9:30,, 10:15)");
		expectHonestLine("sum(x, [9:30,])");
	});

	test("edge: midnight and the last minute, numeric edges as a list item, CRLF", () => {
		expect(outcome("sum(x, [0:00, 23:59])")).toBe(LIST_REFUSED);
		expect(outcome("prod(0:00, 1:3)")).toBe(PROD_REFUSED);
		expect(outcome("sum(x, [24:00])")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
		for (const line of fill("sum(x, [9:30, X])", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("prod(X, 10:15)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		const { batch, incremental } = both("prod(9:30, 10:15)\r\nsum(x, [9:30])\r\n");
		expect(batch.slice(0, 2)).toEqual(["ERROR INVALID_DATETIME_OP", "ERROR MATRIX_CELL_NON_NUMERIC"]);
		expect(incremental).toEqual(batch);
	});
});
