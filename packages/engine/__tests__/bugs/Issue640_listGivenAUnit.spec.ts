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
 * are refused now, the unit written after a list with the sentence `in` has
 * given since #547.
 */

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("a unit written after a list is refused", () => {
	test.each([
		"[1, 2, 3] km",
		"[1, 2, 3] kg",
		"$[4, 5]",
		"[4, 5] USD",
		"(1, 2) km",
		"[1, 2] km/h",
		"[1, 2] mph",
		"[1, 2; 3, 4] m",
	])("%s", (line) => {
		expect(code(line)).toBe("CONVERT_NON_NUMERIC");
	});

	test("with the sentence in has given since #547", () => {
		expect(shown("[1, 2, 3] km")).toBe(shown("[1, 2, 3] in km"));
		expect(shown("[1, 2, 3] km")).toBe("A bracketed list has no single amount to convert to km: only a number or a quantity can be converted.");
	});
});

describe("a list and a quantity cannot be combined", () => {
	test.each([
		["[1, 2] * 1 km", "multiplied"],
		["[1, 2] * (1 km)", "multiplied"],
		["(1 km) * [1, 2]", "multiplied"],
		["[1, 2] / 1 km", "divided"],
		["1 km / [1, 2]", "divided"],
		["[1, 2] + 1 km", "added"],
		["1 km + [1, 2]", "added"],
		["[1, 2] - 1 km", "subtracted"],
		["1 km - [1, 2]", "subtracted"],
		["[1, 2] * $5", "multiplied"],
		["$5 * [1, 2]", "multiplied"],
		["[1, 2] + $5", "added"],
		["[1, 2] * 5 km/h", "multiplied"],
	])("%s", (line, verb) => {
		const value = newTrackedEngine().evaluateExpression(line);
		expect(value.errorCode).toBe("QUANTITY_NON_NUMERIC");
		expect(formatValue(value)).toContain(`cannot be ${verb}`);
	});

	test("the message names the list and the unit", () => {
		expect(shown("[1, 2] * 1 km")).toBe(
			"A bracketed list and a quantity in km cannot be multiplied: a bracketed list has no single amount to put in km. A list does not carry a unit yet.",
		);
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
	});

	test("a list held in a variable and given a unit on a later line, through both passes", () => {
		const { batch } = expectHonestDocument("v = [1, 2]\nv km\nv * 1 km\nv * 2");
		expect(batch).toEqual([
			"= [1, 2]",
			"ERROR A bracketed list has no single amount to convert to km: only a number or a quantity can be converted.",
			"ERROR A bracketed list and a quantity in km cannot be multiplied: a bracketed list has no single amount to put in km. A list does not carry a unit yet.",
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
