import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { loanTermsRefused } from "@solve-js/vm/FinanceFormulas";
import { PERCENT_UNKNOWN, inUnknownUnit, readGoalSeekRange, unknownUnitOf } from "@solve-js/packages/goalseek/GoalSeekPluginFunctions";
import { Value, ValueType, numberValue, percentageValue, uomValue, stringValue } from "@solve-js/vm/Value";

/**
 * Found bug: two things a reader saw around a loan and a goal seek over it.
 *
 * - A repayment whose amount borrowed is an expression that comes to zero or
 *   less (`monthly repayment on (p - 1000) ...` with `p = 1000`) answered
 *   "loanRepayment: principal must be positive", the internal name of the
 *   function behind the phrase. The refusals of the repayment, the interest and
 *   `monthlyPayment` are now in the reader's words (`loanTermsRefused`).
 * - Goal seek for a rate the note holds as a percentage answered the bare
 *   fraction 0.05, where the rate was written 4%. An unknown held as a
 *   percentage is now solved as one (`unknownUnitOf`), as a price in pounds is
 *   solved in pounds (#835).
 */

const LOAN = [":deposit = 100000", ":rate = 4%", "monthly repayment on deposit over 25 years at rate"];

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function lineText(line: { result?: Value | null; error?: unknown }): string {
	if (line.error) return `ERROR ${String(line.error)}`;
	if (line.result?.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

function incremental(lines: string[]): string[] {
	return evaluateDocument(newTrackedEngine(), lines.join("\n"), { inputType: "markdown" }).lines.map(lineText);
}

function batch(lines: string[]): string[] {
	return newTrackedEngine().parseDocument(lines.join("\n")).lines.map(lineText);
}

describe("the lines that exposed it", () => {
	test("a repayment on an amount that comes to zero says so in words", () => {
		const doc = [":p = 1000", "monthly repayment on (p - 1000) over 25 years at 4%"];
		expect(incremental(doc)[1]).toBe("ERROR The amount borrowed must be more than zero to work out a repayment.");
		expect(batch(doc)[1]).toBe(incremental(doc)[1]);
	});

	test("the function form says the same, and no refusal names the function", () => {
		expect(shown("monthlyPayment(0, 5%, 10)")).toBe("The amount borrowed must be more than zero to work out a repayment.");
		expect(shown("monthlyPayment(1000, -5%, 10)")).toBe("A loan's interest rate cannot be negative.");
		expect(shown("monthlyPayment(1000, 5%, 0)")).toBe("A loan's term must be longer than zero to work out a repayment.");
		for (const line of ["monthly repayment on 0 over 25 years at 4%", "total interest on -5 over 2 years at 4%", "monthly repayment on 100 over 0 years at 4%"]) {
			expect({ line, text: shown(line) }).not.toEqual({ line, text: expect.stringMatching(/loanRepayment|loanInterest|monthlyPayment|principal|periodsPerYear/) });
		}
	});

	test("goal seek over a principal that is an expression finds the answer", () => {
		expect(incremental([":p = 1000", "monthly repayment on (p - 1000) over 25 years at 4%", "solve line 2 for p = 900"])[2]).toBe("171,507.23");
		expect(incremental([":p = 1000 + 1000", "monthly repayment on p over 25 years at 4%", "solve line 2 for p = 900"])[2]).toBe("170,507.23");
	});

	test("goal seek for a rate answers a percentage", () => {
		expect(incremental([...LOAN, "solve line 3 for rate = 600"])[3]).toBe("5.26%");
		expect(incremental([...LOAN, "solve line 3 for rate = 600 between 0% and 10%"])[3]).toBe("5.26%");
		expect(incremental([...LOAN, "solve line 3 for rate = 600 between 0 and 0.1"])[3]).toBe("5.26%");
		expect(incremental([":r = 5%", "r * 200", "solve line 2 for r = 30"])[2]).toBe("15.00%");
	});

	test("an unknown that is a plain number stays one", () => {
		expect(incremental([...LOAN, "solve line 3 for deposit = 900"])[3]).toBe("170,507.23");
		expect(incremental([":x = 5", "x * 2", "solve line 2 for x = 3"])[2]).toBe("1.50");
	});
});

describe("cross-path: goal seek for a percentage", () => {
	test("the single-expression path refuses with a structured error", () => {
		const value = newTrackedEngine().evaluateExpression("solve line 3 for rate = 600");
		expect(value.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
	});

	test("the batch pass refuses and agrees with the incremental pass on every other line", () => {
		const doc = [...LOAN, "solve line 3 for rate = 600"];
		const b = batch(doc);
		const i = incremental(doc);
		expect(b[3]).toMatch(/^ERROR Goal seek re-runs another line, which the batch pass/);
		expect(b.slice(0, 3)).toEqual(i.slice(0, 3));
		expect(i[3]).toBe("5.26%");
	});
});

describe("the parts", () => {
	test("loanTermsRefused: usable terms pass, each unusable one is named", () => {
		expect(loanTermsRefused(1000, 5, 0.04, 12)).toBeUndefined();
		expect(loanTermsRefused(1000, 5, 0, 0)).toBeUndefined();
		expect(loanTermsRefused(0, 5, 0.04)?.errorCode).toBe("INVALID_RANGE");
		expect(loanTermsRefused(-1, 5, 0.04)?.errorMessage).toBe("The amount borrowed must be more than zero to work out a repayment.");
		expect(loanTermsRefused(1000, 0, 0.04)?.errorMessage).toBe("A loan's term must be longer than zero to work out a repayment.");
		expect(loanTermsRefused(1000, 5, -0.01)?.errorCode).toBe("INVALID_RATE");
		expect(loanTermsRefused(1000, 5, 0.04, -1)?.errorMessage).toBe("The number of repayments a year cannot be negative.");
	});

	test("loanTermsRefused: hostile numbers are refused rather than passed through", () => {
		expect(loanTermsRefused(Number.NaN, 5, 0.04)).toBeDefined();
		expect(loanTermsRefused(1000, Number.NaN, 0.04)).toBeDefined();
		expect(loanTermsRefused(1000, 5, Number.NaN)).toBeDefined();
		expect(loanTermsRefused(-0, 5, 0.04)).toBeDefined();
		expect(loanTermsRefused(Number.MIN_VALUE, 5, 0.04)).toBeUndefined();
	});

	test("unknownUnitOf and inUnknownUnit: a percentage round-trips", () => {
		expect(unknownUnitOf(percentageValue(0.04))).toBe(PERCENT_UNKNOWN);
		expect(unknownUnitOf(uomValue(5, "GBP"))).toBe("GBP");
		expect(unknownUnitOf(numberValue(5))).toBeUndefined();
		expect(unknownUnitOf(undefined)).toBeUndefined();
		expect(unknownUnitOf(stringValue("%"))).toBeUndefined();
		const solved = inUnknownUnit(0.0526, PERCENT_UNKNOWN);
		expect(solved.type).toBe(ValueType.Percentage);
		expect(solved.toNumber()).toBe(0.0526);
		expect(inUnknownUnit(3, undefined).type).toBe(ValueType.Number);
	});

	test("readGoalSeekRange reads percentage ends only for a percentage unknown", () => {
		expect(readGoalSeekRange(percentageValue(0.1), percentageValue(0), PERCENT_UNKNOWN)).toEqual({ lower: 0, upper: 0.1 });
		expect(readGoalSeekRange(percentageValue(0.1), percentageValue(0), undefined)).toBeInstanceOf(Value);
		expect(readGoalSeekRange(percentageValue(0.1), percentageValue(0.1), PERCENT_UNKNOWN)).toBeInstanceOf(Value);
		expect(readGoalSeekRange(percentageValue(Infinity), percentageValue(0), PERCENT_UNKNOWN)).toBeInstanceOf(Value);
	});
});

describe("adversarial", () => {
	test("security: prototype words as the unknown and the amount", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument(`:${word} = 5%\n${word} * 200\nsolve line 2 for ${word} = 30`, { agree: false });
				expectHonestLine(`monthly repayment on ${word} over 25 years at 4%`);
			}
		});
	});

	test("security: markup-shaped and look-alike text as the amount", () => {
		for (const line of fill("monthly repayment on X over 25 years at 4%", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a what-if and a check over the solved rate", () => {
		const { incremental: i } = expectHonestDocument([...LOAN, "r = solve line 3 for rate = 600", "check r > 5%"].join("\n"), { agree: false });
		expect(i[4]).toBe("= ✓");
		expectHonestDocument([...LOAN, "line 3 with rate = 5%"].join("\n"));
	});

	test("edge: every numeric edge as the amount borrowed and the target", () => {
		for (const line of fill("monthly repayment on X over 25 years at 4%", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const target of NUMERIC_EDGES) {
			expectHonestDocument([...LOAN, `solve line 3 for rate = ${target}`].join("\n"), { agree: false, allowNaN: true });
		}
	});
});
