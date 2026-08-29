/** Named constants through the engine, including their unit-arithmetic integration. */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("dimensioned constants", () => {
	test("speed of light and gravity carry a unit", () => {
		expect(value("speed of light").toNumber()).toBeCloseTo(299792458, 0);
		expect(value("speed of light").type).toBe(ValueType.Uom);
		expect(value("gravity").toNumber()).toBeCloseTo(9.80665, 5);
	});

	test("gravity takes part in unit arithmetic (force)", () => {
		// gravity (m/s^2) times a mass composes to a newton, via the 2.8.0
		// derived-unit algebra.
		expect(value("gravity * 70 kg as N").toNumber()).toBeCloseTo(686.4655, 3);
	});
});

describe("plain-value constants", () => {
	test.each([
		["avogadro", 6.02214076e23],
		["planck", 6.62607015e-34],
		["boltzmann", 1.380649e-23],
		["tau", 6.283185307],
		["golden ratio", 1.618033989],
		["phi", 1.618033989],
	])("%s", (source, expected) => {
		expect(value(source).toNumber() / expected).toBeCloseTo(1, 6);
	});
});

describe("the constants package is removable", () => {
	test("without it, `gravity` is not a constant", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-constants") });
		let ok = false;
		try {
			ok = Math.abs(slim.evaluateLine(1, "gravity").toNumber() - 9.80665) < 1e-4;
		} catch {
			ok = false;
		}
		expect(ok).toBe(false);
	});
});
