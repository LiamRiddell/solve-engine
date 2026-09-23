/**
 * The engine-facing layer over CashFlowMath.ts: read a series of cash flows and
 * a rate off the engine's values, run the appraisal, and hand back a Value.
 *
 * Every shape the maths cannot answer is refused with a structured Error that
 * names the problem, never a thrown exception and never a quiet wrong number: a
 * flow that is not an amount, fewer than two flows, two currencies, a rate at or
 * below -100%, a series with no single internal rate of return, one that never
 * pays back.
 */
import {
	Value, ValueType, numberValue, percentageValue, uomValueExact, errorValue, type MatrixData,
} from "@solve-js/vm/Value";
import { type DecimalData, decimalFromInteger, decimalToFixed, decimalToNumber, decimalToString } from "@solve-js/decimal";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { decimalOfNumber, internalRateOfReturn, netPresentValue, paybackPeriod } from "../CashFlowMath";

/** A series read off the arguments: exact amounts and the one currency they share, if any. */
interface CashFlows {
	readonly amounts: DecimalData[];
	readonly currency: string | undefined;
}

/**
 * The exact decimal a Value holds: the sidecar a money amount carries, a whole
 * number past 2^53 read from its exact rational, or otherwise the decimal the
 * number prints as.
 */
function exactOf(value: Value): DecimalData {
	if (value.exact !== undefined) return value.exact;
	if (value.rational !== undefined && value.rational.d === 1n) return decimalFromInteger(value.rational.n);
	return decimalOfNumber(value.toNumber());
}

/**
 * Read the flows, written out one by one or given as a single bracketed list.
 *
 * A list is a Matrix, which holds plain numbers, so a list of flows answers a
 * plain number; amounts written out after `of` keep their currency. A plain
 * number among amounts of money is read in that currency, the way `$1,000 + 300`
 * is. A list mixed with other flows is refused rather than flattened, since the
 * two ways of writing a series are alternatives, not parts of one.
 *
 * @param name - The form as the reader wrote it, for the messages.
 * @param args - The flow arguments, in order.
 */
function readFlows(name: string, args: readonly Value[]): CashFlows | Value {
	const usage = `${name} of -1000, 300, 400, 500`;
	if (args.length === 0) {
		return errorValue("CASH_FLOW_ARGUMENT_COUNT", `${name} needs a series of cash flows, as in ${usage}`);
	}

	if (args.length === 1 && args[0].type === ValueType.Matrix) {
		const m = args[0].value as MatrixData;
		if (m.hasSymbolic || (m.rows !== 1 && m.cols !== 1)) {
			return errorValue("CASH_FLOW_EXPECTED_AMOUNT", `${name} expects a list of numbers, one flow per period, as in [-1000, 300, 400, 500]`);
		}
		const numbers = m.data as number[];
		if (numbers.some((n) => !Number.isFinite(n))) {
			return errorValue("CASH_FLOW_EXPECTED_AMOUNT", `${name}: every cash flow must be a finite amount`);
		}
		if (numbers.length < 2) return tooFew(name, numbers.length, usage);
		return { amounts: numbers.map(decimalOfNumber), currency: undefined };
	}

	const amounts: DecimalData[] = [];
	let currency: string | undefined;
	for (const arg of args) {
		if (arg.type === ValueType.Matrix) {
			return errorValue(
				"CASH_FLOW_EXPECTED_AMOUNT",
				`${name}: give the flows one by one or as a single list, not both, as in ${usage} or ${name} of [-1000, 300, 400, 500]`,
			);
		}
		const isMoney = arg.type === ValueType.Uom && arg.unit !== undefined && sharedCurrencyExchange.isCurrency(arg.unit);
		if (arg.type !== ValueType.Number && !isMoney) {
			return errorValue(
				"CASH_FLOW_EXPECTED_AMOUNT",
				`${name}: a cash flow is an amount of money or a plain number, not ${describe(arg)}`,
			);
		}
		if (!Number.isFinite(arg.toNumber())) {
			return errorValue("CASH_FLOW_EXPECTED_AMOUNT", `${name}: every cash flow must be a finite amount`);
		}
		if (isMoney) {
			if (currency !== undefined && currency !== arg.unit) {
				return errorValue(
					"INCOMPATIBLE_UNITS",
					`${name}: the flows are in ${currency} and ${arg.unit}; convert them to one currency first`,
				);
			}
			currency = arg.unit;
		}
		amounts.push(exactOf(arg));
	}
	if (amounts.length < 2) return tooFew(name, amounts.length, usage);
	return { amounts, currency };
}

/** The refusal for a series too short to appraise. */
function tooFew(name: string, count: number, usage: string): Value {
	return errorValue(
		"CASH_FLOW_TOO_FEW",
		`${name} needs at least two cash flows, an outlay and a return, but was given ${count}, as in ${usage}`,
	);
}

/** A short name for a value that is not a cash flow, for the refusal. */
function describe(value: Value): string {
	switch (value.type) {
		case ValueType.Percentage: return "a percentage";
		case ValueType.Uom: return `an amount in ${value.unit}`;
		case ValueType.String: return "text";
		case ValueType.Boolean: return "true or false";
		default: return `a ${ValueType[value.type].toLowerCase()}`;
	}
}

/** A rate as a percentage with two decimals, for the messages. */
function percent(rate: number): string {
	return `${(rate * 100).toFixed(2)}%`;
}

/**
 * `npv of <flows> at <rate>`: the net present value, flow 0 today and
 * undiscounted. The rate is the last argument, as the parselet pushes it.
 */
function cashFlowNpv(args: Value[]): Value {
	if (args.length < 2) {
		return errorValue("CASH_FLOW_ARGUMENT_COUNT", "npv needs cash flows and a rate, as in npv of -1000, 300, 400, 500 at 10%");
	}
	const rate = args[args.length - 1];
	const flows = readFlows("npv", args.slice(0, -1));
	if (flows instanceof Value) return flows;
	if (rate.type !== ValueType.Percentage && rate.type !== ValueType.Number) {
		return errorValue("INVALID_RATE", `npv: the discount rate must be a percentage, as in at 10%, not ${describe(rate)}`);
	}
	const r = rate.toNumber();
	if (!Number.isFinite(r)) {
		return errorValue("INVALID_RATE", "npv: the discount rate must be a finite percentage");
	}
	if (r <= -1) {
		return errorValue("INVALID_RATE", `npv: a discount rate of ${percent(r)} is not usable; it must be above -100%`);
	}
	const total = netPresentValue(flows.amounts, exactOf(rate));
	if (total === null) {
		return errorValue("CASH_FLOW_OUT_OF_RANGE", `npv: at ${percent(r)} the present value of these flows is beyond the range of a number`);
	}
	const n = decimalToNumber(total);
	return flows.currency === undefined ? numberValue(n) : uomValueExact(n, flows.currency, total);
}

/** `irr of <flows>`: the internal rate of return, or why there is no single one. */
function cashFlowIrr(args: Value[]): Value {
	const flows = readFlows("irr", args);
	if (flows instanceof Value) return flows;
	const outcome = internalRateOfReturn(flows.amounts);
	switch (outcome.kind) {
		case "rate":
			return percentageValue(outcome.rate);
		case "noSignChange":
			return errorValue(
				"IRR_NO_SIGN_CHANGE",
				"irr: the flows never change sign (all money out or all money in), so no rate makes their net present value zero",
			);
		case "none":
			return errorValue("IRR_NONE", "irr: no rate above -100% makes the net present value of these flows zero, so they have no internal rate of return");
		case "several": {
			const listed = outcome.rates.map(percent);
			const joined = `${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}`;
			return errorValue(
				"IRR_NOT_UNIQUE",
				`irr: these flows have ${outcome.rates.length} internal rates of return, ${joined}, so no single rate is given`,
			);
		}
		case "unresolved":
			return errorValue(
				"IRR_UNRESOLVED",
				"irr: these flows have rates of return too close together to tell apart, so no single rate is given",
			);
	}
}

/** `payback of <flows>`: the periods until the running total recovers, or why it never does. */
function cashFlowPayback(args: Value[]): Value {
	const flows = readFlows("payback", args);
	if (flows instanceof Value) return flows;
	const outcome = paybackPeriod(flows.amounts);
	switch (outcome.kind) {
		case "period":
			return numberValue(outcome.periods);
		case "noOutlay":
			return errorValue("PAYBACK_NO_OUTLAY", "payback: the running total of the flows is never below zero, so there is no outlay to pay back");
		case "never": {
			const short = flows.currency === undefined
				? decimalToString(outcome.shortfall)
				: `${decimalToFixed(outcome.shortfall, 2)} ${flows.currency}`;
			return errorValue("PAYBACK_NEVER", `payback: the flows never pay back the outlay; the running total is still ${short} short after the last one`);
		}
	}
}

/** The cash-flow plugin functions, keyed by the names the parselets emit. */
export const CASH_FLOW_PLUGIN_FUNCTIONS: Record<string, (args: Value[]) => Value> = {
	cashFlowNpv,
	cashFlowIrr,
	cashFlowPayback,
};
