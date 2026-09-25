import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, fill, NUMERIC_EDGES } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, numberValueExact, uomValueExact, percentageValue } from "@solve-js/vm/Value";
import { fractionOfExactDecimal } from "@solve-js/vm/ExactDecimals";

/**
 * Issue #647: `as fraction` guessed at the double nearest a typed decimal with a
 * continued fraction, which for six-digit decimals landed on near misses that
 * are neither the decimal nor a simpler fraction: `0.333333 as fraction` gave
 * 333332/999997 and `3.14159 as fraction` 76149/24239. A decimal written with a
 * point carries its exact decimal, and the fraction is rendered from that.
 *
 * The rule chosen is the one fractions.md states: a decimal reads as the
 * fraction it is, always. So `0.3333333 as fraction` is 3333333/10000000 rather
 * than the 1/3 the guess used to round it onto; a third is written `1/3`.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("a typed decimal reads as the fraction it is", () => {
	test.each([
		["0.333333 as fraction", "= 333333/1000000"],
		["-0.333333 as fraction", "= -333333/1000000"],
		["0.666667 as fraction", "= 666667/1000000"],
		["0.999999 as fraction", "= 999999/1000000"],
		["3.14159 as fraction", "= 314159/100000"],
		["0.0001234 as fraction", "= 617/5000000"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test.each([
		["0.3333333 as fraction", "= 3333333/10000000"],
		["0.2857142857 as fraction", "= 2857142857/10000000000"],
	])("%s: the decimal, not the simple fraction it approximates", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("the boundary: what already read exactly is unchanged", () => {
	test.each([
		["0.333 as fraction", "= 333/1000"],
		["0.125 as fraction", "= 1/8"],
		["0.75 as fraction", "= 3/4"],
		["2.5 as fraction", "= 5/2"],
		["0.50 as fraction", "= 1/2"],
		["333333/1000000 as fraction", "= 333333/1000000"],
		["(0.1 / 3) as fraction", "= 1/30"],
		["1/3 as fraction", "= 1/3"],
		["12.5% as fraction", "= 1/8"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a value with no exact form keeps the continued-fraction guess", () => {
		expect(shown("sqrt(2) as fraction")).toBe("= 47321/33461");
	});
});

describe("adversarial", () => {
	test("a decimal longer than a double holds is read to its last digit", () => {
		expect(shown("0.12345678901234567890 as fraction")).toBe("= 1234567890123456789/10000000000000000000");
	});

	test("arithmetic that keeps the exact decimal keeps the exact fraction", () => {
		expect(shown("(0.1 + 0.2) as fraction")).toBe("= 3/10");
		expect(shown("0.1 * 3 as fraction")).toBe("= 3/10");
		expect(shown("(0.333333 * 3) as fraction")).toBe("= 999999/1000000");
	});

	test("money reads as the fraction its amount is", () => {
		expect(shown("$0.333333 as fraction")).toBe("= 333333/1000000");
		expect(shown("$0.25 as fraction")).toBe("= 1/4");
	});

	test("every numeric edge is answered honestly", () => {
		for (const line of fill("X as fraction", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("a decimal held in a variable, through both document passes", () => {
		const { batch } = expectHonestDocument("x = 0.333333\nx as fraction\n(x * 2) as fraction");
		expect(batch).toEqual(["= 0.33", "= 333333/1000000", "= 333333/500000"]);
	});
});

describe("fractionOfExactDecimal", () => {
	test("a decimal number gives its reduced fraction", () => {
		expect(fractionOfExactDecimal(numberValueExact(0.333333, { coef: 333333n, scale: 6 }))).toEqual({ n: 333333n, d: 1000000n });
		expect(fractionOfExactDecimal(numberValueExact(0.5, { coef: 50n, scale: 2 }))).toEqual({ n: 1n, d: 2n });
		expect(fractionOfExactDecimal(numberValueExact(-2.5, { coef: -25n, scale: 1 }))).toEqual({ n: -5n, d: 2n });
	});

	test("money with an exact decimal gives its fraction too", () => {
		expect(fractionOfExactDecimal(uomValueExact(0.25, "USD", { coef: 25n, scale: 2 }))).toEqual({ n: 1n, d: 4n });
	});

	test("a value with no exact decimal gives null", () => {
		expect(fractionOfExactDecimal(numberValue(Math.SQRT2))).toBeNull();
		expect(fractionOfExactDecimal(percentageValue(0.125))).toBeNull();
	});

	test("a decimal past the exact-decimal digit limit gives null", () => {
		expect(fractionOfExactDecimal(numberValueExact(1e-40, { coef: 1n, scale: 40 }))).toBeNull();
	});
});
