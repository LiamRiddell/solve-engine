import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #592: after #587, a sweep of every builtin with a quantity argument
 * found more that read the bare number: `trunc(3.7 m)` was 3, `hypot(3 m, 4 m)`
 * was 5, `fact(3 m)` was 6, `sind(1 rad)` read the radian as a degree, and
 * `pow(2, 3 m)` took a unit in its exponent that `^` refuses. Each now keeps the
 * unit as its siblings do, reads an angle as an angle, or refuses by name.
 * `root` of a negative number with an odd whole degree is the real root, as
 * `^` is since #588.
 */

const evaluate = (source: string) => newTrackedEngine().evaluateExpression(source);
const shown = (source: string) => formatValue(evaluate(source));

describe("keeps the unit, as its siblings do", () => {
	test.each([
		["trunc(3.7 m)", "= 3.00 m"],
		["int(-3.7 kg)", "= -3.00 kg"],
		["hypot(3 m, 4 m)", "= 5.00 m"],
		["hypot(3 m, 400 cm)", "= 5.00 m"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});
});

describe("reads an angle as an angle", () => {
	test.each([
		["sind(1 rad)", "= 0.84"],
		["sind(30 degrees)", "= 0.50"],
		["degtorad(1 rad)", "= 1"],
		["radtodeg(90 degrees)", "= 90"],
		["radtodeg(1 rad)", "= 57.30"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});
});

describe("refuses a quantity it has no reading of", () => {
	test.each([
		["fact(3 m)", "fact takes a plain number, not a length"],
		["gcd(4 m, 6 m)", "gcd takes a plain number, not a length"],
		["lcm(4, 6 kg)", "lcm takes a plain number, not a mass"],
		["combination(5 m, 2)", "combination takes a plain number, not a length"],
		["permutation(5, 2 s)", "permutation takes a plain number, not a duration"],
		["hex(3 m)", "hex takes a plain number, not a length"],
		["clz32(3 m)", "clz32 takes a plain number, not a length"],
		["sind(3 m)", "sind takes an angle or a plain number, not a length"],
		["asind(3 m)", "asind takes a plain number, not a length"],
		["degtorad(1 m)", "degtorad takes an angle or a plain number, not a length"],
		["root(8 m, 3)", "root takes a plain number as its degree, not a length"],
		["hypot(3 m, 4)", "hypot takes plain numbers, or quantities that all measure one thing, not a mix of the two"],
		["atan2(1 m, 2)", "atan2 takes plain numbers, or quantities that all measure one thing, not a mix of the two"],
	])("%s", (source, message) => {
		const value = evaluate(source);
		expect(value.errorCode).toBe("FUNCTION_TAKES_NUMBER");
		expect(value.errorMessage).toBe(message);
	});

	test("two kinds of quantity are refused in words", () => {
		expect(evaluate("atan2(1 m, 2 kg)").errorMessage).toBe("length and mass cannot be compared");
		expect(evaluate("hypot(3 m, 4 kg)").errorMessage).toBe("length and mass cannot be combined in a hypotenuse");
	});

	test("an exponent has no unit, in pow as in ^", () => {
		expect(evaluate("pow(2, 3 m)").errorCode).toBe("UNIT_IN_EXPONENT");
		expect(evaluate("2^(3 m)").errorCode).toBe("UNIT_IN_EXPONENT");
	});
});

describe("root of a negative number", () => {
	test.each([
		["root(3, -8)", "= -2"],
		["root(5, -32)", "= -2"],
		["root(-3, -8)", "= -0.50"],
	])("%s is real for an odd degree", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("an even degree has no real value", () => {
		expect(evaluate("root(2, -4)").errorCode).toBe("POWER_NO_REAL_VALUE");
	});
});

describe("plain numbers are unchanged", () => {
	test.each([
		["trunc(3.7)", "= 3"],
		["hypot(3, 4)", "= 5"],
		["sind(30)", "= 0.50"],
		["degtorad(90)", "= 1.57"],
		["radtodeg(pi)", "= 180"],
		["fact(5)", "= 120"],
		["gcd(12, 18)", "= 6"],
		["combination(5, 2)", "= 10"],
		["atan2(1, 2)", "= 0.46"],
		["atan2(1 m, 200 cm)", "= 0.46"],
		["root(3, 8)", "= 2"],
		["root(3, 27 m³)", "= 3.00 m"],
		["hex(255)", "= 0xFF"],
		["pow(2 m, 2)", "= 4.00 m²"],
		["sign(-3 m)", "= -1"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});
});
