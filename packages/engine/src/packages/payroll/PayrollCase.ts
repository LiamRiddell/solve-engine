import type { Jurisdiction, StudentLoanPlan, StudentLoanTerms, TaxYearBands } from "./data/HmrcBands";
import type { PayrollCase } from "./PayrollMath";

/** A clause list that cannot be read, with the code and the message a reader sees. */
export interface PayrollCaseRefusal {
	readonly code: "PAYROLL_UNKNOWN_LOAN_PLAN" | "PAYROLL_CONFLICTING_CASE" | "PAYROLL_EXPECTED_PENSION_RATE";
	readonly message: string;
}

/** How each plan is written in a message. */
const PLAN_NAMES: Readonly<Record<StudentLoanPlan, string>> = {
	plan1: "Plan 1",
	plan2: "Plan 2",
	plan4: "Plan 4",
	plan5: "Plan 5",
	postgraduate: "the postgraduate loan",
};

/** The plans a reader can name, keyed by the payload the normaliser writes. */
function planOf(key: string): StudentLoanPlan | undefined {
	return Object.prototype.hasOwnProperty.call(PLAN_NAMES, key) ? (key as StudentLoanPlan) : undefined;
}

/** What to write instead, when a plan is missing or not one of the plans. */
const WHICH_PLAN = 'write "with plan 1 student loan" (or plan 2, plan 4 or plan 5), or "with postgraduate loan"';

/**
 * Read the case clauses a take-home line carries (the payloads
 * `PayrollCaseNormalizerRule` fused, joined by `|`) against a tax year's
 * figures.
 *
 * Each kind of clause may be written once: one place, one pension, and at most
 * one undergraduate plan beside the postgraduate loan. Two undergraduate plans
 * at once are repaid under rules that share one threshold between them, which
 * this does not model, so they are refused rather than both charged in full.
 *
 * @param text - The clause payloads, e.g. `place:scotland|loan:plan2|pension:5`.
 * @param bands - The tax year whose student loan terms apply.
 * @returns The case, or a refusal naming what to write.
 */
export function readPayrollCase(text: string, bands: TaxYearBands): PayrollCase | PayrollCaseRefusal {
	let jurisdiction: Jurisdiction | undefined;
	let pensionRate: number | undefined;
	let undergraduate: StudentLoanPlan | undefined;
	let postgraduate = false;
	const loans: StudentLoanTerms[] = [];

	for (const clause of text === "" ? [] : text.split("|")) {
		const colon = clause.indexOf(":");
		const kind = colon < 0 ? clause : clause.slice(0, colon);
		const detail = colon < 0 ? "" : clause.slice(colon + 1);

		if (kind === "place") {
			const place: Jurisdiction = detail === "scotland" ? "scotland" : "rUK";
			if (jurisdiction !== undefined) {
				return { code: "PAYROLL_CONFLICTING_CASE", message: "a take-home is worked out for one place, so write \"in\" once" };
			}
			jurisdiction = place;
		} else if (kind === "pension") {
			const percent = Number(detail);
			if (pensionRate !== undefined) {
				return { code: "PAYROLL_CONFLICTING_CASE", message: "write one pension contribution, as the total of every one taken from pay" };
			}
			if (detail === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
				return { code: "PAYROLL_EXPECTED_PENSION_RATE", message: `a pension contribution is a percentage of pay between 0 and 100, and ${detail || "nothing"} is not` };
			}
			pensionRate = percent / 100;
		} else if (kind === "loan") {
			const plan = planOf(detail);
			if (plan === undefined) {
				const written = detail === "" ? "a student loan needs its plan" : `"${detail.replace(/^plan/, "plan ")}" is not a student loan plan`;
				return { code: "PAYROLL_UNKNOWN_LOAN_PLAN", message: `${written}: ${WHICH_PLAN}` };
			}
			const terms = bands.studentLoans[plan];
			if (terms === undefined) {
				return { code: "PAYROLL_UNKNOWN_LOAN_PLAN", message: `${PLAN_NAMES[plan]} is not repaid in the ${bands.year} tax year` };
			}
			if (plan === "postgraduate") {
				if (postgraduate) return { code: "PAYROLL_CONFLICTING_CASE", message: "the postgraduate loan is named twice" };
				postgraduate = true;
			} else {
				if (undergraduate === plan) return { code: "PAYROLL_CONFLICTING_CASE", message: `${PLAN_NAMES[plan]} is named twice` };
				if (undergraduate !== undefined) {
					return {
						code: "PAYROLL_CONFLICTING_CASE",
						message: `${PLAN_NAMES[undergraduate]} and ${PLAN_NAMES[plan]} together share one threshold, which is not covered: name the plan with the lower threshold`,
					};
				}
				undergraduate = plan;
			}
			loans.push(terms);
		}
	}

	return {
		...(jurisdiction !== undefined ? { jurisdiction } : {}),
		...(pensionRate !== undefined ? { pensionRate } : {}),
		...(loans.length > 0 ? { studentLoans: loans } : {}),
	};
}

/** Whether a read case is a refusal rather than a case. */
export function isPayrollCaseRefusal(read: PayrollCase | PayrollCaseRefusal): read is PayrollCaseRefusal {
	return "code" in read;
}
