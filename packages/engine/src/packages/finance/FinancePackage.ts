import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { InvestmentGrowthParselet, PresentValueParselet, ReturnOnInvestmentParselet, AnnualReturnParselet } from "./parselets/InvestmentParselets";
import { CompoundInterestParselet } from "./parselets/CompoundInterestParselet";
import { LoanRepaymentParselet } from "./parselets/LoanRepaymentParselet";
import { SplitBetweenParselet, SplitWaysParselet } from "./parselets/BillSplitParselets";
import { SalesTaxParselet } from "./parselets/SalesTaxParselet";
import { InflationQueryParselet } from "./parselets/InflationQueryParselet";
import { InflationFutureValueParselet } from "./parselets/InflationFutureValueParselet";
import { InYearDollarsParselet } from "./parselets/InYearDollarsParselet";
import {
  INFLATION_FROM_YEAR_TO_PRESENT_IDX, INFLATION_TO_YEAR_FROM_PRESENT_IDX, INFLATION_FUTURE_VALUE_IDX,
  inflationFromYearToPresentHandler, inflationToYearFromPresentHandler, inflationFutureValueHandler,
} from "./parselets/InflationPluginFunctions";
import { inYearDollarsNormalizerRule } from "./normalizer/InYearDollarsNormalizerRule";
import { recurringScheduleNormalizerRule } from "./normalizer/RecurringScheduleNormalizerRule";
import { billSplitNormalizerRule } from "./normalizer/BillSplitNormalizerRule";

// CALL_BUILTIN indices. See VMBuiltins.ts for the handler implementations.
const COMPOUND_FV = 51, COMPOUND_INTEREST = 52;
const LOAN_REPAYMENT = 55, LOAN_INTEREST = 56;
// Investments (documented Soulver spellings). See VMBuiltins.ts 80-84.
const COMPOUND_FV_EVERY = 80, COMPOUND_INTEREST_EVERY = 81;
const PRESENT_VALUE = 82, ROI = 83, ANNUAL_RETURN = 84;
// 58 (taxAdd) is not referenced here: it backs the taxAdd() function-call
// form via the builtin-name registry, not a phrase in this package.
const TAX_REMOVE = 59, TAX_IN = 85, TAX_ON = 86;
// Bill split: `split $180 between 4` / `$120 + 18% split 3 ways`.
const SPLIT_EACH = 98;
// 60 = inflationAdjust(amount, fromYear, toYear). See InflationQueryParselet.ts
// and VMBuiltins.ts. The other three inflation calculations (present-year
// forms + the flat-rate future-value projection) are collision-safe
// pluginFunctions instead. See InflationPluginFunctions.ts.

/**
 * Money & finance phrase grammar: compound interest / investment growth,
 * mortgage/loan repayment (standard amortization formula), sales tax/VAT
 * add-and-remove, and CPI-based inflation-adjusted value. SoulverCore-
 * inspired syntax where it could be confirmed (see each parselet's doc
 * comment for exact worked examples and any deliberate deviations);
 * function-call forms (`compoundInterest(...)`, `monthlyPayment(...)`,
 * `taxAdd(...)`, `inflationAdjust(...)`, ...) are registered separately,
 * in FUNCTION_PACKAGE's shared FUNC dispatch (see
 * `packages/function/parselets/FunctionCallParselet.ts`'s
 * `builtinNameToIndex` map) rather than here.
 *
 * TRIGGER-WORD COLLISION DESIGN NOTE (same regression class documented in
 * MathPhrasesPackage.ts, and explicitly called out for this package
 * up-front): "interest", "tax", "principal", "payment", "rate", "balance",
 * "what", "worth", "value" are all common, plausible variable names, a
 * shipped playground example already uses `:tax` (`:total = :subtotal +
 * :tax`, see MathPhrasesPackage.ts's doc comment). None of those words are
 * bare keywords anywhere in this package. Every trigger is either:
 *  - a full phrase fused via `phrases` below ("interest on", "tax on",
 *    "monthly repayment on", "what is", "what was", "value of", "worth
 *    in", ...), so the leading word alone never becomes its own token
 *    type and stays usable as `:interest`/`:tax`/`:what`/`:value`/etc., or
 *  - a genuine preposition ("over", "at") with near-zero plausibility as a
 *    variable name, the same accepted-risk category as this codebase's
 *    existing bare "between"/"from"/"next"/"last"/"best" keywords (see
 *    Token.ts's OVER/RATE_AT doc comment).
 *
 * "split", "ways" and "people" (the bill-split grammar) are likewise ordinary
 * words and never bare keywords: BillSplitNormalizerRule claims them
 * contextually, retyping to SPLIT/WAYS/PEOPLE only inside the full split shape,
 * so `:split`, a variable named `split`, and prose are untouched. "between"
 * reuses the pre-existing bare BETWEEN token (the accepted-risk category above).
 *
 * Inflation-adjusted value (extends this package, see
 * `parselets/InflationQueryParselet.ts`/`InflationFutureValueParselet.ts`/
 * `InYearDollarsParselet.ts` and `data/CpiTable.ts` for the bundled,
 * clearly-labeled-approximate CPI-U table and its doc comment on
 * vintage/accuracy) was the one topic explicitly deferred from this
 * package's original scope, now implemented.
 */
export const FINANCE_PACKAGE: IEnginePackage = {
  name: "solve-finance",
  phrases: {
    "compound interest on": "COMPOUND_INTEREST_ON",
    "interest on": "INTEREST_ON",
    "daily repayment on": "DAILY_REPAYMENT_ON",
    "monthly repayment on": "MONTHLY_REPAYMENT_ON",
    "annual repayment on": "ANNUAL_REPAYMENT_ON",
    "total repayment on": "TOTAL_REPAYMENT_ON",
    "daily interest on": "DAILY_LOAN_INTEREST_ON",
    "monthly interest on": "MONTHLY_LOAN_INTEREST_ON",
    "annual interest on": "ANNUAL_LOAN_INTEREST_ON",
    "total interest on": "TOTAL_LOAN_INTEREST_ON",
    "tax on": "TAX_ON",
    "tax off": "TAX_OFF",
    // The tax already inside a gross amount. Soulver documents "VAT in",
    // "VAT of" and "VAT from" as three spellings of one thing.
    "tax in": "TAX_IN_PHRASE",
    "tax of": "TAX_IN_PHRASE",
    "tax from": "TAX_IN_PHRASE",
    "vat in": "TAX_IN_PHRASE",
    "vat of": "TAX_IN_PHRASE",
    "vat from": "TAX_IN_PHRASE",
    "vat on": "TAX_ON",
    "vat off": "TAX_OFF",
    "what is": "WHAT_IS",
    "what was": "WHAT_WAS",
    "present value of": "PRESENT_VALUE_OF",
    "annual return on": "ANNUAL_RETURN_ON",
    "value of": "VALUE_OF",
    "worth in": "WORTH_IN",
    "assuming": "ASSUMING",
  },
  prefixParselets: [
    { tokenType: "PRESENT_VALUE_OF", parselet: new PresentValueParselet(PRESENT_VALUE) },
    { tokenType: "ANNUAL_RETURN_ON", parselet: new AnnualReturnParselet(ANNUAL_RETURN) },
    { tokenType: "COMPOUND_INTEREST_ON", parselet: new CompoundInterestParselet(COMPOUND_FV, COMPOUND_FV_EVERY) },
    { tokenType: "INTEREST_ON", parselet: new CompoundInterestParselet(COMPOUND_INTEREST, COMPOUND_INTEREST_EVERY) },

    { tokenType: "DAILY_REPAYMENT_ON", parselet: new LoanRepaymentParselet(LOAN_REPAYMENT, 365) },
    { tokenType: "MONTHLY_REPAYMENT_ON", parselet: new LoanRepaymentParselet(LOAN_REPAYMENT, 12) },
    { tokenType: "ANNUAL_REPAYMENT_ON", parselet: new LoanRepaymentParselet(LOAN_REPAYMENT, 1) },
    { tokenType: "TOTAL_REPAYMENT_ON", parselet: new LoanRepaymentParselet(LOAN_REPAYMENT, 0) },

    { tokenType: "DAILY_LOAN_INTEREST_ON", parselet: new LoanRepaymentParselet(LOAN_INTEREST, 365) },
    { tokenType: "MONTHLY_LOAN_INTEREST_ON", parselet: new LoanRepaymentParselet(LOAN_INTEREST, 12) },
    { tokenType: "ANNUAL_LOAN_INTEREST_ON", parselet: new LoanRepaymentParselet(LOAN_INTEREST, 1) },
    { tokenType: "TOTAL_LOAN_INTEREST_ON", parselet: new LoanRepaymentParselet(LOAN_INTEREST, 0) },

    { tokenType: "TAX_ON", parselet: new SalesTaxParselet(TAX_ON) },
    { tokenType: "TAX_OFF", parselet: new SalesTaxParselet(TAX_REMOVE) },
    { tokenType: "TAX_IN_PHRASE", parselet: new SalesTaxParselet(TAX_IN) },

    { tokenType: "SPLIT", parselet: new SplitBetweenParselet(SPLIT_EACH) },

    { tokenType: "WHAT_IS", parselet: new InflationQueryParselet("what-is") },
    { tokenType: "WHAT_WAS", parselet: new InflationQueryParselet("what-was") },
    { tokenType: "VALUE_OF", parselet: new InflationFutureValueParselet() },
  ],
  infixParselets: [
    // The documented bare forms: "$1,000 after 3 years at 7%" and the "for
    // ... compounding monthly" variant. Both pivot words behave identically;
    // Soulver uses "after" for the annual form and "for" with an interval.
    { tokenType: "AFTER", parselet: new InvestmentGrowthParselet(COMPOUND_FV, COMPOUND_FV_EVERY) },
    { tokenType: "FOR_DURATION", parselet: new InvestmentGrowthParselet(COMPOUND_FV, COMPOUND_FV_EVERY) },
    { tokenType: "INVESTED", parselet: new ReturnOnInvestmentParselet(ROI) },
    { tokenType: "IN_YEAR_DOLLARS", parselet: new InYearDollarsParselet() },
    // The amount-first split spelling, `<amount> split N ways`. Infix so the
    // amount (which may be `$120 + 18%`) is the left operand. See
    // BillSplitParselets.ts.
    { tokenType: "SPLIT_WAYS", parselet: new SplitWaysParselet(SPLIT_EACH) },
  ],
  normalizerRules: [
    inYearDollarsNormalizerRule(),
    // `450 monthly for 18 months` -> `450 * 18`. A recurring schedule totalled
    // as a plain multiplication, so a currency amount stays currency and an
    // exact one stays exact. See RecurringScheduleNormalizerRule.ts.
    recurringScheduleNormalizerRule(),
    // `split $180 between 4` / `$120 + 18% split 3 ways`. Retypes split/ways/
    // people contextually so those words stay ordinary names everywhere else.
    // See BillSplitNormalizerRule.ts.
    billSplitNormalizerRule(),
  ],
  pluginFunctions: [
    { index: INFLATION_FROM_YEAR_TO_PRESENT_IDX, handler: inflationFromYearToPresentHandler },
    { index: INFLATION_TO_YEAR_FROM_PRESENT_IDX, handler: inflationToYearFromPresentHandler },
    { index: INFLATION_FUTURE_VALUE_IDX, handler: inflationFutureValueHandler },
  ],
};
