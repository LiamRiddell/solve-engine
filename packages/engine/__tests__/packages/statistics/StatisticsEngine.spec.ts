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

describe("a normal with a mean and a standard deviation (#527)", () => {
	test("the three-argument form standardises the value", () => {
		// P(X <= 110) for mean 100, sd 15, which is P(Z <= 2/3). This used to
		// read only the 110, take it as a z-score and answer 1.
		expect(value("normalcdf(110, 100, 15)").toNumber()).toBeCloseTo(0.747507, 5);
		expect(value("normalcdf(110, 100, 15)").toNumber()).toBe(value("normalcdf(10 / 15)").toNumber());
		expect(value("1 - normalcdf(130, 100, 15)").toNumber()).toBeCloseTo(0.02275, 4);
	});

	test("the density is per unit of the value, so it is divided by the sd", () => {
		// It used to answer 0, the standard density at z = 110.
		expect(value("normalpdf(110, 100, 15)").toNumber()).toBeCloseTo(0.0212965, 6);
		expect(value("normalpdf(100, 100, 15)").toNumber()).toBeCloseTo(0.3989423 / 15, 7);
	});

	test("the one-argument forms are unchanged", () => {
		expect(value("normalcdf(1.96)").toNumber()).toBeCloseTo(0.975, 3);
		expect(value("normalpdf(0)").toNumber()).toBeCloseTo(0.39894, 4);
	});

	const code = (source: string) => {
		const v = value(source);
		expect(v.type).toBe(ValueType.Error);
		return v.errorCode;
	};

	test("two arguments are refused: a mean with no spread has nothing to scale by", () => {
		expect(code("normalcdf(110, 100)")).toBe("STAT_ARGUMENT_COUNT");
		expect(code("normalpdf(110, 100)")).toBe("STAT_ARGUMENT_COUNT");
	});

	test("so are none and four", () => {
		expect(code("normalcdf()")).toBe("STAT_ARGUMENT_COUNT");
		expect(code("normalcdf(1, 2, 3, 4)")).toBe("STAT_ARGUMENT_COUNT");
	});

	test("a standard deviation must be positive", () => {
		expect(code("normalcdf(110, 100, 0)")).toBe("STAT_SD_NOT_POSITIVE");
		expect(code("normalpdf(110, 100, -15)")).toBe("STAT_SD_NOT_POSITIVE");
	});

	test("every argument must be a plain number, and the message names which", () => {
		const v = value("normalcdf(110, 100 kg, 15)");
		expect(v.errorCode).toBe("STAT_EXPECTED_VALUE");
		expect(v.errorMessage).toContain("mean");
	});
});

describe("no statistics call drops an argument", () => {
	test("an extra argument is refused by name rather than ignored", () => {
		const refused = [
			"percentile([1, 2, 3], 50, 9)",
			"zscore(1, [1, 2, 3], 5)",
			"correlation([1, 2, 3], [2, 4, 6], [1, 1, 1])",
			"slope([1, 2, 3], [2, 4, 6], 7)",
			"rsquared([1, 2, 3])",
		];
		for (const source of refused) {
			const v = value(source);
			expect({ source, code: v.errorCode }).toEqual({ source, code: "STAT_ARGUMENT_COUNT" });
		}
	});

	test("the phrase forms, which always pass two lists, still answer", () => {
		expect(value("correlation of [1, 2, 3] and [2, 4, 6]").toNumber()).toBeCloseTo(1, 6);
		expect(value("slope of [1, 2, 3] and [2, 4, 6]").toNumber()).toBeCloseTo(2, 6);
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
