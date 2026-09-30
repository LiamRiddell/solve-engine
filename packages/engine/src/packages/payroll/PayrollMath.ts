/**
 * The take-home computation, as pure functions over a gross annual salary.
 *
 * Every function takes and returns plain numbers so it is trivially testable
 * against a known figure, and carries no engine import. The bands come from
 * {@link ./data/HmrcBands}; nothing here hard-codes a rate.
 *
 * The steps a payslip goes through: take any pension contribution, work out
 * the personal allowance (which tapers for high earners), charge income tax on
 * what is left over the allowance through the jurisdiction's bands, charge
 * National Insurance and any student loan repayment on the earnings. Take-home
 * is the gross minus all of them.
 */

import type { IncomeTaxBand, Jurisdiction, StudentLoanTerms, TaxYearBands } from "./data/HmrcBands";

/**
 * What sets one employee's take-home apart from the plain case (issue #747):
 * where they pay income tax, a pension contribution, and the student loan plans
 * they repay. Every field is optional, and none of them is the plain case.
 */
export interface PayrollCase {
	/** Whose income tax bands apply; England, Wales and Northern Ireland by default. */
	readonly jurisdiction?: Jurisdiction;
	/**
	 * A pension contribution as a fraction of gross pay, taken under a net pay
	 * arrangement: before income tax, but not before National Insurance or
	 * student loan repayments.
	 */
	readonly pensionRate?: number;
	/** The terms of each student loan plan repaid, already looked up for the year. */
	readonly studentLoans?: readonly StudentLoanTerms[];
}

/** Each deduction from a gross salary, and what is left. */
export interface Payslip {
	readonly incomeTax: number;
	readonly nationalInsurance: number;
	readonly pension: number;
	readonly studentLoan: number;
	readonly takeHome: number;
}

/**
 * The personal allowance for an income, after the high-income taper: above
 * £100,000 it falls by £1 for every £2, reaching zero at £125,140. The income
 * is adjusted net income, gross pay less any pension contribution.
 */
export function personalAllowance(income: number, bands: TaxYearBands): number {
	if (income <= bands.personalAllowanceTaperFrom) return bands.personalAllowance;
	const reduction = (income - bands.personalAllowanceTaperFrom) / 2;
	return Math.max(0, bands.personalAllowance - reduction);
}

/**
 * Tax on a taxable income through a list of bands, lowest first: each band's
 * rate on the part of the income between the band below's top and its own.
 * A negative or zero income owes nothing.
 */
export function taxThroughBands(taxable: number, bands: readonly IncomeTaxBand[]): number {
	let tax = 0;
	let floor = 0;
	for (const band of bands) {
		if (taxable <= floor) break;
		tax += (Math.min(taxable, band.upTo) - floor) * band.rate;
		floor = band.upTo;
	}
	return tax;
}

/**
 * Income tax on a gross salary. Taxable income is the gross, less a pension
 * contribution under a net pay arrangement, less the personal allowance (which
 * tapers on the same reduced income); it is charged through the jurisdiction's
 * bands.
 */
export function incomeTax(gross: number, bands: TaxYearBands, jurisdiction: Jurisdiction = "rUK", pension = 0): number {
	const income = gross - pension;
	const taxable = Math.max(0, income - personalAllowance(income, bands));
	return taxThroughBands(taxable, bands.incomeTax[jurisdiction]);
}

/**
 * Employee (Class 1) National Insurance on a gross salary: the main rate on
 * earnings between the primary threshold and the upper earnings limit, the
 * upper rate on everything above. The same across the UK.
 */
export function nationalInsurance(gross: number, bands: TaxYearBands): number {
	if (gross <= bands.niPrimaryThreshold) return 0;
	const main = Math.min(gross, bands.niUpperEarningsLimit) - bands.niPrimaryThreshold;
	const upper = Math.max(0, gross - bands.niUpperEarningsLimit);
	return main * bands.niMainRate + upper * bands.niUpperRate;
}

/**
 * A year's repayment on one student loan plan: its rate on gross pay above its
 * threshold, nothing at or below it. Worked out on the year's pay, where an
 * employer takes it per pay period, so a year of uneven pay can differ.
 */
export function studentLoanRepayment(gross: number, terms: StudentLoanTerms): number {
	return Math.max(0, gross - terms.threshold) * terms.rate;
}

/** A pension contribution: `rate` of gross pay, and nothing on a salary of zero or below. */
export function pensionContribution(gross: number, rate: number): number {
	return Math.max(0, gross) * rate;
}

/** Every deduction from a gross salary for one case, and the take-home left. */
export function payslip(gross: number, bands: TaxYearBands, payrollCase: PayrollCase = {}): Payslip {
	const pension = pensionContribution(gross, payrollCase.pensionRate ?? 0);
	const tax = incomeTax(gross, bands, payrollCase.jurisdiction ?? "rUK", pension);
	const ni = nationalInsurance(gross, bands);
	let studentLoan = 0;
	for (const terms of payrollCase.studentLoans ?? []) studentLoan += studentLoanRepayment(gross, terms);
	return {
		incomeTax: tax,
		nationalInsurance: ni,
		pension,
		studentLoan,
		takeHome: gross - tax - ni - pension - studentLoan,
	};
}

/** Take-home pay: gross salary less income tax, National Insurance and the case's deductions. */
export function takeHome(gross: number, bands: TaxYearBands, payrollCase: PayrollCase = {}): number {
	return payslip(gross, bands, payrollCase).takeHome;
}

/** Hours in a nominal full-time year: a 40-hour week across 48 working weeks. */
export const FULL_TIME_HOURS_PER_YEAR = 1_920;

/**
 * A gross annual salary as an hourly rate, over a {@link FULL_TIME_HOURS_PER_YEAR}
 * year. This is a plain division, before tax; the take-home forms answer the
 * after-tax question.
 */
export function hourlyRate(annual: number): number {
	return annual / FULL_TIME_HOURS_PER_YEAR;
}
