import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, fill, NUMERIC_EDGES } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, numberValueUncertain, uomValue, ValueType } from "@solve-js/vm/Value";
import { toleranceHasNoUnit, toleranceMeetsQuantity, uncertainOp } from "@solve-js/vm/VMConversion";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";

/**
 * Issue #639: a tolerance on a value with a unit drops the unit, as the
 * uncertainty page documents, so `5 m +/- 1 cm` is the plain `5 ± 0.01`. A
 * later `in mm` then labelled that bare 5 as 5.00 mm (the length is 5,000 mm),
 * and adding a length took the quantity's unit and discarded the spread
 * without a word. Both are refused by name until the unit is carried through.
 */

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("a value with a tolerance cannot be converted into a unit", () => {
	test.each([
		"(5 m +/- 1 cm) in mm",
		"(5 km +/- 100 m) in miles",
		"(20 C +/- 1 F) in F",
		"(5 +/- 0.1) in km",
		"(5 m +/- 1 cm) to mm",
		"(5 +/- 0.1) km",
	])("%s", (line) => {
		expect(code(line)).toBe("UNCERTAINTY_WITHOUT_UNIT");
	});

	test("the message says the tolerance was read without its unit, and what to write", () => {
		expect(shown("(5 m +/- 1 cm) in mm")).toBe(
			"A value with a tolerance cannot be converted to mm: a tolerance is read without its unit, so 5 m +/- 1 cm is the plain 5 ± 0.01. Convert the value first and give the tolerance after, as in (5 m in mm) +/- 10.",
		);
	});

	test("the way the message suggests works", () => {
		expect(shown("(5 m in mm) +/- 10")).toBe("= 5,000 ± 10.0");
		expect(shown("5000 mm +/- 1 cm")).toBe("= 5,000 ± 10.0");
	});
});

describe("a value with a tolerance and a quantity cannot be combined", () => {
	test.each([
		["(5 m +/- 1 cm) + 2 m", "added"],
		["(5 +/- 0.1) + 2 m", "added"],
		["2 m - (5 +/- 0.1)", "subtracted"],
		["(5 +/- 0.1) * 2 m", "multiplied"],
		["2 m * (5 +/- 0.1)", "multiplied"],
		["2 m / (5 +/- 0.1)", "divided"],
	])("%s", (line, verb) => {
		const value = newTrackedEngine().evaluateExpression(line);
		expect(value.errorCode).toBe("UNCERTAINTY_WITHOUT_UNIT");
		expect(formatValue(value)).toContain(`cannot be ${verb}`);
	});
});

describe("the boundary: scalar arithmetic and the tolerance's own conversion are unchanged", () => {
	test.each([
		["5 m +/- 1 cm", "= 5 ± 0.01"],
		["(5 m +/- 1 cm) * 2", "= 10 ± 0.02"],
		["20 C +/- 10 F", "= 20 ± 5.56"],
		["(10 +/- 1) + (20 +/- 2)", "= 30 ± 2.24"],
		["(100 +/- 5) * 10%", "= 10 ± 0.5"],
		["5 m +/- 1%", "= 5 ± 0.05"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("adversarial", () => {
	test("a percentage tolerance, a temperature centre and money are refused the same way", () => {
		expect(code("(100 +/- 5%) in km")).toBe("UNCERTAINTY_WITHOUT_UNIT");
		expect(code("(20 °C +/- 1 °C) + 1 °C")).toBe("UNCERTAINTY_WITHOUT_UNIT");
		expect(code("($5 +/- 0.1) + $2")).toBe("UNCERTAINTY_WITHOUT_UNIT");
	});

	test("money converted to another currency, with a rate to hand, is refused", () => {
		currencyExchangeService.primeRates("USD", { EUR: 0.9 });
		try {
			expect(code("($5 +/- $0.10) in EUR")).toBe("UNCERTAINTY_WITHOUT_UNIT");
		} finally {
			currencyExchangeService.clearRates();
		}
	});

	test("in after a scalar multiply is refused, since the product is still unitless", () => {
		expect(code("((5 m +/- 1 cm) * 2) in mm")).toBe("UNCERTAINTY_WITHOUT_UNIT");
	});

	test("every numeric edge as the tolerance is answered honestly", () => {
		for (const line of fill("(5 +/- X) in km", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("a measurement held in a variable and converted on a later line, through both passes", () => {
		const { batch } = expectHonestDocument("x = 5 m +/- 1 cm\nx * 2\nx in mm\nx + 2 m");
		expect(batch[0]).toBe("= 5 ± 0.01");
		expect(batch[1]).toBe("= 10 ± 0.02");
		expect(batch[2]).toMatch(/^ERROR A value with a tolerance cannot be converted to mm/);
		expect(batch[3]).toMatch(/^ERROR A value with a tolerance and a quantity in m cannot be added/);
	});
});

describe("toleranceHasNoUnit and toleranceMeetsQuantity", () => {
	test("each is an UNCERTAINTY_WITHOUT_UNIT refusal naming the unit", () => {
		const converted = toleranceHasNoUnit("mm");
		expect(converted.errorCode).toBe("UNCERTAINTY_WITHOUT_UNIT");
		expect(formatValue(converted)).toContain("converted to mm");
		const combined = toleranceMeetsQuantity("kg", "sub");
		expect(combined.errorCode).toBe("UNCERTAINTY_WITHOUT_UNIT");
		expect(formatValue(combined)).toContain("a quantity in kg cannot be subtracted");
	});
});

describe("uncertainOp", () => {
	test("an uncertain number meeting a quantity is refused on either side", () => {
		expect(uncertainOp(numberValueUncertain(5, 0.1), uomValue(2, "m"), "add")?.errorCode).toBe("UNCERTAINTY_WITHOUT_UNIT");
		expect(uncertainOp(uomValue(2, "m"), numberValueUncertain(5, 0.1), "div")?.errorCode).toBe("UNCERTAINTY_WITHOUT_UNIT");
	});

	test("two plain numbers still propagate in quadrature", () => {
		const sum = uncertainOp(numberValueUncertain(10, 3), numberValueUncertain(20, 4), "add");
		expect(sum?.type).toBe(ValueType.Number);
		expect(sum?.toNumber()).toBe(30);
		expect(sum?.uncertainty).toBe(5);
	});

	test("a quantity with no tolerance on the other side is not refused", () => {
		expect(uncertainOp(numberValue(5), uomValue(2, "m"), "mul")).toBeNull();
	});
});
