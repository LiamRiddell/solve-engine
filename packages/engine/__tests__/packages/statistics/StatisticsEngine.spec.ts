/**
 * The second-tier statistics reached through the engine grammar, both the
 * two-list phrase forms and the call forms (the maths itself is pinned in
 * StatisticsMath.spec.ts).
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("two-list phrase forms", () => {
	test("correlation of A and B", () => {
		expect(value("correlation of [1, 2, 3] and [2, 4, 6]").toNumber()).toBeCloseTo(1, 6);
	});
	test("slope and intercept of A and B", () => {
		expect(value("slope of [1, 2, 3] and [2, 4, 6]").toNumber()).toBeCloseTo(2, 6);
		expect(value("intercept of [1, 2, 3] and [2, 4, 6]").toNumber()).toBeCloseTo(0, 6);
	});
});

describe("call forms", () => {
	test("correlation / rsquared", () => {
		expect(value("correlation([1, 2, 3], [2, 4, 6])").toNumber()).toBeCloseTo(1, 6);
		expect(value("rsquared([1, 2, 3], [2, 4, 6])").toNumber()).toBeCloseTo(1, 6);
	});
	test("percentile", () => {
		expect(value("percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)").toNumber()).toBeCloseTo(9.1, 6);
	});
	test("zscore", () => {
		expect(value("zscore(9, [2, 4, 4, 4, 5, 5, 7, 9])").toNumber()).toBeCloseTo(2, 6);
	});
	test("normalcdf / normalpdf", () => {
		expect(value("normalcdf(1.96)").toNumber()).toBeCloseTo(0.975, 3);
		expect(value("normalpdf(0)").toNumber()).toBeCloseTo(0.39894, 4);
	});
});

describe("bad shapes fault", () => {
	test("mismatched lengths", () => {
		expect(value("correlation of [1, 2, 3] and [1, 2]").type).toBe(ValueType.Error);
	});
	test("percentile out of range", () => {
		expect(value("percentile([1, 2, 3], 150)").type).toBe(ValueType.Error);
	});
});

describe("the statistics package is removable", () => {
	test("without it, `correlation of` is not a clause", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-statistics") });
		let ok = false;
		try {
			ok = Math.abs(slim.evaluateLine(1, "correlation of [1, 2, 3] and [2, 4, 6]").toNumber() - 1) < 1e-6;
		} catch {
			ok = false;
		}
		expect(ok).toBe(false);
	});
});
