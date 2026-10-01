import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, fill, NUMERIC_EDGES } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, uomValue, errorValue, pendingValue, percentageValue, ValueType } from "@solve-js/vm/Value";
import { inflationAmountRefused } from "@solve-js/packages/finance/data/InflationAmount";
import { inflationRatio } from "@solve-js/packages/finance/data/CpiTable";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";

/**
 * Issue #650: the bundled table is the US consumer price index, and every
 * inflation form applied it to whatever amount it was given, keeping the unit:
 * `what is £100 from 1990` was £254.55, the American figure with a pound sign,
 * and `what is 100 kg from 1990` 254.55 kg. A currency other than the dollar is
 * refused with a sentence naming the index, as the payroll forms refuse
 * dollars against HMRC's bands, and so is a quantity that is not money.
 *
 * The choice for a bare number follows payroll too, which refuses a bare
 * salary: `what is 100 from 1990` would assume dollars without saying so, and
 * is refused, pointing at `$100`.
 *
 * #756 then bundled indices for the pound and the euro, so this spec now pins
 * the refusal for a currency with no index (INFLATION_NO_INDEX), and the pound
 * and euro answers live in Issue756_ukAndEuroPriceIndices.spec.ts.
 */

const PRESENT_YEAR = new Date().getFullYear();

afterEach(() => {
	currencyExchangeService.clearRates();
});

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

describe("an amount no bundled index measures is refused by every form", () => {
	// #756 bundled indices for the pound and the euro, so those amounts now read
	// their own index (see Issue756_ukAndEuroPriceIndices.spec.ts); a currency
	// with no bundled index keeps the refusal, now INFLATION_NO_INDEX.
	test.each([
		"what is ¥100 from 1990",
		"what is 100 CHF from 1990",
		"what was ¥100 worth in 1990",
		"what is ¥500 in 1990 worth in 2010",
		"inflationAdjust(¥100, 1990, 2020)",
	])("%s", (line) => {
		expect(code(line)).toBe("INFLATION_NO_INDEX");
	});

	test("pounds and euros read their own index rather than the US one (#756)", () => {
		expect(newTrackedEngine().evaluateExpression("inflationAdjust(£100, 1990, 2020)").unit).toBe("GBP");
		expect(shown("inflationAdjust(£100, 1990, 2020)")).toBe("= £232.44");
		expect(shown("inflationAdjust(€100, 2000, 2020)")).toBe("= €138.15");
	});

	test("in <year> dollars of a pound amount asks for dollars, and is refused", () => {
		expect(code("£100 in 1990 dollars")).toBe("INFLATION_EXPECTED_USD");
	});

	test("the message names the currency and the indices that are bundled", () => {
		expect(shown("what is ¥100 from 1990")).toBe(
			"no price index for JPY is bundled, so there is no record of what it bought in another year: only an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100, can be adjusted",
		);
	});

	test("a quantity that is not money is refused", () => {
		expect(shown("what is 100 kg from 1990")).toBe("a price index adjusts money, and kg is a mass: give an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100");
		expect(code("inflationAdjust(100 kg, 1990, 2020)")).toBe("INFLATION_NO_INDEX");
	});

	test("a bare number is refused rather than read as dollars, as payroll refuses one", () => {
		expect(shown("what is 100 from 1990")).toBe("a price index measures one currency, and this amount has none: write it with its currency, in US dollars, pounds sterling or euros, such as $100, £100 or €100");
		expect(code("inflationAdjust(100, 1990, 2020)")).toBe("INFLATION_NO_INDEX");
		expect(code("what is 10% from 1990")).toBe("INFLATION_NO_INDEX");
	});
});

describe("the boundary: US dollars are adjusted as before", () => {
	test.each([
		["inflationAdjust($100, 1990, 2020)", "= $198.02"],
		["what is $500 in 1990 worth in 2010", "= $834.19"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the forms that run to the present year, in dollars written either way", () => {
		const ratio = inflationRatio(1990, PRESENT_YEAR)!;
		for (const line of ["what is $100 from 1990", "what is 100 USD from 1990"]) {
			const value = newTrackedEngine().evaluateExpression(line);
			expect(value.unit).toBe("USD");
			expect(value.toNumber()).toBeCloseTo(100 * ratio, 6);
		}
		expect(newTrackedEngine().evaluateExpression("$100 in 1990 dollars").unit).toBe("USD");
	});

	test("the stated-rate projection does not use the index and still takes any currency", () => {
		const value = newTrackedEngine().evaluateExpression("value of £100 in 2030 assuming 3% inflation");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.unit).toBe("GBP");
	});
});

describe("adversarial", () => {
	test("a currency is refused before a year outside the table is looked at", () => {
		expect(code("inflationAdjust(¥100, 1900, 2020)")).toBe("INFLATION_NO_INDEX");
		expect(code("inflationAdjust($100, 1900, 2020)")).toBe("INFLATION_YEAR_OUT_OF_RANGE");
	});

	test("an amount converted from dollars into pounds is pounds, and reads the UK index (#756)", () => {
		currencyExchangeService.primeRates("USD", { GBP: 0.75 });
		expect(newTrackedEngine().evaluateExpression("what is ($100 in GBP) from 1990").unit).toBe("GBP");
		expect(shown("inflationAdjust($100 in GBP, 1990, 2020)")).toBe("= £174.33");
		currencyExchangeService.primeRates("USD", { JPY: 150 });
		expect(code("inflationAdjust($100 in JPY, 1990, 2020)")).toBe("INFLATION_NO_INDEX");
	});

	test("every numeric edge as an amount or a year is answered honestly", () => {
		for (const line of fill("inflationAdjust($X, 1990, 2020)", NUMERIC_EDGES.filter((n) => !n.startsWith("-") && !n.includes(" ") && !n.includes("/") && !n.includes("^")))) {
			expectHonestLine(line, { allowNaN: true });
		}
		for (const line of fill("inflationAdjust($100, X, 2020)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("an amount held in a variable, through both passes", () => {
		const { batch } = expectHonestDocument("yen = ¥100\ndollars = $100\ninflationAdjust(yen, 1990, 2020)\ninflationAdjust(dollars, 1990, 2020)");
		expect(batch).toEqual([
			"= ¥100",
			"= $100.00",
			"ERROR no price index for JPY is bundled, so there is no record of what it bought in another year: only an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100, can be adjusted",
			"= $198.02",
		]);
	});
});

describe("inflationAmountRefused", () => {
	test("US dollars pass, and since #756 pounds and euros do too", () => {
		expect(inflationAmountRefused(uomValue(100, "USD"))).toBeNull();
		expect(inflationAmountRefused(uomValue(100, "GBP"))).toBeNull();
		expect(inflationAmountRefused(uomValue(100, "EUR"))).toBeNull();
	});

	test("another currency, a quantity, a bare number and a percentage are refused", () => {
		for (const amount of [uomValue(100, "JPY"), uomValue(100, "kg"), numberValue(100), percentageValue(0.1)]) {
			expect(inflationAmountRefused(amount)?.errorCode).toBe("INFLATION_NO_INDEX");
		}
	});

	test("a fault is handed back as it is", () => {
		const fault = errorValue("SOMETHING", "went wrong");
		expect(inflationAmountRefused(fault)).toBe(fault);
		const pending = pendingValue("rate");
		expect(inflationAmountRefused(pending)).toBe(pending);
	});
});
