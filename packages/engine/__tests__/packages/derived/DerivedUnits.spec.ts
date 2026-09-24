/**
 * Named derived units on output (issue #191). Multiplying two compatible
 * quantities tracks their unit exponents, so `kg * m/s^2` composes into a force
 * and reads out as newtons. It stops at compatible quantities: a product that
 * names no derived unit, and a mismatch, both stay exactly as they were.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");
const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("a product composes onto its named derived unit", () => {
	test("force: mass times acceleration is newtons", () => {
		expect(shown("70 kg * 9.81 m/s^2 as N")).toBe("686.70 N");
	});

	test("power: voltage times current is watts", () => {
		expect(shown("230 V * 13 A as W")).toBe("2,990.00 W");
	});

	test("energy: force times length is joules", () => {
		expect(shown("50 N * 4 m as J")).toBe("200.00 J");
	});

	test("energy: power times time, read in kilowatt-hours", () => {
		expect(shown("2000 W * 3 hours as kWh")).toBe("6.00 kWh");
	});

	test("the name is produced even without an explicit `as`", () => {
		expect(shown("70 kg * 9.81 m/s^2")).toBe("686.70 N");
		expect(shown("230 V * 13 A")).toBe("2,990.00 W");
	});
});

describe("a quotient composes too", () => {
	test("power: energy over time is watts", () => {
		expect(shown("100 J / 5 s as W")).toBe("20.00 W");
	});

	test("pressure: force over area is pascals, and pressure times area is newtons", () => {
		expect(shown("200 N / 2 m²")).toBe("100.00 Pa");
		expect(shown("100 Pa * 2 m²")).toBe("200.00 N");
	});
});

describe("every spelling of a measure takes part (#513)", () => {
	test("imperial and word spellings compose as their metric counterparts do", () => {
		expect(shown("10 lbf * 3 ft")).toBe("40.67 J");
		expect(shown("5 lb * 9.8 m/s^2")).toBe("22.23 N");
	});

	test("a power for a clock-scale time is named in watt-hours with the power's prefix", () => {
		// A kilowatt for three hours reads as the unit an electricity bill uses,
		// not as 21,600,000 joules.
		expect(shown("2 kW * 3 h")).toBe("6.00 kWh");
		expect(shown("100 W * 3 hours")).toBe("300.00 Wh");
		expect(shown("2 kW * 30 min")).toBe("1.00 kWh");
		expect(shown("2 kW * 2 days")).toBe("96.00 kWh");
		// Seconds are the joule's own scale, so a watt for seconds stays in joules.
		expect(shown("100 W * 30 s")).toBe("3,000.00 J");
	});

	test("a watt-hour energy over a clock-scale time is a power in the matching watt", () => {
		expect(shown("6 kWh / 3 h")).toBe("2.00 kW");
		expect(shown("10 J / 2 s")).toBe("5.00 W");
	});

	test("the watt-hour answer converts like any energy", () => {
		expect(shown("2 kW * 3 h in J")).toBe("21,600,000.00 J");
		expect(shown("2000 W * 3 hours as kWh")).toBe("6.00 kWh");
	});
});

describe("it stops at compatible quantities", () => {
	test("`m/s^2` is acceleration, not the square of a speed", () => {
		// The whole point: the exponent binds to the second, not to `m/s`.
		expect(value("9.81 m/s^2").toNumber()).toBeCloseTo(9.81, 5);
	});

	test("a product of lengths is an area, not a derived unit and not a length", () => {
		// `m * m` names no derived unit, and it used to keep the left operand's
		// unit, reporting 15 m. A length times a length is an area (#533), which
		// the unit table holds without this feature inventing anything.
		expect(shown("5 m * 3 m")).toBe("15.00 m²");
	});

	test("a mismatch stays a mismatch", () => {
		// Mass times length is not a named derived unit, so it is still refused.
		expect(value("5 kg * 3 m").type).toBe(ValueType.Error);
	});

	test("asking for a unit the quantity cannot be is an error, not a wrong number", () => {
		expect(value("5 kg as N").type).toBe(ValueType.Error);
	});
});
