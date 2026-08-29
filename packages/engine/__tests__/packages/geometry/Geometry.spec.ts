/** Geometry formulae, pure and through the engine grammar. */
import { describe, expect, test } from "@jest/globals";
import { computeGeometry } from "@solve-js/packages/geometry/GeometryMath";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("computeGeometry (pure)", () => {
	test("plane shapes", () => {
		expect(computeGeometry("area", "circle", { radius: 5 }).value).toBeCloseTo(78.5398, 3);
		expect(computeGeometry("circumference", "circle", { radius: 5 }).value).toBeCloseTo(31.4159, 3);
		expect(computeGeometry("area", "square", { side: 4 }).value).toBe(16);
		expect(computeGeometry("perimeter", "square", { side: 4 }).value).toBe(16);
		expect(computeGeometry("area", "rectangle", { width: 4, height: 6 }).value).toBe(24);
		expect(computeGeometry("perimeter", "rectangle", { width: 4, height: 6 }).value).toBe(20);
		expect(computeGeometry("area", "triangle", { base: 3, height: 4 }).value).toBe(6);
	});

	test("solid shapes", () => {
		expect(computeGeometry("volume", "sphere", { radius: 3 }).value).toBeCloseTo(113.097, 2);
		expect(computeGeometry("surface", "sphere", { radius: 3 }).value).toBeCloseTo(113.097, 2);
		expect(computeGeometry("volume", "cube", { side: 2 }).value).toBe(8);
		expect(computeGeometry("surface", "cube", { side: 2 }).value).toBe(24);
		expect(computeGeometry("volume", "cylinder", { radius: 2, height: 5 }).value).toBeCloseTo(62.8319, 3);
		expect(computeGeometry("volume", "cone", { radius: 2, height: 6 }).value).toBeCloseTo(25.1327, 3);
	});

	test("a missing dimension is an error", () => {
		expect(computeGeometry("area", "circle", {}).error).toBeDefined();
		expect(computeGeometry("area", "circle", { side: 5 }).error).toBeDefined();
	});
});

describe("through the engine", () => {
	test("area / circumference of a circle", () => {
		expect(value("area of circle radius 5").toNumber()).toBeCloseTo(78.5398, 3);
		expect(value("circumference of circle radius 5").toNumber()).toBeCloseTo(31.4159, 3);
	});
	test("rectangle and triangle", () => {
		expect(value("area of rectangle width 4, height 6").toNumber()).toBe(24);
		expect(value("area of triangle base 3, height 4").toNumber()).toBe(6);
	});
	test("solids", () => {
		expect(value("volume of sphere radius 3").toNumber()).toBeCloseTo(113.097, 2);
		expect(value("volume of cylinder radius 2, height 5").toNumber()).toBeCloseTo(62.8319, 3);
	});
	test("a missing dimension faults", () => {
		expect(value("area of circle").type).toBe(ValueType.Error);
	});
});

describe("shape and dimension words are not reserved", () => {
	test("a variable named `width` still works", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":width = 10");
		expect(engine.evaluateLine(2, ":width * 2").toNumber()).toBe(20);
	});
});

describe("the geometry package is removable", () => {
	test("without it, `area of` is not a clause", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-geometry") });
		let ok = false;
		try {
			ok = Math.abs(slim.evaluateLine(1, "area of circle radius 5").toNumber() - 78.5398) < 0.01;
		} catch {
			ok = false;
		}
		expect(ok).toBe(false);
	});
});
