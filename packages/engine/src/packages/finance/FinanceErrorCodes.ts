/**
 * The codes the finance package answers with: cash flows (`npv`, `irr`, `payback`), inflation and compounding. A bill split and a recurring schedule have their own, in `RecurringScheduleErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const FinanceErrorCodes = {
	/** A cash-flow form given no flows, or `npv` given flows with no rate. */
	CASH_FLOW_ARGUMENT_COUNT: "CASH_FLOW_ARGUMENT_COUNT",
	/** A cash flow that is not a finite amount of money or a plain number, or flows given both one by one and as a list. */
	CASH_FLOW_EXPECTED_AMOUNT: "CASH_FLOW_EXPECTED_AMOUNT",
	/** `npv of ...` with no `at <rate>` after the flows. */
	CASH_FLOW_MISSING_RATE: "CASH_FLOW_MISSING_RATE",
	/** A cash-flow form given fewer than two flows: an outlay and a return are the least it reads. */
	CASH_FLOW_TOO_FEW: "CASH_FLOW_TOO_FEW",
	/** A net present value beyond the range of a number at the rate given. */
	CASH_FLOW_OUT_OF_RANGE: "CASH_FLOW_OUT_OF_RANGE",
	/** `irr` of flows that never change sign (all money out, or all in), so no rate makes their value zero. */
	IRR_NO_SIGN_CHANGE: "IRR_NO_SIGN_CHANGE",
	/** `irr` of flows no rate above -100% brings to zero. */
	IRR_NONE: "IRR_NONE",
	/** `irr` of flows with several internal rates of return. The message lists them rather than choosing one. */
	IRR_NOT_UNIQUE: "IRR_NOT_UNIQUE",
	/** `irr` of flows whose rates are too close together to tell apart. */
	IRR_UNRESOLVED: "IRR_UNRESOLVED",
	/** `payback` of flows whose running total is never below zero, so there is nothing to pay back. */
	PAYBACK_NO_OUTLAY: "PAYBACK_NO_OUTLAY",
	/** `payback` of flows that never recover the outlay. The message says how far short the total ends. */
	PAYBACK_NEVER: "PAYBACK_NEVER",
	/** `<amount> in <year> dollars` of an amount in another currency that has its own index: the phrase asks for dollars. */
	INFLATION_EXPECTED_USD: "INFLATION_EXPECTED_USD",
	/** `<amount> in <year> pounds` or `in <year> euros` of an amount in another currency that has its own index: the phrase asks for that currency. */
	INFLATION_EXPECTED_CURRENCY: "INFLATION_EXPECTED_CURRENCY",
	/** An inflation adjustment of an amount no bundled price index measures: a currency without one, a quantity that is not money, or a bare number. */
	INFLATION_NO_INDEX: "INFLATION_NO_INDEX",
	/** `what is <amount>` followed by neither `from <year>` nor `in <year> worth in <year>`, as in `what is $300 and $50 from 2003`. */
	INFLATION_EXPECTED_FROM_OR_IN: "INFLATION_EXPECTED_FROM_OR_IN",
	/** The year of an inflation question that is not a plain whole number: money, a quantity, a date or a fraction, as in `what is $100 from 1990.5`. */
	INFLATION_EXPECTED_YEAR: "INFLATION_EXPECTED_YEAR",
	/** `assuming <rate>%` not followed by the word `inflation`. */
	INFLATION_EXPECTED_INFLATION_WORD: "INFLATION_EXPECTED_INFLATION_WORD",
	/** `how much per month to reach <target>` followed by neither `in` nor `over` and the time the saving runs for. */
	SAVINGS_GOAL_SYNTAX: "SAVINGS_GOAL_SYNTAX",
	/** `compounding <interval>` naming an interval the package does not know. The message lists the ones it does. */
	UNKNOWN_COMPOUNDING_INTERVAL: "UNKNOWN_COMPOUNDING_INTERVAL",
} as const;
