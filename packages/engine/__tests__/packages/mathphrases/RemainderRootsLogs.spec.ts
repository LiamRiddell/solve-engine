/**
 * `remainder of`, the nth root, arbitrary-base logarithms, and multipliers
 * relative to a base.
 *
 * The awkward part of this group is that `root` and `log` are already `FUNC`
 * tokens, so the ordinary call parselet claims them and demands a `(`. They
 * are retyped by a normalizer rule, and only when the next token is not a `(`,
 * so `log(20)` and `sqrt(16)` are untouched. Those cases are asserted here,
 * because a change like this breaking function calls would be far worse than
 * the gap it closes.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";

function num(source: string): number {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value.toNumber();
}

/** The rendered answer, which is where a base or a multiplier suffix appears. */
function text(source: string): string {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	const rendered = formatValue(value, DEFAULT_FORMATTING_SETTINGS) ?? String(value.value);
	return rendered.replace(/^=/, "").trim();
}

describe("remainder", () => {
	test("`remainder of 21 divided by 5` is 1", () => {
		expect(num("remainder of 21 divided by 5")).toBe(1);
	});

	test("it is the remainder, not the division", () => {
		// The whole reason this intercepts "divided by": that phrase already
		// means 4.2 on its own.
		expect(num("21 divided by 5")).toBeCloseTo(4.2, 10);
	});

	test("`/` is accepted as well as the words", () => {
		expect(num("remainder of 21 / 5")).toBe(1);
	});

	test("it agrees with the mod operator", () => {
		expect(num("remainder of 100 divided by 7")).toBe(num("100 mod 7"));
	});

	test("a missing divisor says what was expected", () => {
		expect(() => num("remainder of 21")).toThrow(/divided by/i);
	});
});

describe("the nth root", () => {
	test("`root 5 of 100` is 2.5118864315", () => {
		expect(num("root 5 of 100")).toBeCloseTo(2.5118864315, 8);
	});

	test("root 2 is the square root", () => {
		expect(num("root 2 of 81")).toBeCloseTo(9, 10);
	});

	test("root 3 is the cube root", () => {
		expect(num("root 3 of 27")).toBeCloseTo(3, 10);
	});

	test("the radicand may be an expression", () => {
		expect(num("root 2 of 3 * 27")).toBeCloseTo(9, 10);
	});

	test("a missing `of` says what was expected", () => {
		expect(() => num("root 5 100")).toThrow(/expected "of"/i);
	});
});

describe("logarithms to a base", () => {
	test("`log 20 base 4` is 2.1609640474", () => {
		expect(num("log 20 base 4")).toBeCloseTo(2.1609640474, 8);
	});

	test("log 8 base 2 is 3", () => {
		expect(num("log 8 base 2")).toBeCloseTo(3, 10);
	});

	test("log 1000 base 10 is 3", () => {
		expect(num("log 1000 base 10")).toBeCloseTo(3, 10);
	});

	test("the value may be an expression", () => {
		expect(num("log 2 * 4 base 2")).toBeCloseTo(3, 10);
	});
});

describe("what the retyping must not break", () => {
	test("`log(20)` is still the natural logarithm", () => {
		expect(num("log(20)")).toBeCloseTo(Math.log(20), 10);
	});

	test("`sqrt(16)` and `cbrt(343)` are untouched", () => {
		expect(num("sqrt(16)")).toBe(4);
		expect(num("cbrt(343)")).toBe(7);
	});

	test("`square root of` and `cube root of` still work", () => {
		expect(num("square root of 81")).toBe(9);
		expect(num("cube root of 27")).toBe(3);
	});

	test("`as base 8` still works, so `base` is not claimed globally", () => {
		expect(text("0b101101 as base 8")).toContain("0o55");
	});
});

describe("multipliers relative to a base", () => {
	test("`50 as x of 5` is 10x", () => {
		expect(text("50 as x of 5")).toBe("10x");
	});

	test("`2 as multiplier of 1` is 2x", () => {
		expect(text("2 as multiplier of 1")).toBe("2x");
	});

	test("`20 to 40 as x` is 2x", () => {
		// A percentage change of 100%, which reads as doubling.
		expect(text("20 to 40 as x")).toBe("2x");
	});

	test("a bare `as multiplier` is still the value itself", () => {
		expect(text("20/5 as multiplier")).toBe("4x");
	});
});
