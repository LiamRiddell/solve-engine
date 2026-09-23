import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issues #528 and #529: the spread in `center +/- spread` was read as a bare
 * number whatever it was written as.
 *
 * - #528: `100 +/- 5%` gave `100 ± 0.05`, the percentage read as its
 *   proportion. A percentage tolerance is relative to the value, so it is
 *   `100 ± 5`.
 * - #529: `5 m +/- 1 cm` gave `5 ± 1`, both units dropped before either was
 *   converted, a spread a hundred times too wide. The spread is now converted
 *   into the center's unit first, and a unit that cannot be is refused.
 *
 * See toleranceSpread() in vm/VMConversion.ts.
 */

const value = (source: string) => newTrackedEngine().evaluateExpression(source);

function measured(source: string): { center: number; spread: number } {
	const v = value(source);
	expect(v.type).toBe(ValueType.Number);
	expect(v.uncertainty).toBeDefined();
	return { center: v.toNumber(), spread: v.uncertainty as number };
}

describe("#528: a percentage tolerance is relative to the value", () => {
	test.each([
		["100 +/- 5%", 100, 5],
		["100 ± 5%", 100, 5],
		["12.3 +/- 2%", 12.3, 0.246],
		["-100 +/- 5%", -100, 5],
		["$100 +/- 5%", 100, 5],
		["5 m +/- 2%", 5, 0.1],
	])("%s is %d ± %d", (source, center, spread) => {
		const m = measured(source);
		expect(m.center).toBeCloseTo(center, 9);
		expect(m.spread).toBeCloseTo(spread, 9);
	});

	test("and propagates like any other spread", () => {
		const m = measured("(100 +/- 5%) * 2");
		expect(m.spread).toBeCloseTo(10, 9);
	});

	test("on a percentage the tolerance stays in percentage points", () => {
		// A poll at 45% give or take 3 points, the reading it always had.
		const m = measured("45% +/- 3%");
		expect(m.center).toBeCloseTo(0.45, 9);
		expect(m.spread).toBeCloseTo(0.03, 9);
	});
});

describe("#529: a tolerance in another unit is converted first", () => {
	test.each([
		["5 m +/- 1 cm", 5, 0.01],
		["5 km +/- 100 m", 5, 0.1],
		["1 kg +/- 5 g", 1, 0.005],
		["5m +/- 1m", 5, 1],
		["$100 +/- $5", 100, 5],
	])("%s is %d ± %d", (source, center, spread) => {
		const m = measured(source);
		expect(m.center).toBeCloseTo(center, 9);
		expect(m.spread).toBeCloseTo(spread, 9);
	});

	test("a temperature tolerance converts as an interval, not a reading", () => {
		// 1 °F as a temperature is -17.2 °C; as a width it is 5/9 of a degree.
		expect(measured("20 C +/- 1 F").spread).toBeCloseTo(5 / 9, 9);
		expect(measured("20 C +/- 1 K").spread).toBeCloseTo(1, 9);
	});

	test("a plain spread on a value with a unit is taken in that unit, as documented", () => {
		expect(measured("5 m +/- 0.1").spread).toBeCloseTo(0.1, 9);
	});

	test("a unit that cannot be converted is refused by name", () => {
		for (const source of ["5 m +/- 1 kg", "5 +/- 1 cm"]) {
			const v = value(source);
			expect({ source, code: v.errorCode }).toEqual({ source, code: "UNCERTAINTY_UNIT_MISMATCH" });
		}
	});
});

describe("unchanged forms", () => {
	test("a plain tolerance, and a negative one read as its magnitude", () => {
		expect(measured("12.3 +/- 0.5").spread).toBeCloseTo(0.5, 9);
		expect(measured("5 +/- -2").spread).toBeCloseTo(2, 9);
	});

	test("a percentage applied to a measurement afterwards is still a scalar", () => {
		const m = measured("(100 +/- 5) + 10%");
		expect(m.center).toBeCloseTo(110, 9);
		expect(m.spread).toBeCloseTo(5.5, 9);
	});
});
