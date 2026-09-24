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
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
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

	test("the ° symbol works", () => {
		// It could not reach a trig function at all until the degree sign was
		// retyped as a unit: the lexer reads a unit as one run of [A-Za-z0-9_],
		// so a non-ASCII character could never become one however well the
		// converter understood it.
		expect(num("sin(90°)")).toBeCloseTo(1, 10);
		expect(num("cos(180°)")).toBeCloseTo(-1, 10);
	});

	test("and gradians, not just degrees", () => {
		expect(num("sin(100 gradians)")).toBeCloseTo(1, 10);
	});

	test("`turns` is deliberately not a unit, and stays that way", () => {
		// lexer/units.ts excludes it on purpose: "ordinary English, against a
		// full-rotation angle unit". Admitting it would make the word "turns"
		// in a sentence become a quantity. The unit is reachable as gradians.
		expect(() => num("sin(0.25 turns)")).toThrow();
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

describe("a quantity that is not an angle is refused (#587)", () => {
	test("rather than read as its bare number, which depended on the unit written", () => {
		const code = (source: string) => newTrackedEngine().evaluateExpression(source).errorCode;
		expect(code("sin(1 metre)")).toBe("FUNCTION_TAKES_NUMBER");
		expect(code("sin(100 cm)")).toBe("FUNCTION_TAKES_NUMBER");
	});
});

describe("tan at an odd multiple of a right angle is undefined (#532)", () => {
	const code = (source: string) => newTrackedEngine().evaluateExpression(source).errorCode;

	test.each(["tan(90 degrees)", "tan(270 degrees)", "tan(-90 degrees)", "tan(450 degrees)", "tan(pi/2)", "tan(3*pi/2)", "tan(100 grad)"])(
		"%s is refused rather than answered with the double's 1.6e16",
		(source) => {
			expect(code(source)).toBe("TRIG_UNDEFINED");
		},
	);

	test("the message names the angle in degrees", () => {
		expect(newTrackedEngine().evaluateExpression("tan(pi/2)").errorMessage).toContain("90 degrees");
	});

	test("an angle just either side of the asymptote still answers", () => {
		// Within a ten-thousandth of a degree, well outside the conversion's
		// rounding, the tangent is large but real.
		expect(num("tan(89.9999 degrees)")).toBeCloseTo(572957.8, 0);
		expect(num("tan(90.0001 degrees)")).toBeCloseTo(-572957.8, 0);
	});

	test("the even multiples and ordinary angles are unchanged", () => {
		expect(num("tan(45 degrees)")).toBeCloseTo(1, 10);
		expect(num("tan(0)")).toBe(0);
		expect(num("tan(1)")).toBeCloseTo(Math.tan(1), 12);
	});

	test("a double too large to place against the asymptote keeps Math.tan's answer", () => {
		expect(num("tan(1e20)")).toBeCloseTo(Math.tan(1e20), 12);
	});
});
