/** Health helpers, pure and through the engine. */
import { describe, expect, test } from "@jest/globals";
import { bmi, speedKmh, pacePerKm } from "@solve-js/packages/health/HealthOps";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");
const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("pure", () => {
	test("bmi", () => expect(bmi(70, 1.75)).toBeCloseTo(22.857, 3));
	test("speed km/h", () => expect(speedKmh(10, 50)).toBeCloseTo(12, 6));
	test("pace per km", () => {
		expect(pacePerKm(10, 50)).toBe("5:00");
		expect(pacePerKm(10, 47)).toBe("4:42");
	});
});

describe("through the engine", () => {
	test("bmi", () => {
		expect(value("bmi(70, 1.75)").toNumber()).toBeCloseTo(22.857, 3);
	});
	test("pace is a per-km string", () => {
		expect(shown("pace(10, 50)")).toBe("5:00 /km");
	});
	test("speed is km/h", () => {
		expect(value("speed(10, 50)").toNumber()).toBeCloseTo(12, 6);
	});
	test("a bad input faults", () => {
		expect(value("bmi(70, 0)").type).toBe(ValueType.Error);
	});
});

describe("the health package is removable", () => {
	test("without it, bmi(...) is not a known function", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-health") });
		let ok = false;
		try {
			ok = Math.abs(slim.evaluateLine(1, "bmi(70, 1.75)").toNumber() - 22.857) < 0.01;
		} catch {
			ok = false;
		}
		expect(ok).toBe(false);
	});
});
