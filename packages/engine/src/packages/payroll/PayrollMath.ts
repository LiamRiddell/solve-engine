/**
 * The take-home computation, as pure functions over a gross annual salary.
 *
 * Every function takes and returns plain numbers so it is trivially testable
 * against a known figure, and carries no engine import. The bands come from
 * {@link ./data/HmrcBands}; nothing here hard-codes a rate.
 *
 * The three steps a payslip goes through: work out the personal allowance
 * (which tapers for high earners), charge income tax on what is left over the
 * allowance, and charge National Insurance on the earnings. Take-home is the
 * gross minus the two.
 */

import type { TaxYearBands } from "./data/HmrcBands";

/**
 * The personal allowance for a gross salary, after the high-income taper: above
 * £100,000 it falls by £1 for every £2 earned, reaching zero at £125,140.
 */
export function personalAllowance(gross: number, bands: TaxYearBands): number {
	if (gross <= bands.personalAllowanceTaperFrom) return bands.personalAllowance;
	const reduction = (gross - bands.personalAllowanceTaperFrom) / 2;
	return Math.max(0, bands.personalAllowance - reduction);
}

/**
 * Income tax on a gross salary. The bands are charged on taxable income (gross
 * minus the personal allowance): the basic rate up to the basic limit, the
 * higher rate up to the higher limit, the additional rate above it.
 */
export function incomeTax(gross: number, bands: TaxYearBands): number {
	const taxable = Math.max(0, gross - personalAllowance(gross, bands));

	const basic = Math.min(taxable, bands.basicRateLimit);
	const higher = Math.min(Math.max(0, taxable - bands.basicRateLimit), bands.higherRateLimit - bands.basicRateLimit);
	const additional = Math.max(0, taxable - bands.higherRateLimit);

	return basic * bands.basicRate + higher * bands.higherRate + additional * bands.additionalRate;
}

/**
 * Employee (Class 1) National Insurance on a gross salary: the main rate on
 * earnings between the primary threshold and the upper earnings limit, the
 * upper rate on everything above.
 */
export function nationalInsurance(gross: number, bands: TaxYearBands): number {
	if (gross <= bands.niPrimaryThreshold) return 0;
	const main = Math.min(gross, bands.niUpperEarningsLimit) - bands.niPrimaryThreshold;
	const upper = Math.max(0, gross - bands.niUpperEarningsLimit);
	return main * bands.niMainRate + upper * bands.niUpperRate;
}

/** Take-home pay: gross salary less income tax and National Insurance. */
export function takeHome(gross: number, bands: TaxYearBands): number {
	return gross - incomeTax(gross, bands) - nationalInsurance(gross, bands);
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
