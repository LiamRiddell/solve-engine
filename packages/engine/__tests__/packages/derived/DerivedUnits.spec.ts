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
		expect(shown("230 V * 13 A as W")).toBe("2990.00 W");
	});

	test("energy: force times length is joules", () => {
		expect(shown("50 N * 4 m as J")).toBe("200.00 J");
	});

	test("energy: power times time, read in kilowatt-hours", () => {
		expect(shown("2000 W * 3 hours as kWh")).toBe("6.00 kWh");
	});

	test("the name is produced even without an explicit `as`", () => {
		expect(shown("70 kg * 9.81 m/s^2")).toBe("686.70 N");
		expect(shown("230 V * 13 A")).toBe("2990.00 W");
	});
});

describe("a quotient composes too", () => {
	test("power: energy over time is watts", () => {
		expect(shown("100 J / 5 s as W")).toBe("20.00 W");
	});
});

describe("it stops at compatible quantities", () => {
	test("`m/s^2` is acceleration, not the square of a speed", () => {
		// The whole point: the exponent binds to the second, not to `m/s`.
		expect(value("9.81 m/s^2").toNumber()).toBeCloseTo(9.81, 5);
	});

	test("a product that names nothing is unchanged", () => {
		// `m * m` keeps its old reading; the feature does not invent a unit for it.
		expect(shown("5 m * 3 m")).toBe("15.00 m");
	});

	test("a mismatch stays a mismatch", () => {
		// Mass times length is not a named derived unit, so it is still refused.
		expect(value("5 kg * 3 m").type).toBe(ValueType.Error);
	});

	test("asking for a unit the quantity cannot be is an error, not a wrong number", () => {
		expect(value("5 kg as N").type).toBe(ValueType.Error);
	});
});
