import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, bigIntValue, boolValue, numberValue, numberValueExact, numberValueRational, stringValue, uomValue } from "@solve-js/vm/Value";
import { rational } from "@solve-js/symbolic";
import { hasFiniteExactReading, percentageNotFinite, percentageTooLarge, toPercentage } from "@solve-js/vm/VMConversion";
import { zeroDivisorQuotient } from "@solve-js/vm/IndeterminateQuotient";

/**
 * Found bug: `1e308 as %` answered `Infinity%`. 1e308 is an ordinary finite
 * number, and `toPercentage` refused only a value that is not finite; but a
 * percentage is written a hundred times over, and a hundred times 1e308 is
 * past the largest double, so the formatter's multiplication overflowed and
 * printed the JavaScript spelling of an infinity with a percent sign.
 *
 * Every form that writes a number as a percentage (`as %`, `in %`, `to %`,
 * `as percent`, `is what % of`, a parts-per quantity) now refuses a fraction
 * whose percentage overflows with the new `PERCENTAGE_OVERFLOW`, in the
 * reader's terms, and so does a sum on a percentage that overflows (`50% +
 * 1e308`). The closest existing refusal, `PERCENTAGE_NOT_FINITE`, says the
 * value is what a division by zero gives, which is wrong for a real number, so
 * it is kept for that case and the overflow has its own code, as a factorial,
 * a permutation and a combination each have theirs.
 */

const TOO_LARGE = "This is too large to write as a percentage: a percentage is a hundred times the number, and that is past about 1.8e308, the largest number that can be held.";

function outcome(line: string, engine = newTrackedEngine()): string {
	try {
		const v = engine.evaluateExpression(line);
		return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([
		"1e308 as %",
		"1e308 in %",
		"1e308 to %",
		"1e308 as percent",
		"-1e308 as %",
		"-1e308 in %",
		"-1e308 to %",
		"-1e308 as percent",
		"1.8e306 as %",
		"1e307 is what % of 1",
		"1e308 permille as %",
		"50% + 1e308",
		"50% - 1e308",
		"(1e306 as %) + (1e306 as %)",
		"(2n^2000) as %",
	])("%s is refused by name", (line) => {
		expect(outcome(line)).toBe(`PERCENTAGE_OVERFLOW: ${TOO_LARGE}`);
	});

	test("just below the line, the percentage is written; just above it, refused", () => {
		expect(outcome("1.7976931348623157e306 as %")).not.toContain("Infinity");
		expect(outcome("1.7976931348623157e306 as %")).toMatch(/%$/);
		expect(outcome("1.7976931348623158e306 as %")).toBe(`PERCENTAGE_OVERFLOW: ${TOO_LARGE}`);
	});

	test("what was right stays right: ordinary percentages, a division by zero, a length", () => {
		expect(outcome("0.5 as %")).toBe("50.00%");
		expect(outcome("-0.5 in %")).toBe("-50.00%");
		expect(outcome("1/8 to %")).toBe("12.50%");
		expect(outcome("0.25 as percent")).toBe("25.00%");
		expect(outcome("100 ppm as %")).toBe("0.01%");
		expect(outcome("50% + 50%")).toBe("100.00%");
		expect(outcome("1/0 as %")).toMatch(/^PERCENTAGE_NOT_FINITE: /);
		expect(outcome("40 is what % of 0")).toMatch(/^PERCENTAGE_NOT_FINITE: /);
		expect(outcome("5 km as %")).toMatch(/^PERCENTAGE_OF_QUANTITY: /);
		expect(outcome("9007199254740993.5 as percent")).toBe("900,719,925,474,099,350.00%");
	});

	test("the boundary: a number that is itself past the largest double is too large as well, and says so", () => {
		// It was told "what dividing by zero gives"; see FoundBug_percentageOfAnInfinity.
		expect(outcome("2^2000 as %")).toMatch(/^PERCENTAGE_OVERFLOW: This is too large to write as a percentage: the number is past/);
		expect(outcome("1e309 as %")).toMatch(/^PERCENTAGE_OVERFLOW: /);
		expect(outcome("1/0 as %")).toMatch(/^PERCENTAGE_NOT_FINITE: /);
	});
});

describe("toPercentage", () => {
	test("ordinary: a fraction is its percentage, and a parts-per quantity its share", () => {
		const half = toPercentage(numberValue(0.5));
		expect(half.type).toBe(ValueType.Percentage);
		expect(half.value).toBe(0.5);
		expect(toPercentage(uomValue(100, "ppm")).value).toBeCloseTo(0.0001, 12);
	});

	test("boundary: zero, negative zero, 2^53 ± 1, a 34-digit decimal and the largest fraction that fits", () => {
		expect(toPercentage(numberValue(0)).value).toBe(0);
		expect(Object.is(toPercentage(numberValue(-0)).value, -0)).toBe(true);
		expect(toPercentage(numberValueRational(2 ** 53, rational(9007199254740993n))).type).toBe(ValueType.Percentage);
		expect(toPercentage(numberValue(2 ** 53 - 1)).type).toBe(ValueType.Percentage);
		expect(toPercentage(numberValueExact(1.2345678901234568e33, { coef: 12345678901234567890123456789012345n, scale: 1 })).type).toBe(ValueType.Percentage);
		expect(toPercentage(numberValue(Number.MAX_VALUE / 100)).type).toBe(ValueType.Percentage);
		expect(toPercentage(numberValue(Number.MIN_VALUE)).type).toBe(ValueType.Percentage);
	});

	test("boundary: the largest doubles, either sign, overflow, and so does an unmarked infinity; a division by zero's infinity and NaN are not finite", () => {
		expect(toPercentage(numberValue(Number.MAX_VALUE)).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(toPercentage(numberValue(-Number.MAX_VALUE)).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(toPercentage(numberValue(1e307)).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(toPercentage(numberValue(Number.POSITIVE_INFINITY)).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(toPercentage(numberValue(Number.NEGATIVE_INFINITY)).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(toPercentage(zeroDivisorQuotient(Number.POSITIVE_INFINITY)).errorCode).toBe("PERCENTAGE_NOT_FINITE");
		expect(toPercentage(numberValue(Number.NaN)).errorCode).toBe("PERCENTAGE_NOT_FINITE");
		expect(toPercentage(uomValue(1e308, "permille")).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(toPercentage(bigIntValue(1n << 2000n)).errorCode).toBe("PERCENTAGE_OVERFLOW");
	});

	test("hostile: text, a boolean and a length are answered, never thrown on", () => {
		expect(() => toPercentage(stringValue("1e308"))).not.toThrow();
		expect(() => toPercentage(boolValue(true))).not.toThrow();
		expect(toPercentage(uomValue(1e308, "m")).errorCode).toBe("PERCENTAGE_OF_QUANTITY");
	});
});

describe("percentageTooLarge and hasFiniteExactReading", () => {
	test("the refusal carries its code and the reader's words, with no internal name or operator", () => {
		const v = percentageTooLarge();
		expect(v.errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(v.errorMessage).toBe(TOO_LARGE);
		expect(v.errorMessage).not.toMatch(/Infinity|double|NaN|\*/);
		expect(percentageNotFinite().errorCode).toBe("PERCENTAGE_NOT_FINITE");
	});

	test("a whole number written with n, or an exact sidecar, is a finite reading; a plain infinity is not", () => {
		expect(hasFiniteExactReading(bigIntValue(1n << 2000n))).toBe(true);
		expect(hasFiniteExactReading(numberValueRational(Number.POSITIVE_INFINITY, rational(1n << 2000n)))).toBe(true);
		expect(hasFiniteExactReading(numberValueExact(Number.POSITIVE_INFINITY, { coef: 1n, scale: 0 }))).toBe(true);
		expect(hasFiniteExactReading(numberValue(Number.POSITIVE_INFINITY))).toBe(false);
		expect(hasFiniteExactReading(numberValue(Number.NaN))).toBe(false);
		expect(hasFiniteExactReading(numberValue(-0))).toBe(false);
		expect(hasFiniteExactReading(stringValue("constructor"))).toBe(false);
	});
});

describe("adversarial", () => {
	test("security: prototype words, a long sum, deep brackets, a huge power and look-alike digits", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} as %`);
				expectHonestDocument(`${word} = 1e308\n${word} as %\n${word} in %`);
			}
		});
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)}) * 1e302 as %`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} * 1e308 as %`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.hugePower()} as %`, { budgetMs: 5_000 });
		for (const line of fill("1e308 as % X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("X as %", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("１e308 as %");
		expectHonestLine("1e308 as ​%");
	});

	test("realistic: a value from the line above, a check and a what-if, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("n = 1e308\nn as %\nn in percent\nline 2 with n = 0.25");
		expect(batch[1]).toBe(`ERROR ${TOO_LARGE}`);
		expect(batch[3]).toBe("= 25.00%");
		expect(incremental).toEqual(batch);
		expect(outcome("check 1e308 as % == 5")).not.toContain("Infinity");
		expect(outcome("1e308 as %%")).not.toContain("Infinity");
		expect(outcome("(1e308 as %) * 2")).not.toContain("Infinity");
		expect(outcome("1e308 as procent")).not.toContain("Infinity");
	});

	test("edge: every numeric edge as a percentage, and negated, is a percentage or a refusal, never Infinity%", () => {
		for (const line of [...fill("X as %", NUMERIC_EDGES), ...fill("-(X) in %", NUMERIC_EDGES), ...fill("(X) to %", NUMERIC_EDGES), ...fill("X as percent", NUMERIC_EDGES)]) {
			const result = expectHonestLine(line);
			if (result.kind === "value") expect({ line, text: result.text }).not.toEqual({ line, text: expect.stringMatching(/Infinity|NaN/) });
		}
	});
});
