/**
 * Inline sparkline metadata (issue #186): a numeric vector or range carries a
 * downsampled series, its true min and max, and nothing else, so a frontend can
 * draw a line beside the plain answer. The text answer is untouched; this only
 * adds the plottable series.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { serializeValue } from "@solve-js/worker/serialize";
import { sparklineFor, SPARKLINE_MAX_SAMPLES } from "@solve-js/format/Sparkline";
import { rangeValue, numberValue, matrixValue } from "@solve-js/vm/Value";

const evaluate = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("sparklineFor", () => {
	test("a numeric row vector carries its own values", () => {
		expect(sparklineFor(evaluate("[120, 135, 128, 150, 162]"))).toEqual({
			series: [120, 135, 128, 150, 162],
			min: 120,
			max: 162,
		});
	});

	test("a mapped range is plottable", () => {
		expect(sparklineFor(evaluate("map(x^2, 0:5)"))).toEqual({
			series: [0, 1, 4, 9, 16, 25],
			min: 0,
			max: 25,
		});
	});

	test("a scalar has no series", () => {
		expect(sparklineFor(evaluate("42"))).toBeNull();
	});

	test("a range value plots its integers", () => {
		expect(sparklineFor(rangeValue(0, 4))).toEqual({ series: [0, 1, 2, 3, 4], min: 0, max: 4 });
	});

	test("a wide range is downsampled, not expanded, keeping its true extent", () => {
		const spark = sparklineFor(rangeValue(0, 100000))!;
		expect(spark.series.length).toBe(SPARKLINE_MAX_SAMPLES);
		expect(spark.min).toBe(0);
		expect(spark.max).toBe(100000);
		expect(spark.series[0]).toBe(0);
		expect(spark.series[spark.series.length - 1]).toBe(100000);
	});

	test("a long vector is capped at the sample limit, endpoints kept", () => {
		const data = Array.from({ length: 500 }, (_, i) => i);
		const spark = sparklineFor(matrixValue(1, data.length, data))!;
		expect(spark.series.length).toBe(SPARKLINE_MAX_SAMPLES);
		expect(spark.series[0]).toBe(0);
		expect(spark.series[spark.series.length - 1]).toBe(499);
	});

	test("a non-numeric or symbolic vector carries nothing", () => {
		// A single-element vector is not a line.
		expect(sparklineFor(matrixValue(1, 1, [5]))).toBeNull();
	});
});

describe("sparkline serialisation", () => {
	test("the DTO carries the series, and survives structuredClone", () => {
		const dto = serializeValue(evaluate("[3, 1, 4, 1, 5, 9, 2, 6]"));
		expect(dto.sparkline).toEqual({ series: [3, 1, 4, 1, 5, 9, 2, 6], min: 1, max: 9 });
		expect(structuredClone(dto)).toEqual(dto);
		expect(JSON.parse(JSON.stringify(dto)).sparkline.max).toBe(9);
	});

	test("a scalar DTO has no sparkline", () => {
		expect(serializeValue(numberValue(42)).sparkline).toBeUndefined();
	});
});
