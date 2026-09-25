import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, fill, NUMERIC_EDGES } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, uomValue } from "@solve-js/vm/Value";
import { temperatureStep } from "@solve-js/vm/VMConversion";
import { convertUnit } from "@solve-js/uom/UomConverter";
import { hasOffset } from "@solve-js/uom/UnitConversion";

/**
 * Issue #645, two faults with temperatures on two scales.
 *
 * The display: the offset arithmetic runs in binary floating point, so 32 °F in
 * °C came to 5.684e-14 rather than the 0 the two scales share, and was shown as
 * `5.68e-14 °C`. A conversion between offset scales that lands within the
 * comparison tolerance of zero is now zero.
 *
 * The sum: `20 °C + 10 °F` read the 10 °F as a temperature (-12.22 °C) and
 * added it, answering 7.78 °C. Adding to a temperature adds a step, so a
 * right-hand temperature on another scale is read as one: ten Fahrenheit
 * degrees are 5.56 Celsius degrees, and the sum is 25.56 °C. Subtraction keeps
 * its documented reading, held for 3.0.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

function value(line: string): number {
	return newTrackedEngine().evaluateExpression(line).toNumber();
}

describe("a conversion onto the zero two scales share is zero", () => {
	test.each([
		["32 °F in °C", "= 0.00 °C"],
		["32 F in C", "= 0.00 C"],
		["(32 °F in °C) * 1", "= 0.00 °C"],
		["273.15 K in °C", "= 0.00 °C"],
		["-459.67 °F in K", "= 0.00 K"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the value, not only its display, is zero", () => {
		expect(value("32 °F in °C")).toBe(0);
		expect(Object.is(value("32 °F in °C"), -0)).toBe(false);
	});
});

describe("a temperature on another scale added to one is a step", () => {
	test.each([
		["20 °C + 10 °F", "= 25.56 °C"],
		["20 C + 10 F", "= 25.56 C"],
		["20 °C + 10 K", "= 30.00 °C"],
		["68 °F + 10 °C", "= 86.00 °F"],
		["10 °F + 20 °C", "= 46.00 °F"],
		["50 °F + 10 K", "= 68.00 °F"],
		["300 K + 10 °C", "= 310.00 K"],
		["300 K + 18 °F", "= 310.00 K"],
		["0 °C + 32 °F", "= 17.78 °C"],
		["(20 °C + 10 °F) in °F", "= 78.00 °F"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("the boundary: same-scale sums, subtraction and genuine readings are unchanged", () => {
	test.each([
		["20 °C + 10 °C", "= 30.00 °C"],
		["68 °F + 18 °F", "= 86.00 °F"],
		["20 °C - 10 °F", "= 32.22 °C"],
		["(30 °C - 20 °C) in F", "= 50.00 F"],
		["-40 °F in °C", "= -40.00 °C"],
		["0 K in °C", "= -273.15 °C"],
		["0 °C in °F", "= 32.00 °F"],
		["32.0018 °F in °C", "= 0.001 °C"],
		["20 C +/- 10 F", "= 20 ± 5.56"],
		["32 °F == 0 °C", "= true"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("adversarial", () => {
	test("every numeric edge in a conversion and a mixed sum is answered honestly", () => {
		for (const line of fill("X °F in °C", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("20 °C + X °F", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("a temperature held in a variable, through both passes", () => {
		const { batch } = expectHonestDocument("t = 20 °C\nt + 10 °F\nfreezing = 32 °F\nfreezing in °C");
		expect(batch).toEqual(["= 20.00 °C", "= 25.56 °C", "= 32.00 °F", "= 0.00 °C"]);
	});
});

describe("temperatureStep", () => {
	test("reads the right operand as a step in the left's scale", () => {
		expect(temperatureStep(uomValue(20, "°C"), uomValue(10, "K"))?.toNumber()).toBe(30);
		expect(temperatureStep(uomValue(68, "°F"), uomValue(10, "°C"))?.toNumber()).toBe(86);
	});

	test("declines a same-scale sum, a non-temperature and a plain number", () => {
		expect(temperatureStep(uomValue(20, "°C"), uomValue(10, "°C"))).toBeNull();
		expect(temperatureStep(uomValue(20, "°C"), uomValue(10, "m"))).toBeNull();
		expect(temperatureStep(uomValue(20, "°C"), numberValue(10))).toBeNull();
		expect(temperatureStep(numberValue(20), uomValue(10, "°F"))).toBeNull();
	});
});

describe("the offset snap in convertUnit", () => {
	test("snaps an offset conversion onto zero", () => {
		expect(convertUnit(32, "°F", "°C")).toBe(0);
		expect(convertUnit(32, "F", "C")).toBe(0);
	});

	test("leaves a genuine small reading, and a tiny ratio conversion with no offset, alone", () => {
		expect(convertUnit(32.0018, "°F", "°C")).toBeCloseTo(0.001, 9);
		expect(convertUnit(1, "nm", "km")).toBe(1e-12);
	});

	test("hasOffset names the scales with a zero of their own", () => {
		expect(hasOffset("°C")).toBe(true);
		expect(hasOffset("°F")).toBe(true);
		expect(hasOffset("m")).toBe(false);
		expect(hasOffset("constructor")).toBe(false);
	});
});
