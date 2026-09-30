/**
 * HMRC income tax and National Insurance bands, the Scottish income tax bands,
 * and the student loan repayment terms: the figures the take-home computation
 * is built from.
 *
 * Income tax is a list of bands per jurisdiction, because the jurisdictions do
 * not share a shape: England, Wales and Northern Ireland have three rates
 * (basic, higher and additional), Scotland six (starter, basic, intermediate,
 * higher, advanced and top). The personal allowance, its taper and National
 * Insurance are UK-wide, so each is one set of figures per year. A jurisdiction
 * with no table here is not assumed to share another's (issue #747), the same
 * discipline the sales-tax rule follows (no rate is ever guessed).
 *
 * Every number here is public data for the stated tax year: HMRC's rates, the
 * Scottish Government's bands and the Student Loans Company's thresholds. They
 * are laid out one per line, named, so the figures can be read and checked
 * against the source rather than buried inside the arithmetic.
 *
 * A table per tax year, and {@link DEFAULT_TAX_YEAR} names the latest one
 * shipped. The default is not read off the clock: a year the engine has no
 * table for would otherwise start answering with the previous year's figures
 * the moment the calendar rolled over, silently, which is the same mistake as
 * assuming a sales-tax rate.
 *
 * @see https://www.gov.uk/income-tax-rates
 * @see https://www.gov.uk/scottish-income-tax
 * @see https://www.gov.uk/national-insurance-rates-letters
 * @see https://www.gov.uk/repaying-your-student-loan/what-you-pay
 */

/**
 * One income tax band: the rate charged on taxable income (income above the
 * personal allowance) up to `upTo`, and above the band before it.
 */
export interface IncomeTaxBand {
	/** The rate, as a fraction (0.2 for 20%). */
	readonly rate: number;
	/** The top of the band, in taxable income; `Infinity` for the top band. */
	readonly upTo: number;
}

/** A jurisdiction with its own income tax bands. */
export type Jurisdiction = "rUK" | "scotland";

/** A student loan repayment plan, as the Student Loans Company names them. */
export type StudentLoanPlan = "plan1" | "plan2" | "plan4" | "plan5" | "postgraduate";

/** How a student loan plan is repaid: `rate` of gross pay above `threshold` a year. */
export interface StudentLoanTerms {
	/** Annual pay above which repayments are taken. */
	readonly threshold: number;
	/** The share of pay above the threshold that is repaid, as a fraction. */
	readonly rate: number;
}

/** The figures for one tax year. */
export interface TaxYearBands {
	/** The tax year these figures are for, e.g. "2024/25". */
	readonly year: string;

	// ── Personal allowance (UK-wide) ──────────────────────────────────────
	/** The tax-free personal allowance, before any taper. */
	readonly personalAllowance: number;
	/** Income above which the personal allowance is reduced by £1 for every £2. */
	readonly personalAllowanceTaperFrom: number;

	// ── Income tax, per jurisdiction ──────────────────────────────────────
	/** Each jurisdiction's bands, lowest first, the last reaching `Infinity`. */
	readonly incomeTax: Readonly<Record<Jurisdiction, readonly IncomeTaxBand[]>>;

	// ── National Insurance (Class 1, employee, UK-wide) ────────────────────
	/** Annual earnings above which employee NI is charged. */
	readonly niPrimaryThreshold: number;
	/** Annual earnings up to this pay the main rate; above it, the upper rate. */
	readonly niUpperEarningsLimit: number;
	readonly niMainRate: number;
	readonly niUpperRate: number;

	// ── Student loan repayments ────────────────────────────────────────────
	/** Each plan repaid in this year; a plan not yet repaid in it (Plan 5 before 2026/27) is absent. */
	readonly studentLoans: Readonly<Partial<Record<StudentLoanPlan, StudentLoanTerms>>>;
}

/**
 * England, Wales and Northern Ireland, unchanged across 2024/25 to 2026/27:
 * basic 20% on the first £37,700 of taxable income, higher 40% up to £125,140,
 * additional 45% above.
 */
const RUK_BANDS: readonly IncomeTaxBand[] = [
	{ rate: 0.2, upTo: 37_700 },
	{ rate: 0.4, upTo: 125_140 },
	{ rate: 0.45, upTo: Infinity },
];

/**
 * Scotland 2024/25, as the Scottish Government publishes them on gross pay with
 * the standard allowance: starter 19% £12,571 to £14,876, basic 20% to £26,561,
 * intermediate 21% to £43,662, higher 42% to £75,000, advanced 45% to £125,140,
 * top 48% above. Here in taxable income, each gross limit less the £12,570
 * allowance, except the top threshold, which is £125,140 of taxable income as
 * the additional rate's is (the allowance is gone by then).
 */
const SCOTLAND_2024_25: readonly IncomeTaxBand[] = [
	{ rate: 0.19, upTo: 2_306 },
	{ rate: 0.2, upTo: 13_991 },
	{ rate: 0.21, upTo: 31_092 },
	{ rate: 0.42, upTo: 62_430 },
	{ rate: 0.45, upTo: 125_140 },
	{ rate: 0.48, upTo: Infinity },
];

/** Scotland 2025/26: starter to £15,397, basic to £27,491, the rest as 2024/25. */
const SCOTLAND_2025_26: readonly IncomeTaxBand[] = [
	{ rate: 0.19, upTo: 2_827 },
	{ rate: 0.2, upTo: 14_921 },
	{ rate: 0.21, upTo: 31_092 },
	{ rate: 0.42, upTo: 62_430 },
	{ rate: 0.45, upTo: 125_140 },
	{ rate: 0.48, upTo: Infinity },
];

/** Scotland 2026/27: starter to £16,537, basic to £29,526 (both up 7.4%), the rest frozen. */
const SCOTLAND_2026_27: readonly IncomeTaxBand[] = [
	{ rate: 0.19, upTo: 3_967 },
	{ rate: 0.2, upTo: 16_956 },
	{ rate: 0.21, upTo: 31_092 },
	{ rate: 0.42, upTo: 62_430 },
	{ rate: 0.45, upTo: 125_140 },
	{ rate: 0.48, upTo: Infinity },
];

/**
 * 2024/25. Personal allowance £12,570, tapered away £1 per £2 over £100,000 (so
 * gone at £125,140). Employee NI at 8% between £12,570 and £50,270, then 2%
 * above (the main rate cut to 8% from 6 April 2024). Student loans: Plan 1
 * £24,990, Plan 2 £27,295, Plan 4 £31,395, each at 9%; Postgraduate £21,000 at
 * 6%.
 */
export const HMRC_2024_25: TaxYearBands = {
	year: "2024/25",

	personalAllowance: 12_570,
	personalAllowanceTaperFrom: 100_000,
	incomeTax: { rUK: RUK_BANDS, scotland: SCOTLAND_2024_25 },

	niPrimaryThreshold: 12_570,
	niUpperEarningsLimit: 50_270,
	niMainRate: 0.08,
	niUpperRate: 0.02,

	studentLoans: {
		plan1: { threshold: 24_990, rate: 0.09 },
		plan2: { threshold: 27_295, rate: 0.09 },
		plan4: { threshold: 31_395, rate: 0.09 },
		postgraduate: { threshold: 21_000, rate: 0.06 },
	},
};

/**
 * 2025/26. The allowance, the England, Wales and Northern Ireland bands and
 * employee National Insurance are unchanged from 2024/25. Student loans: Plan 1
 * £26,065, Plan 2 £28,470, Plan 4 £32,745; Postgraduate £21,000.
 */
export const HMRC_2025_26: TaxYearBands = {
	year: "2025/26",

	personalAllowance: 12_570,
	personalAllowanceTaperFrom: 100_000,
	incomeTax: { rUK: RUK_BANDS, scotland: SCOTLAND_2025_26 },

	niPrimaryThreshold: 12_570,
	niUpperEarningsLimit: 50_270,
	niMainRate: 0.08,
	niUpperRate: 0.02,

	studentLoans: {
		plan1: { threshold: 26_065, rate: 0.09 },
		plan2: { threshold: 28_470, rate: 0.09 },
		plan4: { threshold: 32_745, rate: 0.09 },
		postgraduate: { threshold: 21_000, rate: 0.06 },
	},
};

/**
 * 2026/27, the tax year running from 6 April 2026. The employee figures are
 * again unchanged: allowance £12,570, the three England, Wales and Northern
 * Ireland bands, and employee National Insurance at 8% between £12,570 and
 * £50,270 then 2% above. The employer's rate and secondary threshold did move
 * in April 2025; this package models the employee's deductions only, so those
 * do not appear here. Student loans: Plan 1 £26,900, Plan 2 £29,385, Plan 4
 * £33,795, and Plan 5, repaid from April 2026, £25,000, each at 9%;
 * Postgraduate £21,000 at 6%.
 */
export const HMRC_2026_27: TaxYearBands = {
	year: "2026/27",

	personalAllowance: 12_570,
	personalAllowanceTaperFrom: 100_000,
	incomeTax: { rUK: RUK_BANDS, scotland: SCOTLAND_2026_27 },

	niPrimaryThreshold: 12_570,
	niUpperEarningsLimit: 50_270,
	niMainRate: 0.08,
	niUpperRate: 0.02,

	studentLoans: {
		plan1: { threshold: 26_900, rate: 0.09 },
		plan2: { threshold: 29_385, rate: 0.09 },
		plan4: { threshold: 33_795, rate: 0.09 },
		plan5: { threshold: 25_000, rate: 0.09 },
		postgraduate: { threshold: 21_000, rate: 0.06 },
	},
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
