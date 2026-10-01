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
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { parseInflationAmount } from "@solve-js/packages/finance/parselets/InflationQueryParselet";

/**
 * Found bug: `what is $300 + $50 from 2003` was refused at the `+` the reader
 * typed ("Expected "from <year>" ... but found "+""), and only the bracketed
 * `what is ($300 + $50) from 2003` answered. The query read its amount at a
 * binding power above the conversion `in`, so that the `in` of `what is $X in
 * <year> worth in <year>` stayed the query's, and a sum binds looser than
 * that, so the amount stopped at the first `+` or `-`.
 *
 * The amount is now its terms joined by `+` and `-`, each read at the same
 * guarded binding power, so the `in` stays the query's and the sum is read.
 * Nothing a query is written with follows the amount with a sign: the year
 * comes after `from`, `in` or `worth in`.
 */

/** One line through evaluateLine, as the reader sees it. */
function shown(line: string): string {
	const outcome = evaluateLine(line);
	if (outcome.kind === "value") return outcome.text.replace(/^=\s*/, "");
	if (outcome.kind === "crashed") return `CRASHED ${outcome.name}`;
	return `ERROR ${outcome.code}: ${outcome.message}`;
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

/** The lexer's tokens for a line, without spaces. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

/** parseInflationAmount on a bare parser: what it emitted and where it stopped. */
function amountOf(source: string): { ops: number[]; next: string | undefined } | string {
	const parser = new PrecedenceParser(new ParseletRegistry(), 50, "en");
	parser.load(lex(source), false);
	const builder = new BytecodeBuilder(new Map());
	parser.setBuilder(builder);
	try {
		parseInflationAmount(parser, builder);
	} catch (e) {
		return e instanceof EngineError ? `refused ${e.code}` : `crashed ${(e as Error).constructor.name}`;
	}
	const ops = Array.from(builder.build().opcodes).filter((op) => op === OpCode.ADD || op === OpCode.SUB || op === OpCode.MUL);
	return { ops, next: parser.peek()?.type };
}

describe("the line that exposed it", () => {
	test("the sum is read, and answers as the bracketed form does, through every entry point", () => {
		expect(shown("what is $300 + $50 from 2003")).toBe(shown("what is ($300 + $50) from 2003"));
		expect(shown("what is $300 + $50 from 2003")).toMatch(/^\$[\d,]+\.\d\d$/);
		const { batch, incremental } = both("what is $300 + $50 from 2003\nwhat is ($300 + $50) from 2003");
		expect(batch[0]).toBe(batch[1]);
		expect(incremental).toEqual(batch);
	});

	test("both named years: the same answer as the brackets, which the docs prove", () => {
		expect(shown("what is $300 + $50 in 1990 worth in 2010")).toBe("$583.93");
		expect(shown("what is ($300 + $50) in 1990 worth in 2010")).toBe("$583.93");
		expect(shown("what was $300 + $50 worth in 1965")).toBe(shown("what was ($300 + $50) worth in 1965"));
	});

	test("minus, several terms, a product inside a term, a percentage and a pound amount", () => {
		expect(shown("what is $300 - $50 in 1990 worth in 2010")).toBe(shown("what is $250 in 1990 worth in 2010"));
		expect(shown("what is $250 + $50 + $50 in 1990 worth in 2010")).toBe("$583.93");
		expect(shown("what is $100 * 2 + $150 in 1990 worth in 2010")).toBe("$583.93");
		expect(shown("what is $100 + 10% in 1990 worth in 2010")).toBe(shown("what is $110 in 1990 worth in 2010"));
		expect(shown("what is £300 + £50 in 1990 worth in 2010")).toBe(shown("what is £350 in 1990 worth in 2010"));
		expect(shown("what is -$300 + $350 in 1990 worth in 2010")).toBe(shown("what is $50 in 1990 worth in 2010"));
	});

	test("no parser wording about the sign reaches the reader", () => {
		for (const line of ["what is $300 + $50 from 2003", "what is $300 - $50 from 2003", "what was $300 - $50 worth in 1965"]) {
			expect(shown(line)).not.toMatch(/found "[+-]"/);
		}
	});

	test("what was right stays right", () => {
		expect(shown("what is $100 * 2 from 1990")).toMatch(/^\$/);
		expect(shown("what is $300 + $50")).toBe("$350.00");
		expect(shown("what is 2 + 3")).toBe("5");
		expect(shown("what is 10% of 200")).toBe("20");
	});
});

// ── The part ──────────────────────────────────────────────────────────────

describe("parseInflationAmount", () => {
	test("ordinary: one term, a sum, a difference, several terms; it stops at the query's keyword", () => {
		expect(amountOf("300 from 2003")).toEqual({ ops: [], next: "FROM" });
		expect(amountOf("300 + 50 from 2003")).toEqual({ ops: [OpCode.ADD], next: "FROM" });
		expect(amountOf("300 - 50 in 1990")).toEqual({ ops: [OpCode.SUB], next: "IN" });
		expect(amountOf("1 + 2 - 3 + 4 from 2003")).toEqual({ ops: [OpCode.ADD, OpCode.SUB, OpCode.ADD], next: "FROM" });
	});

	test("boundary: a product binds inside a term, and the conversion in is never consumed", () => {
		expect(amountOf("2 * 3 + 4 in 1990")).toEqual({ ops: [OpCode.MUL, OpCode.ADD], next: "IN" });
		expect(amountOf("2 + 3 * 4 in 1990")).toEqual({ ops: [OpCode.MUL, OpCode.ADD], next: "IN" });
		expect(amountOf("5")).toEqual({ ops: [], next: undefined });
	});

	test("hostile: a sign with nothing after it is refused by the parser, never a crash", () => {
		expect(amountOf("300 + from 2003")).toBe("refused NO_PREFIX_PARSELET");
		expect(amountOf("300 +")).toMatch(/^refused /);
		expect(amountOf("+ + +")).toMatch(/^refused /);
		// A long sum is read to its end: the query's keyword is next.
		const long = amountOf(`${RESOURCE_PROBES.longSum(200)} from 2003`);
		expect(typeof long === "object" ? long.next : long).toBe("FROM");
		// Past the constant pool a line is refused by the builder, never a crash.
		const longer = amountOf(`${RESOURCE_PROBES.longSum(2_000)} from 2003`);
		expect(typeof longer === "object" ? longer.next : longer).not.toMatch(/^crashed/);
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words as a term, sized input, look-alike and markup text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`what is $300 + ${word} from 2003`);
				expectHonestDocument(`${word} = $5\nwhat is $300 + ${word} in 1990 worth in 2010`);
			}
		});
		expectHonestLine(`what is ${RESOURCE_PROBES.longSum(2_000)} from 2003`, { budgetMs: 5_000 });
		expectHonestLine(`what is $1 ${"+ $1 ".repeat(2_000)}in 1990 worth in 2010`, { budgetMs: 5_000 });
		for (const line of fill("what is $300 + X from 2003", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a value from the line above, a check, a half-typed sign, an unsupported currency", () => {
		const { batch, incremental } = expectHonestDocument(
			"a = $300\nwhat is a + $50 in 1990 worth in 2010\ncheck (what is a + $50 in 1990 worth in 2010) == (what is $350 in 1990 worth in 2010)\nwhat is a + in 1990 worth in 2010",
		);
		expect(batch.slice(1, 3)).toEqual(["= $583.93", "= ✓"]);
		expect(batch[3]).toMatch(/^ERROR /);
		expect(incremental).toEqual(batch);
		expect(shown("what is ¥300 + ¥50 from 1990")).toMatch(/^ERROR .*no price index for JPY/);
		expect(shown("what is $300 and $50 from 2003")).toMatch(/^ERROR INFLATION_EXPECTED_FROM_OR_IN: /);
	});

	test("edge: the numeric edges as a term, zero and a negative total, and CRLF", () => {
		for (const line of fill("what is $100 + X in 1990 worth in 2010", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("what is $100 - $100 in 1990 worth in 2010")).toBe("$0.00");
		expect(shown("what is $100 - $300 in 1990 worth in 2010")).toMatch(/^-\$/);
		const { batch, incremental } = both("what is $300 + $50 in 1990 worth in 2010\r\nwhat is $350 in 1990 worth in 2010\r\n");
		expect(batch[0]).toBe(batch[1]);
		expect(incremental).toEqual(batch);
	});
});
