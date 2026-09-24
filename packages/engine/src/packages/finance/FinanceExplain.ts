import type { ExplainCall, ExplainContext, ExplanationStep } from "@solve-js/explain/Explanation";
import { Value, ValueType, numberValue, uomValue } from "@solve-js/vm/Value";
import {
	amortizeLoan,
	growthFactor,
	loanDiscountFactor,
	periodicGrowthFactor,
	termInYears,
} from "@solve-js/vm/FinanceFormulas";

/**
 * Derivations for the finance forms: compound growth, present value, loan
 * repayments, return on investment and sales tax.
 *
 * Every number a step shows comes from `vm/FinanceFormulas.ts`, the module the
 * builtins themselves compute through, so a step cannot disagree with the
 * answer it leads to. The last step of each carries the call's own result.
 *
 * The phrase forms (`present value of $1,000 after 5 years at 5%`) and the
 * function-call forms (`presentValue`, `compoundInterest(...)`) reach the same
 * builtins, so both explain the same way.
 */

/** A rate as a reader writes it: 0.05 is `5%`, 0.04/12 is `0.333333%`. */
function percent(rate: number, context: ExplainContext): string {
	return `${context.formatNumber(rate * 100)}%`;
}

/** An amount in the principal's own unit, the way the builtin returns one. */
function amountLike(principal: Value, n: number): Value {
	return principal.type === ValueType.Uom && principal.unit !== undefined ? uomValue(n, principal.unit) : numberValue(n);
}

/** A term as written (`25 years`, `18 months`), or a bare number of years. */
function termText(term: Value, years: number, context: ExplainContext): string {
	if (term.type === ValueType.Uom) return context.format(term);
	return `${context.formatNumber(years)} year${years === 1 ? "" : "s"}`;
}

/** The term in years, or `null` when the builtin refused it (and so answered with an error). */
function yearsOf(term: Value | undefined): number | null {
	if (term === undefined) return null;
	const years = termInYears(term);
	return typeof years === "number" ? years : null;
}

/** `(1 + r)^years` as a step: the growth one unit sees over the term. */
function growthStep(rate: number, years: number, term: Value, context: ExplainContext): ExplanationStep {
	const { formatNumber } = context;
	const factor = growthFactor(rate, years);
	return {
		description: `${percent(rate, context)} a year for ${termText(term, years, context)}: (1 plus ${percent(rate, context)}) to the power of ${formatNumber(years)} is ${formatNumber(factor)}`,
		value: numberValue(factor),
	};
}

/** Compound growth and present value, each compounded once a year. */
function explainAnnual(call: ExplainCall, context: ExplainContext): readonly ExplanationStep[] | undefined {
	const [amount, rateValue, term] = call.args;
	const years = yearsOf(term);
	if (years === null || amount === undefined || rateValue === undefined) return undefined;
	const rate = rateValue.toNumber();
	const factor = growthFactor(rate, years);
	const shown = context.format(amount);
	const f = context.formatNumber(factor);
	const growth = growthStep(rate, years, term, context);
	switch (call.name) {
		case "compoundInterest":
			return [growth, { description: `${shown} times ${f}`, value: call.result }];
		case "interestEarned":
			return [growth, { description: `${shown} times (${f} minus 1), the growth alone`, value: call.result }];
		case "presentValue":
			return [growth, { description: `${shown} divided by ${f}`, value: call.result }];
	}
	return undefined;
}

/** Growth compounded several times a year (`compounding monthly`). */
function explainPeriodic(call: ExplainCall, context: ExplainContext): readonly ExplanationStep[] | undefined {
	const [amount, rateValue, term, perYearValue] = call.args;
	const years = yearsOf(term);
	if (years === null || amount === undefined || rateValue === undefined || perYearValue === undefined) return undefined;
	const { formatNumber } = context;
	const rate = rateValue.toNumber();
	const perYear = perYearValue.toNumber();
	const factor = periodicGrowthFactor(rate, perYear, years);
	const growth: ExplanationStep = {
		description:
			`${percent(rate, context)} a year added ${formatNumber(perYear)} times a year for ${termText(term, years, context)}: ` +
			`(1 plus ${percent(rate, context)} / ${formatNumber(perYear)}) to the power of ${formatNumber(perYear * years)} is ${formatNumber(factor)}`,
		value: numberValue(factor),
	};
	const shown = context.format(amount);
	if (call.name === "compoundInterestEvery") {
		return [growth, { description: `${shown} times ${formatNumber(factor)}`, value: call.result }];
	}
	return [growth, { description: `${shown} times (${formatNumber(factor)} minus 1), the growth alone`, value: call.result }];
}

/** How a repayment is spread over the year: per day, month, year, or the whole loan. */
const PERIOD_WORD: Record<number, string> = { 365: "days", 12: "months", 1: "years" };

/** Loan repayments and the interest within them, amortised monthly. */
function explainLoan(call: ExplainCall, context: ExplainContext): readonly ExplanationStep[] | undefined {
	const [principal, rateValue, term, periodsValue] = call.args;
	const years = yearsOf(term);
	if (years === null || principal === undefined || rateValue === undefined) return undefined;
	const { formatNumber } = context;
	const rate = rateValue.toNumber();
	const payments = years * 12;
	const monthlyRate = rate / 12;
	const { monthlyPayment, totalRepayment, totalInterest } = amortizeLoan(principal.toNumber(), rate, years);
	const shown = context.format(principal);
	// monthlyPayment() has no period argument: it is the monthly figure.
	const perYear = periodsValue === undefined ? 12 : periodsValue.toNumber();
	const repayment = call.name !== "loanInterest";

	const steps: ExplanationStep[] = [];
	let paymentDescription: string;
	if (monthlyRate === 0) {
		paymentDescription = `no interest: ${shown} divided by ${formatNumber(payments)} monthly payments`;
	} else {
		const discount = loanDiscountFactor(monthlyRate, payments);
		steps.push({
			description:
				`${percent(rate, context)} a year is ${percent(monthlyRate, context)} a month over ${formatNumber(payments)} monthly payments: ` +
				`(1 plus ${percent(monthlyRate, context)}) to the power of -${formatNumber(payments)} is ${formatNumber(discount)}`,
			value: numberValue(discount),
		});
		paymentDescription = `${shown} times ${percent(monthlyRate, context)}, divided by 1 minus ${formatNumber(discount)}`;
	}

	const payment = amountLike(principal, monthlyPayment);
	// The monthly repayment is the answer itself: end on the call's result.
	if (repayment && perYear === 12) {
		steps.push({ description: paymentDescription, value: call.result });
		return steps;
	}
	steps.push({ description: paymentDescription, value: payment });

	const whole = repayment ? totalRepayment : totalInterest;
	const wholeDescription = repayment
		? `${context.format(payment)} times ${formatNumber(payments)} payments`
		: `${context.format(payment)} times ${formatNumber(payments)} payments, less the ${shown} borrowed`;
	if (perYear === 0) {
		steps.push({ description: wholeDescription, value: call.result });
		return steps;
	}
	steps.push({ description: wholeDescription, value: amountLike(principal, whole) });
	const periods = years * perYear;
	const word = PERIOD_WORD[perYear] ?? "periods";
	steps.push({
		description: `${context.format(amountLike(principal, whole))} divided by ${formatNumber(periods)} ${word}`,
		value: call.result,
	});
	return steps;
}

/** Sales tax: the tax itself, the total with it, the amount before it, and the tax inside a total. */
function explainTax(call: ExplainCall, context: ExplainContext): readonly ExplanationStep[] | undefined {
	const [amount, rateValue] = call.args;
	if (amount === undefined || rateValue === undefined) return undefined;
	const rate = rateValue.toNumber();
	const shown = context.format(amount);
	const r = percent(rate, context);
	const onePlus = `(1 plus ${r})`;
	switch (call.name) {
		case "taxOn":
			return [{ description: `${shown} times ${r}`, value: call.result }];
		case "taxAdd":
			return [{ description: `${shown} times ${onePlus}`, value: call.result }];
		case "taxRemove":
			return [{ description: `${shown} divided by ${onePlus}`, value: call.result }];
		case "taxIn":
			return [{ description: `${shown} less ${shown} divided by ${onePlus}`, value: call.result }];
	}
	return undefined;
}

/** Return on an investment, as a multiple and as a yearly rate. */
function explainReturn(call: ExplainCall, context: ExplainContext): readonly ExplanationStep[] | undefined {
	const [invested, returned, term] = call.args;
	if (invested === undefined || returned === undefined) return undefined;
	const i = context.format(invested);
	const o = context.format(returned);
	if (call.name === "roi") {
		return [{ description: `${o} minus ${i}, divided by ${i}`, value: call.result }];
	}
	const years = yearsOf(term);
	if (years === null) return undefined;
	return [{ description: `${o} divided by ${i}, to the power of 1/${context.formatNumber(years)}, minus 1`, value: call.result }];
}

/**
 * The finance package's `explain` hook: the growth, discount or amortisation
 * behind each finance builtin, in the engine's own numbers.
 *
 * @param call - The call to describe; only this package's finance builtins are.
 * @param context - The formatting the engine hands every hook.
 * @returns The steps, or `undefined` for any other call.
 */
export function explainFinance(call: ExplainCall, context: ExplainContext): readonly ExplanationStep[] | undefined {
	if (call.kind !== "builtin") return undefined;
	// A builtin that refused its input answered with an error, which has no
	// derivation: the error message is the whole account.
	if (call.result.type === ValueType.Error) return undefined;
	switch (call.name) {
		case "compoundInterest":
		case "interestEarned":
		case "presentValue":
			return explainAnnual(call, context);
		case "compoundInterestEvery":
		case "compoundInterestEarnedEvery":
			return explainPeriodic(call, context);
		case "loanRepayment":
		case "loanInterest":
		case "monthlyPayment":
			return explainLoan(call, context);
		case "taxOn":
		case "taxAdd":
		case "taxRemove":
		case "taxIn":
			return explainTax(call, context);
		case "roi":
		case "annualisedReturn":
			return explainReturn(call, context);
	}
	return undefined;
}
