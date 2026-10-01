import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, ValueType, numberValue, numberValueExact, numberValueRational, stringValue, uomValue, boolValue } from "@solve-js/vm/Value";
import { rational } from "@solve-js/symbolic";
import { ipAsInt, truncateToWhole } from "@solve-js/packages/ip/IpPluginFunctions";

/**
 * Found bug: `9007199254740993.5 as int` answered 9,007,199,254,740,994 while
 * `floor(9007199254740993.5)` and `int(9007199254740993.5)` answered
 * 9,007,199,254,740,993. Past 2^53 a double holds no fraction, so the literal's
 * double is 9,007,199,254,740,994; the literal keeps its exact decimal beside
 * it, and the rounding functions read that, but `as int` (the networking
 * package's converter, which also truncates a plain number) truncated the
 * double. `(2^53 + 1) as int` lost its last digit the same way.
 *
 * `as int` of a value that is not an address now goes through
 * `truncateToWhole`, the chain `int` and `trunc` use: an exact integer is
 * handed back as it is, an exact decimal is truncated in base ten towards zero,
 * and anything else truncates its double, as before.
 */

function shown(line: string, engine = newTrackedEngine()): string {
	try {
		const v = engine.evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const text = (v: Value): string => formatValue(v).replace(/^=\s*/, "");

describe("the lines that exposed it", () => {
	test.each([
		["9007199254740993.5 as int", "9,007,199,254,740,993"],
		["-9007199254740993.5 as int", "-9,007,199,254,740,993"],
		["9007199254740992.9 as int", "9,007,199,254,740,992"],
		["(2^53 + 1) as int", "9,007,199,254,740,993"],
		["12345678901234567890.75 as int", "12,345,678,901,234,567,890"],
		["3.7 as int", "3"],
		["-3.7 as int", "-3"],
		["0.999999999999999999 as int", "0"],
		["2.99999999999999999 as int", "2"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("as int agrees with int and trunc, and with floor above zero and ceil below it", () => {
		for (const n of ["9007199254740993.5", "12345678901234567890.75", "2.99999999999999999", "(2^53 + 1)", "4.5"]) {
			expect(shown(`${n} as int`)).toBe(shown(`int(${n})`));
			expect(shown(`${n} as int`)).toBe(shown(`trunc(${n})`));
			expect(shown(`${n} as int`)).toBe(shown(`floor(${n})`));
			expect(shown(`-${n} as int`)).toBe(shown(`ceil(-${n})`));
		}
	});

	test("what was right stays right: addresses, text that reads as a number, a quantity", () => {
		expect(shown("10.0.0.0/8 as int")).toBe("167,772,160");
		expect(shown("fe80::1 as int")).toBe("338288524927261089654018896841347694593");
		expect(shown('"42" as int')).toBe("42");
		expect(shown("3.7 m as int")).toBe("3");
		expect(shown("-0.5 as int")).toBe("0");
	});

	test("the boundary: a value with no exact reading truncates its double, as floor does", () => {
		expect(shown("9007199254740993.5 m as int")).toBe("9,007,199,254,740,994");
		expect(shown("(9007199254740993.5 + 1/3) as int")).toBe(shown("floor(9007199254740993.5 + 1/3)"));
		expect(shown("sqrt(2^106) + 0.5 as int")).toBe("9,007,199,254,740,992");
		// An exact fraction past 2^53 (2^60 + 0.5 is 2^61 + 1 halves) is not an
		// exact decimal, and floor and int read its double too; as int matches them.
		expect(shown("(2^60 + 0.5) as int")).toBe(shown("floor(2^60 + 0.5)"));
		expect(shown("(2^60 + 0.5) as int")).toBe(shown("int(2^60 + 0.5)"));
	});
});

describe("truncateToWhole", () => {
	test("ordinary: an exact decimal, an exact integer, a plain double", () => {
		const exact = truncateToWhole(numberValueExact(9007199254740994, { coef: 90071992547409935n, scale: 1 }));
		expect(text(exact)).toBe("9,007,199,254,740,993");
		const whole = numberValueRational(9007199254740992, rational(9007199254740993n));
		expect(truncateToWhole(whole)).toBe(whole);
		expect(truncateToWhole(numberValue(3.7)).value).toBe(3);
		expect(truncateToWhole(numberValue(-3.7)).value).toBe(-3);
	});

	test("boundary: zero, negative zero, a negative exact decimal and the largest doubles", () => {
		expect(truncateToWhole(numberValue(0)).value).toBe(0);
		expect(Object.is(truncateToWhole(numberValue(-0)).value, -0)).toBe(true);
		const negative = truncateToWhole(numberValueExact(-9007199254740994, { coef: -90071992547409935n, scale: 1 }));
		expect(text(negative)).toBe("-9,007,199,254,740,993");
		expect(Object.is(truncateToWhole(numberValueExact(-0.5, { coef: -5n, scale: 1 })).value, -0)).toBe(true);
		expect(truncateToWhole(numberValue(Number.MAX_VALUE)).value).toBe(Number.MAX_VALUE);
		expect(truncateToWhole(numberValue(Number.MIN_VALUE)).value).toBe(0);
	});

	test("hostile: NaN, the infinities, text, a boolean and a quantity are not thrown on", () => {
		expect(truncateToWhole(numberValue(Number.NaN)).value).toBeNaN();
		expect(truncateToWhole(numberValue(Number.POSITIVE_INFINITY)).value).toBe(Number.POSITIVE_INFINITY);
		expect(truncateToWhole(numberValue(Number.NEGATIVE_INFINITY)).value).toBe(Number.NEGATIVE_INFINITY);
		expect(truncateToWhole(stringValue("42.9")).value).toBe(42);
		expect(() => truncateToWhole(boolValue(true))).not.toThrow();
		expect(truncateToWhole(uomValue(3.7, "m")).type).toBe(ValueType.Number);
	});

	test("ipAsInt hands a value that is not an address to it", () => {
		const exact = numberValueExact(9007199254740994, { coef: 90071992547409935n, scale: 1 });
		expect(text(ipAsInt(exact))).toBe(text(truncateToWhole(exact)));
	});
});

describe("adversarial", () => {
	test("security: prototype words, long literals, deep brackets and look-alike digits", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} as int`);
				expectHonestDocument(`${word} = 9007199254740993.5\n${word} as int`);
			}
		});
		expectHonestLine(`${"9".repeat(300)}.5 as int`, { budgetMs: 5_000 });
		expectHonestLine(`${"9".repeat(40)}.5 as int`);
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} + 0.5 as int`, { budgetMs: 5_000 });
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)}) + 0.5 as int`, { budgetMs: 5_000 });
		for (const line of fill("9007199254740993.5 as int X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("X as int", TEXT_EDGES)) expectHonestLine(line);
		// Digits from another script are not these digits, and the line is still honest.
		expectHonestLine("９００７１９９２５４７４０９９３.５ as int");
	});

	test("realistic: a number from the line above, a check and a what-if through it, both passes", () => {
		const { batch, incremental } = expectHonestDocument("n = 9007199254740993.5\nn as int\ncheck (n as int) == 9007199254740993\nline 2 with n = -2.5");
		expect(batch.slice(0, 3)).toEqual(["= 9,007,199,254,740,993.50", "= 9,007,199,254,740,993", "= ✓"]);
		expect(batch[3]).toBe("= -2");
		expect(incremental).toEqual(batch);
		expect(shown("9007199254740993.5 as integer")).not.toBe("9,007,199,254,740,994");
		expect(shown("(9007199254740993.5 as int) + 1")).toBe("9,007,199,254,740,994");
	});

	test("edge: every numeric edge, plus a half, as an integer", () => {
		for (const line of fill("X as int", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("(X) + 0.5 as int", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("-(X) as int", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("12345678901234567890123456789012345.5 as int")).toBe(shown("int(12345678901234567890123456789012345.5)"));
	});
});
