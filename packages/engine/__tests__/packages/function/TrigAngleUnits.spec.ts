/**
 * Trigonometric functions accept an angle that carries its unit.
 *
 * `sin(90 degrees)` used to answer 0.8939966636, because the builtin read the
 * number and discarded the unit, so 90 was taken to be 90 radians. That is the
 * kind of wrong answer nobody catches: it is plausible, it is not an error, and
 * sine of ninety degrees being 0.89 only looks wrong if you already know it
 * should be 1.
 *
 * The engine already knew the conversion. `90 degrees in radians` has always
 * given 1.5707963268; the trig functions simply never asked.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function num(source: string): number {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value.toNumber();
}

describe("an angle with a unit", () => {
	test("sin(90 degrees) is 1", () => {
		expect(num("sin(90 degrees)")).toBeCloseTo(1, 10);
	});

	test("cos(180 degrees) is -1", () => {
		expect(num("cos(180 degrees)")).toBeCloseTo(-1, 10);
	});

	test("tan(45 degrees) is 1", () => {
		expect(num("tan(45 degrees)")).toBeCloseTo(1, 10);
	});

	test("the abbreviated spelling works too", () => {
		expect(num("sin(90 deg)")).toBeCloseTo(1, 10);
	});

	test("the ° symbol is a separate, still-open lexer gap", () => {
		// Not this conversion's doing: "90°" does not lex as a unit at all, so
		// the symbol never reaches a trig function. Asserted rather than left
		// out, so fixing the lexer surfaces here instead of going unnoticed.
		expect(() => num("sin(90°)")).toThrow(/undefined variable/i);
	});

	test("and gradians, not just degrees", () => {
		// 100 gradians is a right angle. "turns" is in the unit table but does
		// not lex as a unit, the same gap as "°" above.
		expect(num("sin(100 gradians)")).toBeCloseTo(1, 10);
	});

	test("radians are unchanged by the conversion", () => {
		expect(num("sin(1 radian)")).toBeCloseTo(Math.sin(1), 10);
	});
});

describe("a bare number is still radians", () => {
	test("which is what sin(pi/2) relies on", () => {
		expect(num("sin(pi/2)")).toBeCloseTo(1, 10);
	});

	test("sin(90) is the sine of ninety radians", () => {
		// Deliberately unchanged. Without a unit there is nothing to convert,
		// and radians are the convention everywhere else in the engine.
		expect(num("sin(90)")).toBeCloseTo(Math.sin(90), 10);
	});
});

describe("a non-angle unit is left alone", () => {
	test("so it does not silently rescale something unrelated", () => {
		expect(num("sin(1 metre)")).toBeCloseTo(Math.sin(1), 10);
	});
});
