/**
 * UK take-home pay (issue #277), on the HMRC bands for England, Wales and
 * Northern Ireland. The figures below are worked by hand from the published
 * bands so a drift in the arithmetic, or in the committed rates, fails here.
 *
 * Worked against the 2024/25 table, whose employee figures HMRC left unchanged
 * for 2025/26 and 2026/27, so these numbers hold for every year the package
 * ships. PayrollTaxYears.spec.ts pins that, and which year is the default.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import { incomeTax, nationalInsurance, takeHome, personalAllowance, hourlyRate } from "@solve-js/packages/payroll/PayrollMath";
import { HMRC_2024_25 } from "@solve-js/packages/payroll/data/HmrcBands";

const num = (s: string) => newTrackedEngine().evaluateExpression(s).toNumber();
const shown = (s: string) => formatValue(newTrackedEngine().evaluateExpression(s)).replace(/^=\s*/, "");
const B = HMRC_2024_25;

describe("the HMRC computation", () => {
	test("a £50,000 salary: £7,486 tax, £2,994.40 NI, £39,519.60 take-home", () => {
		expect(incomeTax(50000, B)).toBeCloseTo(7486, 2);
		expect(nationalInsurance(50000, B)).toBeCloseTo(2994.4, 2);
		expect(takeHome(50000, B)).toBeCloseTo(39519.6, 2);
	});

	test("the higher rate: £60,000 take-home is £45,357.40", () => {
		expect(takeHome(60000, B)).toBeCloseTo(45357.4, 2);
	});

	test("the personal-allowance taper over £100,000", () => {
		// £120,000 loses £10,000 of the £12,570 allowance, leaving £2,570.
		expect(personalAllowance(120000, B)).toBeCloseTo(2570, 2);
		expect(personalAllowance(100000, B)).toBeCloseTo(12570, 2); // full at the threshold
		expect(personalAllowance(125140, B)).toBeCloseTo(0, 2); // gone
		expect(takeHome(120000, B)).toBeCloseTo(76157.4, 2);
	});

	test("the additional rate over £125,140: £150,000 take-home is £91,286.40", () => {
		expect(takeHome(150000, B)).toBeCloseTo(91286.4, 2);
	});

	test("below the personal allowance there is no tax or NI", () => {
		expect(takeHome(10000, B)).toBeCloseTo(10000, 2);
	});

	test("hourly is the gross over a 1,920-hour year", () => {
		expect(hourlyRate(45000)).toBeCloseTo(23.4375, 4);
	});
});

describe("the grammar", () => {
	test("`after tax` and `take home on` agree", () => {
		expect(num("£50,000 after tax")).toBeCloseTo(39519.6, 2);
		expect(num("take home on £50,000")).toBeCloseTo(39519.6, 2);
		expect(num("£50,000 salary after tax")).toBeCloseTo(39519.6, 2);
	});

	test("a salary keeps its currency", () => {
		const v = newTrackedEngine().evaluateExpression("£50,000 salary after tax");
		expect(v.type).toBe(ValueType.Uom);
		expect(shown("£50,000 salary after tax")).toBe("£39,519.60");
	});

	test("`per month after tax` is the monthly take-home", () => {
		expect(num("£60,000 per month after tax")).toBeCloseTo(3779.78, 2);
	});

	test("`after tax` binds to the whole preceding amount", () => {
		// (50000 + 2000) after tax, not 50000 + (2000 after tax).
		expect(num("£50,000 + £2,000 after tax")).toBeCloseTo(takeHome(52000, B), 2);
	});

	test("`hourly for` is the plain hourly rate", () => {
		expect(num("hourly for 45000")).toBeCloseTo(23.44, 2);
	});
});

describe("the bands are British, and say so", () => {
	// HMRC's bands are a fact about the United Kingdom. Applied to a dollar
	// salary they answered confidently about a different country's tax and
	// printed a dollar sign on it; applied to a bare number they assumed
	// Britain silently. Both now refuse, and the refusal names the form that
	// does work, because the question behind it is a real one.
	test("another currency is refused by name", () => {
		expect(shown("$50,000 after tax")).toContain("say nothing about USD");
		expect(shown("€50,000 after tax")).toContain("say nothing about EUR");
		expect(shown("take home on $50,000")).toContain("say nothing about USD");
	});

	test("a bare number is refused too, because it names no currency", () => {
		expect(shown("50000 after tax")).toContain("needs a pound salary");
		expect(shown("50000 per month after tax")).toContain("needs a pound salary");
	});

	test("`hourly for` is not gated, because it applies no bands", () => {
		// A salary divided by a working year is a division, not tax.
		expect(num("hourly for 45000")).toBeCloseTo(23.44, 2);
		expect(shown("hourly for $45,000")).toBe("$23.44");
	});
});

describe("a rate the line states, which is national about nothing", () => {
	test("any currency, and a bare number", () => {
		expect(shown("£50,000 after 20% tax")).toBe("£40,000.00");
		expect(shown("$50,000 after 20% tax")).toBe("$40,000.00");
		expect(num("50000 after 20% tax")).toBeCloseTo(40000, 2);
	});

	test("it binds to the whole preceding amount, as the banded form does", () => {
		expect(num("50000 + 2000 after 20% tax")).toBeCloseTo(41600, 2);
	});

	test("a rate that is not a rate is refused rather than applied", () => {
		expect(shown("50000 after 120% tax")).toContain("between 0 and 100");
	});

	test("`after` on its own still means what it did", () => {
		// The whole shape is required, closing word included, so an ordinary
		// `after` is untouched: this is the parse error it has always been.
		expect(() => newTrackedEngine().evaluateExpression("3 days after tuesday")).toThrow();
	});
});
