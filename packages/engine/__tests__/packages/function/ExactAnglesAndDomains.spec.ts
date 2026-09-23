/**
 * Honest edge values (#510): exact special angles, and a named refusal outside
 * a function's domain.
 *
 * The angles people type (multiples of 30 and 45 degrees, and of π) have exact
 * sines, cosines and tangents that a double misses by a hair: `sin(180 degrees)`
 * was 1.22e-16. And the logarithms and inverse functions answered NaN or an
 * infinity outside their domain. See VMBuiltins.ts's specialAngleDegrees() and
 * outsideDomain().
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

const value = (source: string) => newTrackedEngine().evaluateExpression(source);
const num = (source: string) => value(source).toNumber();

describe("exact special angles", () => {
	test.each([
		["sin(180 degrees)", 0],
		["sin(pi)", 0],
		["sin(30 degrees)", 0.5],
		["sin(90 degrees)", 1],
		["sin(-90 degrees)", -1],
		["sin(390 degrees)", 0.5],
		["cos(90 degrees)", 0],
		["cos(60 degrees)", 0.5],
		["cos(180 degrees)", -1],
		["tan(45 degrees)", 1],
		["tan(180 degrees)", 0],
		["tan(135 degrees)", -1],
		["sin(100 grad)", 1],
		["sind(180)", 0],
		["cosd(90)", 0],
		["tand(45)", 1],
		["sin(180°)", 0],
	])("%s is exactly %d", (source, expected) => {
		expect(num(source)).toBe(expected);
	});

	test("an exact zero is a positive zero, never shown as -0", () => {
		expect(Object.is(num("tan(180 degrees)"), 0)).toBe(true);
		expect(Object.is(num("sin(180 degrees)"), 0)).toBe(true);
	});

	test("the irrational special values are the nearest doubles", () => {
		expect(num("sin(45 degrees)")).toBe(Math.SQRT1_2);
		expect(num("sin(60 degrees)")).toBe(Math.sqrt(3) / 2);
		expect(num("tan(60 degrees)")).toBe(Math.sqrt(3));
	});

	test("an angle that is not special is computed as before", () => {
		expect(num("sin(1)")).toBe(Math.sin(1));
		expect(num("sin(29.9 degrees)")).toBe(Math.sin((29.9 * Math.PI) / 180));
		expect(num("sin(15 degrees)")).toBe(Math.sin((15 * Math.PI) / 180));
	});

	test("the degree form of tan refuses its asymptote too", () => {
		expect(value("tand(90)").errorCode).toBe("TRIG_UNDEFINED");
		expect(value("tan(90 degrees)").errorCode).toBe("TRIG_UNDEFINED");
	});
});

describe("outside a function's domain", () => {
	test.each([
		"log(0)", "log(-1)", "log10(0)", "log2(-4)", "log1p(-1)",
		"asin(2)", "acos(-1.5)", "asind(2)", "acosd(-2)", "acosh(0.5)", "atanh(1)", "atanh(-1)",
	])("%s is refused by name", (source) => {
		expect(value(source).errorCode).toBe("FUNCTION_DOMAIN");
	});

	test("the message says what the function accepts", () => {
		expect(value("log(0)").errorMessage).toBe("log(0) has no real value: log is only defined for positive numbers.");
		expect(value("asin(2)").errorMessage).toContain("numbers from -1 to 1");
	});

	test("the edges of each domain still answer", () => {
		expect(num("log(1)")).toBe(0);
		expect(num("asin(1)")).toBe(Math.PI / 2);
		expect(num("acos(-1)")).toBe(Math.PI);
		expect(num("acosh(1)")).toBe(0);
		expect(num("atanh(0.5)")).toBe(Math.atanh(0.5));
		expect(num("log1p(-0.5)")).toBe(Math.log1p(-0.5));
	});

	test("the square root of a negative number stays complex, and division by zero stays IEEE", () => {
		expect(value("sqrt(-1)").errorCode).toBeUndefined();
		expect(num("1/0")).toBe(Infinity);
	});
});
