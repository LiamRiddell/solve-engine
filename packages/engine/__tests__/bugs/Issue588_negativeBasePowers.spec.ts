import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #588: a negative number to a fractional power answered NaN, which the
 * number-functions page calls "not an answer". A negative number has a real
 * root of odd degree and none of even degree, and the engine holds the
 * exponent as a fraction when it was written as one (`1/3`) or typed as a
 * decimal (`0.2` is 1/5), so it can tell: an odd denominator gives the real
 * root, anything else is refused by name, as `log(-1)` is (#510). `sqrt(-1)`
 * still answers `i`; `^` stays in the real numbers. `0/0` stays NaN, the
 * floating-point standard's defined answer, as `1/0` stays infinity.
 */

const evaluate = (source: string) => newTrackedEngine().evaluateExpression(source);
const shown = (source: string) => formatValue(evaluate(source));

describe("an odd root of a negative number is real", () => {
	test.each([
		["(-8)^(1/3)", "= -2"],
		["(-32)^(1/5)", "= -2"],
		["(-32)^0.2", "= -2"],
		["(-8)^(2/3)", "= 4"],
		["(-8)^(-1/3)", "= -0.50"],
		["(-2)^(1/3)", "= -1.26"],
		["(-8.0)^(1/3)", "= -2"],
		["pow(-8, 1/3)", "= -2"],
	])("%s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});
});

describe("an even root of a negative number is refused by name", () => {
	test.each([
		["(-1)^0.5", "(-1)^0.5"],
		["(-2)^0.3", "(-2)^0.3"],
		["pow(-1, 0.5)", "(-1)^0.5"],
	])("%s", (source, written) => {
		const value = evaluate(source);
		expect(value.errorCode).toBe("POWER_NO_REAL_VALUE");
		expect(value.errorMessage).toBe(
			`${written} has no real value: a negative number to a fractional power has one only when the fraction's denominator is odd, as in (-8)^(1/3).`,
		);
	});
});

describe("what does not change", () => {
	test("a whole power of a negative number, the complex square root, and 0/0", () => {
		expect(shown("(-8)^2")).toBe("= 64");
		expect(shown("(-2)^3")).toBe("= -8");
		expect(shown("sqrt(-1)")).toBe("i");
		expect(evaluate("0/0").toNumber()).toBeNaN();
	});
});
