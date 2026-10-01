import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
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
import { fromOrInRefusal } from "@solve-js/packages/finance/parselets/InflationQueryParselet";

/**
 * Found bug: `ErrorCodeReachability.spec.ts` listed
 * `INFLATION_EXPECTED_FROM_OR_IN` as guarded and unreachable, but `what is
 * $300 and $50 from 2003` reaches it, and the message it carried was the
 * parser's: `Expected "from <year>" or "in <year> worth in <year>" after "what
 * is <amount>", but found "and"`. The code is now listed as reachable with
 * that line, and the message says in plain words what the two shapes are, what
 * stands where the keyword goes, and, for `and`, that amounts are joined with
 * a plus sign. `what was $300 and $50 worth in 1965` used to be refused by the
 * parser's own `consume` (`Expected WORTH_IN`); it answers with the same code
 * and the `what was` shape.
 */

const PLAIN_AND =
	"an inflation question names its year straight after the amount, as in what is $300 from 2003 or what is $300 in 1990 worth in 2010, and here \"and\" comes after the amount: to adjust a total, join the amounts with a plus sign, as in what is $300 + $50 from 2003";

/** The lexer's first token for a word. */
function tokenOf(source: string): Token {
	const lexer = new Lexer("en");
	lexer.reset(source);
	const token = Array.from(lexer).find((t) => t.type !== "WS");
	if (!token) throw new TypeError(`no token in ${source}`);
	return token;
}

/** One line through evaluateLine: its code and message, or its answer. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text;
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

describe("the line that exposed it", () => {
	test("what is $300 and $50 from 2003 is refused in plain words through every entry point", () => {
		expect(outcome("what is $300 and $50 from 2003")).toBe(`INFLATION_EXPECTED_FROM_OR_IN: ${PLAIN_AND}`);
		const text = "what is $300 and $50 from 2003\nwhat is $300 + $50 from 2003";
		const batch = newTrackedEngine().parseDocument(text);
		const incremental = evaluateDocument(newTrackedEngine(), text);
		expect(batch.lines[0].error).toBe(PLAIN_AND);
		expect(incremental.lines[0].error).toBe(PLAIN_AND);
		expect(batch.lines[1].result?.isError()).toBe(false);
		expect(incremental.lines[1].result?.toNumber()).toBe(batch.lines[1].result?.toNumber());
	});

	test("what was ... and ... worth in is refused with its own shape, not the parser's consume", () => {
		const line = outcome("what was $300 and $50 worth in 1965");
		expect(line).toMatch(/^INFLATION_EXPECTED_FROM_OR_IN: /);
		expect(line).toContain("as in what was $300 worth in 1965");
		expect(line).toContain("what was $300 + $50 worth in 1965");
	});

	test("no parser wording reaches the reader from any refusal of this code", () => {
		for (const line of [
			"what is $300 and $50 from 2003",
			"what is $300 or $50 from 2003",
			"what is $300 dollars from 2003 extra",
			"what was $300 and $50 worth in 1965",
			"what is $100 in 1990 + 5 worth in 2010",
		]) {
			const shown = outcome(line);
			expect({ line, shown }).not.toEqual({ line, shown: expect.stringMatching(/Expected|but found|WORTH_IN|FROM\b/) });
		}
	});
});

describe("fromOrInRefusal", () => {
	test("ordinary: names the word after the amount, with the plus-sign hint for and", () => {
		expect(fromOrInRefusal(tokenOf("and"))).toBe(PLAIN_AND);
		expect(fromOrInRefusal(tokenOf("AND"))).toContain("join the amounts with a plus sign");
		expect(fromOrInRefusal(tokenOf("or"))).toBe(
			"an inflation question names its year straight after the amount, as in what is $300 from 2003 or what is $300 in 1990 worth in 2010, and here \"or\" comes after the amount",
		);
	});

	test("boundary: the end of the line, and the what was shape", () => {
		expect(fromOrInRefusal(undefined)).toMatch(/and here the line ends after the amount$/);
		expect(fromOrInRefusal(tokenOf("and"), "what-was")).toBe(
			"an inflation question names its year straight after the amount, as in what was $300 worth in 1965, and here \"and\" comes after the amount: to adjust a total, join the amounts with a plus sign, as in what was $300 + $50 worth in 1965",
		);
	});

	test("hostile: a prototype word, markup and invisible characters are quoted as text", () => {
		for (const word of PROTOTYPE_WORDS) expect(fromOrInRefusal(tokenOf(word))).toContain("comes after the amount");
		const odd = fromOrInRefusal({ text: "<script>‮", value: "<script>‮" } as unknown as Token);
		expect(odd).not.toContain("‮");
		expect(fromOrInRefusal({ text: "", value: "" } as unknown as Token)).toContain("\"\" comes after the amount");
	});
});

describe("adversarial", () => {
	test("security: prototype words and markup between the amounts, a long run of words", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`what is $300 ${word} $50 from 2003`);
				expectHonestDocument(`${word} = 5\nwhat is $300 ${word} from 2003`);
			}
		});
		for (const line of fill("what is $300 X $50 from 2003", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(`what is $300 ${"and $1 ".repeat(2_000)}from 2003`, { budgetMs: 5_000 });
		expectHonestLine(`what is ${RESOURCE_PROBES.longIdentifier(5_000)} and $50 from 2003`, { budgetMs: 5_000 });
	});

	test("realistic: the corrected line answers, a check over the refusal, and an edit", () => {
		const { batch, incremental } = expectHonestDocument(
			"a = what is $300 and $50 from 2003\nb = what is $300 + $50 from 2003\ncheck b == what is $350 from 2003",
		);
		expect(batch[0]).toMatch(/^ERROR /);
		expect(batch[2]).toBe("= ✓");
		expect(incremental).toEqual(batch);
	});

	test("edge: blank amount, CRLF and a trailing newline", () => {
		expectHonestLine("what is and $50 from 2003");
		expectHonestLine("what is from 2003");
		const { batch, incremental } = expectHonestDocument("what is $300 and $50 from 2003\r\nwhat is $300 and $50 from 2003\n");
		expect(batch[0]).toBe(batch[1]);
		expect(incremental).toEqual(batch);
	});
});
