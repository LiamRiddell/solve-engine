/**
 * Cooking: the gas-mark scale, and scaling a recipe by its servings.
 *
 * A gas mark is a dial setting, not a unit: the marks are a published table
 * with uneven steps, so reading one is a lookup rather than a formula. Scaling
 * by servings is a factor derived from two counts, which the cook applies to
 * whatever they are measuring.
 *
 * What is pinned: both spellings a recipe uses, the table in both directions,
 * the refusals for a temperature no dial reaches and a setting no dial has,
 * and the boundary that keeps `gas` an ordinary word everywhere else.
 */

import { describe, expect, test } from "@jest/globals";
import { GAS_MARKS, celsiusForGasMark, gasMarkForCelsius } from "@solve-js/packages/cooking";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} finally {
		engine.clear();
	}
};

describe("the table", () => {
	test("runs from the two slow settings to nine, with the published temperatures", () => {
		expect(GAS_MARKS.map((row) => row.written)).toEqual(["1/4", "1/2", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
		expect(celsiusForGasMark(4)).toBe(180);
		expect(celsiusForGasMark(0.25)).toBe(110);
		expect(celsiusForGasMark(9)).toBe(240);
	});

	test("reads back the mark a temperature stands for", () => {
		expect(gasMarkForCelsius(180)?.written).toBe("4");
		expect(gasMarkForCelsius(200)?.written).toBe("6");
	});

	test("and refuses a temperature no dial reaches", () => {
		// Ten degrees is half the widest step in the table, so anything further
		// out is not a setting rather than a near one.
		expect(gasMarkForCelsius(300)).toBeNull();
		expect(gasMarkForCelsius(50)).toBeNull();
	});
});

describe("reading a temperature as a gas mark", () => {
	test("from Celsius and from Fahrenheit alike", () => {
		expect(answer("180C in gas mark")).toBe("gas 4");
		expect(answer("200C in gas mark")).toBe("gas 6");
		// 350F is 176.7C, which is the 180C mark.
		expect(answer("350F in gas mark")).toBe("gas 4");
	});

	test("`as` reads the same as `in`", () => {
		expect(answer("180C as gas mark")).toBe("gas 4");
	});

	test("a temperature off the dial says so, and names the range", () => {
		expect(answer("300C in gas mark")).toContain("not a gas setting");
		expect(answer("300C in gas mark")).toContain("gas 9");
	});

	test("something that is not a temperature says that instead", () => {
		expect(answer("5 kg in gas mark")).toContain("not a temperature");
	});
});

describe("reading a gas mark as a temperature", () => {
	test("both spellings a recipe uses", () => {
		expect(answer("gas mark 4")).toBe("180.00 C");
		expect(answer("gas 6")).toBe("200.00 C");
	});

	test("and it converts onwards like any temperature", () => {
		expect(answer("gas mark 4 in C")).toBe("180.00 C");
		expect(answer("gas 6 in F")).toBe("392.00 F");
	});

	test("a setting the dial does not have is refused", () => {
		expect(answer("gas mark 12")).toContain("there is no gas mark 12");
	});
});

describe("scaling a recipe", () => {
	test("gives the factor to multiply every quantity by", () => {
		expect(answer("scale 4 servings to 6")).toBe("1.50");
		expect(answer("scale 6 servings to 4")).toBe("0.67");
	});

	test("whichever word the recipe uses for what it counts, or none", () => {
		expect(answer("scale 4 people to 10")).toBe("2.50");
		expect(answer("scale 2 to 5")).toBe("2.50");
	});

	test("and a count that cannot scale anything is refused", () => {
		expect(answer("scale 0 servings to 6")).toContain("positive number");
	});
});

describe("the boundary", () => {
	test("`gas` is not claimed as a word, only as a setting before a number", () => {
		// A lexer keyword would take the word everywhere, so `:gas = 5` would
		// stop defining a variable. The number beside it is what narrows it.
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression(":gas = 5").toNumber()).toBe(5);
			expect(engine.evaluateExpression("gas * 2").toNumber()).toBe(10);
		} finally {
			engine.clear();
		}
	});

	test("ingredient and temperature conversions stay where they were", () => {
		// This package deliberately adds neither: the units package already
		// converts by ingredient density, and F to C is an ordinary conversion.
		expect(answer("2 cups flour in grams")).toBe("250.78 grams");
		expect(answer("180C in F")).toBe("356.00 F");
	});
});
