/**
 * Unit algebra (#513): units multiply, divide and cancel the way numbers do.
 *
 * A product or quotient of two quantities carries the unit the two make
 * together, a rate cancels against the quantity it is per, and a square or cube
 * root takes an area or volume back to a length. Where the combined unit is not
 * one the engine can show (a mass squared, a speed divided by a time), the
 * answer is a named error, never the left operand's unit worn by the wrong
 * number. Before this, `2 kg * 3 kg` was 6 kg, `3 kg * $5/kg` was 15.00 USD/kg,
 * `$0.30/kWh` was an undefined variable, and `(100 km/h) / 2 h` was 50 km/h/h.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";

function evaluate(source: string): Value {
	return newTrackedEngine().evaluateExpression(source);
}

/** The answer as the gutter prints it, without the leading `=`. */
function shown(source: string): string {
	return formatValue(evaluate(source)).replace(/^=\s*/, "");
}

function errorCode(source: string): string | undefined {
	const value = evaluate(source);
	expect(value.type).toBe(ValueType.Error);
	return value.errorCode;
}

describe("a product carries the unit its two quantities make", () => {
	test.each([
		["5 m * 3 m", "15.00 m²"],
		["2 m * 3 m * 4 m", "24.00 m³"],
		["5 m * 3 ft", "4.57 m²"],
		["10 ft * 12 ft", "120.00 ft²"],
		["4 m * 2.5 m * 2", "20.00 m²"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("an area worked out is the same unit as the table's own spellings, so it compares, adds and converts", () => {
		expect(evaluate("5 m * 3 m == 15 m2").value).toBe(true);
		expect(shown("5 m * 3 m + 2 m2")).toBe("17.00 m²");
		expect(shown("15 m² + 10 sq ft")).toBe("15.93 m²");
		expect(shown("3 m * 2 m in square feet")).toBe("64.58 square feet");
		expect(shown("3 m * 2 m in sq ft")).toBe("64.58 sq ft");
		expect(shown("5 m * 3 m in m2")).toBe("15.00 m2");
	});

	test("variables holding lengths multiply the same way", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "width = 4 m");
		engine.evaluateLine(2, "height = 2.5 m");
		expect(formatValue(engine.evaluateLine(3, "width * height"))).toBe("= 10.00 m²");
	});
});

describe("a like product that has no unit is refused by name", () => {
	test.each([
		"2 kg * 3 kg",
		"3 lb * 2 kg",
		"2 s * 3 s",
		"$5 * $3",
		"60 mph * 60 mph",
		"20 C * 3 C",
	])("%s", (source) => {
		// Each of these used to keep the left operand's unit: 2 kg * 3 kg was 6 kg.
		expect(errorCode(source)).toBe("UNIT_PRODUCT_UNSUPPORTED");
	});

	test("the message names what was multiplied", () => {
		expect(evaluate("2 kg * 3 kg").errorMessage).toMatch(/mass times mass is not a unit/);
		expect(evaluate("$5 * $3").errorMessage).toMatch(/money times money is not a unit/);
	});

	test("two different kinds with no named product are still a mismatch", () => {
		expect(errorCode("2 kg * 3 m")).toBe("INCOMPATIBLE_UNITS");
	});

	test("money times a count keeps its own rule", () => {
		expect(shown("$5 * 3 kg")).toBe("$15.00");
		expect(shown("$30 * 4 days")).toBe("$120.00");
	});
});

describe("a quotient of lengths cancels down to a length or an area", () => {
	test.each([
		["15 m² / 3 m", "5.00 m"],
		["15 m2 / 3 m", "5.00 m"],
		["24 m³ / 6 m²", "4.00 m"],
		["24 m³ / 6 m", "4.00 m²"],
		["1 ha / 50 m", "200.00 m"],
		["15 ft² / 3 ft", "5.00 ft"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("like units still cancel to a plain number", () => {
		expect(evaluate("15 m² / 3 m²").toNumber()).toBe(5);
		expect(evaluate("10 m / 5 m").toNumber()).toBe(2);
	});

	test("a length over an area is left as the rate it always was", () => {
		expect(shown("10 m / 2 m²")).toBe("5.00 m/m²");
	});
});

describe("powers and roots of a quantity", () => {
	test.each([
		["(3 m)^2", "9.00 m²"],
		["5 m^2", "5.00 m²"],
		["sqrt(9 m²)", "3.00 m"],
		["sqrt(9 m^2)", "3.00 m"],
		["(9 m²)^0.5", "3.00 m"],
		["(27 m³)^(1/3)", "3.00 m"],
		["cbrt(27 m3)", "3.00 m"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("a root with no whole-power unit is refused by name", () => {
		expect(errorCode("sqrt(5 m)")).toBe("UNIT_ROOT_UNSUPPORTED");
		expect(errorCode("(5 m)^0.5")).toBe("UNIT_POWER_UNSUPPORTED");
		expect(errorCode("(8 m²)^(1/3)")).toBe("UNIT_POWER_UNSUPPORTED");
	});
});

describe("square and cubic spellings are units as typed", () => {
	test.each([
		["15 m² in ft²", "161.46 ft²"],
		["15 sq ft", "15.00 sq ft"],
		["15 sq ft in m²", "1.39 m²"],
		["15 square metres in ft²", "161.46 ft²"],
		["2 cubic metres in litres", "2,000.00 litres"],
		["10 cu ft in L", "283.17 L"],
		["5 sq in in cm²", "32.26 cm²"],
		["(2 + 3) sq ft", "5.00 sq ft"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("a square or cubic unit in words is a power of the length it names", () => {
		// `sq ft` shares its table entry with `ft²`, so it is measured in feet,
		// not converted to metres as an area with a name of its own would be.
		expect(shown("2 sq ft * 3 ft")).toBe("6.00 ft³");
		expect(shown("sqrt(9 square feet)")).toBe("3.00 ft");
		expect(shown("cbrt(8 cubic feet)")).toBe("2.00 ft");
		expect(shown("sqrt(1 ha)")).toBe("100.00 m");
	});

	test("a two-word unit that was already fused is unchanged", () => {
		expect(shown("2 fl oz in ml")).toBe("59.15 ml");
		expect(shown("3 ft in in")).toBe("36.00 in");
	});
});

describe("a price per unit cancels against that unit", () => {
	test.each([
		["6 kWh * $0.30/kWh", "$1.80"],
		["$0.30/kWh * 6 kWh", "$1.80"],
		["3 kg * $5/kg", "$15.00"],
		["3 kg * $5 per kg", "$15.00"],
		["3 kg * £2 per kg", "£6.00"],
		["2 kW * 3 h * $0.30/kWh", "$1.80"],
		["6 kWh at $0.30/kWh", "$1.80"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("the price binds to its own amount, not to everything before it", () => {
		// Read as (3 kg * $5) per kg, this used to be 15.00 USD/kg.
		const value = evaluate("3 kg * $5/kg");
		expect(value.unit).toBe("USD");
		expect(value.toNumber()).toBe(15);
	});

	test("a price per a unit spelled with capitals is a rate, not a variable", () => {
		expect(shown("$0.30/kWh")).toBe("0.30 USD/kWh");
		expect(shown("$2/GB * 5 GB")).toBe("$10.00");
	});

	test("money divided by a price is the quantity it buys", () => {
		expect(shown("$100 / ($5/kg)")).toBe("20.00 kg");
		expect(shown("$100 / $5/kg")).toBe("20.00 kg");
		// A word takes its plural, as `at` has always given it; a symbol does not.
		expect(shown("$100 / $5/hour")).toBe("20 hours");
		expect(shown("$100 / $5/h")).toBe("20.00 h");
	});

	test("the plural of a count is the same unit, never a symbol plus s", () => {
		// `hs` is a hectosecond and `ms` a millisecond: `$500 at $20/h` used to
		// answer 25 hectoseconds and `$500 at $20/m` 25 milliseconds.
		expect(shown("$500 at $20/h")).toBe("25.00 h");
		expect(shown("$500 at $20/m")).toBe("25.00 m");
		expect(shown("$500 at $20/hour")).toBe("25 hours");
	});

	test("a single capital letter after a slash is still a variable", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "total = 20");
		engine.evaluateLine(2, "N = 4");
		expect(engine.evaluateLine(3, "total / N").toNumber()).toBe(5);
	});
});

describe("a number over a quantity is its reciprocal (#570)", () => {
	test.each([
		["1 / (2 m)", "0.50 /m"],
		["10 / (5 s)", "2.00 /s"],
		["1 / $5", "0.20 /USD"],
		["1 / (2/week)", "0.50 week"],
		["1 / (50 Hz)", "0.02 s"],
		["1 / (30 mpg)", "0.03 gal/mi"],
		["1 / ($5/kg)", "0.20 kg/USD"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("a rate turns over, so a speed's reciprocal is a pace", () => {
		const value = evaluate("1 / (60 km/h)");
		expect(value.unit).toBe("h/km");
		expect(value.toNumber()).toBeCloseTo(1 / 60, 12);
	});

	test("the reciprocal cancels against the quantity again", () => {
		expect(evaluate("1 / (2 m) * 4 m").toNumber()).toBe(2);
		expect(evaluate("1 / (2 h) * 6 h").toNumber()).toBe(3);
	});

	test("a variable holding a quantity turns over the same way", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "width = 4 m");
		expect(formatValue(engine.evaluateLine(2, "2 / width"))).toBe("= 0.50 /m");
	});

	test("a quantity with no reciprocal the engine can show is refused by name", () => {
		expect(errorCode("1 / (20 C)")).toBe("UNIT_RECIPROCAL_UNSUPPORTED");
	});

	test("a fraction written in front of a unit is still that much of the unit", () => {
		expect(shown("1 / 2 hour")).toBe("0.50 hour");
		expect(shown("1/2 hour")).toBe("0.50 hour");
		expect(shown("3 / 4 cup")).toBe("0.75 cup");
		expect(shown("10 / 2 m")).toBe("5.00 m");
		expect(shown("-1/2 hour")).toBe("-0.50 hour");
		expect(shown("2 * 1/2 hour")).toBe("1 hour");
		expect(shown("1/2 m^2")).toBe("0.50 m²");
		expect(shown("1 / 2 m in cm")).toBe("50.00 cm");
	});

	test("a quantity or a symbol before the slash is still a division", () => {
		expect(shown("100 km / 2 h")).toBe("50.00 km/h");
		expect(shown("$10 / 2 h")).toBe("5.00 USD/h");
		// Straight after a division or a power the number is that operator's.
		expect(shown("6 / 3 / 2 h")).toBe("1.00 /h");
	});
});

describe("a rate cancels against what it is per", () => {
	test.each([
		["60 mph * 2 hours", "120.00 mi"],
		["2 h * 60 mph", "120.00 mi"],
		["120 miles / 60 mph", "2.00 h"],
		["120 km / 60 km/h", "2.00 h"],
		["20 m² / (5 m²/l)", "4.00 l"],
		["4 m * 2.5 m * 2 / (12 m²/l)", "1.67 l"],
		["100 miles / 30 mpg", "3.33 gal"],
		["4 GB / 50 Mbps", "640.00 s"],
		["500 l / 20 lpm", "25.00 min"],
		["$30/hour * 8 hours/day", "240.00 USD/day"],
		["60 km/h * 2 h/day", "120.00 km/day"],
		["(100 km/h) / (10 l/h)", "10.00 km/l"],
		["(60 km/h) / (2 km)", "30.00 /h"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("two rates of the same kind make a plain ratio", () => {
		expect(evaluate("(10 km/h) / (5 mi/h)").toNumber()).toBeCloseTo(1.2427, 4);
	});

	test("a quotient with a compound rate that cancels nothing is refused by name", () => {
		// These used to join another slash on: 50 km/h/h and 2 kg/m/s.
		expect(errorCode("(100 km/h) / (2 h)")).toBe("UNIT_QUOTIENT_UNSUPPORTED");
		expect(errorCode("10 kg / (5 m/s)")).toBe("UNIT_QUOTIENT_UNSUPPORTED");
	});

	test("a rate that must meet its own denominator says so", () => {
		expect(errorCode("$0.30/kWh * 2 kW * 3 h")).toBe("RATE_MUL_MEASURE_MISMATCH");
	});

	test("a named rate that cancels nothing keeps the rate it always made", () => {
		expect(shown("100 kg / 30 mph")).toBe("3.33 kg/mph");
	});
});
