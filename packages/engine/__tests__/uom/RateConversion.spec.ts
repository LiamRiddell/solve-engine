/**
 * Unit-level tests for `convertRate`, the rate/speed conversion algebra.
 *
 * The end-to-end behaviour is pinned in
 * `hardening/DerivedAndCompoundUnits.spec.ts`; this file exercises the pure
 * function directly, so the dimension arithmetic (convert each axis on its own,
 * bridge a speed alias through metres per second) is checked without the
 * parser, normalizer or VM in the way, and a null (not a throw, not a wrong
 * number) is confirmed for the pairs that genuinely do not line up.
 */

import { describe, expect, test } from "@jest/globals";
import { convertRate } from "@solve-js/uom/UomConverter";

describe("rate to rate", () => {
	test.each([
		// source value, from, to, expected
		[10, "m/s", "km/h", 36],
		[36, "km/h", "m/s", 10],
		[60, "km/h", "m/s", 60_000 / 3600],
		[1, "mile/hour", "km/h", 1.609344],
		[100, "km/h", "km/h", 100],
	])("%f %s in %s is %f", (value, from, to, expected) => {
		expect(convertRate(value, from, to)).toBeCloseTo(expected, 6);
	});
});

describe("rate to a single-token speed spelling", () => {
	test.each([
		[100, "km/h", "mph", 62.137119],
		[100, "km/h", "kph", 100],
		[10, "m/s", "kph", 36],
		[10, "m/s", "mph", 22.369363],
	])("%f %s in %s is %f", (value, from, to, expected) => {
		expect(convertRate(value, from, to)).toBeCloseTo(expected, 6);
	});
});

describe("a single-token speed spelling to a rate", () => {
	test.each([
		[60, "mph", "km/h", 96.56064],
		[100, "kph", "m/s", 100_000 / 3600],
		[1, "mps", "km/h", 3.6],
	])("%f %s in %s is %f", (value, from, to, expected) => {
		expect(convertRate(value, from, to)).toBeCloseTo(expected, 6);
	});
});

describe("round trips are lossless", () => {
	test.each([
		["km/h", "mph"],
		["m/s", "km/h"],
		["km/h", "m/s"],
	])("%s to %s and back returns the original", (a, b) => {
		const there = convertRate(100, a, b)!;
		const back = convertRate(there, b, a)!;
		expect(back).toBeCloseTo(100, 9);
	});
});

describe("pairs that do not line up return null, not a wrong number", () => {
	test.each([
		// A rate has no plain-unit target: neither half is the whole thing.
		[100, "km/h", "km"],
		[5, "m/s", "s"],
		[100, "km/h", "kg"],
		// A plain unit is not a rate to begin with.
		[5, "km", "m/s"],
		[5, "kg", "km/h"],
		// Numerator measures differ (mass over time cannot become length over time).
		[5, "kg/s", "m/s"],
		// Denominator measures differ (per metre is not per second).
		[5, "km/m", "km/h"],
	])("convertRate(%f, %j, %j) is null", (value, from, to) => {
		expect(convertRate(value, from, to)).toBeNull();
	});
});

describe("a non-speed rate converts on its denominator", () => {
	test("mass per hour to mass per minute scales by 60", () => {
		// Nothing speed-specific: km/h and kg/h go down the same axis-by-axis path.
		expect(convertRate(60, "kg/h", "kg/min")).toBeCloseTo(1, 6);
	});
});
