import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, numberValue, percentageValue, stringValue, uomValue } from "@solve-js/vm/Value";
import { asRate, isPartsPerUnit, partsPerFraction, percentageInPartsPer, toPercentage } from "@solve-js/vm/VMConversion";

/**
 * Issue #633: percent sat outside the parts-per scale. `in %` left the `%` for
 * the postfix operator, which divided by a hundred again (`20/80 in %` gave
 * 0.25%); `as %` read a quantity's magnitude and dropped its unit (`100 ppm as
 * %` gave 10000.00%, `5 km as %` 500.00%); and `of` multiplied a parts-per
 * quantity by its magnitude (`2 permille of $5000` gave $10,000.00). They now
 * share one scale: 1% is 0.01, 1 permille 0.001, 1 ppm 0.000001.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

describe("the helpers", () => {
	test("isPartsPerUnit and partsPerFraction", () => {
		expect(["ppm", "ppb", "ppt", "permille"].every(isPartsPerUnit)).toBe(true);
		expect(isPartsPerUnit("km")).toBe(false);
		expect(isPartsPerUnit(undefined)).toBe(false);
		expect(partsPerFraction(uomValue(2, "permille"))).toBeCloseTo(0.002, 15);
		expect(partsPerFraction(uomValue(100, "ppm"))).toBeCloseTo(0.0001, 15);
	});

	test("toPercentage: parts-per becomes its fraction, another quantity is refused, a number is its own fraction", () => {
		expect(toPercentage(uomValue(100, "ppm")).type).toBe(ValueType.Percentage);
		expect(toPercentage(uomValue(100, "ppm")).toNumber()).toBeCloseTo(0.0001, 15);
		expect(toPercentage(uomValue(5, "km")).errorCode).toBe("PERCENTAGE_OF_QUANTITY");
		expect(toPercentage(numberValue(0.25)).toNumber()).toBe(0.25);
		expect(toPercentage(numberValue(Infinity)).errorCode).toBe("PERCENTAGE_NOT_FINITE");
		expect(toPercentage(numberValue(NaN)).errorCode).toBe("PERCENTAGE_NOT_FINITE");
	});

	test("percentageInPartsPer reads only a percentage into a parts-per unit", () => {
		expect(percentageInPartsPer(percentageValue(0.005), "ppm")?.toNumber()).toBeCloseTo(5000, 9);
		expect(percentageInPartsPer(numberValue(0.005), "ppm")).toBeNull();
		expect(percentageInPartsPer(percentageValue(0.005), "km")).toBeNull();
	});

	test("asRate changes only a parts-per quantity", () => {
		expect(asRate(uomValue(2, "permille")).type).toBe(ValueType.Percentage);
		const km = uomValue(3, "km");
		expect(asRate(km)).toBe(km);
		const text = stringValue("x");
		expect(asRate(text)).toBe(text);
	});
});

describe("one scale, every spelling", () => {
	test.each([
		["20/80 in %", "= 25.00%"],
		["20/80 in percent", "= 25.00%"],
		["20/80 as %", "= 25.00%"],
		["50% in %", "= 50.00%"],
		["0.25 to %", "= 25.00%"],
		["100 ppm in %", "= 0.01%"],
		["100 ppm in percent", "= 0.01%"],
		["100 ppm as %", "= 0.01%"],
		["0.5% in ppm", "= 5,000.00 ppm"],
		["10% in permille", "= 100.00 permille"],
		["2 permille of 5000", "= 10"],
		["2 permille of $5000", "= $10.00"],
		["2 permille of 5000 kg", "= 10.00 kg"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test.each([
		["5 km as %", "A length is not a proportion"],
		["$5 as %", "Money is not a proportion"],
	])("%s is refused: not a proportion", (line, start) => {
		expect(show(line).startsWith(start)).toBe(true);
	});

	test("both document passes agree", () => {
		const text = "c = 100 ppm\nc as %\n2 permille of $5000\n0.5% in ppm";
		const read = (lines: { result: unknown }[]) => lines.map((l) => (l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch.slice(1)).toEqual(["= 0.01%", "= $10.00", "= 5,000.00 ppm"]);
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});
});

describe("the boundary: what does not change", () => {
	test.each([
		["0.5 as %", "= 50.00%"],
		["40 to 90 as %", "= 125.00%"],
		["10% of 200", "= 20"],
		["3 of 5", "= 15"],
		["half of $50", "= $25.00"],
		["100 ppm * 2", "= 200.00 ppm"],
		["2 permille * 5000", "= 10,000.00 permille"],
		["5 ppm + 3 ppm", "= 8.00 ppm"],
		["100 ppm in permille", "= 0.10 permille"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});
});
