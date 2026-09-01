/**
 * `<quantity> at <rate>` where the rate is a speed or a bandwidth gives a
 * duration (issues #280 and #276): a distance at a speed, a data size at a
 * bandwidth. Guards the figures, and that the money `at`-rate is untouched.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const num = (s: string) => newTrackedEngine().evaluateExpression(s).toNumber();
const shown = (s: string) => formatValue(newTrackedEngine().evaluateExpression(s)).replace(/^=\s*/, "");

describe("drive time: distance at a speed", () => {
	test("250 miles at 60 mph is 15,000 seconds, shown in hours", () => {
		expect(num("(250 miles at 60 mph) in seconds")).toBeCloseTo(15000, 2);
		expect(shown("250 miles at 60 mph")).toBe("4.17 h");
	});

	test("metric and other speed units line up too", () => {
		expect(num("(100 km at 60 kph) in minutes")).toBeCloseTo(100, 2); // 100/60 h = 100 min
		expect(shown("100 km at 60 kph")).toBe("1.67 h");
	});
});

describe("transfer: data size at a bandwidth", () => {
	test("4 GB at 50 Mbps is 640 seconds, shown in minutes", () => {
		expect(num("(4 GB at 50 Mbps) in seconds")).toBeCloseTo(640, 2);
		expect(shown("4 GB at 50 Mbps")).toBe("10.67 min");
	});

	test("bits and bytes are eight apart, from the unit's case", () => {
		// 50 Mbps (megabits) vs 50 MBps (megabytes): the byte rate is 8x faster.
		expect(num("(1 GB at 100 Mbps) in seconds")).toBeCloseTo(80, 2);
		expect(num("(1 GB at 100 MBps) in seconds")).toBeCloseTo(10, 2);
	});

	test("a fast link resolves to seconds", () => {
		expect(shown("2 GB at 1 Gbps")).toBe("16.00 s");
	});
});

describe("the boundaries", () => {
	test("a quantity that does not match the rate's numerator is refused", () => {
		// Mass at a speed: the numerator is a length, so this does not line up.
		expect(newTrackedEngine().evaluateExpression("5 kg at 60 mph").type).toBe(ValueType.Error);
	});

	test("the money `at`-rate keeps its own answer, unchanged", () => {
		expect(shown("$500 at $20/hour")).toBe("25 hours");
		expect(shown("30 hours at $30/hour")).toBe("$900.00");
	});
});
