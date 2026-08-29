/**
 * The statistics maths against known values. Hand-checked constants are the only
 * guard on formulae like these, where a wrong divisor or a swapped term gives a
 * plausible-looking but wrong number.
 */
import { describe, expect, test } from "@jest/globals";
import {
	correlation, slope, intercept, rSquared,
	percentile, zScore, normalCdf, normalPdf,
} from "@solve-js/packages/statistics/StatisticsMath";

describe("correlation and regression", () => {
	test("a perfect positive relationship is 1", () => {
		expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
	});
	test("a perfect negative relationship is -1", () => {
		expect(correlation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 10);
	});
	test("slope and intercept of the best-fit line", () => {
		expect(slope([1, 2, 3], [2, 4, 6])).toBeCloseTo(2, 10);
		expect(intercept([1, 2, 3], [2, 4, 6])).toBeCloseTo(0, 10);
	});
	test("r squared is the square of the correlation", () => {
		expect(rSquared([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
	});
});

describe("percentile (linear interpolation)", () => {
	test("the 50th percentile is the median", () => {
		expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 10);
	});
	test("the 90th percentile of 1..10", () => {
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1, 10);
	});
	test("the 25th percentile of 1..4", () => {
		expect(percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75, 10);
	});
});

describe("z-score", () => {
	test("standardises against the list", () => {
		const xs = [2, 4, 4, 4, 5, 5, 7, 9]; // mean 5, population stdev 2
		expect(zScore(5, xs)).toBeCloseTo(0, 10);
		expect(zScore(9, xs)).toBeCloseTo(2, 10);
	});
});

describe("normal distribution", () => {
	test("the CDF at the standard points", () => {
		expect(normalCdf(0)).toBeCloseTo(0.5, 6);
		expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
		expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4);
	});
	test("the PDF peak is 1/sqrt(2π)", () => {
		expect(normalPdf(0)).toBeCloseTo(0.3989422804, 8);
	});
});
