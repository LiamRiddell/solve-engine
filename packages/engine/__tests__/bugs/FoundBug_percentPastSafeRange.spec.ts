import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue, percentOfFraction } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { ValueType, numberValue, numberValueExact, numberValueRational, uomValue, stringValue, percentageValue } from "@solve-js/vm/Value";
import { rational } from "@solve-js/symbolic";
import { percentageExact, toPercentage } from "@solve-js/vm/VMConversion";

/**
 * Found bug: `9007199254740993.5 as percent` answered
 * 900,719,925,474,099,456.00%, the double's digits a hundred times over,
 * though the number keeps its exact decimal beside the double and is itself
 * shown as 9,007,199,254,740,993.50. The conversion made a percentage from the
 * double alone, and the formatter had nothing else to write.
 *
 * A percentage made from a plain number now keeps that number's exact decimal
 * (or exact whole number) where its double cannot hold six places of the
 * percentage (`percentageExact`), and the formatter writes the digits from it a
 * hundred times over (`percentOfFraction`), so the answer is
 * 900,719,925,474,099,350.00%. `in %` and `to %` share the conversion.
 */

function shown(line: string, engine = newTrackedEngine()): string {
	try {
		const v = engine.evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["9007199254740993.5 as percent", "900,719,925,474,099,350.00%"],
		["-9007199254740993.5 as percent", "-900,719,925,474,099,350.00%"],
		["9007199254740993.5 in %", "900,719,925,474,099,350.00%"],
		["9007199254740993.5 to %", "900,719,925,474,099,350.00%"],
		["9007199254740993.5 as percentage", "900,719,925,474,099,350.00%"],
		["(2^53 + 1) as percent", "900,719,925,474,099,300.00%"],
		["225000000000.5 as percent", "22,500,000,000,050.00%"],
		["12345678901234567890.125 as percent", "1,234,567,890,123,456,789,012.50%"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("what was right stays right", () => {
		expect(shown("0.5 as percent")).toBe("50.00%");
		expect(shown("0.25 as percent")).toBe("25.00%");
		expect(shown("12.345 as percent")).toBe("1,234.50%");
		expect(shown("(1/3) as percent")).toBe("33.33%");
		expect(shown("100 ppm as %")).toBe("0.01%");
		expect(shown("0 as percent")).toBe("0.00%");
		expect(shown("1/0 as %")).toContain("percentage");
	});

	test("the boundary: a unit, an inexact result and a percentage typed with its sign keep their doubles", () => {
		expect(shown("5 km as %")).toContain("not a proportion");
		expect(shown("sqrt(2^106) + 0.5 as percent")).toBe(shown("sqrt(2^106) as percent"));
		expect(shown("900719925474099350%")).toBe("900,719,925,474,099,456.00%");
	});

	test("arithmetic on the percentage reads the same number it did", () => {
		expect(shown("1/3 + (9007199254740993.5 as percent)")).toBe("3,002,399,751,580,332");
		expect(shown("(9007199254740993.5 as percent) as fraction")).toBe("18014398509481987/2");
		expect(shown("(0.5 as percent) + 1")).toBe(shown("50% + 1"));
		expect(shown("100 + (0.1 as percent)")).toBe("110");
	});
});

describe("percentOfFraction", () => {
	test("ordinary: the point moves two places", () => {
		expect(percentOfFraction({ coef: 125n, scale: 3 })).toEqual({ coef: 125n, scale: 1 });
		expect(percentOfFraction({ coef: 90071992547409935n, scale: 1 })).toEqual({ coef: 900719925474099350n, scale: 0 });
		expect(percentOfFraction({ coef: 25n, scale: 2 })).toEqual({ coef: 25n, scale: 0 });
	});

	test("boundary: zero, a whole number, a negative, and a long decimal", () => {
		expect(percentOfFraction({ coef: 0n, scale: 0 })).toEqual({ coef: 0n, scale: 0 });
		expect(percentOfFraction({ coef: 7n, scale: 0 })).toEqual({ coef: 700n, scale: 0 });
		expect(percentOfFraction({ coef: -5n, scale: 1 })).toEqual({ coef: -50n, scale: 0 });
		const long = { coef: BigInt(`1${"0".repeat(299)}1`), scale: 300 };
		expect(percentOfFraction(long)).toEqual({ coef: long.coef, scale: 298 });
	});

	test("hostile: a scale outside the contract still moves the point, and nothing throws", () => {
		expect(percentOfFraction({ coef: 3n, scale: -1 })).toEqual({ coef: 3000n, scale: 0 });
		expect(() => percentOfFraction({ coef: 1n, scale: Number.NaN })).not.toThrow();
	});
});

describe("percentageExact", () => {
	const exact = { coef: 90071992547409935n, scale: 1 };

	test("ordinary: a large exact decimal is kept, a small one is not", () => {
		expect(percentageExact(numberValueExact(9007199254740994, exact))).toEqual(exact);
		expect(percentageExact(numberValueExact(0.5, { coef: 5n, scale: 1 }))).toBeUndefined();
	});

	test("boundary: the six-place threshold, an exact whole number, and a fraction that is not whole", () => {
		const below = numberValueExact(1e6, { coef: 1000000n, scale: 0 });
		expect(percentageExact(below)).toBeUndefined();
		const above = numberValueExact(1e10, { coef: 10000000000n, scale: 0 });
		expect(percentageExact(above)).toEqual({ coef: 10000000000n, scale: 0 });
		expect(percentageExact(numberValueRational(9007199254740992, rational(9007199254740993n)))).toEqual({ coef: 9007199254740993n, scale: 0 });
		expect(percentageExact(numberValueRational(4.6e18, rational(9223372036854775807n, 2n)))).toBeUndefined();
	});

	test("hostile: no exact reading, NaN, the infinities, and every type that is not a plain number", () => {
		expect(percentageExact(numberValue(1e20))).toBeUndefined();
		expect(percentageExact(numberValue(Number.NaN))).toBeUndefined();
		expect(percentageExact(numberValue(Number.POSITIVE_INFINITY))).toBeUndefined();
		expect(percentageExact(uomValue(1e20, "m"))).toBeUndefined();
		expect(percentageExact(stringValue("9007199254740993.5"))).toBeUndefined();
		expect(percentageExact(percentageValue(1e20))).toBeUndefined();
	});

	test("toPercentage carries it, and formats from it", () => {
		const p = toPercentage(numberValueExact(9007199254740994, exact));
		expect(p.type).toBe(ValueType.Percentage);
		expect(p.exact).toEqual(exact);
		expect(formatValue(p, DEFAULT_FORMATTING_SETTINGS)).toBe("= 900,719,925,474,099,350.00%");
		expect(toPercentage(numberValueExact(0.5, { coef: 5n, scale: 1 })).exact).toBeUndefined();
	});
});

describe("adversarial", () => {
	test("security: prototype words, long literals, deep brackets and look-alike text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} as percent`);
				expectHonestDocument(`${word} = 9007199254740993.5\n${word} as percent`);
			}
		});
		expectHonestLine(`${"9".repeat(300)}.5 as percent`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} * 9007199254740993.5 as percent`, { budgetMs: 5_000 });
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)}) + 9007199254740993.5 as percent`, { budgetMs: 5_000 });
		for (const line of fill("9007199254740993.5 as percent X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("X as percent", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a number from the line above, a what-if through it, settings, and both passes", () => {
		const { batch, incremental } = expectHonestDocument("n = 9007199254740993.5\nn as percent\nline 2 with n = 0.25\n(n as percent) as fraction");
		expect(batch.slice(1)).toEqual(["= 900,719,925,474,099,350.00%", "= 25.00%", "= 18014398509481987/2"]);
		expect(incremental).toEqual(batch);
		const p = newTrackedEngine().evaluateExpression("9007199254740993.5 as percent");
		const trimmed = { ...DEFAULT_FORMATTING_SETTINGS, floatResult: { ...DEFAULT_FORMATTING_SETTINGS.floatResult, trimTrailingZeros: true } };
		expect(formatValue(p, trimmed)).toBe("= 900,719,925,474,099,350%");
		const german = { ...DEFAULT_FORMATTING_SETTINGS, numberResult: { ...DEFAULT_FORMATTING_SETTINGS.numberResult, decimalSeparatorLocale: "de-DE" } };
		expect(formatValue(p, german)).toBe("= 900.719.925.474.099.350,00%");
		expect(shown("9007199254740993.5 as precent")).not.toBe("900,719,925,474,099,456.00%");
	});

	test("edge: every numeric edge as a percentage, plus a half and negated", () => {
		for (const line of fill("X as percent", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("(X) + 0.5 as percent", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("-(X) in %", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("-0 as percent")).toBe("0.00%");
	});
});
