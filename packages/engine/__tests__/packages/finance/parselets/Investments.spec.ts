/**
 * Soulver's documented investment grammar.
 *
 * `packages/finance` had the compound-interest maths but only behind its own
 * `compound interest on X over Y years at Z%` phrasing, which is not what
 * Soulver documents and not what anyone reading that page types.
 * `CompoundInterestParselet`'s doc comment recorded the substitution honestly;
 * this closes it. Every expected value below is the figure Soulver's own
 * documentation states for that expression.
 *
 * https://documentation.soulver.app/syntax-reference/money-and-finance/investments
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("compound interest, the documented spellings", () => {
	test("`$1,000 after 3 years at 7%` is $1,225.04", () => {
		expect(num("$1,000 after 3 years at 7%")).toBeCloseTo(1225.043, 2);
	});

	test("the amount keeps its currency", () => {
		expect(evaluate("$1,000 after 3 years at 7%").type).toBe(ValueType.Uom);
	});

	test("`for` is accepted as well as `after`", () => {
		expect(num("$1,000 for 3 years at 7%")).toBeCloseTo(1225.043, 2);
	});

	test("the original `over` spelling still parses", () => {
		expect(num("compound interest on $1,000 over 3 years at 7%")).toBeCloseTo(1225.043, 2);
	});
});

describe("compounding intervals", () => {
	test("monthly is $1,232.93", () => {
		expect(num("$1,000 for 3 years at 7% compounding monthly")).toBeCloseTo(1232.926, 2);
	});

	test("quarterly is $1,231.44", () => {
		expect(num("$1,000 for 3 years at 7% compounding quarterly")).toBeCloseTo(1231.439, 2);
	});

	test("daily compounds more than monthly, which compounds more than annually", () => {
		const annual = num("$1,000 for 3 years at 7%");
		const monthly = num("$1,000 for 3 years at 7% compounding monthly");
		const daily = num("$1,000 for 3 years at 7% compounding daily");
		expect(monthly).toBeGreaterThan(annual);
		expect(daily).toBeGreaterThan(monthly);
	});

	test("an unknown interval names the ones that work", () => {
		expect(() => evaluate("$1,000 for 3 years at 7% compounding hourly")).toThrow(
			/expected one of .*monthly/i,
		);
	});
});

describe("interest earned rather than the final balance", () => {
	test("`interest on $1,000 after 3 years at 7%` is $225.04", () => {
		expect(num("interest on $1,000 after 3 years at 7%")).toBeCloseTo(225.043, 2);
	});

	test("`interest on $1,000 for 3 years at 7% compounding monthly` is $232.93", () => {
		expect(num("interest on $1,000 for 3 years at 7% compounding monthly")).toBeCloseTo(232.926, 2);
	});

	test("and it is the balance minus the principal", () => {
		const balance = num("$1,000 after 3 years at 7%");
		const interest = num("interest on $1,000 after 3 years at 7%");
		expect(balance - interest).toBeCloseTo(1000, 6);
	});
});

describe("present value", () => {
	test("`present value of $1,000 after 20 years at 10%` is $148.64", () => {
		expect(num("present value of $1,000 after 20 years at 10%")).toBeCloseTo(148.644, 2);
	});

	test("it inverts compound growth exactly", () => {
		const grown = num("$500 after 10 years at 6%");
		expect(num(`present value of $${grown.toFixed(6)} after 10 years at 6%`)).toBeCloseTo(500, 4);
	});
});

describe("return on investment", () => {
	test("`$500 invested $1,500 returned` is 2x", () => {
		// The profit against the cost, not the money multiple. Tripling your
		// money is a 2x return; `$1,500 / $500` is the 3x figure.
		expect(num("$500 invested $1,500 returned")).toBeCloseTo(2, 10);
	});

	test("breaking even is a zero return", () => {
		expect(num("$500 invested $500 returned")).toBeCloseTo(0, 10);
	});

	test("a loss is negative", () => {
		expect(num("$500 invested $250 returned")).toBeCloseTo(-0.5, 10);
	});
});

describe("annualised return", () => {
	test("`annual return on $1,000 invested $2,500 returned after 7 years` is 13.99%", () => {
		expect(num("annual return on $1,000 invested $2,500 returned after 7 years")).toBeCloseTo(
			0.13985,
			4,
		);
	});

	test("it is a percentage, so it renders as one", () => {
		const value = evaluate("annual return on $1,000 invested $2,500 returned after 7 years");
		expect(value.type).toBe(ValueType.Percentage);
	});

	test("applying it back for the same years reproduces the return", () => {
		const rate = num("annual return on $1,000 invested $2,500 returned after 7 years");
		expect(1000 * Math.pow(1 + rate, 7)).toBeCloseTo(2500, 6);
	});

	test("a total loss has no compound rate, and says so", () => {
		// Surfaces as an error Value rather than a throw: the engine keeps
		// evaluating the rest of the document and reports this line as failed.
		const value = evaluate("annual return on $1,000 invested $0 returned after 7 years");
		expect(value.type).toBe(ValueType.Error);
	});
});
