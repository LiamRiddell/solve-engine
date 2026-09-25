import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, fill, NUMERIC_EDGES } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, uomValue, stringValue, ValueType } from "@solve-js/vm/Value";
import { spreadStatistic, modeOf } from "@solve-js/vm/VMBuiltins";

/**
 * Issue #643: standard deviation, variance and mode read each argument's bare
 * magnitude, so a list of quantities lost its unit and was not converted into
 * one: `standard deviation of 1 kg, 1000 g` was 499.50, the spread of 1 and
 * 1000. They read the values in one unit now, as `spread` and `total` do, and
 * answer in it.
 *
 * Variance is in the square of the unit, which the engine spells only for a
 * length. The choice made for every other unit (a mass, money, a temperature)
 * is to refuse by name with the power operator's code, as `(2 kg)^2` is
 * refused, and point at the standard deviation, which is the same spread in a
 * unit the engine can write.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

describe("a list of quantities answers in a unit", () => {
	test.each([
		["standard deviation of 1 kg, 1000 g", "= 0.00 kg"],
		["sample standard deviation of 1 kg, 1000 g", "= 0.00 kg"],
		["standard deviation of $10, $20, $30", "= $8.16"],
		["sample standard deviation of 2 m, 4 m", "= 1.41 m"],
		["mode of 1 kg, 1000 g, 2 kg", "= 1.00 kg"],
		["mode of 1 kg, 2 kg, 2000 g", "= 2.00 kg"],
		["mode of $10, $10, $20", "= $10.00"],
		["mode of 1 ft, 12 in, 2 ft", "= 1.00 ft"],
		["variance of 2 m, 4 m", "= 1.00 m²"],
		["sample variance of 2 m, 4 m, 6 m", "= 4.00 m²"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a variance of lengths with no square spelling is in square metres, as their power is", () => {
		expect(shown("variance of 1 furlong, 2 furlong")).toBe("= 10,117.14 m²");
	});
});

describe("refusals", () => {
	test("two measures are refused, as spread refuses them", () => {
		const value = newTrackedEngine().evaluateExpression("standard deviation of 1 kg, 2 m");
		expect(value.errorCode).toBe("INCOMPATIBLE_UNITS");
		expect(formatValue(value)).toBe("mass and length cannot be used in a standard deviation");
	});

	test.each(["variance of 1 kg, 1000 g", "sample variance of 1 kg, 1000 g", "variance of $10, $20", "variance of 0 °C, 10 °C"])(
		"%s: a variance with no squared unit is refused by name",
		(line) => {
			expect(code(line)).toBe("UNIT_POWER_UNSUPPORTED");
		},
	);

	test("the variance refusal points at the standard deviation", () => {
		expect(shown("variance of 1 kg, 1000 g")).toBe(
			"A variance of quantities in kg would be in kg squared, which has no unit: only a length squared has one, an area. The standard deviation is the same spread in kg.",
		);
	});
});

describe("the boundary: plain numbers are unchanged", () => {
	test.each([
		["standard deviation of 10, 20, 30", "= 8.16"],
		["variance of 10, 20, 30", "= 66.67"],
		["mode of 1, 2, 2", "= 2"],
		["spread of 1 kg, 1000 g", "= 0.00 kg"],
		["median of $10, $20, $30", "= $20.00"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("adversarial", () => {
	test("temperatures across scales are read as readings in the first one's scale", () => {
		expect(shown("standard deviation of 0 °C, 32 °F")).toBe("= 0.00 °C");
	});

	test("two currencies with no rate to hand are refused rather than read as one", () => {
		expect(code("standard deviation of $10, €20")).toBe("INCOMPATIBLE_UNITS");
	});

	test("a single value, and the sample forms of one value, are zero in the unit", () => {
		expect(shown("standard deviation of 1 kg")).toBe("= 0.00 kg");
		expect(shown("sample standard deviation of 1 kg")).toBe("= 0.00 kg");
	});

	test("a list with an infinity in it is refused by name, where it answered NaN", () => {
		expect(code("standard deviation of 1/0, 1000")).toBe("STATISTIC_NOT_FINITE");
		expect(code("standard deviation of (1/0) kg, 1000 g")).toBe("STATISTIC_NOT_FINITE");
		expect(shown("variance of (-1/0) m, 2 m")).toBe("A variance of a list with an infinity in it has no value: an infinite value has no finite distance from the mean.");
	});

	test("every numeric edge beside a quantity is answered honestly", () => {
		for (const line of fill("standard deviation of 1 kg, X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("mode of 1 kg, X, X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("quantities held in variables, through both passes", () => {
		const { batch } = expectHonestDocument("w1 = 1 kg\nw2 = 1000 g\nstandard deviation of w1, w2\nmode of w1, w2, 2 kg");
		expect(batch).toEqual(["= 1.00 kg", "= 1,000.00 g", "= 0.00 kg", "= 1.00 kg"]);
	});

	test("a table column of quantities is refused by the column form, through both passes", () => {
		// A boundary of table columns rather than of this fix: the column form
		// reads number and money cells only (#651), and says so.
		const table = "| item | weight |\n| ---- | ------ |\n| a | 1 kg |\n| b | 3 kg |\n\nstandard deviation of column \"weight\" above";
		const { batch } = expectHonestDocument(table);
		expect(batch[batch.length - 1]).toBe('ERROR Column "weight" has no number or money cells to aggregate (a cell with a unit is not read yet)');
	});
});

describe("spreadStatistic", () => {
	test("plain numbers give a plain number", () => {
		const v = spreadStatistic([numberValue(10), numberValue(20), numberValue(30)], "used in a variance", false, false);
		expect(v.type).toBe(ValueType.Number);
		expect(v.toNumber()).toBeCloseTo(66.667, 3);
	});

	test("quantities are read in the first one's unit", () => {
		const v = spreadStatistic([uomValue(1, "kg"), uomValue(3000, "g")], "used in a standard deviation", false, true);
		expect(v.unit).toBe("kg");
		expect(v.toNumber()).toBe(1);
	});

	test("the variance of lengths is an area; of anything else, a refusal", () => {
		expect(spreadStatistic([uomValue(2, "m"), uomValue(4, "m")], "used in a variance", false, false).unit).toBe("m²");
		expect(spreadStatistic([uomValue(2, "kg"), uomValue(4, "kg")], "used in a variance", false, false).errorCode).toBe("UNIT_POWER_UNSUPPORTED");
	});

	test("text is refused by the aggregate's own sentence", () => {
		expect(spreadStatistic([stringValue("x"), numberValue(1)], "used in a variance", false, false).errorCode).toBe("AGGREGATE_NON_NUMERIC");
	});

	test("no values give zero", () => {
		expect(spreadStatistic([], "used in a variance", false, false).toNumber()).toBe(0);
	});
});

describe("modeOf", () => {
	test("the most frequent value, a tie going to the value that reached the count first", () => {
		expect(modeOf([1, 2, 2, 3], false)).toBe(2);
		expect(modeOf([3, 1, 1, 3], false)).toBe(1);
		expect(modeOf([3, 1, 2], false)).toBe(3);
	});

	test("converted magnitudes compare at twelve digits, and the first spelling is returned", () => {
		expect(modeOf([1, 0.9999999999999999, 2], true)).toBe(1);
		expect(modeOf([1, 0.9999999999999999, 2], false)).toBe(1);
		expect(modeOf([2, 1, 0.9999999999999999], true)).toBe(1);
	});

	test("NaN and the infinities do not break the count", () => {
		expect(modeOf([NaN, NaN, 1], true)).toBeNaN();
		expect(modeOf([Infinity, 1, Infinity], true)).toBe(Infinity);
	});
});
