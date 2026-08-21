/**
 * A rate written in slash notation is a first-class value to convert.
 *
 * `100 kph in mph` answered `62.14 mph`, but `100 km/h in mph` answered
 * INCOMPATIBLE_UNITS, for the same speed spelled the way a person reads it off
 * a sign. The cause was two-fold: the lexer split `km/h` into `km`, `/` and `h`,
 * so the compound was never one unit, and nothing could convert a rate once it
 * was. `10 m/s in km/h` and `60 mph in km/h` failed the same way, and
 * `120 km / 2 hours in kph` failed for a third reason: the inner `2 hours`
 * swallowed the `in kph` that belonged to the whole quotient.
 *
 * The fix has three parts. A normalizer fuses `UNIT / UNIT` into one unit whose
 * spelling is the rate string, so `km/h` is a unit both as a source and as a
 * target. `convertRate` (uom/UomConverter.ts) converts a rate to another rate,
 * or bridges it to a single-token speed spelling, by converting the numerator
 * and denominator each on their own. And a unit literal that is the right
 * operand of `*` or `/` no longer swallows a trailing `in`/`to`, so the
 * conversion binds where precedence says it should.
 *
 * Naming a compound derived unit on output, `m/s^2 * kg` as `N` rather than
 * `kg*m/s^2`, is deliberately out of scope here and left for a later slice; see
 * the pull request for #89.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

function evaluate(source: string) {
	const engine = new ExpressionEngine("en");
	const [value] = engine.evaluateExpression(source);
	engine.clear();
	return value;
}

const num = (source: string) => evaluate(source).toNumber();
const unit = (source: string) => evaluate(source).unit;
/** The formatted result with the leading display marker removed. */
const display = (source: string) => formatValue(evaluate(source)).replace(/^=\s*/, "");

describe("the reported cases now convert", () => {
	test.each([
		["100 km/h in mph", 62.137119, "mph"],
		["10 m/s in km/h", 36, "km/h"],
		["60 mph in km/h", 96.56064, "km/h"],
		["120 km / 2 hours in kph", 60, "kph"],
		["100 km/h to m/s", 27.777778, "m/s"],
		["60 km/h to mph", 37.282272, "mph"],
	])("%s is %f %s", (source, expected, expectedUnit) => {
		expect(num(source)).toBeCloseTo(expected, 4);
		expect(unit(source)).toBe(expectedUnit);
	});

	test("the written-out form matches the single-word spelling it always had", () => {
		// `kph` was the documented spelling and always worked; `km/h` is how the
		// same speed gets typed. They must now agree to the last decimal.
		expect(num("100 km/h in mph")).toBeCloseTo(num("100 kph in mph"), 9);
	});
});

describe("a slash-notation compound is one unit", () => {
	test.each([
		["100 km/h", "km/h"],
		["5 m/s", "m/s"],
		["3 hours / day", "hours/day"],
		["1 mile/hour", "mile/hour"],
	])("%s carries the compound unit %j", (source, expectedUnit) => {
		expect(unit(source)).toBe(expectedUnit);
	});

	test("a rate converts to another rate by each axis on its own", () => {
		// 60 km/h: kilometres to metres up top (x1000), hours to seconds below
		// (x3600), so 60 * 1000 / 3600 = 16.67 m/s.
		expect(num("60 km/h in m/s")).toBeCloseTo(16.66667, 4);
	});

	test("and reads out in the exact unit that was asked for", () => {
		expect(display("100 km/h in mph")).toBe("62.14 mph");
		expect(display("10 m/s in km/h")).toBe("36.00 km/h");
	});
});

describe("precedence puts the conversion on the whole quotient", () => {
	test("a division then a conversion groups as (a / b) in c", () => {
		// The inner `2 hours` used to swallow `in kph`, leaving `120 km` divided
		// by an incompatible conversion. It now reads `(120 km / 2 hours) in kph`.
		expect(num("120 km / 2 hours in kph")).toBeCloseTo(60, 6);
		expect(unit("120 km / 2 hours in kph")).toBe("kph");
	});

	test("a bare rate keeps the denominator that was typed", () => {
		expect(unit("120 km / 2 hours")).toBe("km/hours");
		expect(num("120 km / 2 hours")).toBeCloseTo(60, 6);
	});
});

describe("what must keep working", () => {
	test("the single-word speed spelling still converts", () => {
		expect(num("100 kph in mph")).toBeCloseTo(62.137119, 4);
		expect(unit("100 kph in mph")).toBe("mph");
	});

	test("a numbered denominator is still a division, not a fused unit", () => {
		// `90 km / 3 day` has a number after the slash, so the slash stays a
		// divide (which still produces a rate, by a different route).
		expect(unit("90 km / 3 day")).toBe("km/day");
		expect(num("90 km / 3 day")).toBeCloseTo(30, 6);
	});

	test("ordinary division of plain numbers is untouched", () => {
		expect(num("12 / 4")).toBe(3);
		expect(num("1000 / 200")).toBe(5);
	});

	test("a money rate multiplied by a matching period is still money", () => {
		expect(num("$50/hour * 3 hours")).toBeCloseTo(150, 6);
		expect(unit("$50/hour * 3 hours")).toBe("USD");
	});

	test("two rates of different measures are still refused when added", () => {
		expect(String(evaluate("$20/day + 5 km/hour").value)).toMatch(/incompatible/i);
	});

	test("a rate cannot convert to a plain unit of one of its halves", () => {
		// `km/h` is not a length and not a time, so neither `km` nor `h` is a
		// valid target; the pair stays an honest failure.
		expect(String(evaluate("100 km/h in km").value)).toMatch(/INCOMPATIBLE_UNITS/);
		expect(String(evaluate("5 m/s in s").value)).toMatch(/INCOMPATIBLE_UNITS/);
	});

	test("a plain conversion with an inline unit still works at the top level", () => {
		expect(num("5 km to miles")).toBeCloseTo(3.106856, 4);
		expect(num("2 * 3 km in m")).toBeCloseTo(6000, 6);
	});
});
