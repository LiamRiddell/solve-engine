import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { fixedDecimalText, shortestText } from "@solve-js/utilities/Number";
import { numberValue, percentageValue, uomValue } from "@solve-js/vm/Value";

/**
 * Found bug: `1e306 as %` showed `1e+308%`, and `1e308 ppm as %` showed
 * `1.0000000000000001e+304%`, JavaScript's exponent text, while a plain
 * `1e306` shows every digit. The percentage, quantity and money formatters
 * wrote their figures with `toFixed`, which writes a number of 1e21 or more the
 * way `String` does, in exponent form, and a check's message wrote its sides
 * with `String`. Each now writes such a number in full digits through
 * `fixedDecimalText` (or `shortestText` where the shortest form is wanted),
 * the `Intl` path a plain number already takes, so a percentage, a length, a
 * span of days, money and a check read as the number does.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

/** JavaScript's exponent text, `1e+22` or `1.5e+304`. */
const JS_EXPONENT = /\de\+\d/;

describe("the lines that exposed it", () => {
	test("a percentage past 1e21 is written in full digits", () => {
		expect(outcome("1e306 as %")).toBe(`1${"0".repeat(308)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + ".00%");
		expect(outcome("1e22 as %")).toBe("1,000,000,000,000,000,000,000,000.00%");
		expect(outcome("-1e22 as %")).toBe("-1,000,000,000,000,000,000,000,000.00%");
		expect(outcome("1e308 ppm as %")).toMatch(/^10,000,000,000,000,001(?:,000)+\.00%$/);
		expect(outcome("1e19 as %")).toBe("1,000,000,000,000,000,000,000.00%");
	});

	test.each([
		["1e22 m", "10,000,000,000,000,000,000,000.00 m"],
		["1e22 days", "10,000,000,000,000,000,000,000 days"],
		["1e22 km to 2 dp", "10,000,000,000,000,000,000,000.00 km"],
		["$1e40 + $1", "$10,000,000,000,000,000,000,000,000,000,000,000,000,000.00"],
		["1e22 m in km", "10,000,000,000,000,000,000.00 km"],
	])("a quantity and money: %s", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test("a check's message writes its sides in full", () => {
		expect(outcome("check 1e22 m == 2e22 m within 1%")).toBe(
			"CHECK_FAILED: check failed: 10000000000000000000000 m differs from 20000000000000000000000 m by 50%, more than 1%",
		);
	});

	test("what was right stays right", () => {
		expect(outcome("0.5 as %")).toBe("50.00%");
		expect(outcome("1e22")).toBe("10,000,000,000,000,000,000,000");
		expect(outcome("5 km")).toBe("5.00 km");
		expect(outcome("1e20 m")).toBe("100,000,000,000,000,000,000.00 m");
		expect(outcome("1 Hz in MHz")).toBe("1e-6 MHz");
		expect(outcome("1e22 as compact")).toBe("1e+22");
	});
});

describe("fixedDecimalText", () => {
	test("ordinary: a number to its places, as toFixed writes it", () => {
		expect(fixedDecimalText(1.5, 2)).toBe("1.50");
		expect(fixedDecimalText(-12.345, 1)).toBe((-12.345).toFixed(1));
		expect(fixedDecimalText(123456, 0)).toBe("123456");
	});

	test("boundary: just below 1e21 it is toFixed; at and past it, every digit, either sign", () => {
		expect(fixedDecimalText(999999999999999900000, 2)).toBe((999999999999999900000).toFixed(2));
		expect(fixedDecimalText(1e21, 2)).toBe("1000000000000000000000.00");
		expect(fixedDecimalText(-1e21, 0)).toBe("-1000000000000000000000");
		expect(fixedDecimalText(Number.MAX_VALUE, 0)).toMatch(/^17976931348623157\d{292}$/);
		expect(fixedDecimalText(-Number.MAX_VALUE, 1)).toMatch(/^-17976931348623157\d{292}\.0$/);
		expect(fixedDecimalText(0, 2)).toBe("0.00");
		expect(fixedDecimalText(-0, 2)).toBe("0.00");
		expect(fixedDecimalText(Number.MIN_VALUE, 2)).toBe("0.00");
		expect(fixedDecimalText(1e22, 100)).toBe(`10000000000000000000000.${"0".repeat(100)}`);
	});

	test("hostile: an infinity and NaN are toFixed's own text, never an exception", () => {
		expect(fixedDecimalText(Number.POSITIVE_INFINITY, 2)).toBe("Infinity");
		expect(fixedDecimalText(Number.NEGATIVE_INFINITY, 2)).toBe("-Infinity");
		expect(fixedDecimalText(Number.NaN, 2)).toBe("NaN");
	});
});

describe("shortestText", () => {
	test("ordinary, boundary and hostile", () => {
		expect(shortestText(0.25)).toBe("0.25");
		expect(shortestText(42)).toBe("42");
		expect(shortestText(999999999999999900000)).toBe("999999999999999900000");
		expect(shortestText(1e21)).toBe("1000000000000000000000");
		expect(shortestText(-1e22)).toBe("-10000000000000000000000");
		expect(shortestText(1e-7)).toBe("1e-7");
		expect(shortestText(-0)).toBe("0");
		expect(shortestText(Number.POSITIVE_INFINITY)).toBe("Infinity");
		expect(shortestText(Number.NaN)).toBe("NaN");
	});
});

describe("formatValue, the formatters that called toFixed", () => {
	test("a percentage, a quantity, a day count and money past 1e21, under English and German", () => {
		expect(formatValue(percentageValue(1e20))).toBe("= 10,000,000,000,000,000,000,000.00%");
		expect(formatValue(uomValue(1e22, "m"))).toBe("= 10,000,000,000,000,000,000,000.00 m");
		expect(formatValue(uomValue(1e22, "USD"))).toBe("= $10,000,000,000,000,000,000,000.00");
		const de = { numberResult: { decimalSeparatorLocale: "de-DE" } };
		expect(formatValue(uomValue(1e22, "m"), de)).not.toMatch(JS_EXPONENT);
		expect(formatValue(percentageValue(1e20), de)).toBe("= 10.000.000.000.000.000.000.000,00%");
	});

	test("the hot path is unchanged: an ordinary figure is written as toFixed writes it", () => {
		expect(formatValue(uomValue(1.005, "m"))).toBe(`= ${(1.005).toFixed(2)} m`);
		expect(formatValue(numberValue(1e22))).toBe("= 10,000,000,000,000,000,000,000");
	});
});

describe("adversarial", () => {
	test("security: prototype words, a long sum, deep brackets, a huge power and look-alike text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} * 1e22 as %`);
				expectHonestDocument(`${word} = 1e22\n${word} m\n${word} as %`);
			}
		});
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)}) * 1e300 as %`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} * 1e300 kg`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.hugePower()} as %`, { budgetMs: 5_000 });
		for (const line of fill("X * 1e22 as %", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("１e22 as %");
		expectHonestLine("<b>1e22</b> m");
	});

	test("realistic: a value from the line above, a conversion, a what-if, and both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("n = 1e22\nn as %\nn m in km\nline 2 with n = 0.5");
		expect(batch[1]).toBe("= 1,000,000,000,000,000,000,000,000.00%");
		expect(batch[2]).toBe("= 10,000,000,000,000,000,000.00 km");
		expect(batch[3]).toBe("= 50.00%");
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge a hundred trillion trillion times over, as a percentage, a length and money, never in exponent text", () => {
		for (const line of [...fill("(X) * 1e22 as %", NUMERIC_EDGES), ...fill("(X) * 1e22 m", NUMERIC_EDGES), ...fill("(X) * $1e22", NUMERIC_EDGES)]) {
			const result = expectHonestLine(line, { allowNaN: line.includes("0/0") });
			if (result.kind === "value") expect({ line, text: result.text }).not.toEqual({ line, text: expect.stringMatching(JS_EXPONENT) });
		}
	});
});
