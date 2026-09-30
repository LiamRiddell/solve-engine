import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { Value, ValueType, uomValue, numberValue, errorValue } from "@solve-js/vm/Value";
import { PayrollPrefixParselet, PayrollPostfixParselet, PayrollRateParselet } from "./parselets/PayrollParselets";
import { afterRateNormalizerRule } from "./normalizer/AfterRateNormalizerRule";
import { payrollCaseNormalizerRule } from "./normalizer/PayrollCaseNormalizerRule";
import { takeHome, hourlyRate } from "./PayrollMath";
import { readPayrollCase, isPayrollCaseRefusal } from "./PayrollCase";
import { DEFAULT_TAX_YEAR } from "./data/HmrcBands";

/** Error codes this package answers with. Each names something a person can correct. */
export const PayrollErrorCodes = {
	/** The banded forms were given something other than a pound salary. */
	PAYROLL_EXPECTED_GBP: "PAYROLL_EXPECTED_GBP",
	/** A stated tax rate was not a rate a take-home can be worked out from. */
	PAYROLL_EXPECTED_RATE: "PAYROLL_EXPECTED_RATE",
	/** `with student loan` with no plan, or a plan that does not exist (`with plan 3 student loan`). */
	PAYROLL_UNKNOWN_LOAN_PLAN: "PAYROLL_UNKNOWN_LOAN_PLAN",
	/** Two places, two pensions, a plan named twice, or two undergraduate plans on one take-home line. */
	PAYROLL_CONFLICTING_CASE: "PAYROLL_CONFLICTING_CASE",
	/** `with 150% pension`: a pension contribution that is not a percentage between 0 and 100. */
	PAYROLL_EXPECTED_PENSION_RATE: "PAYROLL_EXPECTED_PENSION_RATE",
} as const;

/** Apply a gross-to-figure computation, keeping the input's currency (or a bare number). */
function money(input: Value, compute: (gross: number) => number): Value {
	const result = compute(input.toNumber());
	return input.type === ValueType.Uom ? uomValue(result, input.unit!) : numberValue(result);
}

/**
 * The same, for the forms that carry HMRC's bands, which only answer for pounds.
 *
 * The bands are a fact about the United Kingdom. Applied to a dollar salary
 * they produced a confident figure that was wrong about a different country's
 * tax, and printed it with a dollar sign; applied to a bare number they assumed
 * Britain without saying so. Neither is a rounding error, so neither is
 * answered. The refusal names the form that does work, because the person
 * asking has a real question and it is one the engine can take.
 */
function bandedMoney(input: Value, compute: (gross: number) => number, refusal?: Value): Value {
	if (input.type !== ValueType.Uom || input.unit === undefined) {
		return errorValue(
			PayrollErrorCodes.PAYROLL_EXPECTED_GBP,
			`these are HMRC's bands, so this needs a pound salary: write "£50,000 after tax", or state a rate with "50,000 after 20% tax"`,
		);
	}
	if (input.unit !== "GBP") {
		return errorValue(
			PayrollErrorCodes.PAYROLL_EXPECTED_GBP,
			`these are HMRC's bands, which say nothing about ${input.unit}: state a rate instead, as in "50,000 after 20% tax"`,
		);
	}
	if (refusal !== undefined) return refusal;
	return money(input, compute);
}

/**
 * The banded take-home for a line's case clauses (`in Scotland`, `with plan 2
 * student loan`, `with 5% pension`), or the refusal a clause earns. The pound
 * gate runs first, so a dollar salary is refused for its currency whatever
 * clauses follow it.
 */
function bandedTakeHome(args: Value[], monthly: boolean): Value {
	const clauses = args.length > 1 ? String(args[1].value ?? "") : "";
	const read = readPayrollCase(clauses, DEFAULT_TAX_YEAR);
	if (isPayrollCaseRefusal(read)) return bandedMoney(args[0], () => 0, errorValue(read.code, read.message));
	return bandedMoney(args[0], (g) => {
		const yearly = takeHome(g, DEFAULT_TAX_YEAR, read);
		return monthly ? yearly / 12 : yearly;
	});
}

/** Take-home at a rate the line states, which is national about nothing. */
function rateMoney(input: Value, rate: Value, monthly: boolean): Value {
	const percent = rate.toNumber();
	if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
		return errorValue(
			PayrollErrorCodes.PAYROLL_EXPECTED_RATE,
			`a tax rate is a percentage between 0 and 100, and ${percent} is not`,
		);
	}
	return money(input, (gross) => {
		const kept = gross * (1 - percent / 100);
		return monthly ? kept / 12 : kept;
	});
}

/**
 * Take-home pay from a UK salary (issue #277).
 *
 * `<salary> after tax` (and `take home on <salary>`) answers what actually
 * reaches the bank after income tax and National Insurance; `per month after
 * tax` gives that as a monthly figure; `hourly for <salary>` is the gross salary
 * as an hourly rate.
 *
 * The banded forms take pounds and nothing else. HMRC's bands are a fact about
 * the United Kingdom, so a dollar salary was being answered confidently about a
 * country they say nothing about, and a bare number was assuming Britain in
 * silence. Both refuse now and name `after 20% tax`, the form that states its
 * own rate and is therefore national about nothing. `hourly for` is not gated:
 * a salary over a working year is a division, with no bands in it.
 *
 * The figures are the full HMRC bands for England, Wales and Northern Ireland,
 * for whichever year `DEFAULT_TAX_YEAR` names, which is the latest the package
 * ships a table for (see `data/HmrcBands.ts`): the personal-allowance taper over
 * £100,000, the 20/40/45% income-tax bands, and employee NI at 8% then 2%.
 *
 * Case clauses after the form (issue #747) change whose take-home it is: `in
 * Scotland` charges Scotland's six income tax bands (National Insurance is
 * UK-wide), `with plan 2 student loan` and the other plans take a student loan
 * repayment, and `with 5% pension` takes a pension contribution before income
 * tax (a net pay arrangement). A different tax code and self-employment stay
 * out, the same boundary the sales-tax rule draws: what is not shipped is not
 * assumed. On by default and removable.
 */
export const PAYROLL_PACKAGE: IEnginePackage = {
	name: "solve-payroll",
	phrases: {
		"take home on": "TAKE_HOME_ON",
		"hourly for": "HOURLY_FOR",
		// Postfix. "salary" is optional flourish on the same forms.
		"after tax": "AFTER_TAX",
		"salary after tax": "AFTER_TAX",
		"per month after tax": "AFTER_TAX_MONTHLY",
		"monthly after tax": "AFTER_TAX_MONTHLY",
		"salary per month after tax": "AFTER_TAX_MONTHLY",
	},
	prefixParselets: {
		TAKE_HOME_ON: new PayrollPrefixParselet("payrollTakeHome"),
		HOURLY_FOR: new PayrollPrefixParselet("payrollHourly"),
	},
	infixParselets: {
		AFTER_TAX: new PayrollPostfixParselet("payrollTakeHome"),
		AFTER_TAX_MONTHLY: new PayrollPostfixParselet("payrollTakeHomeMonthly"),
		AFTER_RATE: new PayrollRateParselet("payrollTakeHomeAtRate"),
	},
	normalizerRules: [afterRateNormalizerRule(), payrollCaseNormalizerRule()],
	pluginFunctions: {
		payrollTakeHome: (args: Value[]): Value => bandedTakeHome(args, false),
		payrollTakeHomeMonthly: (args: Value[]): Value => bandedTakeHome(args, true),
		// No bands, so no country, so no gate: an hourly rate is a division.
		payrollHourly: (args: Value[]): Value => money(args[0], hourlyRate),
		payrollTakeHomeAtRate: (args: Value[]): Value => rateMoney(args[0], args[1], false),
	},
	tokenCategories: {
		TAKE_HOME_ON: "function",
		HOURLY_FOR: "function",
		AFTER_TAX: "operator",
		AFTER_TAX_MONTHLY: "operator",
		AFTER_RATE: "operator",
		PAYROLL_CASE: "keyword",
	},
};
