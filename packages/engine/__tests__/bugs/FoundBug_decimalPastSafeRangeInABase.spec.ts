import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, numberValueExact, numberValueRational, percentageValue, stringValue, uomValueExact } from "@solve-js/vm/Value";
import { rational } from "@solve-js/symbolic";
import { baseConversionOperand, truncatedDecimal } from "@solve-js/vm/ExactIntegers";

/**
 * Found bug: `12345678901234567890.5 in hex` answered 0xAB54A98CEB1F0800. The
 * literal keeps its exact decimal, but a base conversion read its double,
 * which past 2^53 holds no fraction and lands on 12,345,678,901,234,567,168,
 * so the hex digits were the double's. A base now truncates (see
 * `wholeForBase`), so `baseConversionOperand` cuts the exact decimal, or an
 * exact fraction that is not whole, toward zero first (`truncatedDecimal`) and
 * converts that whole number: 0xAB54A98CEB1F0AD2, the digits of
 * 12,345,678,901,234,567,890.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

describe("the lines that exposed it", () => {
	test.each([
		["12345678901234567890.5 in hex", "0xAB54A98CEB1F0AD2"],
		["-12345678901234567890.5 in hex", "-0xAB54A98CEB1F0AD2"],
		["12345678901234567890.9 as hex", "0xAB54A98CEB1F0AD2"],
		["12345678901234567890.5 in binary", "0b1010101101010100101010011000110011101011000111110000101011010010"],
		["12345678901234567890.5 in octal", "0o1255245230635307605322"],
		["9007199254740993.5 in hex", "0x20000000000001"],
		["(2^60 + 1.5) in hex", "0x1000000000000001"],
		["(12345678901234567890.5 in hex) as number", "12,345,678,901,234,567,890"],
		["(12345678901234567890.5 in hex) + 1", "12,345,678,901,234,567,891"],
	])("%s is %s", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test("what was right stays right", () => {
		expect(outcome("12345678901234567890 in hex")).toBe("0xAB54A98CEB1F0AD2");
		expect(outcome("255.7 in hex")).toBe("0xFF");
		expect(outcome("-1.5 in hex")).toBe("-0x1");
		expect(outcome("-0.5 in hex")).toBe("0x0");
		expect(outcome("(1/3) in hex")).toBe("0x0");
		expect(outcome("(2^100 + 1) in hex")).toBe("0x10000000000000000000000001");
		// A number typed in exponent form names a double, so its digits are the double's.
		expect(outcome("1e30 in hex")).toBe(`0x${BigInt(1e30).toString(16).toUpperCase()}`);
	});
});

describe("truncatedDecimal", () => {
	test("ordinary: a decimal cut toward zero", () => {
		expect(truncatedDecimal(2557n, 1)).toBe(255n);
		expect(truncatedDecimal(-2557n, 1)).toBe(-255n);
		expect(truncatedDecimal(123456789012345678905n, 1)).toBe(12345678901234567890n);
	});

	test("boundary: a whole decimal, trailing zeros, a value below one, and the largest scale either way", () => {
		expect(truncatedDecimal(7n, 0)).toBe(7n);
		expect(truncatedDecimal(7n, -3)).toBe(7000n);
		expect(truncatedDecimal(5n, 1)).toBe(0n);
		expect(truncatedDecimal(-5n, 1)).toBe(0n);
		expect(truncatedDecimal(1n, 340)).toBe(0n);
		expect(truncatedDecimal(1n, -340)).toBe(BigInt(`1${"0".repeat(340)}`));
	});

	test("hostile: a scale past the limit or not whole is null, never a huge build", () => {
		expect(truncatedDecimal(1n, 341)).toBeNull();
		expect(truncatedDecimal(1n, -1_000_000)).toBeNull();
		expect(truncatedDecimal(1n, 1.5)).toBeNull();
		expect(truncatedDecimal(1n, Number.NaN)).toBeNull();
	});
});

describe("baseConversionOperand", () => {
	test("an exact decimal or fraction past 2^53 is cut from its exact value; within the range a double", () => {
		expect(baseConversionOperand(numberValueExact(Number("12345678901234567890.5"), { coef: 123456789012345678905n, scale: 1 }))).toBe(12345678901234567890n);
		expect(baseConversionOperand(numberValueRational(2 ** 60, rational(2305843009213693955n, 2n)))).toBe(1152921504606846977n);
		expect(baseConversionOperand(numberValueExact(255.7, { coef: 2557n, scale: 1 }))).toBe(255);
		expect(baseConversionOperand(numberValueRational(1 / 3, rational(1n, 3n)))).toBe(0);
		expect(baseConversionOperand(numberValue(255.7))).toBe(255.7);
	});

	test("money and a percentage that carry a decimal read it the same way; text keeps its own path", () => {
		expect(baseConversionOperand(uomValueExact(2.5, "USD", { coef: 25n, scale: 1 }))).toBe(2);
		const pct = percentageValue(0.5);
		pct.exact = { coef: 5n, scale: 1 };
		expect(baseConversionOperand(pct)).toBe(0);
		expect(() => baseConversionOperand(stringValue("constructor"))).not.toThrow();
	});
});

describe("adversarial", () => {
	test("security: prototype words, a long sum, deep brackets, a huge power and look-alike text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word}.5 in hex`);
				expectHonestDocument(`${word} = 12345678901234567890.5\n${word} in hex\n${word} in binary`);
			}
		});
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)} + 12345678901234567890.5) in hex`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} * 12345678901234567890.5 in hex`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.hugePower()} + 0.5 in hex`, { budgetMs: 5_000 });
		expectHonestLine(`1${"0".repeat(33)}.5 in hex`);
		for (const line of fill("12345678901234567890.5 in hex X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("１2345678901234567890.5 in hex");
	});

	test("realistic: a value from the line above, a what-if, a check and a total, both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("n = 12345678901234567890.5\nn in hex\nline 2 with n = 255.7\ncheck n in hex == 12345678901234567890");
		expect(batch[1]).toBe("= 0xAB54A98CEB1F0AD2");
		expect(batch[2]).toBe("= 0xFF");
		expect(batch[3]).toBe("= ✓");
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge plus a large fraction, in each base", () => {
		for (const line of [...fill("((X) + 12345678901234567890.5) in hex", NUMERIC_EDGES), ...fill("-((X) - 9007199254740993.5) in binary", NUMERIC_EDGES)]) {
			expectHonestLine(line);
		}
	});
});
