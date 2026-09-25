import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #600: `sin(1/0)` and `(1/0) mod 3` answered NaN. The sine of an
 * infinite angle has no value, and neither does a remainder by zero or of an
 * infinite number, so each is refused by name, as `asin(1/0)` already was
 * (#510). `0/0` stays the documented NaN, and a form fed it may answer NaN in
 * turn; `1/0` stays infinity.
 */

const evaluate = (source: string) => newTrackedEngine().evaluateExpression(source);
const shown = (source: string) => formatValue(evaluate(source));

describe("an infinite angle has no sine, cosine or tangent", () => {
	test.each([
		["sin(1/0)", "sin(Infinity) has no real value: sin is only defined for finite angles."],
		["cos(-1/0)", "cos(-Infinity) has no real value: cos is only defined for finite angles."],
		["tan(1/0)", "tan(Infinity) has no real value: tan is only defined for finite angles."],
		["sind(1/0)", "sind(Infinity) has no real value: sind is only defined for finite angles."],
		["cosd(-1/0)", "cosd(-Infinity) has no real value: cosd is only defined for finite angles."],
		["tand(1/0)", "tand(Infinity) has no real value: tand is only defined for finite angles."],
	])("%s", (source, message) => {
		const value = evaluate(source);
		expect(value.errorCode).toBe("FUNCTION_DOMAIN");
		expect(value.errorMessage).toBe(message);
	});
});

describe("a remainder with no value is refused by name", () => {
	test.each([
		["5 mod 0", "5 mod 0 has no value: nothing is left over from a division by zero, because it never ends."],
		["-5.5 mod 0", "-5.5 mod 0 has no value: nothing is left over from a division by zero, because it never ends."],
		["(1/0) mod 3", "Infinity mod 3 has no value: an infinite number has no remainder."],
		["(-1/0) mod 3", "-Infinity mod 3 has no value: an infinite number has no remainder."],
	])("%s", (source, message) => {
		const value = evaluate(source);
		expect(value.errorCode).toBe("REMAINDER_UNDEFINED");
		expect(value.errorMessage).toBe(message);
	});
});

describe("adversarial: what must not change, and the edges around it", () => {
	test("finite angles, however large, still answer", () => {
		expect(shown("sin(30 degrees)")).toBe("= 0.50");
		expect(shown("sin(pi)")).toBe("= 0");
		expect(evaluate("sin(1e300)").isError()).toBe(false);
		expect(evaluate("cos(-1e308)").isError()).toBe(false);
	});

	test("a finite remainder, with every sign and an exact operand, is unchanged", () => {
		expect(shown("7 mod 3")).toBe("= 1");
		expect(shown("-7 mod 3")).toBe("= -1");
		expect(shown("5 mod (1/0)")).toBe("= 5");
		expect(shown("0.5 mod 0.2")).toBe("= 0.10");
		expect(shown("3^40 mod 7")).toBe("= 4");
		expect(shown("10 m mod 3 m")).toBe("= 1.00 m");
	});

	test("the documented NaN of 0/0 passes through, rather than being blamed on the function", () => {
		expect(evaluate("sin(0/0)").toNumber()).toBeNaN();
		expect(evaluate("(0/0) mod 3").toNumber()).toBeNaN();
	});

	test("a whole-number (n) remainder by zero keeps its own named error", () => {
		expect(() => evaluate("10n mod 0n")).toThrow(/Division by zero/);
	});

	test("an infinity reached through a variable and a line is refused the same way, in both passes", () => {
		const text = "big = 1/0\nsin(big)\nbig mod 3\nline 1 mod 3";
		for (const lines of [newTrackedEngine().parseDocument(text).lines]) {
			expect(lines[1].result?.errorCode ?? lines[1].error).toBe("FUNCTION_DOMAIN");
			expect(lines[2].result?.errorCode).toBe("REMAINDER_UNDEFINED");
			expect(lines[3].result?.errorCode).toBe("REMAINDER_UNDEFINED");
		}
	});

	test("a refusal inside a total is named as the failed line it is", () => {
		const lines = newTrackedEngine().parseDocument("10\n5 mod 0\ntotal above").lines;
		expect(lines[2].result?.isError()).toBe(true);
	});
});
