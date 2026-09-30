import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { baseConversionOperand } from "@solve-js/vm/ExactIntegers";
import { Value, ValueType, bigIntValue, hexValue, numberValue, stringValue, type IpCidrData } from "@solve-js/vm/Value";

/**
 * Found bug: `(2^100 + 1) in binary as hex` answered
 * 0x10000000000000000000000000, dropping the final 1. `in binary` keeps the
 * exact integer as a bigint inside the value it writes in base two, but the
 * next conversion read that value through `toNumber()`, which rounds to the
 * nearest double. `baseConversionOperand` now reads the bigint a value written
 * in a base already holds, so a chain of `in binary`, `in octal` and `as hex`
 * keeps every digit, and `as number` at the end of the chain gives the exact
 * whole number rather than the double.
 */

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const big = (1n << 100n) + 1n;

describe("the line that exposed it", () => {
	test("(2^100+1) in binary as hex keeps its final 1", () => {
		expect(shown("(2^100+1) in binary as hex")).toBe("0x10000000000000000000000001");
	});
});

describe("every link of a conversion chain", () => {
	test.each([
		["(2^100+1) in hex", "0x10000000000000000000000001"],
		["(2^100+1) in octal as hex", "0x10000000000000000000000001"],
		["(2^100+1) in hex in octal", "0o2000000000000000000000000000000001"],
		["(2^100+1) in octal as binary", `0b1${"0".repeat(99)}1`],
		["(2^100+1) in hex as number", "1,267,650,600,228,229,401,496,703,205,377"],
		["(2^100+1) in hex in binary as number", "1,267,650,600,228,229,401,496,703,205,377"],
		["(2^100+1) in hex as number + 1", "1,267,650,600,228,229,401,496,703,205,378"],
		["-(2^100+1) in binary as hex", "-0x10000000000000000000000001"],
		["12345678901234567890n in binary as hex", "0xAB54A98CEB1F0AD2"],
		["(2^53+1) in binary as hex", "0x20000000000001"],
		["fe80::1 in binary as hex", "0xFE800000000000000000000000000001"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("small values are unchanged", () => {
		expect(shown("255 in binary as hex")).toBe("0xFF");
		expect(shown("0 in binary as hex")).toBe("0x0");
		expect(shown("0xff in binary")).toBe("0b11111111");
		expect(shown("0b1010 as number")).toBe("10");
	});
});

describe("baseConversionOperand", () => {
	test("ordinary: a bigint, and a value in a base holding one, give the bigint", () => {
		expect(baseConversionOperand(bigIntValue(big))).toBe(big);
		expect(baseConversionOperand(hexValue(big, "bin"))).toBe(big);
		expect(baseConversionOperand(hexValue(big, "oct"))).toBe(big);
		expect(baseConversionOperand(hexValue(big))).toBe(big);
	});

	test("boundary: a small value in a base, zero, a negative, and the safe limit", () => {
		expect(baseConversionOperand(hexValue(255))).toBe(255);
		expect(baseConversionOperand(hexValue(0n, "bin"))).toBe(0n);
		expect(baseConversionOperand(hexValue(-big))).toBe(-big);
		expect(baseConversionOperand(numberValue(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
	});

	test("hostile: text, an IPv6 address and a non-finite double are read as before", () => {
		expect(baseConversionOperand(stringValue("constructor"))).toBe(0);
		expect(baseConversionOperand(new Value(ValueType.IpCidr, { addr6: big } satisfies IpCidrData))).toBe(big);
		expect(baseConversionOperand(numberValue(Infinity))).toBe(Infinity);
		// A bigint in the value slot of a type that is not a base is not taken as one.
		expect(typeof baseConversionOperand(numberValue(1))).toBe("number");
	});
});

describe("adversarial", () => {
	test("security: prototype words holding a big value in a base, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = expectHonestDocument(`${word} = (2^100+1) in binary\n${word} as hex`);
				expect(batch[1]).toBe("= 0x10000000000000000000000001");
				expect(incremental).toEqual(batch);
			}
		});
	});

	test("security: a long chain and a very large value stay within budget", () => {
		expectHonestLine(`(2^100+1)${" in binary in octal as hex".repeat(60)}`);
		expect(shown("2^1000 in binary as hex")).toBe(`0x1${"0".repeat(250)}`);
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)}) in binary as hex`);
	});

	test("realistic: a value from the line above converted twice, through both passes", () => {
		const text = "mask = 2^100 + 1\nm = mask in binary\nm as hex\nm as number";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch.slice(2)).toEqual(["= 0x10000000000000000000000001", "= 1,267,650,600,228,229,401,496,703,205,377"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: the numeric edges through a binary-to-hex chain are honest", () => {
		for (const line of fill("X in binary as hex", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("2^53 in binary as hex")).toBe("0x20000000000000");
		expect(shown("-0 in binary as hex")).toBe("0x0");
	});
});
