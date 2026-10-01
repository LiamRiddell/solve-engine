import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { callExport } from "@tools/scriptHarness";
import { compoundingRefused, rateAtOrBelowMinusHundred, ratePercent } from "@solve-js/vm/FinanceFormulas";

/**
 * Found bug: the finance builtins' refusals opened with the internal name of
 * the function behind the phrase the reader typed: `compound interest on 1000
 * over 3 years at -150%` answered "compoundInterest: rate -1.5 makes (1 + rate)
 * non-positive", and `taxRemove:`, `presentValue:`, `compounding:` and `fact:`
 * did the same. Each is now said in the reader's terms, as `loanTermsRefused`
 * did for a loan: the rate as the percentage they wrote, and what it would do.
 * The rate refusals share `rateAtOrBelowMinusHundred` and `compoundingRefused`,
 * and the message lint now holds a line's result to not opening with a
 * camelCase name and a colon (`internal-name-prefix`), so a new one is caught.
 */

function refusal(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `${v.errorCode}: ${v.errorMessage}` : `answered ${String(v.value)}`;
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const BELOW = (pct: string, what = "A rate") => `INVALID_RATE: ${what} of ${pct} cannot be used: it must be more than -100%, since at -100% or less the amount falls to nothing or below.`;

describe("the lines that exposed it", () => {
	test.each([
		["compound interest on 1000 over 3 years at -150%", BELOW("-150%")],
		["compoundInterest(1000, -150%, 3)", BELOW("-150%")],
		["interestEarned(1000, -150%, 3)", BELOW("-150%")],
		["present value of 10000 over 5 years at -150%", BELOW("-150%")],
		["present value of 10000 over 5 years at -100%", BELOW("-100%")],
		["compoundInterestYears(1000, 1157.63, -200%)", BELOW("-200%")],
		["interest on 1000 over 3 years at -2400% compounded monthly", "INVALID_RATE: A rate of -2400% added 12 times a year is -200% each time, which cannot be used: each must be more than -100%."],
		["compoundInterestRate(0, 1157.63, 3)", "INVALID_RANGE: The starting amount and the amount it grows to must both be more than zero to work out a rate."],
		["compoundInterestRate(1000, 1157.63, 0)", "INVALID_RANGE: The number of years must be more than zero to work out a rate."],
		["compoundInterestYears(1000, 1157.63, 0)", "INVALID_RATE: At a rate of 0% the amount never grows, so no number of years reaches it."],
		["compoundInterestYears(-1000, 1157.63, 5%)", "INVALID_RANGE: The starting amount and the amount it grows to must both be more than zero to work out how many years it takes."],
		["inflationAdjust($100, 1700, 2020)", "INFLATION_YEAR_OUT_OF_RANGE: Year 1700 is outside the bundled CPI table's range (1913-2026)"],
		["inflationAdjust($100, 1990, 2990)", "INFLATION_YEAR_OUT_OF_RANGE: Year 2990 is outside the bundled CPI table's range (1913-2026)"],
		["fact(-1)", "INVALID_FACTORIAL_INPUT: A factorial is only defined for a whole number of zero or more, and -1 is not one."],
		["fact(2.5)", "INVALID_FACTORIAL_INPUT: A factorial is only defined for a whole number of zero or more, and 2.5 is not one."],
		["171!", "FACTORIAL_OVERFLOW: 171! is too large to hold as a number: 170! is the largest factorial that fits."],
	])("%s", (line, expected) => {
		expect(refusal(line)).toBe(expected);
	});

	test("no refusal of these forms opens with a function's name", () => {
		const lines = ["compoundInterest(1000, -150%, 3)", "present value of 1000 over 3 years at -200%", "taxRemove(100, -2)", "tax in 120 at -200%", "fact(-1)", "interest on 1000 over 3 years at -2400% compounded monthly"];
		for (const line of lines) {
			const text = refusal(line);
			expect({ line, refused: /^[A-Z_]+: /.test(text), internal: /^[A-Z_]+: [a-z]+[A-Z]\w*: /.test(text) }).toEqual({ line, refused: true, internal: false });
		}
	});

	test("the codes are unchanged, so a host that reads them sees no difference", () => {
		expect(refusal("taxRemove(100, -2)")).toBe(BELOW("-200%", "A tax rate"));
		expect(refusal("tax in 120 at -200%")).toBe(BELOW("-200%", "A tax rate"));
		expect(refusal("tax off 120 at -200%")).toBe(BELOW("-200%", "A tax rate"));
		expect(refusal("present value of 1000 over 3 years at -200%")).toBe(BELOW("-200%"));
	});
});

describe("ratePercent", () => {
	test("a rate as the percentage a reader writes, without a floating-point tail", () => {
		expect(ratePercent(0.05)).toBe("5%");
		expect(ratePercent(-1.5)).toBe("-150%");
		expect(ratePercent(0.1 + 0.2)).toBe("30%");
		expect(ratePercent(1 / 3)).toBe("33.3333333333%");
	});

	test("zero, negative zero, the infinities and NaN", () => {
		expect(ratePercent(0)).toBe("0%");
		expect(ratePercent(-0)).toBe("0%");
		expect(ratePercent(Infinity)).toBe("∞%");
		expect(ratePercent(-Infinity)).toBe("-∞%");
		expect(ratePercent(NaN)).toBe("an undefined percentage");
		// A finite rate whose percentage is past the largest double reads as the infinity it becomes.
		expect(ratePercent(Number.MAX_VALUE)).toBe("∞%");
		expect(ratePercent(-Number.MAX_VALUE)).toBe("-∞%");
	});
});

describe("rateAtOrBelowMinusHundred and compoundingRefused", () => {
	test("the refusal names the rate and what it is", () => {
		expect(rateAtOrBelowMinusHundred(-1).errorMessage).toBe("A rate of -100% cannot be used: it must be more than -100%, since at -100% or less the amount falls to nothing or below.");
		expect(rateAtOrBelowMinusHundred(-3, "An inflation rate").errorMessage).toMatch(/^An inflation rate of -300%/);
		expect(rateAtOrBelowMinusHundred(-Infinity).errorCode).toBe("INVALID_RATE");
	});

	test("compounding: usable terms answer nothing, fewer than one period a year or a period at -100% is refused", () => {
		expect(compoundingRefused(0.05, 12)).toBeUndefined();
		expect(compoundingRefused(-11.99, 12)).toBeUndefined();
		expect(compoundingRefused(0.05, 0)?.errorMessage).toBe("Interest must be added at least once a year to compound, not 0 times.");
		expect(compoundingRefused(0.05, -4)?.errorCode).toBe("INVALID_RATE");
		expect(compoundingRefused(0.05, NaN)?.errorCode).toBe("INVALID_RATE");
		expect(compoundingRefused(-12, 12)?.errorMessage).toContain("-100% each time");
	});

	test("a prototype word as the rate's description is text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(rateAtOrBelowMinusHundred(-2, word).errorMessage?.startsWith(`${word} of -200%`)).toBe(true);
		});
	});
});

describe("the message lint's rule", () => {
	type Finding = { rule: string; hit: string };
	const findings = (source: string) => callExport<Finding[]>("check-message-style.mjs", "findViolations", ["fixture.ts", source]).filter((f) => f.rule === "internal-name-prefix");

	test("a line's result opening with a camelCase name and a colon is caught", () => {
		expect(findings('errorValue("X", "compoundInterest: rate is bad");').map((f) => f.hit)).toEqual(["compoundInterest: "]);
		expect(findings('errorValue("X", `taxRemove: ${1}`);')).toHaveLength(1);
	});

	test("a word the reader types, a sentence, and a host's error are not", () => {
		expect(findings('errorValue("X", "npv: the discount rate must be a percentage");')).toEqual([]);
		expect(findings('errorValue("X", "A rate of -150% cannot be used.");')).toEqual([]);
		expect(findings('throw ErrorFactory.validation("X", "createEngine: bad option");')).toEqual([]);
		expect(findings('errorValue("X", "");')).toEqual([]);
	});
});

describe("adversarial", () => {
	test("security: prototype words as the amount or the rate, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`compoundInterest(${word}, -150%, 3)`);
				expectHonestLine(`compound interest on 1000 over 3 years at ${word}`);
			}
		});
		expectHonestLine(`compoundInterest(1000, ${"(".repeat(200)}-150%${")".repeat(200)}, 3)`);
	});

	test("realistic: a rate from the line above, a check over the refusal, both passes", () => {
		const { batch, incremental } = expectHonestDocument(":r = -150%\ncompound interest on 1000 over 3 years at r\npresent value of 10000 over 5 years at r");
		expect(batch[1]).toBe(`ERROR ${BELOW("-150%").slice("INVALID_RATE: ".length)}`);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge as the rate and as the periods a year", () => {
		for (const line of fill("compoundInterest(1000, X, 3)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("interest on 1000 over 3 years at X compounded monthly", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("present value of 1000 over 3 years at X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
