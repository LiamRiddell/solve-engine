import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, NUMERIC_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { readCompoundingInterval } from "@solve-js/packages/finance/parselets/InvestmentParselets";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import { EngineError } from "@solve-js/errors/EngineError";

/**
 * Issue #746: `monthly payment on`, the everyday name for a loan repayment, was
 * a parse error. It now reads as `monthly repayment on`, as do the daily,
 * annual and total forms. `compounded <interval>` had already landed with
 * #801; a tail with no interval now says so in the word that was written,
 * rather than showing `compounding ?`.
 */

function show(line: string): string {
	try {
		const value = newTrackedEngine().evaluateExpression(line);
		if (value.isError()) return `ERROR ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as EngineError).code}: ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

const LOAN = "200000 over 25 years at 4%";

describe("payment on reads as repayment on", () => {
	test.each([
		["daily", "34.71"],
		["monthly", "1,055.67"],
		["annual", "12,668.08"],
		["total", "316,702.10"],
	])("%s payment on", (period, answer) => {
		expect(show(`${period} payment on ${LOAN}`)).toBe(show(`${period} repayment on ${LOAN}`));
		expect(show(`${period} payment on ${LOAN}`)).toBe(answer);
	});

	test("with money, the rate first and any case", () => {
		expect(show("monthly payment on $200,000 over 25 years at 4%")).toBe("$1,055.67");
		expect(show("monthly payment on 200000 at 4% over 25 years")).toBe("1,055.67");
		expect(show("Monthly Payment On 200000 over 25 years at 4%")).toBe("1,055.67");
		expect(show("monthly payment on £200,000 over 300 months at 4.5%")).toBe("£1,111.66");
	});

	test("a variable principal, and payment as a variable on the same line as the phrase", () => {
		expect(doc(`principal = 200000\npayment = monthly payment on principal over 25 years at 4%\npayment * 12\npayment + monthly payment on principal over 25 years at 4%`))
			.toEqual(["200,000", "1,055.67", "12,668.08", "2,111.35"]);
	});

	test("a variable named payment is untouched", () => {
		expect(doc("payment = 500\npayment * 12\nmonthly payment on 200000 over 25 years at 4%")).toEqual(["500", "6,000", "1,055.67"]);
	});

	test("payment on without a period, and the phrase with nothing after it, are not read", () => {
		expect(show(`payment on ${LOAN}`)).toMatch(/^THROWS UNEXPECTED_TRAILING_TOKEN/);
		expect(show("monthly payment on")).toMatch(/^THROWS UNEXPECTED_END_OF_INPUT/);
		expect(show("monthly payment")).toMatch(/^THROWS UNEXPECTED_TRAILING_TOKEN/);
	});

	test("a term that is not a time is refused as the repayment form refuses it", () => {
		expect(show("monthly payment on 200000 over 25 kg at 4%")).toBe(show("monthly repayment on 200000 over 25 kg at 4%"));
	});
});

describe("compounded reads as compounding", () => {
	test.each([
		["$1,000 after 3 years at 7% compounded monthly", "$1,232.93"],
		["$1,000 for 3 years at 7% compounded monthly", "$1,232.93"],
		["compound interest on $1,000 over 3 years at 7% compounded monthly", "$1,232.93"],
		["$1,000 for 3 years at 7% compounded semi-annually", "$1,229.26"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
		expect(show(line)).toBe(show(line.replace("compounded", "compounding")));
	});

	test("an unknown interval, no interval and a repeated tail are refused by name", () => {
		expect(show("$1,000 after 3 years at 7% compounded bananas")).toBe(
			"THROWS UNKNOWN_COMPOUNDING_INTERVAL: compounded bananas: expected one of annually, yearly, semi-annually, semiannually, half-yearly, quarterly, monthly, fortnightly, weekly, daily");
		expect(show("$1,000 after 3 years at 7% compounded")).toBe(
			"THROWS UNKNOWN_COMPOUNDING_INTERVAL: compounded needs an interval after it: expected one of annually, yearly, semi-annually, semiannually, half-yearly, quarterly, monthly, fortnightly, weekly, daily");
		expect(show("$1,000 after 3 years at 7% compounding")).toMatch(/^THROWS UNKNOWN_COMPOUNDING_INTERVAL: compounding needs an interval after it/);
		expect(show("$1,000 after 3 years at 7% compounded monthly compounded monthly")).toMatch(/^THROWS UNEXPECTED_TRAILING_TOKEN/);
	});
});

describe("readCompoundingInterval", () => {
	/** A parser stand-in over the given words, enough for the reader's peek, match and consume. */
	function parserOver(words: string[]): { parser: Parser; left: () => number } {
		const tokens = words.map((w, i) => ({ type: w === "compounding" ? "COMPOUNDING" : w === "-" ? "MINUS" : "IDENT", value: w, text: w, offset: i * 20 }) as unknown as Token);
		let at = 0;
		const parser = {
			peek: () => tokens[at],
			peekAt: (ahead: number) => tokens[at + ahead],
			consume: () => tokens[at++],
			match: (type: string) => {
				if (tokens[at]?.type !== type) return false;
				at++;
				return true;
			},
		} as unknown as Parser;
		return { parser, left: () => tokens.length - at };
	}

	test("reads each interval after either word", () => {
		for (const word of ["compounding", "compounded"]) {
			const { parser, left } = parserOver([word, "monthly"]);
			expect(readCompoundingInterval(parser)).toBe(12);
			expect(left()).toBe(0);
		}
	});

	test("no tail is annual and consumes nothing", () => {
		const { parser, left } = parserOver(["over"]);
		expect(readCompoundingInterval(parser)).toBe(1);
		expect(left()).toBe(1);
		expect(readCompoundingInterval(parserOver([]).parser)).toBe(1);
	});

	test("a missing interval and a prototype word are refused, not looked up", () => {
		expect(() => readCompoundingInterval(parserOver(["compounded"]).parser)).toThrow(/compounded needs an interval after it/);
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(() => readCompoundingInterval(parserOver(["compounded", word]).parser)).toThrow(/expected one of/);
			}
		});
	});
});

describe("adversarial", () => {
	test("numeric edges in each slot of the payment form stay honest", () => {
		for (const line of [
			...fill("monthly payment on X over 25 years at 4%", NUMERIC_EDGES),
			...fill("monthly payment on 200000 over X years at 4%", NUMERIC_EDGES),
			...fill("total payment on 200000 over 25 years at X%", NUMERIC_EDGES),
			...fill("$1,000 for 3 years at X% compounded monthly", NUMERIC_EDGES),
		]) {
			expectHonestLine(line, { allowNaN: true });
		}
	});

	test("a prototype word as the interval or the principal is an ordinary unknown word", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`$1,000 for 3 years at 7% compounded ${word}`);
				expectHonestLine(`monthly payment on ${word} over 25 years at 4%`);
			}
		});
	});

	test("a what-if and a line reference through the payment form agree across passes", () => {
		const { batch } = expectHonestDocument(`deposit = 200000\npayment = monthly payment on deposit over 25 years at 4%\nline 2 with deposit = 100000\nline 2 * 12`);
		expect(batch.slice(1)).toEqual(["= 1,055.67", "= 527.84", "= 12,668.08"]);
	});

	test("a zero or negative principal answers as the repayment form does", () => {
		for (const principal of ["0", "-200000", "-0"]) {
			expect(show(`monthly payment on ${principal} over 25 years at 4%`)).toBe(show(`monthly repayment on ${principal} over 25 years at 4%`));
		}
	});
});
