/**
 * HMRC income tax and National Insurance bands, the figures the take-home
 * computation is built from.
 *
 * These are the rates and thresholds for England, Wales and Northern Ireland.
 * Scotland sets its own income tax bands and is not covered here; a Scottish or
 * other-jurisdiction figure would need those bands supplied rather than assumed,
 * the same discipline the sales-tax rule follows (no rate is ever guessed).
 *
 * Every number here is public HMRC data for the stated tax year. They are laid
 * out one per line, named, so the figures can be read and checked against the
 * source rather than buried inside the arithmetic.
 *
 * @see https://www.gov.uk/income-tax-rates
 * @see https://www.gov.uk/national-insurance-rates-letters
 */

export interface TaxYearBands {
	/** The tax year these figures are for, e.g. "2024/25". */
	readonly year: string;

	// ── Income tax (England, Wales, Northern Ireland) ──────────────────────
	/** The tax-free personal allowance, before any taper. */
	readonly personalAllowance: number;
	/** Income above which the personal allowance is reduced by £1 for every £2. */
	readonly personalAllowanceTaperFrom: number;
	/** Taxable income up to this is charged at the basic rate. */
	readonly basicRateLimit: number;
	/** Taxable income up to this (and above the basic limit) is at the higher rate. */
	readonly higherRateLimit: number;
	readonly basicRate: number;
	readonly higherRate: number;
	readonly additionalRate: number;

	// ── National Insurance (Class 1, employee) ─────────────────────────────
	/** Annual earnings above which employee NI is charged. */
	readonly niPrimaryThreshold: number;
	/** Annual earnings up to this pay the main rate; above it, the upper rate. */
	readonly niUpperEarningsLimit: number;
	readonly niMainRate: number;
	readonly niUpperRate: number;
}

/**
 * 2024/25. Personal allowance £12,570, tapered away £1 per £2 over £100,000 (so
 * gone at £125,140). Basic 20% on the first £37,700 of taxable income, higher
 * 40% up to £125,140, additional 45% above. Employee NI at 8% between £12,570
 * and £50,270, then 2% above (the main rate cut to 8% from 6 April 2024).
 */
export const HMRC_2024_25: TaxYearBands = {
	year: "2024/25",

	personalAllowance: 12_570,
	personalAllowanceTaperFrom: 100_000,
	basicRateLimit: 37_700,
	higherRateLimit: 125_140,
	basicRate: 0.2,
	higherRate: 0.4,
	additionalRate: 0.45,

	niPrimaryThreshold: 12_570,
	niUpperEarningsLimit: 50_270,
	niMainRate: 0.08,
	niUpperRate: 0.02,
};

/** The tax year used when none is named. */
export const DEFAULT_TAX_YEAR = HMRC_2024_25;
