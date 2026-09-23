/**
 * Whole-number results past 2^53 are exact (#526).
 *
 * A double holds every whole number up to 9,007,199,254,740,991 and only some
 * beyond it, so an integer result past that line used to be the nearest double:
 * `3^40` printed invented trailing digits, `2^53 + 1` answered 2^53, and
 * `7^77 mod 13` took its remainder from the wrong number. Such a result now
 * carries its exact integer as the value's rational sidecar (vm/ExactIntegers.ts),
 * and stays a Number.
 *
 * Every expected value here was computed separately with BigInt arithmetic in
 * plain JavaScript. The exact integer is asserted directly wherever it matters,
 * because `toNumber()` returns the nearest double whether or not the digits
 * survived and so cannot tell a fix from the bug.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";

function evaluate(source: string): Value {
	return newTrackedEngine().evaluateExpression(source);
}

/** The exact integer a result carries, or undefined when it is a plain double. */
function exactInteger(source: string): bigint | undefined {
	const value = evaluate(source);
	return value.rational !== undefined && value.rational.d === 1n ? value.rational.n : undefined;
}

const shown = (source: string) => formatValue(evaluate(source));

describe("the reported answers", () => {
	test("3^40 shows every digit", () => {
		expect(shown("3^40")).toBe("= 12,157,665,459,056,928,801");
		expect(exactInteger("3^40")).toBe(12157665459056928801n);
	});

	test("7^77 mod 13 is 11", () => {
		// The double 7^77 has the wrong low digits, and its remainder was 2.
		expect(evaluate("7^77 mod 13").toNumber()).toBe(11);
		expect(evaluate("3^40 mod 7").toNumber()).toBe(4);
	});

	test("2^53 + 1 is one more than 2^53", () => {
		expect(shown("2^53 + 1")).toBe("= 9,007,199,254,740,993");
		expect(evaluate("2^53 + 1 - 2^53").toNumber()).toBe(1);
		expect(evaluate("2^53 + 1 == 2^53").value).toBe(false);
		expect(evaluate("2^53 + 1 > 2^53").value).toBe(true);
	});

	test("fact(25) is exact", () => {
		expect(shown("fact(25)")).toBe("= 15,511,210,043,330,985,984,000,000");
	});

	test("2^64 no longer prints a double's zeros", () => {
		expect(shown("2^64")).toBe("= 18,446,744,073,709,551,616");
	});
});

describe("every integer operator keeps the digits", () => {
	test("add, subtract and multiply", () => {
		expect(exactInteger("2^60 + 3^30")).toBe(1153127395738941625n);
		expect(exactInteger("2^60 - 1")).toBe(1152921504606846975n);
		expect(exactInteger("2^40 * 3^20")).toBe(3833759992447475122176n);
		expect(exactInteger("-(2^63)")).toBe(-9223372036854775808n);
	});

	test("a power of a negative base keeps its sign", () => {
		expect(exactInteger("(-3)^41")).toBe(-36472996377170786403n);
	});

	test("an exact integer raised again stays exact", () => {
		expect(exactInteger("(2^53 + 1)^2")).toBe(81129638414606699710187514626049n);
	});

	test("the remainder reads the exact integer", () => {
		expect(evaluate("(2^53 + 1) mod 2").toNumber()).toBe(1);
		expect(evaluate("(2^53 + 1) mod 1e20").toNumber()).toBe(9007199254740992);
		expect(exactInteger("(2^53 + 1) mod 1e20")).toBe(9007199254740993n);
	});

	test("division still produces the exact fraction it always did", () => {
		expect(evaluate("2^60 / 3 as fraction").value).toBe("1152921504606846976/3");
		expect(evaluate("(2^53 + 2) / 2").toNumber()).toBe(4503599627370497);
		expect(evaluate("2^60 / 2^61").toNumber()).toBe(0.5);
	});
});

describe("where exactness stops, and why", () => {
	test("a number typed past the safe range stays the double it became", () => {
		// Its digits were rounded before the engine saw them, so exact
		// arithmetic on it would print invented digits as though they were real.
		expect(exactInteger("12345678901234567890 + 1")).toBeUndefined();
		expect(evaluate("1e16 + 1 - 1e16").toNumber()).toBe(0);
		expect(evaluate("10^16 + 1 - 10^16").toNumber()).toBe(1);
	});

	test("a fractional operand keeps the double path", () => {
		expect(exactInteger("2^60 + 0.5")).toBeUndefined();
		expect(exactInteger("2^60 * 0.5")).toBeUndefined();
		expect(exactInteger("2^-60")).toBeUndefined();
	});

	test("past a double's range the answer is still Infinity", () => {
		expect(exactInteger("2^1023")).toBe(1n << 1023n);
		expect(evaluate("2^1024").toNumber()).toBe(Infinity);
		expect(exactInteger("2^1024")).toBeUndefined();
		// The same line when two exact values multiply past it.
		expect(evaluate("2^1000 * 2^30").toNumber()).toBe(Infinity);
		expect(exactInteger("2^1000 * 2^30")).toBeUndefined();
		expect(evaluate("2^100000").toNumber()).toBe(Infinity);
	});

	test("a measurement with an uncertainty carries no exact value", () => {
		expect(evaluate("(10^10 +/- 1)^2").rational).toBeUndefined();
	});

	test("within the safe range nothing changes at all", () => {
		expect(exactInteger("2 + 3")).toBeUndefined();
		expect(exactInteger("2^52 + 1")).toBeUndefined();
		expect(evaluate("0.1 + 0.2").toNumber()).toBe(0.30000000000000004);
		// An exact value that comes back inside the range keeps its sidecar,
		// as a fraction does, and reads exactly as the double would.
		expect(shown("2^53 - 1")).toBe("= 9,007,199,254,740,991");
	});

	test("the result is still a Number, not a bigint", () => {
		expect(evaluate("3^40").type).toBe(ValueType.Number);
		expect(evaluate("fact(25)").type).toBe(ValueType.Number);
	});
});

describe("functions that return whole numbers", () => {
	test("factorial is exact from 19! to its 170 cap", () => {
		expect(exactInteger("fact(18)")).toBeUndefined();
		expect(exactInteger("fact(19)")).toBe(121645100408832000n);
		expect(evaluate("fact(171)").type).toBe(ValueType.Error);
	});

	test("permutation and combination", () => {
		expect(exactInteger("permutation(30, 15)")).toBe(202843204931727360000n);
		// The running product rounded past the safe range even though the
		// answer is inside it, so this was 3,167,295,784,216,201.
		expect(evaluate("combination(56, 23)").toNumber()).toBe(3167295784216200);
		expect(exactInteger("combination(100, 50)")).toBe(100891344545564193334812497256n);
	});

	test("lcm and gcd", () => {
		expect(exactInteger("lcm(2^40, 3^20)")).toBe(3833759992447475122176n);
		expect(evaluate("gcd(2^60 + 2, 6)").toNumber()).toBe(6);
		expect(evaluate("lcm(4, 6)").toNumber()).toBe(12);
	});

	test("pow is the same as ^", () => {
		expect(exactInteger("pow(3, 40)")).toBe(12157665459056928801n);
	});

	test("rounding leaves an exact integer where it is", () => {
		for (const fn of ["floor", "ceil", "round", "trunc", "int"]) {
			expect(exactInteger(`${fn}(2^53 + 1)`)).toBe(9007199254740993n);
		}
		expect(exactInteger("abs(-(2^53 + 1))")).toBe(9007199254740993n);
	});
});

describe("what reads the exact integer", () => {
	test("money scales by it", () => {
		expect(shown("(2^60 + 1) * $1")).toBe("= $1,152,921,504,606,846,977.00");
	});

	test("a base conversion writes its digits", () => {
		expect(shown("(2^53 + 1) as hex")).toBe("= 0x20000000000001");
		expect(shown("hex(2^53 + 1)")).toBe("= 0x20000000000001");
		expect(shown("(2^53 + 1) as octal")).toBe("= 0o400000000000000001");
	});

	test("a place count keeps the digits and adds the places", () => {
		expect(shown("3^40 to 2 dp")).toBe("= 12,157,665,459,056,928,801.00");
	});

	test("the display follows the separator and locale settings", () => {
		const s = DEFAULT_FORMATTING_SETTINGS;
		const plain = { ...s, floatResult: { ...s.floatResult, enableSeperator: false } };
		const german = { ...s, numberResult: { ...s.numberResult, decimalSeparatorLocale: "de-DE" } };
		expect(formatValue(evaluate("2^64"), plain)).toBe("= 18446744073709551616");
		expect(formatValue(evaluate("2^64"), german)).toBe("= 18.446.744.073.709.551.616");
	});

	test("a variable carries it from line to line", () => {
		const doc = newTrackedEngine().parseDocument("a = 2^53\nb = a + 1\nb - a\nb mod 2");
		const results = doc.lines.map((line) => (line.result ? formatValue(line.result) : line.error));
		expect(results).toEqual([
			"= 9,007,199,254,740,992",
			"= 9,007,199,254,740,993",
			"= 1",
			"= 1",
		]);
	});
});
