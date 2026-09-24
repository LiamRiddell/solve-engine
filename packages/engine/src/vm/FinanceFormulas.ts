import { Value, ValueType, errorValue } from "@solve-js/vm/Value";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";

/**
 * The formulas behind the finance builtins, in one place.
 *
 * The builtins in `vm/VMBuiltins.ts` compute through these, and so does the
 * finance package's `explain` hook when it lays out a step, which is the point
 * of the module: a derivation that recomputed a growth factor with its own
 * arithmetic could disagree with the answer in the last digit, and a reader
 * checking the one against the other would find the engine contradicting
 * itself. One function, called from both places, cannot.
 */

/** How many months a finance term counts in a year. */
const MONTHS_PER_YEAR = 12;

/** Every spelling of a month the unit table accepts, singular and plural. */
const MONTH_UNITS = new Set(["month", "months", "mo", "mos", "mth", "mths"]);

/**
 * The term of a finance form, in years.
 *
 * A term is written as an ordinary quantity (`over 45 days`, `over 18 months`),
 * and every finance builtin wants years. Reading the magnitude and ignoring the
 * unit charged 45 days as 45 years: £74,209.08 of interest on a £2,400 invoice,
 * and `over 1 month` answering the same as `over 1 year`.
 *
 * A bare number is still years, which is what the documented phrase forms and
 * every function-call spelling pass. A quantity that is not a duration is
 * refused by measure, because a term in kilograms is a mistake rather than a
 * number.
 *
 * A month here is a twelfth of a year, which is the financial convention and
 * not the engine's general one: `18 months in years` answers 1.48, because the
 * unit table makes a month thirty days. A lender does not. "18 months at 8%"
 * means a year and a half to anyone who has been quoted one, and a 300-month
 * mortgage is a 25-year mortgage exactly, which the thirty-day month misses by
 * four months. Every other duration goes through the table, where a year is
 * 365 days. Both conventions are stated on the page.
 *
 * @param value - The term operand as the parser left it.
 * @returns The term in years, or the error Value to return in its place.
 */
export function termInYears(value: Value): number | Value {
	if (value.type !== ValueType.Uom || value.unit === undefined) return value.toNumber();
	if (getMeasure(value.unit) !== "time") {
		return errorValue(
			"INVALID_TERM",
			`a term is a length of time, and "${value.unit}" is not: write it as days, months or years`,
		);
	}
	if (MONTH_UNITS.has(value.unit)) return value.toNumber() / MONTHS_PER_YEAR;
	return convertUnit(value.toNumber(), value.unit, "year");
}

/**
 * How much one unit grows to at `rate` a year, compounded once a year, over
 * `years`: `(1 + rate)^years`. The factor behind compound growth and, divided
 * into a future sum, behind present value.
 *
 * @param rate - The annual rate as a decimal fraction (0.05 for 5%).
 * @param years - The term in years.
 * @returns The growth factor.
 */
export function growthFactor(rate: number, years: number): number {
	return Math.pow(1 + rate, years);
}

/**
 * The same growth compounded `perYear` times a year: `(1 + rate / perYear)^(perYear × years)`.
 *
 * @param rate - The annual rate as a decimal fraction.
 * @param perYear - How many times a year interest is added (12 for monthly).
 * @param years - The term in years.
 * @returns The growth factor.
 */
export function periodicGrowthFactor(rate: number, perYear: number, years: number): number {
	return Math.pow(1 + rate / perYear, perYear * years);
}

/**
 * `(1 + monthlyRate)^-payments`, the part of a repayment loan's formula that
 * discounts the last payment back to today.
 *
 * @param monthlyRate - The monthly rate as a decimal fraction.
 * @param payments - How many monthly payments the loan runs for.
 * @returns The discount factor.
 */
export function loanDiscountFactor(monthlyRate: number, payments: number): number {
	return Math.pow(1 + monthlyRate, -payments);
}

/**
 * Standard amortizing-loan math shared by the loanRepayment/loanInterest/
 * monthlyPayment builtins (indices 55-57). Always amortizes monthly (the
 * standard mortgage convention), `annualRate` is the nominal annual rate as a
 * decimal fraction (e.g. 0.06 for 6%).
 *
 * A zero rate is handled as a special case (plain principal/periods split)
 * since the closed-form annuity formula divides by rate and would otherwise
 * produce a NaN from 0/0.
 *
 * @param principal - The amount borrowed.
 * @param annualRate - The nominal annual rate as a decimal fraction.
 * @param years - The term in years.
 * @returns The monthly payment, the total repaid, and the interest within it.
 */
export function amortizeLoan(
	principal: number,
	annualRate: number,
	years: number,
): { monthlyPayment: number; totalRepayment: number; totalInterest: number } {
	const n = years * 12;
	const rMonthly = annualRate / 12;
	const monthlyPayment = rMonthly === 0
		? principal / n
		: (principal * rMonthly) / (1 - loanDiscountFactor(rMonthly, n));
	const totalRepayment = monthlyPayment * n;
	const totalInterest = totalRepayment - principal;
	return { monthlyPayment, totalRepayment, totalInterest };
}
