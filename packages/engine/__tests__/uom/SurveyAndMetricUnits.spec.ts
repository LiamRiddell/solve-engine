/**
 * Length and mass units that the generated table does not carry.
 *
 * The table is a mirror of the `convert` package and cannot be hand-edited, so
 * these live in `ExtendedUnits.ts`. What is new is that they name a measure the
 * base table already has: an extended unit declaring `measure: "length"` states
 * its ratio in the same metres, so the two tables compose and a furlong can
 * reach a kilometre.
 *
 * Ratios are asserted against their defining relationships rather than against
 * a decimal someone typed. A furlong is ten chains and a mile is eight
 * furlongs, and those are the facts worth pinning: a transcription slip in the
 * metre value would still satisfy a test that only checked the metre value.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { convertUnit, canConvert } from "@solve-js/uom/UomConverter";

/** Evaluates one line through a real engine and returns the formatted result. */
function evaluate(source: string): string {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(source)).replace(/^=\s*/, "");
	} finally {
		engine.clear();
	}
}

describe("the surveying chain of length units", () => {
	test("each is defined in terms of the one below it", () => {
		// The relationships are exact by definition, so these are equalities
		// rather than approximations.
		expect(convertUnit(1, "chain", "rod")).toBeCloseTo(4, 9);
		expect(convertUnit(1, "furlong", "chain")).toBeCloseTo(10, 9);
		expect(convertUnit(1, "mile", "furlong")).toBeCloseTo(8, 9);
		expect(convertUnit(1, "league", "mile")).toBeCloseTo(3, 9);
	});

	test("and reaches metres, which is the point of the bridge", () => {
		expect(evaluate("1 furlong in m")).toBe("201.17 m");
		expect(evaluate("1 chain in m")).toBe("20.12 m");
		expect(evaluate("1 rod in m")).toBe("5.03 m");
		expect(evaluate("1 league in km")).toBe("4.83 km");
	});

	test("the small ones", () => {
		// A hand is four inches, and a mil is a thousandth of one.
		expect(convertUnit(1, "hand", "in")).toBeCloseTo(4, 9);
		expect(convertUnit(1, "in", "mil")).toBeCloseTo(1000, 6);
		expect(evaluate("1 hand in cm")).toBe("10.16 cm");
	});

	test("a cable is a tenth of a nautical mile", () => {
		expect(convertUnit(10, "cable", "nmi")).toBeCloseTo(1, 9);
	});

	test("plurals resolve to the same unit", () => {
		for (const [singular, plural] of [["furlong", "furlongs"], ["chain", "chains"], ["rod", "rods"], ["carat", "carats"]]) {
			expect(convertUnit(1, singular, plural)).toBeCloseTo(1, 12);
		}
	});
});

describe("mass units the table lacks", () => {
	test("the carat is the metric one, exactly 200 mg", () => {
		// Not the older variable gemstone carat, and not the karat that measures
		// gold purity, which is not a mass at all.
		expect(convertUnit(1, "carat", "mg")).toBeCloseTo(200, 9);
		expect(evaluate("2 carats in mg")).toBe("400.00 mg");
	});

	test("the centner is the metric hundred kilograms", () => {
		// The Imperial hundredweight is a different quantity and already exists
		// separately as `cwt`, so the two must not agree.
		expect(convertUnit(1, "centner", "kg")).toBeCloseTo(100, 9);
		expect(convertUnit(1, "centner", "kg")).not.toBeCloseTo(convertUnit(1, "cwt", "kg"), 3);
	});
});

describe("the bridge does not leak", () => {
	test("it works in both directions", () => {
		expect(evaluate("1 mile in furlongs")).toBe("8.00 furlongs");
		expect(evaluate("1 m in mil")).toBe("39370.08 mil");
	});

	test("a measure the base table has no concept of stays unreachable", () => {
		// The bridge is keyed on the measure name, so pace and speed, which the
		// base table knows nothing about, must not become convertible to a length
		// just because they also live in the extended table.
		expect(canConvert("min_km", "m")).toBe(false);
		expect(canConvert("mph", "km")).toBe(false);
	});

	test("measures that were never related stay unrelated", () => {
		expect(canConvert("furlong", "kg")).toBe(false);
		expect(canConvert("carat", "m")).toBe(false);
	});
});
