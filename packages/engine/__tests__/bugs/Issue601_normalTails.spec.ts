import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { erfc, normalCdf, normalPdf } from "@solve-js/packages/statistics/DistributionMath";

/**
 * Issue #601: `normalcdf(1e308)` answered NaN. The exponential helpers split
 * their argument with `Math.trunc(x * 4096)`, which overflows near the top of
 * the double range, so the head became infinite and the product NaN. Past 40
 * the exponential has underflowed to zero anyway, so it now answers 0 there
 * without the arithmetic, and the tails answer 0 and 1.
 */

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source));

describe("the far tails are 0 and 1, and the density 0", () => {
	test.each([
		["normalcdf(1e308)", "= 1"],
		["normalcdf(-1e308)", "= 0"],
		["normalpdf(1e308)", "= 0"],
		["normalpdf(-1e308)", "= 0"],
		["normalcdf(1e200)", "= 1"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});
});

describe("adversarial: the whole range, and what must not change", () => {
	test("finite at every magnitude from 1 to the largest double, in both directions", () => {
		for (let exponent = 0; exponent <= 308; exponent++) {
			for (const z of [10 ** exponent, -(10 ** exponent), Number.MAX_VALUE, -Number.MAX_VALUE]) {
				expect(Number.isFinite(normalCdf(z))).toBe(true);
				expect(Number.isFinite(normalPdf(z))).toBe(true);
				expect(Number.isFinite(erfc(z))).toBe(true);
			}
		}
	});

	test("the infinities and NaN behave as before", () => {
		expect(normalCdf(Infinity)).toBe(1);
		expect(normalCdf(-Infinity)).toBe(0);
		expect(normalPdf(Infinity)).toBe(0);
		expect(Number.isNaN(normalCdf(NaN))).toBe(true);
	});

	test("the precise lower tail is kept, not rounded to zero early", () => {
		expect(normalCdf(-10)).toBeCloseTo(7.62e-24, 26);
		expect(normalCdf(-37)).toBeGreaterThan(0);
		expect(shown("normalcdf(-10)")).toBe("= 7.62e-24");
	});

	test("ordinary values are unchanged", () => {
		expect(shown("normalcdf(1.96)")).toBe("= 0.98");
		expect(shown("normalpdf(0)")).toBe("= 0.40");
		expect(shown("invnorm(0.975)")).toBe("= 1.96");
	});
});
