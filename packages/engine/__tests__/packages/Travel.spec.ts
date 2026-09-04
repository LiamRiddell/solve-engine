/**
 * Travel: what a journey burns, and what that costs.
 *
 * Drive time and economy conversion already shipped; what was missing is the
 * pair of sums joining a distance, a car's economy and the price at the pump.
 * Neither is a unit conversion, because each needs two quantities of different
 * kinds.
 *
 * What is pinned: the arithmetic in both economy spellings, a price quoted in
 * a volume other than the one the fuel was computed in, the refusals, and the
 * two forms the issue lists as already covered, which this package does not
 * touch.
 *
 * The reciprocal is the thing to get wrong here. `mpg` is distance over volume
 * and `l/100km` is volume over distance, so a trip calculator that mixes them
 * halves or doubles the answer, which is why both directions are asserted
 * against hand-computed figures.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { litresForTrip, litresPer100Km } from "@solve-js/packages/travel";
import { newTrackedEngine } from "@tools/trackedEngine";

const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} finally {
		engine.clear();
	}
};

describe("the fuel a trip takes", () => {
	test("from an economy written as litres per hundred kilometres", () => {
		// 500 km at 7 l/100km is five hundredths of 7, five times over: 35.
		expect(answer("fuel for 500 km at 7 l/100km")).toBe("35.00 litre");
	});

	test("and from one written as miles per gallon", () => {
		// 300 miles at 35 mpg is 8.571 US gallons, and a US gallon is 3.785412
		// litres, so 32.45.
		expect(answer("fuel for 300 miles at 35 mpg")).toBe("32.45 litre");
	});

	test("`fuel to drive` reads the same as `fuel for`", () => {
		expect(answer("fuel to drive 500 km at 7 l/100km")).toBe("35.00 litre");
	});
});

describe("what the fuel costs", () => {
	test("at a price per litre", () => {
		expect(answer("cost to drive 500 km at 7 l/100km at £1.50/litre")).toBe("£52.50");
		expect(answer("cost to drive 300 miles at 35 mpg at £1.50/litre")).toBe("£48.67");
	});

	test("and at a price per gallon, which is the hire-car case", () => {
		// The litres are converted into the volume the pump quoted before
		// multiplying: 8.571 US gallons at $4.20.
		expect(answer("cost to drive 300 miles at 35 mpg at $4.20/gallon")).toBe("$36.00");
	});

	test("the price may also be written with `per`", () => {
		expect(answer("cost to drive 500 km at 7 l/100km at £1.50 per litre")).toBe("£52.50");
	});
});

describe("what is refused, and how", () => {
	test("a first quantity that is not a distance", () => {
		expect(answer("fuel for 50 kg at 7 l/100km")).toContain("a trip starts with a distance");
	});

	test("a second that is not an economy", () => {
		expect(answer("fuel for 500 km at 35 kg")).toContain("is not a fuel economy");
	});

	test("a price that is not money for a volume", () => {
		expect(answer("cost to drive 300 miles at 35 mpg at 5 kg")).toContain("an amount for a volume");
	});
});

describe("the reciprocal, directly", () => {
	test("both spellings reach the same litres per hundred kilometres", () => {
		expect(litresPer100Km(7, "l100km")).toBe(7);
		// 35 mpg is 14.875 km per litre, so 6.72 litres per hundred kilometres.
		expect(litresPer100Km(35, "mpg")).toBeCloseTo(6.72, 2);
	});

	test("and a unit that is neither answers null rather than a number", () => {
		// `convertUnit` would answer 1,488 here, which is what a wrong trip
		// calculator is built on.
		expect(litresPer100Km(35, "kg")).toBeNull();
		expect(litresForTrip(300, "kg", 35, "mpg")).toBeNull();
	});
});

describe("what this package deliberately does not touch", () => {
	test("drive time and economy conversion, which already shipped", () => {
		expect(answer("250 miles at 60 mph")).toBe("4.17 h");
		expect(answer("40 mpg in l/100km")).toBe("5.88 l/100km");
	});
});
