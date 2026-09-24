/**
 * Cash-flow appraisal (#519): `npv of <flows> at <rate>`, `irr of <flows>` and
 * `payback of <flows>`, through the engine and, for the shapes the grammar
 * cannot produce, through the plugin functions directly.
 *
 * Reference values are computed independently of the engine, never read back
 * from it:
 *  - NPV and payback: exact rational arithmetic in Python (`fractions.Fraction`),
 *    summing `flow / (1 + r)^t` with the first flow at t = 0.
 *  - IRR: sympy's exact real-root isolation (`Poly(p, x).real_roots()`) on the
 *    polynomial `sum(flow_t * x^t)`, every positive root x mapped to
 *    `r = 1/x - 1`, printed to 15 significant figures.
 *  - The Microsoft figures are the worked examples on Microsoft's own NPV and
 *    IRR function pages (Excel), and agree with the Python results above:
 *    NPV example 2 (1,922.06 and -3,749.47, the outlay added outside `NPV()`,
 *    which is this engine's convention) and the IRR example (8.66%, -2.12%,
 *    -44.35%).
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType, numberValue, percentageValue, uomValue, stringValue, type Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { CASH_FLOW_PLUGIN_FUNCTIONS } from "@solve-js/packages/finance/parselets/CashFlowPluginFunctions";
import {
	decimalOfNumber, internalRateOfReturn, netPresentValue, paybackPeriod,
} from "@solve-js/packages/finance/CashFlowMath";
import { decimalToString } from "@solve-js/decimal";

const value = (source: string): Value => newTrackedEngine().evaluateExpression(source);
const num = (source: string): number => value(source).toNumber();
const shown = (source: string): string => formatValue(value(source)).replace(/^=\s*/, "");

/** The error code a line answers with, asserting it is a structured Error and not a throw. */
function code(source: string): string {
	const v = value(source);
	expect(v.type).toBe(ValueType.Error);
	return String(v.errorCode);
}

/** The message a refused line carries. */
const message = (source: string): string => String(value(source).unit);

describe("npv of <flows> at <rate>", () => {
	test("the issue's example: the first flow is today, so -21.04", () => {
		// Fraction: -1000 + 300/1.1 + 400/1.1^2 + 500/1.1^3 = -21.036814425244177...
		expect(num("npv of -1000, 300, 400, 500 at 10%")).toBeCloseTo(-21.036814425244177, 12);
		expect(shown("npv of -1000, 300, 400, 500 at 10%")).toBe("-21.04");
	});

	test("a spreadsheet's NPV() is one period's discount away, -19.12", () => {
		// NPV(10%, -1000, 300, 400, 500) discounts the first flow as well; this
		// engine's answer divided by 1.1 is that figure (Fraction: -19.124376750221980).
		expect(num("npv of -1000, 300, 400, 500 at 10%") / 1.1).toBeCloseTo(-19.12437675022198, 10);
	});

	test("Microsoft's NPV example 2, the outlay added outside NPV()", () => {
		expect(num("npv of -40000, 8000, 9200, 10000, 12000, 14500 at 8%")).toBeCloseTo(1922.0615549323722, 9);
		expect(num("npv of -40000, 8000, 9200, 10000, 12000, 14500, -9000 at 8%")).toBeCloseTo(-3749.465087015571, 9);
	});

	test("a series that breaks even exactly is exactly zero, not a float residue", () => {
		// 110 / 1.1 is exactly 100 in decimals; as doubles it is 100.00000000000001.
		expect(num("npv of -100, 110 at 10%")).toBe(0);
		expect(shown("npv of -100, 110 at 10%")).toBe("0");
	});

	test("at 0% the NPV is the plain sum, and a negative rate is allowed above -100%", () => {
		expect(num("npv of -1000, 300, 400, 500 at 0%")).toBe(200);
		// At -50% each later flow doubles per period: -1000 + 600 + 1600 + 4000.
		expect(num("npv of -1000, 300, 400, 500 at -50%")).toBe(5200);
	});

	test("decimal flows are read as the decimals written", () => {
		// Fraction on -1000.50, 300.25, 400, 500.10 at 5%: 80.269355361192095886...
		expect(num("npv of -1000.50, 300.25, 400, 500.10 at 5%")).toBeCloseTo(80.2693553611921, 10);
	});

	test("money keeps its currency, with an exact sidecar", () => {
		const v = value("npv of -$1,000, $300, $400, $500 at 10%");
		expect(v.type).toBe(ValueType.Uom);
		expect(v.unit).toBe("USD");
		expect(v.exact).toBeDefined();
		expect(shown("npv of -$1,000, $300, $400, $500 at 10%")).toBe("$-21.04");
		expect(value("npv of -£5,000, £1,500, £2,000, £2,500 at 8%").unit).toBe("GBP");
	});

	test("a plain number among amounts of money is read in that currency", () => {
		const v = value("npv of -$1,000, 300, 400, 500 at 10%");
		expect(v.unit).toBe("USD");
		expect(v.toNumber()).toBeCloseTo(-21.036814425244177, 12);
	});

	test("the spellings: net present value of, a closing and, @ for at", () => {
		const expected = -21.036814425244177;
		expect(num("net present value of -1000, 300, 400, 500 at 10%")).toBeCloseTo(expected, 12);
		expect(num("NPV of -1000, 300, 400, 500 at 10%")).toBeCloseTo(expected, 12);
		expect(num("npv of -1000, 300, 400 and 500 at 10%")).toBeCloseTo(expected, 12);
		expect(num("npv of -1000, 300, 400, 500 @ 10%")).toBeCloseTo(expected, 12);
	});

	test("a bare-number rate is a proportion, as elsewhere in the finance package", () => {
		expect(num("npv of -1000, 300, 400, 500 at 0.1")).toBeCloseTo(-21.036814425244177, 12);
	});

	test("a bracketed list, or a variable holding one, is the same series", () => {
		expect(num("npv of [-1000, 300, 400, 500] at 10%")).toBeCloseTo(-21.036814425244177, 12);
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "flows = [-1000, 300, 400, 500]");
		expect(engine.evaluateLine(2, "npv of flows at 10%").toNumber()).toBeCloseTo(-21.036814425244177, 12);
	});

	test("the answer takes part in arithmetic when bracketed", () => {
		expect(num("(npv of -1000, 300, 400, 500 at 10%) * 2")).toBeCloseTo(-42.07362885048835, 10);
	});
});

describe("npv refusals: a named Error, never a throw or a wrong number", () => {
	test("a rate at or below -100%", () => {
		expect(code("npv of -1000, 300 at -100%")).toBe("INVALID_RATE");
		expect(code("npv of -1000, 300 at -150%")).toBe("INVALID_RATE");
		expect(message("npv of -1000, 300 at -150%")).toMatch(/above -100%/);
	});

	test("a rate that is not a percentage or a number", () => {
		expect(code("npv of -1000, 300 at 10 km")).toBe("INVALID_RATE");
		expect(code('npv of -1000, 300 at "x"')).toBe("INVALID_RATE");
		expect(code("npv of -1000, 300 at 1/0")).toBe("INVALID_RATE");
	});

	test("fewer than two flows", () => {
		expect(code("npv of -1000 at 10%")).toBe("CASH_FLOW_TOO_FEW");
		expect(code("npv of [-1000] at 10%")).toBe("CASH_FLOW_TOO_FEW");
	});

	test("a flow that is not an amount of money or a plain number", () => {
		expect(code("npv of -1000, 5 km at 10%")).toBe("CASH_FLOW_EXPECTED_AMOUNT");
		expect(code("npv of -1000, 10% at 10%")).toBe("CASH_FLOW_EXPECTED_AMOUNT");
		expect(code("npv of true, 3 at 10%")).toBe("CASH_FLOW_EXPECTED_AMOUNT");
		expect(code("npv of -1000, 1/0 at 10%")).toBe("CASH_FLOW_EXPECTED_AMOUNT");
	});

	test("a list mixed with loose flows, or a list that is not a vector", () => {
		expect(code("npv of [-1000, 300], 400 at 10%")).toBe("CASH_FLOW_EXPECTED_AMOUNT");
		expect(code("npv of [1, 2; 3, 4] at 10%")).toBe("CASH_FLOW_EXPECTED_AMOUNT");
	});

	test("no rate at all is a parse error that names the missing clause", () => {
		expect(() => value("npv of -1000, 300, 400, 500")).toThrow(/needs a discount rate/);
	});

	test("two currencies are refused, not converted at today's rate", () => {
		// Through the handler: the engine line holds two currencies beside
		// arithmetic, so its currency preflight asks for a rate first (Pending)
		// and reaches this same refusal once the rate lands.
		const v = CASH_FLOW_PLUGIN_FUNCTIONS.cashFlowNpv([uomValue(-1000, "USD"), uomValue(300, "GBP"), percentageValue(0.1)]);
		expect(v.errorCode).toBe("INCOMPATIBLE_UNITS");
		expect(String(v.unit)).toMatch(/USD and GBP/);
	});

	test("the handler checks its own argument count", () => {
		expect(CASH_FLOW_PLUGIN_FUNCTIONS.cashFlowNpv([]).errorCode).toBe("CASH_FLOW_ARGUMENT_COUNT");
		expect(CASH_FLOW_PLUGIN_FUNCTIONS.cashFlowNpv([percentageValue(0.1)]).errorCode).toBe("CASH_FLOW_ARGUMENT_COUNT");
		expect(CASH_FLOW_PLUGIN_FUNCTIONS.cashFlowIrr([]).errorCode).toBe("CASH_FLOW_ARGUMENT_COUNT");
		expect(CASH_FLOW_PLUGIN_FUNCTIONS.cashFlowPayback([stringValue("x"), numberValue(1)]).errorCode).toBe("CASH_FLOW_EXPECTED_AMOUNT");
	});

	test("a present value beyond the range of a number is refused, not Infinity", () => {
		// At -99.9999999% every period multiplies a flow by a billion.
		const list = `[-1, ${Array(60).fill("1").join(", ")}]`;
		expect(code(`npv of ${list} at -99.9999999%`)).toBe("CASH_FLOW_OUT_OF_RANGE");
	});
});

describe("irr of <flows>", () => {
	test("the issue's example is 8.90%", () => {
		// sympy: 0.0889633946933499
		expect(num("irr of -1000, 300, 400, 500")).toBeCloseTo(0.0889633946933499, 13);
		expect(value("irr of -1000, 300, 400, 500").type).toBe(ValueType.Percentage);
		expect(shown("irr of -1000, 300, 400, 500")).toBe("8.90%");
	});

	test("Microsoft's IRR example: 8.66%, -2.12% and -44.35%", () => {
		// sympy: 0.0866309480365316, -0.0212448482734110, -0.443506941334741
		expect(num("irr of -70000, 12000, 15000, 18000, 21000, 26000")).toBeCloseTo(0.0866309480365316, 13);
		expect(num("irr of -70000, 12000, 15000, 18000, 21000")).toBeCloseTo(-0.021244848273411, 13);
		expect(num("irr of -70000, 12000, 15000")).toBeCloseTo(-0.443506941334741, 13);
	});

	test("the NPV at the IRR is zero, to the precision of the rate", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "rate = irr of -1000, 300, 400, 500");
		expect(Math.abs(engine.evaluateLine(2, "npv of -1000, 300, 400, 500 at rate").toNumber())).toBeLessThan(1e-9);
	});

	test("a rate that is a dyadic point of the search is found exactly", () => {
		expect(num("irr of -100, 200")).toBe(1);
		expect(num("irr of -100, 50")).toBe(-0.5);
	});

	test("flows summing to zero have an IRR of exactly 0%, even as a double root", () => {
		// -1 + 2x - x^2 = -(x - 1)^2: NPV touches zero at 0% and is negative elsewhere.
		expect(num("irr of -1, 2, -1")).toBe(0);
	});

	test("more than one sign change can still have a single rate", () => {
		// sympy: one positive root each.
		expect(num("irr of -1000, 500, 500, -200, 600")).toBeCloseTo(0.163230331424357, 13);
		expect(num("irr of -100, 50, -10, 80")).toBeCloseTo(0.0861073244724228, 13);
		expect(num("irr of -10000, 4000, 4000, -3000, 6000, 5000")).toBeCloseTo(0.16791721985222, 12);
	});

	test("leading and trailing zeros, and an inflow first, do not move the rate", () => {
		for (const source of ["irr of 0, -100, 110", "irr of -100, 110, 0, 0", "irr of 100, -110", "irr of -1000, 0, 0, 1331"]) {
			expect(num(source)).toBeCloseTo(0.1, 14);
		}
	});

	test("rates far from zero, either side", () => {
		// sympy: 9999 and -0.999
		expect(num("irr of -100, 1000000")).toBeCloseTo(9999, 8);
		expect(num("irr of -1000, 1")).toBeCloseTo(-0.999, 14);
	});

	test("a long monthly series answers, and quickly", () => {
		// sympy: 0.00729944579528437 for -100,000 then 180 payments of 1,000 (the
		// engine's line length and stack depth bound how long a written list can be).
		const list = `[-100000, ${Array(180).fill("1000").join(", ")}]`;
		const started = performance.now();
		expect(num(`irr of ${list}`)).toBeCloseTo(0.00729944579528437, 13);
		expect(performance.now() - started).toBeLessThan(2000);
		// sympy: 0.00968924582258193 for 360 payments, through the maths directly.
		const outcome = internalRateOfReturn([-100000, ...Array(360).fill(1000)].map(decimalOfNumber));
		expect(outcome.kind === "rate" && outcome.rate).toBeCloseTo(0.00968924582258193, 13);
	});

	test("money flows give a plain percentage", () => {
		expect(shown("irr of -$1,000, $300, $400, $500")).toBe("8.90%");
	});

	test("a variable holding the list", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "flows = [-1000, 300, 400, 500]");
		expect(engine.evaluateLine(2, "irr of flows").toNumber()).toBeCloseTo(0.0889633946933499, 13);
	});
});

describe("irr refusals", () => {
	test("flows that never change sign have no IRR", () => {
		expect(code("irr of 100, 200")).toBe("IRR_NO_SIGN_CHANGE");
		expect(code("irr of -100, -200")).toBe("IRR_NO_SIGN_CHANGE");
		expect(code("irr of 0, 0")).toBe("IRR_NO_SIGN_CHANGE");
	});

	test("two rates are both named and neither is given", () => {
		// The textbook case: sympy finds exactly 0.1 and 0.2.
		expect(code("irr of -100, 230, -132")).toBe("IRR_NOT_UNIQUE");
		expect(message("irr of -100, 230, -132")).toMatch(/2 internal rates of return, 10\.00% and 20\.00%/);
	});

	test("four rates are all named", () => {
		// sympy: -0.912783613297923, -0.394720863781569, -0.139346322279295, 0.111892031400618
		expect(message("irr of -1000.37, 2600.11, -2200.93, 610.5, 0.01, -3.33")).toMatch(
			/4 internal rates of return, -91\.28%, -39\.47%, -13\.93% and 11\.19%/,
		);
	});

	test("a sign change with no rate that reaches zero", () => {
		// -100 + 250x - 200x^2 has a negative discriminant: no real root at all.
		expect(code("irr of -100, 250, -200")).toBe("IRR_NONE");
	});

	test("a double root away from a search point cannot be separated", () => {
		// (x - 0.9)^2 (x - 0.5): the two rates at 11.11% coincide.
		expect(code("irr of -0.405, 1.71, -2.3, 1")).toBe("IRR_UNRESOLVED");
	});

	test("one flow is too few", () => {
		expect(code("irr of -1000")).toBe("CASH_FLOW_TOO_FEW");
	});
});

describe("payback of <flows>", () => {
	test("the running total recovers part-way through a period: 2.6", () => {
		// 700 short, then 300 short, and the third period's 500 covers 300 of it.
		expect(num("payback of -1000, 300, 400, 500")).toBeCloseTo(2.6, 14);
		expect(shown("payback of -1000, 300, 400, 500")).toBe("2.60");
		expect(num("payback period of -1000, 300, 400, 500")).toBeCloseTo(2.6, 14);
	});

	test("recovering exactly at a period end is a whole number", () => {
		expect(num("payback of -1000, 500, 500")).toBe(2);
	});

	test("a later outlay pays back the last time the total recovers", () => {
		// Totals -1000, 200, -300, 300: back after one period, short again, back at 2.5.
		expect(num("payback of -1000, 1200, -500, 600")).toBeCloseTo(2.5, 14);
	});

	test("a delayed outlay is measured from the start", () => {
		expect(num("payback of 0, -1000, 600, 600")).toBeCloseTo(2 + 400 / 600, 14);
	});

	test("money and lists give the same count of periods", () => {
		expect(num("payback of -$1,000, $300, $400, $500")).toBeCloseTo(2.6, 14);
		expect(num("payback of [-1000, 300, 400, 500]")).toBeCloseTo(2.6, 14);
	});

	test("never paying back is refused, with the shortfall", () => {
		expect(code("payback of -1000, 1200, -500, 100")).toBe("PAYBACK_NEVER");
		expect(message("payback of -1000, 1200, -500, 100")).toMatch(/200 short/);
		expect(message("payback of -$1000, $100, $100")).toMatch(/800\.00 USD short/);
	});

	test("nothing to pay back is refused", () => {
		expect(code("payback of 100, 200")).toBe("PAYBACK_NO_OUTLAY");
	});

	test("two currencies are refused", () => {
		expect(code("payback of -$1000, £1300")).toBe("INCOMPATIBLE_UNITS");
		expect(code("irr of -$1000, £1300")).toBe("INCOMPATIBLE_UNITS");
	});
});

describe("the trigger words stay ordinary names", () => {
	test("npv, irr and payback are variables outside the phrases", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "npv = 5");
		engine.evaluateLine(2, "irr = 3");
		engine.evaluateLine(3, "payback = 4");
		expect(engine.evaluateLine(4, "npv + irr + payback").toNumber()).toBe(12);
	});
});

describe("CashFlowMath, the exact helpers", () => {
	test("decimalOfNumber reads the shortest decimal, scientific notation included", () => {
		expect(decimalToString(decimalOfNumber(0.1))).toBe("0.1");
		expect(decimalToString(decimalOfNumber(-1.5e-7))).toBe("-0.00000015");
		expect(decimalToString(decimalOfNumber(1.5e21))).toBe("1500000000000000000000");
		expect(decimalToString(decimalOfNumber(-300))).toBe("-300");
	});

	test("netPresentValue is exact where the decimals terminate", () => {
		const total = netPresentValue([-100, 110].map(decimalOfNumber), decimalOfNumber(0.1));
		expect(total).not.toBeNull();
		expect(total!.coef).toBe(0n);
	});

	test("a huge rate leaves only the first flow", () => {
		const total = netPresentValue([-1, 1].map(decimalOfNumber), decimalOfNumber(1e300));
		expect(decimalToString(total!)).toMatch(/^-1\.0+$/);
	});

	test("the outcomes carry their kind", () => {
		expect(internalRateOfReturn([5, 5].map(decimalOfNumber)).kind).toBe("noSignChange");
		expect(paybackPeriod([5, 5].map(decimalOfNumber)).kind).toBe("noOutlay");
		const never = paybackPeriod([-5, 1].map(decimalOfNumber));
		expect(never.kind === "never" && decimalToString(never.shortfall)).toBe("4");
	});
});
