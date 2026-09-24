/**
 * Significant figures, engineering notation and compact form (#515).
 *
 * `to N sf` rounds the way `to N dp` does, counting from the first non-zero
 * digit; `as engineering` keeps a scientific exponent to a multiple of three;
 * `as compact` writes a headline figure as `3.3M`. See VMBuiltins.ts's
 * roundToSignificant() and converters/NumberNotation.ts.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { engineeringString, compactString } from "@solve-js/packages/converters/NumberNotation";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source));

describe("to N sf", () => {
	test.each([
		["1234567 to 3 sf", "= 1,230,000"],
		["3.14159 to 3 sf", "= 3.14"],
		["0.0012345 to 2 sf", "= 0.0012"],
		["-1234 to 2 sf", "= -1,200"],
		["1/3 to 4 sf", "= 0.3333"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("trailing zeros that are significant are shown", () => {
		expect(shown("2.5 to 3 sf")).toBe("= 2.50");
		expect(shown("0 to 3 sf")).toBe("= 0.00");
	});

	test("rounding that carries into the next power of ten keeps the figure count", () => {
		expect(shown("9.99 to 2 sf")).toBe("= 10");
		expect(shown("99.95 to 3 sf")).toBe("= 100");
		expect(shown("0.000999 to 2 sf")).toBe("= 0.0010");
	});

	test("an exact decimal rounds half away from zero, as to N dp does", () => {
		expect(shown("1.005 to 3 sf")).toBe("= 1.01");
	});

	test("every spelling", () => {
		for (const spelling of ["sf", "sig figs", "sig fig", "significant figures", "significant digits"]) {
			expect(shown(`1234567 to 3 ${spelling}`)).toBe("= 1,230,000");
		}
	});

	test("a unit and a currency are kept", () => {
		expect(shown("5.678 km to 2 sf")).toBe("= 5.7 km");
		expect(shown("$1234.5 to 3 sf")).toBe("= $1,230");
	});

	test("a figure count outside 1 to 17 is refused", () => {
		expect(() => newTrackedEngine().evaluateExpression("1234 to 0 sf")).toThrow(/between 1 and 17/);
	});

	test("to N dp and to N digits are unchanged", () => {
		expect(shown("3.14159 to 2 dp")).toBe("= 3.14");
		expect(shown("pi to 5 digits")).toBe("= 3.14159");
	});
});

describe("as engineering", () => {
	test.each([
		[1234567, "1.234567e+6"],
		[12345, "12.345e+3"],
		[0.00012, "120e-6"],
		[-4700, "-4.7e+3"],
		[0, "0e+0"],
		[999999, "999.999e+3"],
	])("%d is %s", (n, expected) => {
		expect(engineeringString(n)).toBe(expected);
	});

	test("both spellings reach it", () => {
		expect(shown("12345 as engineering")).toBe("= 12.345e+3");
		expect(shown("12345 as eng")).toBe("= 12.345e+3");
	});
});

describe("as compact", () => {
	test.each([
		[3300000, "3.3M"],
		[1234, "1.23k"],
		[2500000000, "2.5B"],
		[1.5e12, "1.5T"],
		[-45000, "-45k"],
		[999, "999"],
		[0.5, "0.5"],
	])("%d is %s", (n, expected) => {
		expect(compactString(n)).toBe(expected);
	});

	test("a figure that rounds up to the next suffix takes it", () => {
		expect(compactString(999950)).toBe("1M");
	});

	test("the reported case, and money and units", () => {
		expect(shown("3 million + 10% as compact")).toBe("= 3.3M");
		expect(shown("$3300000 as compact")).toBe("= $3.3M");
		// A negative amount keeps its currency, sign first, as the full form writes
		// it; it used to fall back to the code, -1.5k USD (#554).
		expect(shown("-$1500 as compact")).toBe("= -$1.5k");
		expect(shown("5000 m as compact")).toBe("= 5k m");
	});

	test("the suffixes read back as the numbers they stand for", () => {
		expect(shown("3.3M")).toBe(shown("3300000"));
		expect(shown("1.23k")).toBe(shown("1230"));
	});

	test("text is refused", () => {
		expect(newTrackedEngine().evaluateExpression('"x" as compact').errorCode).toBe("AS_CONVERTER_EXPECTED_NUMBER");
	});
});
