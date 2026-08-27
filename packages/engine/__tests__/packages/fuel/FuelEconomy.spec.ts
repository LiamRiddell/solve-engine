/**
 * Fuel economy (issue #190): miles per gallon and litres per 100 km, and the
 * conversion between them. The two describe the same thing upside down, so
 * converting is a reciprocal, not a rescale of each axis, which is why fuel
 * economy needs its own conversion route.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");

describe("the units read and display as themselves", () => {
	test("mpg and l/100km", () => {
		expect(shown("40 mpg")).toBe("40.00 mpg");
		expect(shown("6 l/100km")).toBe("6.00 l/100km");
	});
});

describe("the reciprocal conversion", () => {
	test("mpg to l/100km", () => {
		expect(shown("40 mpg in l/100km")).toBe("5.88 l/100km");
	});

	test("l/100km to mpg", () => {
		expect(shown("6 l/100km in mpg")).toBe("39.20 mpg");
	});

	test("the round trip returns the original", () => {
		expect(shown("40 mpg in l/100km in mpg")).toBe("40.00 mpg");
	});
});

describe("the same-direction conversion (distance per volume)", () => {
	test("mpg to km/l is a rescale, not a reciprocal", () => {
		expect(shown("30 mpg in km/l")).toBe("12.75 km/l");
	});

	test("a plain quotient of a distance and a volume is a rate", () => {
		expect(shown("500 km / 35 litres")).toBe("14.29 km/litres");
	});
});

describe("the boundary", () => {
	test("mpg is miles per US gallon, and stays an ordinary word off a number", () => {
		// The US gallon is the shipped gallon (see issue #190).
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":mpg = 30");
		expect(engine.evaluateLine(2, "mpg + 1").toNumber()).toBe(31);
	});
});
