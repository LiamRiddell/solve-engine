import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { bigBaseInteger, wholeFromBase } from "@solve-js/vm/ExactIntegers";
import { bigBaseArithmetic, compareRationalOperands, toBigIntOperand } from "@solve-js/vm/VMConversion";
import { Value, ValueType, bigIntValue, colourValue, hexValue, numberValue, numberValueUncertain, stringValue, uomValue } from "@solve-js/vm/Value";

/**
 * Found bug: `(2^100 + 1) in hex + 1` answered
 * 1,267,650,600,228,229,400,000,000,000,000, although `(2^100 + 1) in binary
 * as hex` keeps every digit. `in hex` keeps the exact integer inside the value
 * it writes, and the chain of conversions reads it, but `+`, `-`, `*`, `/`,
 * `mod`, `^`, unary minus and the comparisons read the value through
 * `toNumber()`, the nearest double; `+ 1n` even answered 2^100 + 1, the digit
 * it added lost in the rounding. Each now reads the whole number the base
 * holds (`bigBaseInteger`) and goes through the exact path an ordinary large
 * whole number takes (`bigBaseArithmetic`), and one past a double's range is
 * worked as the `n` number it is (`wholeFromBase`).
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
const grouped = (n: bigint): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

describe("the line that exposed it", () => {
	test("(2^100+1) in hex + 1 keeps every digit", () => {
		expect(shown("(2^100+1) in hex + 1")).toBe(grouped(big + 1n));
	});
});

describe("every operation on a large value in a base", () => {
	test.each([
		["(2^100+1) in hex - 1", grouped(big - 1n)],
		["(2^100+1) in hex * 2", grouped(big * 2n)],
		["((2^100+1) in hex) mod 10", "7"],
		["(2^100+1) in hex ^ 2", grouped(big * big)],
		["-((2^100+1) in hex)", grouped(-big)],
		["(2^100+1) in hex + 0x1", grouped(big + 1n)],
		["(2^100+1) in hex + 1n", (big + 1n).toString()],
		["(2^100+1) in hex / 2 as fraction", `${big}/2`],
		["(2^100+1) in hex / 2 * 2", grouped(big)],
		["(2^100+1) in hex + 1 in hex", "0x10000000000000000000000002"],
		["(2^60+1) in hex + 1", grouped((1n << 60n) + 2n)],
		["(2^53+1) in hex + 1", grouped((1n << 53n) + 2n)],
		["12345678901234567890n in hex + 1", grouped(12345678901234567891n)],
		["((2^100+1) in hex) == 2^100", "false"],
		["((2^100+1) in hex) > 2^100", "true"],
		["((2^100+1) in hex) == ((2^100) in hex)", "false"],
		["((2^100+1) in hex) != ((2^100) in hex)", "true"],
		["((2^100+1) in hex) < ((2^100) in hex)", "false"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("past a double's range the n number is kept for + - * and mod", () => {
		const huge = 1n << 2000n;
		expect(shown("(2n^2000) in hex + 1")).toBe((huge + 1n).toString());
		expect(shown("-((2n^2000) in hex)")).toBe((-huge).toString());
		expect(shown("((2n^2000) in hex) mod 7")).toBe(String(huge % 7n));
		expect(shown("(2n^2000) in hex as number")).toBe(huge.toString());
	});

	test("small values keep their path", () => {
		expect(shown("0x10 + 1")).toBe("17");
		expect(shown("0xff * 2")).toBe("510");
		expect(shown("-0xff")).toBe("-255");
		expect(shown("0xff + 0.5")).toBe("255.50");
		expect(shown("hex(255) + 1")).toBe("256");
	});

	test("the boundary: a quantity, a percentage, a tolerance, text and a power past a double's range", () => {
		expect(shown("(2^100+1) in hex * 1 km")).toBe("1.2676506002282294e+30 km");
		expect(shown("(2^100+1) in hex ^ 20")).toBe("∞");
		expect(shown("(2^100+1) in hex ^ (2 m)")).toMatch(/^UNIT_IN_EXPONENT: /);
		expect(shown("(2^100+1) in hex + \"a\"")).toMatch(/^TEXT_ARITHMETIC: /);
		expect(shown("((2^100+1) in hex) mod 0")).toMatch(/^REMAINDER_UNDEFINED: /);
	});
});

describe("bigBaseInteger", () => {
	test("ordinary: a value in any base holding a bigint past 2^53", () => {
		expect(bigBaseInteger(hexValue(big))).toBe(big);
		expect(bigBaseInteger(hexValue(-big, "bin"))).toBe(-big);
		expect(bigBaseInteger(hexValue(big, "oct"))).toBe(big);
	});

	test("boundary: the safe limit itself is left to the double, one past it is not", () => {
		const safe = BigInt(Number.MAX_SAFE_INTEGER);
		expect(bigBaseInteger(hexValue(safe))).toBeNull();
		expect(bigBaseInteger(hexValue(-safe))).toBeNull();
		expect(bigBaseInteger(hexValue(safe + 1n))).toBe(safe + 1n);
		expect(bigBaseInteger(hexValue(0n))).toBeNull();
		expect(bigBaseInteger(hexValue(255))).toBeNull();
	});

	test("hostile: a bigint of another type, text and a colour are not in a base", () => {
		expect(bigBaseInteger(bigIntValue(big))).toBeNull();
		expect(bigBaseInteger(stringValue("__proto__"))).toBeNull();
		expect(bigBaseInteger(colourValue({ r: 1, g: 2, b: 3, a: 1, format: "hex" }))).toBeNull();
		expect(bigBaseInteger(numberValue(Infinity))).toBeNull();
	});
});

describe("wholeFromBase", () => {
	test("ordinary and boundary: exact within a double's range, the n number past it", () => {
		expect(wholeFromBase(big).toNumber()).toBe(Number(big));
		expect(wholeFromBase(big).rational?.n).toBe(big);
		expect(wholeFromBase(5n).value).toBe(5);
		expect(wholeFromBase(0n).value).toBe(0);
		const huge = 1n << 1024n;
		expect(wholeFromBase(huge).type).toBe(ValueType.BigInt);
		expect(wholeFromBase(-huge).value).toBe(-huge);
		expect(wholeFromBase((1n << 1023n)).type).toBe(ValueType.Number);
	});
});

describe("bigBaseArithmetic", () => {
	const h = hexValue(big);
	test("ordinary: each operation on the whole number", () => {
		expect((bigBaseArithmetic(h, numberValue(1), "add") as Value).rational?.n).toBe(big + 1n);
		expect((bigBaseArithmetic(h, numberValue(1), "sub") as Value).rational?.n).toBe(big - 1n);
		expect((bigBaseArithmetic(numberValue(3), h, "mul") as Value).rational?.n).toBe(3n * big);
		expect((bigBaseArithmetic(h, numberValue(10), "mod") as Value).value).toBe(7);
		expect((bigBaseArithmetic(h, numberValue(2), "pow") as Value).rational?.n).toBe(big * big);
		expect((bigBaseArithmetic(h, h, "div") as Value).value).toBe(1);
	});

	test("boundary: no large base on either side, a zero divisor, and a power past a double's range", () => {
		expect(bigBaseArithmetic(hexValue(255), numberValue(1), "add")).toBeNull();
		expect(bigBaseArithmetic(numberValue(1), numberValue(1), "add")).toBeNull();
		expect(bigBaseArithmetic(h, numberValue(0), "div")).toBeNull();
		expect(bigBaseArithmetic(h, numberValue(0), "mod")).toBeNull();
		expect(bigBaseArithmetic(h, numberValue(20), "pow")).toBeNull();
		expect((bigBaseArithmetic(h, numberValue(-1), "pow") as Value).value).toBeCloseTo(1 / Number(big));
	});

	test("hostile: a quantity, text, a tolerance and a colour keep their own paths", () => {
		expect(bigBaseArithmetic(h, uomValue(1, "km"), "mul")).toBeNull();
		expect(bigBaseArithmetic(h, stringValue("1"), "add")).toBeNull();
		expect(bigBaseArithmetic(h, numberValueUncertain(1, 0.1), "add")).toBeNull();
		expect(bigBaseArithmetic(colourValue({ r: 1, g: 2, b: 3, a: 1, format: "hex" }), h, "add")).toBeNull();
		expect(bigBaseArithmetic(hexValue(1n << 2000n), numberValue(0.5), "add")).toBeNull();
	});
});

describe("the altered readers", () => {
	test("toBigIntOperand reads a large value in a base exactly, and a small one as before", () => {
		expect(toBigIntOperand(hexValue(big))).toBe(big);
		expect(toBigIntOperand(hexValue(255))).toBe(255n);
		expect(() => toBigIntOperand(numberValue(Infinity))).toThrow();
	});

	test("compareRationalOperands orders two large values in a base on their digits", () => {
		expect(compareRationalOperands(hexValue(big), hexValue(big - 1n))).toBe(1);
		expect(compareRationalOperands(hexValue(big), hexValue(big))).toBe(0);
		expect(compareRationalOperands(numberValue(0.5), hexValue(big))).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: prototype words holding a large value in a base, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = expectHonestDocument(`${word} = (2^100+1) in hex\n${word} + 1`);
				expect(batch[1]).toBe(`= ${grouped(big + 1n)}`);
				expect(incremental).toEqual(batch);
			}
		});
	});

	test("security: a long sum of large values in a base and a big n number stay within budget", () => {
		expectHonestLine(Array.from({ length: 300 }, () => "(2^100+1) in hex").join(" + "));
		expectHonestLine(`(2n^60000) in hex * (2n^60000) in hex`);
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)}) in hex + 1`);
	});

	test("realistic: a value from the line above, a total, a check and a what-if over it, both passes agreeing", () => {
		const text = "mask = (2^100 + 1) in hex\nmask + 1\nmask * 2\ncheck mask + 1 > mask\nline 2 with mask = 5";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch.slice(1, 4)).toEqual([`= ${grouped(big + 1n)}`, `= ${grouped(big * 2n)}`, "= ✓"]);
		expect(batch[4]).toBe("= 6");
		expect(incremental).toEqual(batch);
	});

	test("edge: the numeric edges against a large value in a base are honest", () => {
		for (const form of ["(2^100+1) in hex + X", "X * ((2^100+1) in hex)", "((2^100+1) in hex) mod X", "((2^100+1) in hex) ^ X", "((2^100+1) in hex) == X"]) {
			for (const line of fill(form, NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		}
		expect(shown("-(2^53+1) in hex - 1")).toBe(grouped(-(1n << 53n) - 2n));
		expect(shown("((2^100+1) in hex) - ((2^100+1) in hex)")).toBe("0");
	});
});
