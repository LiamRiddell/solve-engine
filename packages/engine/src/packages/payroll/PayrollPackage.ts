import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { Value, ValueType, uomValue, numberValue } from "@solve-js/vm/Value";
import { PayrollPrefixParselet, PayrollPostfixParselet } from "./parselets/PayrollParselets";
import { takeHome, hourlyRate } from "./PayrollMath";
import { DEFAULT_TAX_YEAR } from "./data/HmrcBands";

/** Apply a gross-to-figure computation, keeping the input's currency (or a bare number). */
function money(input: Value, compute: (gross: number) => number): Value {
	const result = compute(input.toNumber());
	return input.type === ValueType.Uom ? uomValue(result, input.unit!) : numberValue(result);
}

/**
 * Take-home pay from a UK salary (issue #277).
 *
 * `<salary> after tax` (and `take home on <salary>`) answers what actually
 * reaches the bank after income tax and National Insurance; `per month after
 * tax` gives that as a monthly figure; `hourly for <salary>` is the gross salary
 * as an hourly rate. The salary keeps its currency, so a `£` figure answers in
 * `£`.
 *
 * The figures are the full HMRC bands for England, Wales and Northern Ireland,
 * tax year 2024/25 (see `data/HmrcBands.ts`): the personal-allowance taper over
 * £100,000, the 20/40/45% income-tax bands, and employee NI at 8% then 2%.
 * Scotland sets its own bands and is not covered, the same boundary the sales-tax
 * rule draws: a rate that is not shipped is not assumed. On by default and
 * removable.
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
	},
	pluginFunctions: {
		payrollTakeHome: (args: Value[]): Value => money(args[0], (g) => takeHome(g, DEFAULT_TAX_YEAR)),
		payrollTakeHomeMonthly: (args: Value[]): Value => money(args[0], (g) => takeHome(g, DEFAULT_TAX_YEAR) / 12),
		payrollHourly: (args: Value[]): Value => money(args[0], hourlyRate),
	},
	tokenCategories: {
		TAKE_HOME_ON: "function",
		HOURLY_FOR: "function",
		AFTER_TAX: "operator",
		AFTER_TAX_MONTHLY: "operator",
	},
};
