import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { nonFiniteInBase, valueInBase } from "@solve-js/vm/ExactIntegers";
import { ValueType, bigIntValue, hexValue, numberValue, numberValueRational, stringValue } from "@solve-js/vm/Value";
import { rational } from "@solve-js/symbolic";

/**
 * Found bug: `(1/0) in hex` and `2^4000 in binary as hex` displayed
 * "Infinity" as though it were a numeral. An infinity has no digits in any
 * base, and an ordinary number past about 1.8e308 is already infinite before
 * the conversion sees it. Every base conversion (`in hex`, `as binary`, `in
 * octal`, `hex()`, `bin()`) now goes through `valueInBase`, which refuses a
 * value with no digits by name (`BASE_NOT_FINITE`) and points at the `n` form,
 * which writes a very large whole number out in full.
 */

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const code = (line: string): string | undefined => {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? String(v.errorCode) : undefined;
};

const INFINITE = "An infinite value has no digits to write in hex. An ordinary number past about 1.8e308 is infinite; a whole number written with n, as in 2n^4000, keeps every digit.";

describe("the lines that exposed it", () => {
	test("(1/0) in hex and 2^4000 in binary as hex are refused by name", () => {
		expect(shown("(1/0) in hex")).toBe(`BASE_NOT_FINITE: ${INFINITE}`);
		expect(shown("2^4000 in binary as hex")).toBe(`BASE_NOT_FINITE: ${INFINITE.replace("in hex", "in binary")}`);
	});
});

describe("every way into a base", () => {
	test.each(["(1/0) in hex", "(1/0) as hex", "-(1/0) in binary", "(1/0) in octal", "(1/0) as binary", "hex(1/0)", "bin(1/0)", "1e400 in hex", "2^4000 in hex", "-(2^4000) in octal"])(
		"%s is refused",
		(line) => {
			expect(code(line)).toBe("BASE_NOT_FINITE");
		},
	);

	test("a very large exact value is written out in full", () => {
		expect(shown("2n^200 in hex")).toBe(`0x1${"0".repeat(50)}`);
		expect(shown("(2n^4000) in binary")).toBe(`0b1${"0".repeat(4000)}`);
		expect(shown("2^1000 in hex")).toBe(`0x1${"0".repeat(250)}`);
		expect(shown("1e300 in hex")).toMatch(/^0x17E43C8800759C0+$/);
	});

	test("finite values are unchanged", () => {
		expect(shown("255 in hex")).toBe("0xFF");
		expect(shown("hex(-255)")).toBe("-0xFF");
		expect(shown("255.7 as hex")).toBe("0xFF");
		expect(shown("0 in binary")).toBe("0b0");
	});
});

describe("nonFiniteInBase", () => {
	test("ordinary: an infinity in each base is named in that base", () => {
		expect(nonFiniteInBase(Infinity, "hex")?.errorMessage).toBe(INFINITE);
		expect(nonFiniteInBase(-Infinity, "bin")?.errorMessage).toContain("to write in binary");
		expect(nonFiniteInBase(Infinity, "oct")?.errorMessage).toContain("to write in octal");
	});

	test("boundary: the largest double, the smallest and zero have digits", () => {
		expect(nonFiniteInBase(Number.MAX_VALUE, "hex")).toBeNull();
		expect(nonFiniteInBase(Number.MIN_VALUE, "bin")).toBeNull();
		expect(nonFiniteInBase(-0, "oct")).toBeNull();
		expect(nonFiniteInBase(1n << 5000n, "hex")).toBeNull();
	});

	test("hostile: NaN is a result with no value, not an infinity", () => {
		expect(nonFiniteInBase(NaN, "hex")?.errorMessage).toBe("A result with no value has no digits to write in hex.");
		expect(nonFiniteInBase(NaN, "hex")?.errorCode).toBe("BASE_NOT_FINITE");
	});
});

describe("valueInBase", () => {
	test("ordinary: a number, a bigint and an exact integer past 2^53 keep their digits", () => {
		expect(valueInBase(numberValue(255), "hex").value).toBe(255);
		expect(valueInBase(bigIntValue(1n << 100n), "bin").value).toBe(1n << 100n);
		expect(valueInBase(numberValueRational(2 ** 60, rational((1n << 60n) + 1n)), "hex").value).toBe((1n << 60n) + 1n);
	});

	test("boundary: a value already in a base and each base's tag", () => {
		expect(valueInBase(hexValue(15), "oct").unit).toBe("oct");
		expect(valueInBase(hexValue(15, "bin"), "hex").unit).toBeUndefined();
		expect(valueInBase(numberValue(2), "bin").type).toBe(ValueType.Hex);
	});

	test("hostile: an infinity, NaN and text", () => {
		expect(valueInBase(numberValue(Infinity), "hex").errorCode).toBe("BASE_NOT_FINITE");
		expect(valueInBase(numberValue(NaN), "bin").errorCode).toBe("BASE_NOT_FINITE");
		// Text reads as its number (0 here); the builtins refuse text before this.
		expect(valueInBase(stringValue("constructor"), "hex").type).toBe(ValueType.Hex);
	});
});

describe("adversarial", () => {
	test("security: prototype words holding an infinity, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = expectHonestDocument(`${word} = 1/0\n${word} in hex`);
				expect(batch[1]).toBe(`ERROR ${INFINITE}`);
				expect(incremental).toEqual(batch);
			}
		});
	});

	test("security: a huge power and a long chain are refused or answered in time", () => {
		expectHonestLine(`${RESOURCE_PROBES.hugePower()} in hex`);
		expectHonestLine(`(1/0)${" in binary in octal as hex".repeat(60)}`);
		expect(expectHonestLine("2n^100000 in hex")).toMatchObject({ code: "BIGINT_POW_LIMIT_EXCEEDED" });
	});

	test("realistic: an infinity from the line above, a check and a what-if over it, both passes agreeing", () => {
		const text = "rate = 0\nratio = 1 / rate\nratio in hex\nline 3 with rate = 16";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch[2]).toBe(`ERROR ${INFINITE}`);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge through each base is honest", () => {
		for (const form of ["X in hex", "X in binary", "X in octal", "hex(X)", "X as hex"]) {
			for (const line of fill(form, NUMERIC_EDGES)) {
				const outcome = expectHonestLine(line, { allowNaN: true });
				if (outcome.kind === "value") expect(outcome.text).not.toMatch(/Infinity|NaN/);
			}
		}
		expect(shown("(-1/0) in hex")).toMatch(/^BASE_NOT_FINITE: /);
		expect(shown("(2^1023 * 1.9) in hex")).toMatch(/^0xF3+0+$/);
	});
});
