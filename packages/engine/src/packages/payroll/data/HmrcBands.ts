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
 * A table per tax year, and {@link DEFAULT_TAX_YEAR} names the latest one
 * shipped. The default is not read off the clock: a year the engine has no
 * table for would otherwise start answering with the previous year's figures
 * the moment the calendar rolled over, silently, which is the same mistake as
 * assuming a sales-tax rate.
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

/**
 * 2025/26. Identical figures to 2024/25: the personal allowance, the band
 * limits and the employee National Insurance thresholds and rates were all
 * unchanged for this year, so this table differs from the one above only in
 * its label. It is kept separate rather than aliased so that a year whose
 * figures do move is a one-line addition beside its neighbours.
 */
export const HMRC_2025_26: TaxYearBands = {
	year: "2025/26",

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

/**
 * 2026/27, the tax year running from 6 April 2026. The employee figures are
 * again unchanged: allowance £12,570, basic rate on the first £37,700 of
 * taxable income, higher rate to £125,140, additional rate above, and employee
 * National Insurance at 8% between £12,570 and £50,270 then 2% above. The
 * employer's rate and secondary threshold did move in April 2025; this package
 * models the employee's deductions only, so those do not appear here.
 */
export const HMRC_2026_27: TaxYearBands = {
	year: "2026/27",

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

/** Every tax year this package ships, oldest first, keyed by the year as it is written. */
export const HMRC_TAX_YEARS: ReadonlyMap<string, TaxYearBands> = new Map([
	[HMRC_2024_25.year, HMRC_2024_25],
	[HMRC_2025_26.year, HMRC_2025_26],
	[HMRC_2026_27.year, HMRC_2026_27],
]);

/**
 * The bands for a written tax year, or undefined when the package ships none.
 *
 * Accepts the year as a reader writes it: "2025/26", "2025-26", "2025/2026".
 * A year with no table is answered as unknown by the caller rather than given
 * the nearest year's figures.
 *
 * @param year - The tax year, e.g. "2025/26".
 * @returns The bands for that year, or undefined.
 */
export function bandsForYear(year: string): TaxYearBands | undefined {
	const digits = year.match(/(\d{4})\D+(\d{2,4})/);
	if (!digits) return undefined;
	const start = digits[1];
	const end = digits[2].length === 4 ? digits[2].slice(2) : digits[2];
	return HMRC_TAX_YEARS.get(`${start}/${end}`);
}

/**
 * The tax year used when none is named: the latest this package ships.
 *
 * Deliberately the latest table rather than one chosen from today's date. A
 * table the package does not have cannot be guessed, and a default that
 * followed the clock would answer a new tax year with the previous year's
 * figures without saying so.
 */
export const DEFAULT_TAX_YEAR = HMRC_2026_27;
