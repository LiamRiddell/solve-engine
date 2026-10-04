/**
 * A power on a unit (#525).
 *
 * `5 m^2` used to be read as `(5 m)^2` and the power handler, which had no reading
 * for a unit, answered a bare 25; `10 m^3 in litres` then labelled that bare 1,000
 * as litres. The power now belongs to the unit where it is written (five square
 * metres), a quantity raised to a power keeps its unit, and anything with no unit
 * to give is refused by name rather than answered as a plain number.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { poweredUnit, rootUnit } from "@solve-js/uom/UnitPowers";

function evaluate(source: string): Value {
	return newTrackedEngine().evaluateExpression(source);
}

/** The error code a parse-time refusal throws, or `undefined` if nothing was thrown. */
function thrownCode(source: string): string | undefined {
	try {
		newTrackedEngine().evaluateExpression(source);
		return undefined;
	} catch (error) {
		return (error as { code?: string }).code;
	}
}

function expectQuantity(source: string, magnitude: number, unit: string): void {
	const value = evaluate(source);
	expect(value.type).toBe(ValueType.Uom);
	expect(value.unit).toBe(unit);
	expect(value.toNumber()).toBeCloseTo(magnitude, 6);
}

describe("a power written on a unit belongs to the unit", () => {
	test.each([
		["10 m^3 in litres", 10_000, "litres"],
		["1 m^3 in L", 1_000, "L"],
		["5 m^2", 5, "m²"],
		["5 m^2 in ft2", 53.8195520835, "ft2"],
		["5 metres^2", 5, "m²"],
		["5 feet^3 in litres", 141.5842327, "litres"],
		["-5 m^2", -5, "m²"],
		["2 * 5 m^2", 10, "m²"],
		["2 km^2", 2, "km²"],
		["3 in^2", 3, "in²"],
		["5 m^1", 5, "m"],
	])("%s is %d %s", (source, magnitude, unit) => {
		expectQuantity(source, magnitude, unit);
	});

	test("a power on the conversion target is the target's, as on the source", () => {
		expectQuantity("15 ft2 in m^2", 1.3935456, "m²");
	});

	test("a value beside the unit keeps the unit's power, not its own", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("x = 4");
		const value = engine.evaluateExpression("x m^2");
		expect(value.unit).toBe("m²");
		expect(value.toNumber()).toBe(4);
	});
});

describe("a quantity raised to a power keeps its unit", () => {
	test.each([
		["(3 m)^2", 9, "m²"],
		["(2 ft)^3", 8, "ft³"],
		["pow(3 m, 2)", 9, "m²"],
		["(5 m)^1", 5, "m"],
		// A length with no square spelling of its own is measured in metres first.
		["(5 furlong)^2", 1_011_714.1056, "m²"],
	])("%s is %d %s", (source, magnitude, unit) => {
		expectQuantity(source, magnitude, unit);
	});

	test("a variable holding a length squares into an area", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("a = 5 m");
		const value = engine.evaluateExpression("a^2");
		expect(value.unit).toBe("m²");
		expect(value.toNumber()).toBe(25);
	});

	test("a quantity to the power 0 is the plain number 1", () => {
		const value = evaluate("(5 m)^0");
		expect(value.type).toBe(ValueType.Number);
		expect(value.toNumber()).toBe(1);
	});
});

describe("the root of an area or volume is a length", () => {
	test.each([
		["sqrt(16 m^2)", 4, "m"],
		["sqrt(16 m2)", 4, "m"],
		["cbrt(27 m3)", 3, "m"],
		["root(2, 16 m2)", 4, "m"],
		["root(3, 8 ft3)", 2, "ft"],
		// An area with a name of its own answers in metres.
		["sqrt(1 ha)", 100, "m"],
	])("%s is %d %s", (source, magnitude, unit) => {
		expectQuantity(source, magnitude, unit);
	});
});

describe("a power or root with no unit to give is refused by name", () => {
	test.each(["5 kg^2", "5 m^4", "5 m^0.5", "9.81 ft/s^2", "2s^2", "10 GBP ^ 2", "5 furlong^2", "5 m^-1"])(
		"%s is refused while parsing",
		(source) => {
			expect(thrownCode(source)).toBe("UNIT_POWER_UNSUPPORTED");
		},
	);

	test.each([
		["(5 USD) ^ 2", "UNIT_POWER_UNSUPPORTED"],
		["$5^2", "UNIT_POWER_UNSUPPORTED"],
		["(5 m)^-1", "UNIT_POWER_UNSUPPORTED"],
		["(5 kg)^2", "UNIT_POWER_UNSUPPORTED"],
		["pow(5 kg, 2)", "UNIT_POWER_UNSUPPORTED"],
		["sqrt(16 m)", "UNIT_ROOT_UNSUPPORTED"],
		["sqrt(9 kg)", "UNIT_ROOT_UNSUPPORTED"],
		["sqrt(-4 m2)", "UNIT_ROOT_UNSUPPORTED"],
		["cbrt(27 m2)", "UNIT_ROOT_UNSUPPORTED"],
		["root(4, 16 m2)", "UNIT_ROOT_UNSUPPORTED"],
	])("%s is the error %s", (source, code) => {
		const value = evaluate(source);
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe(code);
	});
});

describe("forms that already worked are unchanged", () => {
	test.each([
		["9.81 m/s^2", 9.81, "mps2"],
		["15 m2 in ft2", 161.4586, "ft2"],
		["10 m3 in litres", 10_000, "litres"],
		["5 in litres", 5, "litres"],
		["3 ft in in", 36, "in"],
	])("%s is %d %s", (source, magnitude, unit) => {
		const value = evaluate(source);
		expect(value.unit).toBe(unit);
		expect(value.toNumber()).toBeCloseTo(magnitude, 3);
	});

	test("a unit name used as a variable is still a variable: m = 3 then m^2 is 9", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("m = 3");
		expect(engine.evaluateExpression("m^2").toNumber()).toBe(9);
	});

	test("plain powers and roots are untouched", () => {
		expect(evaluate("2 ^ 3 ^ 2").toNumber()).toBe(512);
		expect(evaluate("sqrt(16)").toNumber()).toBe(4);
		expect(evaluate("5^-1").toNumber()).toBeCloseTo(0.2, 12);
	});

	test("a unit target the lexer does not mark is left to the outer conversion: 100 EUR in €", () => {
		// `1 m3 in L` was the example here until #706 made `L` a lexer unit; it
		// converts the same either way.
		expectQuantity("1 m3 in L", 1_000, "L");
		// A currency symbol is not a lexer unit, and used to be a parse error.
		const euros = evaluate("100 EUR in €");
		expect(euros.unit).toBe("EUR");
		expect(euros.toNumber()).toBe(100);
	});

	test("`to best` still reaches the best-unit conversion once `to` is taken", () => {
		// The target check that leaves `in L` to the outer conversion must still
		// take `to` when `best` follows it.
		const value = evaluate("500 lux to best");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.toNumber()).toBeGreaterThan(0);
	});
});

describe("lengths multiply into areas and volumes (#533)", () => {
	// The general multiply converted the right operand into the left's unit and
	// then kept only that unit, so `5 m * 3 m` was reported as 15 m, a length.
	test.each([
		["5 m * 3 m", 15, "m²"],
		["5 m * 3 ft", 4.572, "m²"],
		["5 ft * 3 ft", 15, "ft²"],
		["5 km * 3 m", 0.015, "km²"],
		["5 m * 3 m in ft2", 161.4586, "ft2"],
		["2 m * 3 m * 4 m", 24, "m³"],
		["5 m2 * 3 m", 15, "m³"],
		["5 m2 * 3 ft", 4.572, "m³"],
		["3 m * 5 m2", 15, "m³"],
		// An area with a name of its own, or a length with no square spelling,
		// is measured in metres instead.
		["2 ha * 3 m", 60_000, "m³"],
		["2 furlong * 3 furlong", 242_811.385344, "m²"],
	])("%s is %d %s", (source, magnitude, unit) => {
		const value = evaluate(source);
		expect(value.type).toBe(ValueType.Uom);
		expect(value.unit).toBe(unit);
		expect(value.toNumber()).toBeCloseTo(magnitude, 3);
	});

	test("the product keeps exact decimals: 0.1 m * 0.2 m is exactly 0.02 m2", () => {
		expect(evaluate("0.1 m * 0.2 m == 0.02 m2").value).toBe(true);
	});

	test.each(["5 m2 * 3 m2", "5 m3 * 2 m"])("%s, more than three lengths, is refused by name", (source) => {
		const value = evaluate(source);
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.value)).toBe("UNIT_PRODUCT_UNSUPPORTED");
	});

	test("products that are not of lengths keep their own rules", () => {
		expectQuantity("5 m * 3", 15, "m");
		expect(evaluate("70 kg * 9.81 m/s^2").unit).toBe("N");
		expect(evaluate("10 N * 5 m").unit).toBe("J");
		expect(evaluate("5 kg * 3 m").type).toBe(ValueType.Error);
	});
});

describe("the spelling helpers", () => {
	test("poweredUnit finds the square and cube spellings of a length", () => {
		expect(poweredUnit("m", 2)).toBe("m²");
		expect(poweredUnit("km", 3)).toBe("km³");
		expect(poweredUnit("ft", 2)).toBe("ft²");
		expect(poweredUnit("metres", 3)).toBe("m³");
		expect(poweredUnit("feet", 2)).toBe("ft²");
	});

	test("poweredUnit has nothing for a non-length, an unsupported power, or a length the table does not spell", () => {
		expect(poweredUnit("kg", 2)).toBeUndefined();
		expect(poweredUnit("m", 4)).toBeUndefined();
		expect(poweredUnit("m", 1)).toBeUndefined();
		expect(poweredUnit("furlong", 2)).toBeUndefined();
		expect(poweredUnit("USD", 2)).toBeUndefined();
	});

	test("rootUnit reads the length back out of a spelled square or cube", () => {
		expect(rootUnit("m2", 2)).toBe("m");
		expect(rootUnit("ft3", 3)).toBe("ft");
		expect(rootUnit("km2", 2)).toBe("km");
	});

	test("rootUnit reads the superscript and the word spellings the same way (#513)", () => {
		expect(rootUnit("m²", 2)).toBe("m");
		expect(rootUnit("ft³", 3)).toBe("ft");
		expect(rootUnit("sq ft", 2)).toBe("ft");
		expect(rootUnit("square metres", 2)).toBe("m");
		expect(rootUnit("cubic feet", 3)).toBe("ft");
		expect(rootUnit("cu in", 3)).toBe("in");
	});

	test("poweredUnit prints the superscript spelling, which the table holds beside the digit one", () => {
		expect(poweredUnit("mi", 2)).toBe("mi²");
		expect(poweredUnit("yd", 3)).toBe("yd³");
	});

	test("rootUnit has nothing for an area with a name of its own, or a mismatched power", () => {
		expect(rootUnit("ha", 2)).toBeUndefined();
		expect(rootUnit("L", 3)).toBeUndefined();
		expect(rootUnit("m2", 3)).toBeUndefined();
		expect(rootUnit("m3", 2)).toBeUndefined();
		expect(rootUnit("sq ft", 3)).toBeUndefined();
		expect(rootUnit("cubic feet", 2)).toBeUndefined();
	});
});
