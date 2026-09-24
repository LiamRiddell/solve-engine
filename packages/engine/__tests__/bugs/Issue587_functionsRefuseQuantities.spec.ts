import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #587: `sin(1 m)` was 0.84 and `sin(100 cm)` was -0.51. The functions
 * read a quantity's bare magnitude, so the answer depended on which unit was
 * written. A sine, logarithm or exponential of a length has no meaning, and is
 * now refused by name, the way `sqrt(4 m)` already was. An angle is what the
 * trigonometric functions take, and a ratio that cancels to a plain number
 * still answers.
 */

const evaluate = (source: string) => newTrackedEngine().evaluateExpression(source);
const shown = (source: string) => formatValue(evaluate(source));

describe("a function refuses a quantity it has no reading of", () => {
	test.each([
		["sin(1 m)", "sin takes an angle or a plain number, not a length"],
		["cos(2 kg)", "cos takes an angle or a plain number, not a mass"],
		["tan(3 s)", "tan takes an angle or a plain number, not a duration"],
		["log(10 kg)", "log takes a plain number, not a mass"],
		["exp(1 m)", "exp takes a plain number, not a length"],
		["log($100)", "log takes a plain number, not money"],
		["log10(5 l)", "log10 takes a plain number, not a volume"],
		["asin(1 m)", "asin takes a plain number, not a length"],
		["sinh(2 km)", "sinh takes a plain number, not a length"],
	])("%s", (source, message) => {
		const value = evaluate(source);
		expect(value.errorCode).toBe("FUNCTION_TAKES_NUMBER");
		expect(value.errorMessage).toBe(message);
	});
});

describe("an angle, a plain number and a cancelled ratio still answer", () => {
	test.each([
		["sin(30 degrees)", "= 0.50"],
		["cos(pi rad)", "= -1"],
		["sin(100 grad)", "= 1"],
		["sin(1 m / 2 m)", "= 0.48"],
		["log(100 m / 1 m)", "= 4.61"],
		["sin(0.5)", "= 0.48"],
		["atan2(1 m, 2 m)", "= 0.46"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});
});
