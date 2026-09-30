import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, numberValueUncertain, uomValue, matrixValue, stringValue, rangeValue, symbolicValue, ValueType } from "@solve-js/vm/Value";
import { varNode } from "@solve-js/symbolic";
import { noSingleAmount, quantityOperandRefused, unitAfterValue } from "@solve-js/vm/VMConversion";

/**
 * Issue #640: a bracketed list given a unit became 0 of that unit. A unit
 * written straight after a list handed it to `valueInUnit`, and arithmetic with
 * a quantity reached `unifyUom`, and both read the list as the 0 `toNumber()`
 * reports for it: `[1, 2, 3] km` was 0.00 km and `[1, 2] + 1 km` 1.00 km. Both
 * were refused, the unit written after a list with the sentence `in` had
 * given since #547.
 *
 * Since #745 a list carries a unit, so both now have an answer: the unit
 * written after a list gives every cell that unit, and a list meeting a
 * quantity is worked cell by cell. The refusals that remain are for a value
 * with no single amount at all (a colour, text) and a quotient a list cannot
 * hold.
 */

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("a unit written after a list gives every cell that unit (#745)", () => {
	test.each([
		["[1, 2, 3] km", "= [1.00 km, 2.00 km, 3.00 km]"],
		["[1, 2, 3] kg", "= [1.00 kg, 2.00 kg, 3.00 kg]"],
		["$[4, 5]", "= [$4.00, $5.00]"],
		["[4, 5] USD", "= [$4.00, $5.00]"],
		["(1, 2) km", "= [1.00 km, 2.00 km]"],
		["[1, 2] km/h", "= [1.00 km/h, 2.00 km/h]"],
		["[1, 2] mph", "= [1.00 mph, 2.00 mph]"],
		["[1, 2; 3, 4] m", "= [1.00 m, 2.00 m; 3.00 m, 4.00 m]"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the same as the sentence with in", () => {
		expect(shown("[1, 2, 3] km")).toBe(shown("[1, 2, 3] in km"));
	});
});

describe("a list and a quantity are worked cell by cell (#745)", () => {
	test.each([
		["[1, 2] * 1 km", "= [1.00 km, 2.00 km]"],
		["[1, 2] * (1 km)", "= [1.00 km, 2.00 km]"],
		["(1 km) * [1, 2]", "= [1.00 km, 2.00 km]"],
		["1 km / [1, 2]", "= [1.00 km, 0.50 km]"],
		["[1, 2] + 1 km", "= [2.00 km, 3.00 km]"],
		["1 km + [1, 2]", "= [2.00 km, 3.00 km]"],
		["[1, 2] - 1 km", "= [0.00 km, 1.00 km]"],
		["1 km - [1, 2]", "= [0.00 km, -1.00 km]"],
		["[1, 2] * $5", "= [$5.00, $10.00]"],
		["$5 * [1, 2]", "= [$5.00, $10.00]"],
		["[1, 2] + $5", "= [$6.00, $7.00]"],
		["[1, 2] * 5 km/h", "= [5.00 km/h, 10.00 km/h]"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a plain list divided by a quantity has no unit a list can hold, and says so", () => {
		expect(code("[1, 2] / 1 km")).toBe("MATRIX_UNIT_OPERATION_UNSUPPORTED");
		expect(shown("[1, 2] / 1 km")).toBe("A list cannot divide a plain number by a quantity cell by cell: each answer would be in a reciprocal unit (per km), which a list does not carry.");
	});
});

describe("the boundary: a list and a plain number, and the older refusals, are unchanged", () => {
	test.each([
		["[1, 2] * 2", "= [2, 4]"],
		["[1, 2] + [3, 4]", "= [4, 6]"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("text and a date keep their own refusals", () => {
		expect(code('"abc" * 1 km')).toBe("TEXT_ARITHMETIC");
		expect(code("1:30 * 1 km")).toBe("INVALID_DATETIME_OP");
	});
});

describe("adversarial", () => {
	test("a colour meeting a quantity is refused by name", () => {
		expect(shown("#ff0000 * 1 km")).toBe("A colour and a quantity in km cannot be multiplied: a colour has no single amount to put in km.");
	});

	test("large and awkward lists are refused, not read", () => {
		const big = `[${Array.from({ length: 500 }, (_, i) => i).join(", ")}]`;
		expectHonestLine(`${big} km`);
		expectHonestLine(`${big} * 1 km`);
		expectHonestLine("[] km");
		expectHonestLine("[0/0] * 1 km");
		const medium = `[${Array.from({ length: 100 }, (_, i) => i).join(", ")}]`;
		expect(shown(`${medium} km`)).toMatch(/^= \[0\.00 km, 1\.00 km, /);
	});

	test("a list held in a variable and given a unit on a later line, through both passes", () => {
		const { batch } = expectHonestDocument("v = [1, 2]\nv km\nv * 1 km\nv * 2");
		expect(batch).toEqual([
			"= [1, 2]",
			"= [1.00 km, 2.00 km]",
			"= [1.00 km, 2.00 km]",
			"= [2, 4]",
		]);
	});
});

describe("noSingleAmount", () => {
	test("refuses a list, text and a range, and passes a number or a quantity", () => {
		expect(noSingleAmount(matrixValue(1, 2, [1, 2]), "km")?.errorCode).toBe("CONVERT_NON_NUMERIC");
		expect(noSingleAmount(stringValue("abc"), "km")?.errorCode).toBe("CONVERT_NON_NUMERIC");
		expect(noSingleAmount(rangeValue(1, 5), "km")?.errorCode).toBe("CONVERT_NON_NUMERIC");
		expect(noSingleAmount(numberValue(5), "km")).toBeNull();
		expect(noSingleAmount(uomValue(5, "m"), "km")).toBeNull();
	});
});

describe("quantityOperandRefused", () => {
	const list = matrixValue(1, 2, [1, 2]);

	test("a list beside a quantity is refused on either side", () => {
		expect(quantityOperandRefused(list, uomValue(1, "km"), "mul")?.errorCode).toBe("QUANTITY_NON_NUMERIC");
		expect(quantityOperandRefused(uomValue(1, "km"), list, "add")?.errorCode).toBe("QUANTITY_NON_NUMERIC");
		expect(quantityOperandRefused(list, uomValue(1, "km"))?.errorCode).toBe("QUANTITY_NON_NUMERIC");
	});

	test("two quantities, or none, are not its business", () => {
		expect(quantityOperandRefused(uomValue(1, "km"), uomValue(2, "m"), "add")).toBeNull();
		expect(quantityOperandRefused(list, numberValue(2), "mul")).toBeNull();
		expect(quantityOperandRefused(numberValue(2), numberValue(3), "mul")).toBeNull();
	});

	test("text, a date and an unknown are left for their own refusals", () => {
		expect(quantityOperandRefused(stringValue("abc"), uomValue(1, "km"), "add")).toBeNull();
		expect(quantityOperandRefused(symbolicValue(varNode("x")), uomValue(1, "km"), "mul")).toBeNull();
	});

	test("a plain number beside a quantity is let through", () => {
		expect(quantityOperandRefused(numberValue(2), uomValue(1, "km"), "mul")).toBeNull();
	});
});

describe("unitAfterValue", () => {
	test("a number becomes the quantity", () => {
		const v = unitAfterValue(numberValue(5), "km");
		expect(v.type).toBe(ValueType.Uom);
		expect(v.unit).toBe("km");
	});

	test("a list and an uncertain number are refused", () => {
		expect(unitAfterValue(matrixValue(1, 2, [1, 2]), "km").errorCode).toBe("CONVERT_NON_NUMERIC");
		expect(unitAfterValue(numberValueUncertain(5, 0.1), "km").errorCode).toBe("UNCERTAINTY_WITHOUT_UNIT");
	});

	test("an unknown is let through unchanged, as it always was", () => {
		expect(unitAfterValue(symbolicValue(varNode("x")), "km").type).toBe(ValueType.Uom);
	});
});
