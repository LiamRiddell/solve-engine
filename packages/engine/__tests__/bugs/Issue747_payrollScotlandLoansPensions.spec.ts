import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { HMRC_2024_25, HMRC_2025_26, HMRC_2026_27, DEFAULT_TAX_YEAR } from "@solve-js/packages/payroll/data/HmrcBands";
import {
	incomeTax,
	nationalInsurance,
	payslip,
	pensionContribution,
	personalAllowance,
	studentLoanRepayment,
	takeHome,
	taxThroughBands,
} from "@solve-js/packages/payroll/PayrollMath";
import { readPayrollCase, isPayrollCaseRefusal } from "@solve-js/packages/payroll/PayrollCase";
import { payrollCaseNormalizerRule } from "@solve-js/packages/payroll/normalizer/PayrollCaseNormalizerRule";
import type { Token } from "@solve-js/lexer/Token";

/**
 * Issue #747: the take-home forms covered an employee in England, Wales and
 * Northern Ireland only. `in Scotland` now charges Scotland's six income tax
 * bands, `with plan 2 student loan` (and Plan 1, 4, 5 and the postgraduate
 * loan) takes a student loan repayment, and `with 5% pension` takes a pension
 * contribution before income tax. The band shape became a list of bands per
 * jurisdiction to hold Scotland's six.
 */

const B = DEFAULT_TAX_YEAR;

function show(line: string): string {
	try {
		const value = newTrackedEngine().evaluateExpression(line);
		if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** The amount a line answers, as a number. */
function amount(line: string): number {
	return newTrackedEngine().evaluateExpression(line).toNumber();
}

describe("in Scotland", () => {
	test("both forms, and the monthly form, charge the Scottish bands", () => {
		expect(show("take home on £50,000 in Scotland")).toBe("£38,023.55");
		expect(show("£50,000 after tax in Scotland")).toBe("£38,023.55");
		expect(show("£50,000 per month after tax in Scotland")).toBe("£3,168.63");
		expect(show("£50,000 salary after tax in Scotland")).toBe("£38,023.55");
		expect(show("take home on £50,000 IN SCOTLAND")).toBe("£38,023.55");
	});

	test("England, Wales and Northern Ireland are the plain answer", () => {
		for (const place of ["England", "Wales", "Northern Ireland"]) {
			expect(show(`£50,000 after tax in ${place}`)).toBe(show("£50,000 after tax"));
		}
	});

	test("the taper runs across the Scottish bands, and the top rate is reached", () => {
		expect(show("£120,000 after tax in Scotland")).toBe("£71,357.35");
		expect(amount("£200,000 after tax in Scotland")).toBeCloseTo(200_000 - incomeTax(200_000, B, "scotland") - nationalInsurance(200_000, B), 6);
		expect(personalAllowance(125_140, B)).toBe(0);
	});

	test("a salary on each Scottish band boundary", () => {
		// Gross limits for 2026/27, each one pound either side.
		for (const gross of [12_570, 16_537, 29_526, 43_662, 75_000, 100_000, 125_140]) {
			for (const g of [gross - 1, gross, gross + 1]) {
				expect(amount(`£${g} after tax in Scotland`)).toBeCloseTo(g - incomeTax(g, B, "scotland") - nationalInsurance(g, B), 6);
			}
		}
		// Tax is continuous across a boundary: a pound more costs at most 48p more.
		for (const gross of [16_537, 29_526, 43_662, 75_000, 125_140]) {
			const step = incomeTax(gross + 1, B, "scotland") - incomeTax(gross, B, "scotland");
			expect(step).toBeGreaterThanOrEqual(0);
			expect(step).toBeLessThanOrEqual(0.48 + 0.5 * 0.45 + 1e-9);
		}
	});

	test("a place is written once, and the rate form takes none", () => {
		expect(show("£50,000 after tax in Scotland in England")).toMatch(/^PAYROLL_CONFLICTING_CASE: /);
		expect(show("£50,000 after 20% tax")).toBe("£40,000.00");
		expect(show("£50,000 after 20% tax in Scotland")).toBe('UNKNOWN_UNIT: "Scotland" is not a unit.');
	});
});

describe("student loans", () => {
	test.each([
		["plan 1 student loan", "£37,440.60"],
		["plan 2 student loan", "£37,664.25"],
		["plan 4 student loan", "£38,061.15"],
		["plan 5 student loan", "£37,269.60"],
		["postgraduate loan", "£37,779.60"],
		["postgraduate student loan", "£37,779.60"],
		["plan 2 loan", "£37,664.25"],
	])("with %s", (clause, answer) => {
		expect(show(`£50,000 after tax with ${clause}`)).toBe(answer);
	});

	test("the postgraduate loan is repaid beside an undergraduate plan", () => {
		expect(show("£50,000 after tax with plan 2 student loan and postgraduate loan")).toBe("£35,924.25");
		expect(show("£50,000 after tax with postgraduate loan with plan 2 student loan")).toBe("£35,924.25");
	});

	test("a salary at the threshold repays nothing, and a pound above it 9p", () => {
		expect(amount("£29,385 after tax with plan 2 student loan")).toBeCloseTo(amount("£29,385 after tax"), 6);
		expect(amount("£29,386 after tax with plan 2 student loan")).toBeCloseTo(amount("£29,386 after tax") - 0.09, 6);
		expect(amount("£10,000 after tax with plan 5 student loan")).toBe(10_000);
	});

	test("no plan, an unknown plan, two undergraduate plans and a plan named twice are refused by name", () => {
		expect(show("£50,000 after tax with student loan")).toBe(
			'PAYROLL_UNKNOWN_LOAN_PLAN: a student loan needs its plan: write "with plan 1 student loan" (or plan 2, plan 4 or plan 5), or "with postgraduate loan"');
		expect(show("£50,000 after tax with plan 3 student loan")).toMatch(/^PAYROLL_UNKNOWN_LOAN_PLAN: "plan 3" is not a student loan plan/);
		expect(show("£50,000 after tax with plan 1 student loan and plan 2 student loan")).toBe(
			"PAYROLL_CONFLICTING_CASE: Plan 1 and Plan 2 together share one threshold, which is not covered: name the plan with the lower threshold");
		expect(show("£50,000 after tax with plan 2 student loan and plan 2 student loan")).toBe("PAYROLL_CONFLICTING_CASE: Plan 2 is named twice");
		expect(show("£50,000 after tax with postgraduate loan and postgraduate loan")).toBe("PAYROLL_CONFLICTING_CASE: the postgraduate loan is named twice");
	});
});

describe("pension contributions", () => {
	test("taken before income tax, not before National Insurance", () => {
		expect(show("take home on £50,000 with 5% pension")).toBe("£37,519.60");
		expect(show("take home on £50,000 with 5 percent pension")).toBe("£37,519.60");
		expect(show("£50,000 monthly after tax with 5% pension")).toBe("£3,126.63");
		const slip = payslip(50_000, B, { pensionRate: 0.05 });
		expect(slip.nationalInsurance).toBe(nationalInsurance(50_000, B));
		expect(slip.incomeTax).toBeCloseTo(incomeTax(47_500, B), 6);
	});

	test("a contribution that takes income below the taper restores the allowance", () => {
		// £110,000 with 10% is £99,000 of adjusted net income: the full allowance.
		const slip = payslip(110_000, B, { pensionRate: 0.1 });
		expect(slip.incomeTax).toBeCloseTo(incomeTax(99_000, B), 6);
	});

	test("every clause together, in any order", () => {
		expect(show("£50,000 after tax in Scotland with plan 4 student loan and 5% pension")).toBe("£35,115.10");
		expect(show("£50,000 after tax with 5% pension in Scotland with plan 4 student loan")).toBe("£35,115.10");
	});

	test("a rate outside 0 to 100, and two pensions, are refused by name", () => {
		expect(show("£50,000 after tax with 150% pension")).toBe(
			"PAYROLL_EXPECTED_PENSION_RATE: a pension contribution is a percentage of pay between 0 and 100, and 150 is not");
		expect(show("£50,000 after tax with 5% pension and 3% pension")).toMatch(/^PAYROLL_CONFLICTING_CASE: write one pension contribution/);
		expect(show("£50,000 after tax with 0% pension")).toBe(show("£50,000 after tax"));
		// Everything goes to the pension, and National Insurance is still owed on the salary.
		expect(show("£50,000 after tax with 100% pension")).toBe("-£2,994.40");
	});
});

describe("what must not break", () => {
	test("the plain answers, the pound requirement and the rate form", () => {
		expect(show("take home on £50,000")).toBe("£39,519.60");
		expect(show("£50,000 after tax")).toBe("£39,519.60");
		expect(show("£120,000 after tax")).toBe("£76,157.40");
		expect(show("$50,000 after tax in Scotland")).toMatch(/^PAYROLL_EXPECTED_GBP: these are HMRC's bands, which say nothing about USD/);
		expect(show("50000 after tax with plan 2 student loan")).toMatch(/^PAYROLL_EXPECTED_GBP: /);
		expect(show("$50,000 after 20% tax")).toBe("$40,000.00");
	});

	test("in and with keep their meanings away from a payroll form", () => {
		expect(show("5 km in Scotland")).toBe('UNKNOWN_UNIT: "Scotland" is not a unit.');
		expect(show("3 with 4")).toBe("7");
		expect(show("1 and 2")).not.toMatch(/PAYROLL/);
	});

	test("the salary from a line above, a variable named pension, and both passes", () => {
		const { batch } = expectHonestDocument("pay = £50,000\npension = 5\npay after tax in Scotland\ntake home on pay with 5% pension\npension * 2");
		expect(batch.slice(2)).toEqual(["= £38,023.55", "= £37,519.60", "= 10"]);
	});

	test("a what-if through the Scottish form agrees across passes", () => {
		const { batch } = expectHonestDocument("pay = £50,000\npay after tax in Scotland\nline 2 with pay = £60,000");
		expect(batch[2]).toBe(`= £${(60_000 - incomeTax(60_000, B, "scotland") - nationalInsurance(60_000, B)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
	});
});

describe("the parts", () => {
	test("taxThroughBands", () => {
		const bands = [{ rate: 0.1, upTo: 100 }, { rate: 0.5, upTo: Infinity }];
		expect(taxThroughBands(0, bands)).toBe(0);
		expect(taxThroughBands(-50, bands)).toBe(0);
		expect(taxThroughBands(100, bands)).toBe(10);
		expect(taxThroughBands(150, bands)).toBe(35);
		expect(taxThroughBands(Infinity, [{ rate: 0.1, upTo: 100 }])).toBe(10);
		expect(taxThroughBands(1e308, bands)).toBe(5e307);
		expect(taxThroughBands(50, [])).toBe(0);
	});

	test("incomeTax by jurisdiction and with a pension", () => {
		expect(incomeTax(50_000, B)).toBeCloseTo(7_486, 6);
		expect(incomeTax(50_000, B, "rUK", 2_500)).toBeCloseTo(6_986, 6);
		expect(incomeTax(50_000, B, "scotland")).toBeCloseTo(8_982.05, 6);
		expect(incomeTax(12_570, B, "scotland")).toBe(0);
		expect(incomeTax(0, B, "scotland")).toBe(0);
		expect(incomeTax(-5_000, B, "scotland")).toBe(0);
	});

	test("the Scottish bands of each year, from their published gross limits", () => {
		const limits = (bands: typeof HMRC_2024_25) => bands.incomeTax.scotland.map((b) => b.upTo);
		expect(limits(HMRC_2024_25)).toEqual([14_876 - 12_570, 26_561 - 12_570, 43_662 - 12_570, 75_000 - 12_570, 125_140, Infinity]);
		expect(limits(HMRC_2025_26)).toEqual([15_397 - 12_570, 27_491 - 12_570, 43_662 - 12_570, 75_000 - 12_570, 125_140, Infinity]);
		expect(limits(HMRC_2026_27)).toEqual([16_537 - 12_570, 29_526 - 12_570, 43_662 - 12_570, 75_000 - 12_570, 125_140, Infinity]);
		for (const year of [HMRC_2024_25, HMRC_2025_26, HMRC_2026_27]) {
			expect(year.incomeTax.scotland.map((b) => b.rate)).toEqual([0.19, 0.2, 0.21, 0.42, 0.45, 0.48]);
		}
	});

	test("the student loan terms of each year", () => {
		expect(HMRC_2024_25.studentLoans.plan5).toBeUndefined();
		expect(HMRC_2025_26.studentLoans.plan5).toBeUndefined();
		expect(HMRC_2026_27.studentLoans).toEqual({
			plan1: { threshold: 26_900, rate: 0.09 },
			plan2: { threshold: 29_385, rate: 0.09 },
			plan4: { threshold: 33_795, rate: 0.09 },
			plan5: { threshold: 25_000, rate: 0.09 },
			postgraduate: { threshold: 21_000, rate: 0.06 },
		});
	});

	test("studentLoanRepayment and pensionContribution", () => {
		const terms = { threshold: 29_385, rate: 0.09 };
		expect(studentLoanRepayment(29_385, terms)).toBe(0);
		expect(studentLoanRepayment(29_386, terms)).toBeCloseTo(0.09, 9);
		expect(studentLoanRepayment(-1, terms)).toBe(0);
		expect(studentLoanRepayment(0, terms)).toBe(0);
		expect(pensionContribution(50_000, 0.05)).toBe(2_500);
		expect(pensionContribution(-50_000, 0.05)).toBe(0);
		expect(pensionContribution(0, 1)).toBe(0);
	});

	test("payslip adds up to the gross", () => {
		for (const gross of [0, 12_570, 50_000, 125_140, 250_000]) {
			const slip = payslip(gross, B, { jurisdiction: "scotland", pensionRate: 0.05, studentLoans: [B.studentLoans.plan4!, B.studentLoans.postgraduate!] });
			expect(slip.incomeTax + slip.nationalInsurance + slip.pension + slip.studentLoan + slip.takeHome).toBeCloseTo(gross, 6);
		}
		expect(takeHome(50_000, B)).toBeCloseTo(39_519.6, 6);
	});

	test("readPayrollCase", () => {
		expect(readPayrollCase("", B)).toEqual({});
		expect(readPayrollCase("place:scotland|loan:plan2|pension:5", B)).toEqual({
			jurisdiction: "scotland",
			pensionRate: 0.05,
			studentLoans: [B.studentLoans.plan2],
		});
		expect(readPayrollCase("place:rUK", B)).toEqual({ jurisdiction: "rUK" });
		const refused = (text: string) => {
			const read = readPayrollCase(text, B);
			return isPayrollCaseRefusal(read) ? read.code : "read";
		};
		expect(refused("loan:plan5")).toBe("read");
		expect(readPayrollCase("loan:plan5", HMRC_2025_26)).toEqual({ code: "PAYROLL_UNKNOWN_LOAN_PLAN", message: "Plan 5 is not repaid in the 2025/26 tax year" });
		expect(refused("loan:")).toBe("PAYROLL_UNKNOWN_LOAN_PLAN");
		expect(refused("loan:plan99999999999999999999")).toBe("PAYROLL_UNKNOWN_LOAN_PLAN");
		expect(refused("pension:")).toBe("PAYROLL_EXPECTED_PENSION_RATE");
		expect(refused("pension:-1")).toBe("PAYROLL_EXPECTED_PENSION_RATE");
		expect(refused("pension:Infinity")).toBe("PAYROLL_EXPECTED_PENSION_RATE");
		expect(refused("pension:NaN")).toBe("PAYROLL_EXPECTED_PENSION_RATE");
		expect(refused("place:scotland|place:scotland")).toBe("PAYROLL_CONFLICTING_CASE");
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(refused(`loan:${word}`)).toBe("PAYROLL_UNKNOWN_LOAN_PLAN");
				expect(refused(`${word}:1`)).toBe("read");
			}
		});
	});

	test("payrollCaseNormalizerRule fuses a clause only after a payroll form", () => {
		const rule = payrollCaseNormalizerRule();
		const tokensOf = (line: string): Token[] => {
			const engine = newTrackedEngine();
			return engine.getNormalizer().normalize(engine.getLexer().getHighlightTokenObjects(line, 0));
		};
		const cases = tokensOf("£50,000 after tax in Scotland with plan 2 student loan and 5% pension").filter((t) => t.type === "PAYROLL_CASE");
		expect(cases.map((t) => t.value)).toEqual(["place:scotland", "loan:plan2", "pension:5"]);
		expect(tokensOf("5 km in Scotland").some((t) => t.type === "PAYROLL_CASE")).toBe(false);
		expect(tokensOf("3 with 5% pension").some((t) => t.type === "PAYROLL_CASE")).toBe(false);
		expect(tokensOf("£50,000 after tax and 5% pension").some((t) => t.type === "PAYROLL_CASE")).toBe(false);
		expect(rule.match([], 0)).toBeNull();
		expect(rule.match(tokensOf("in Scotland"), 5)).toBeNull();
	});
});

describe("adversarial", () => {
	test("numeric edges as the salary and the pension rate stay honest", () => {
		for (const line of [
			...fill("£X after tax in Scotland", NUMERIC_EDGES),
			...fill("take home on £X with plan 2 student loan and 5% pension", NUMERIC_EDGES),
			...fill("£50,000 after tax with X% pension", NUMERIC_EDGES),
			...fill("£50,000 after tax with plan X student loan", NUMERIC_EDGES),
		]) {
			expectHonestLine(line, { allowNaN: true });
		}
	});

	test("a zero and a negative salary", () => {
		expect(show("£0 after tax in Scotland")).toBe("£0.00");
		expect(show("£0 after tax with plan 2 student loan and 5% pension")).toBe("£0.00");
		expect(show("-£5,000 after tax with 5% pension")).toBe("-£5,000.00");
	});

	test("prototype words and text edges in the clauses are ordinary words", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`£50,000 after tax in ${word}`);
				expectHonestLine(`£50,000 after tax with plan ${word} student loan`);
				expectHonestLine(`£50,000 after tax with ${word} pension`);
			}
		});
		for (const line of fill("£50,000 after tax in Scotland X", TEXT_EDGES)) expectHonestLine(line);
		expect(show("£50,000 after tax in Scot​land")).not.toBe("£38,023.55");
	});

	test("a long chain of clauses is answered or refused in time", () => {
		expectHonestLine(`£50,000 after tax${" with 5% pension".repeat(500)}`, { budgetMs: 4_000 });
		expectHonestLine(`£50,000 after tax${" and".repeat(2_000)}`, { budgetMs: 4_000 });
	});
});
