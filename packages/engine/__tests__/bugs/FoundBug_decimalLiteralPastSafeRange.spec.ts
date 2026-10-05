import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { exactDigitsWhereDoubleCannot, formatValue } from "@solve-js/format/FormatEngine";
import { decimalFromLiteral } from "@solve-js/decimal";
import { rational } from "@solve-js/symbolic";
import { numberValue, numberValueExact } from "@solve-js/vm/Value";
import { compareRationalOperands, exactRationalOp } from "@solve-js/vm/VMConversion";
import { exactWholeLiteral } from "@solve-js/vm/ExactIntegers";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";

/**
 * Found bug: the typed literal `9007199254740993.5` answered
 * `9,007,199,254,740,994`, a confident wrong number. Past 2^53 a double holds no
 * fraction at all, so the literal's nearest double is the whole number above it.
 * The literal already kept its exact decimal beside the double (PUSH_DECIMAL),
 * and exact arithmetic on it kept that too, but the formatter printed the
 * double, and the exact-fraction reading of an operand looked at the whole
 * double before the exact decimal, so the literal also compared equal to
 * `9007199254740994`.
 *
 * The formatter now writes a number from its exact decimal, or its exact
 * fraction, wherever the double's spacing could reach half of the last place
 * shown (`exactDigitsWhereDoubleCannot`), and an operand's exact reading takes
 * its exact decimal before its double.
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
		["9007199254740993.5", "9,007,199,254,740,993.50"],
		["-9007199254740993.5", "-9,007,199,254,740,993.50"],
		["9,007,199,254,740,993.5", "9,007,199,254,740,993.50"],
		["9007199254740993.25", "9,007,199,254,740,993.25"],
		["9007199254740993.125", "9,007,199,254,740,993.13"],
		["9007199254740993.0", "9,007,199,254,740,993"],
		["12345678901234567890.25", "12,345,678,901,234,567,890.25"],
		["9007199254740993.5 + 1", "9,007,199,254,740,994.50"],
		["9007199254740993.5 - 0.5", "9,007,199,254,740,993"],
		["9007199254740993.5 * 2", "18,014,398,509,481,987"],
		["9007199254740993.5 / 2", "4,503,599,627,370,496.75"],
		["9007199254740993.5 + 9007199254740993", "18,014,398,509,481,986.50"],
		["1/3 + 9007199254740993.5", "9,007,199,254,740,993.83"],
		["2^60 + 0.5", "1,152,921,504,606,846,976.50"],
		["9007199254740993.5 to 3 dp", "9,007,199,254,740,993.500"],
		["$9007199254740993.5", "$9,007,199,254,740,993.50"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("comparisons read the exact digits, not the whole double", () => {
		expect(shown("9007199254740993.5 == 9007199254740994")).toBe("false");
		expect(shown("9007199254740993.5 == 9007199254740993.5")).toBe("true");
		expect(shown("9007199254740993.5 > 9007199254740993")).toBe("true");
		expect(shown("9007199254740993.5 < 9007199254740994")).toBe("true");
		expect(shown("check 9007199254740993.5 != 9007199254740994")).toBe("✓");
	});

	test("within the range a double holds, nothing changes", () => {
		expect(shown("0.1 + 0.2")).toBe("0.30");
		expect(shown("1234.5")).toBe("1,234.50");
		expect(shown("1.005")).toBe("1.01");
		expect(shown("1/3")).toBe("0.33");
		expect(shown("9007199254740993")).toBe("9,007,199,254,740,993");
	});

	test("the boundary: a unit, and a result with no exact reading, keep their double", () => {
		expect(shown("9007199254740993.5 m")).toBe("9,007,199,254,740,994.00 m");
		expect(shown("sqrt(2^106) + 0.5")).toBe("9,007,199,254,740,992");
		expect(shown("1e16 + 0.5")).toBe("10,000,000,000,000,000");
	});

	test("a literal written under a locale that writes the decimal with a comma and groups with dots", () => {
		const de = new ExpressionEngine({ locale: "de", packages: BUILTIN_PACKAGES });
		try {
			// The engine reads the German literal; the display follows the
			// formatting locale, which is English here.
			expect(shown("9.007.199.254.740.993,5", de)).toBe("9,007,199,254,740,993.50");
		} finally {
			de.clear();
		}
	});
});

describe("exactDigitsWhereDoubleCannot", () => {
	const lit = (text: string) => decimalFromLiteral(text);

	test("ordinary: past the magnitude a double holds, the exact digits at the places asked", () => {
		expect(exactDigitsWhereDoubleCannot(9007199254740994, { exact: lit("9007199254740993.5") }, 2)).toBe("9007199254740993.50");
		expect(exactDigitsWhereDoubleCannot(-9007199254740994, { exact: lit("-9007199254740993.5") }, 2)).toBe("-9007199254740993.50");
		expect(exactDigitsWhereDoubleCannot(9007199254740994, { exact: lit("9007199254740993.5") }, 0)).toBe("9007199254740994");
		expect(exactDigitsWhereDoubleCannot(4503599627370497, { rational: rational(18014398509481987n, 4n) }, 2)).toBe("4503599627370496.75");
	});

	test("a whole value shows no places, whatever the budget", () => {
		expect(exactDigitsWhereDoubleCannot(9007199254740992, { exact: lit("9007199254740993.000") }, 2)).toBe("9007199254740993");
		expect(exactDigitsWhereDoubleCannot(9007199254740992, { rational: rational(9007199254740993n) }, 2)).toBe("9007199254740993");
	});

	test("boundary: below the magnitude where the places are at risk, undefined", () => {
		expect(exactDigitsWhereDoubleCannot(1234.5, { exact: lit("1234.5") }, 2)).toBeUndefined();
		expect(exactDigitsWhereDoubleCannot(0.30000000000000004, { exact: lit("0.3") }, 2)).toBeUndefined();
		expect(exactDigitsWhereDoubleCannot(0, { exact: lit("0") }, 2)).toBeUndefined();
		expect(exactDigitsWhereDoubleCannot(-0, { exact: lit("-0.0") }, 2)).toBeUndefined();
		// A double's spacing reaches half a hundredth near 2.25e13.
		expect(exactDigitsWhereDoubleCannot(2e13, { exact: lit("20000000000000.01") }, 2)).toBeUndefined();
		expect(exactDigitsWhereDoubleCannot(3e13, { exact: lit("30000000000000.01") }, 2)).toBe("30000000000000.01");
		// A whole value is safe to 2^51, where the spacing reaches a half.
		expect(exactDigitsWhereDoubleCannot(2 ** 50, { exact: lit("1125899906842624") }, 2)).toBeUndefined();
		expect(exactDigitsWhereDoubleCannot(2 ** 51, { exact: lit("2251799813685248") }, 2)).toBe("2251799813685248");
	});

	test("hostile: no exact value, a value that is not finite, and a place count out of range", () => {
		expect(exactDigitsWhereDoubleCannot(9007199254740994, {}, 2)).toBeUndefined();
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			expect(exactDigitsWhereDoubleCannot(value, { exact: lit("1") }, 2)).toBeUndefined();
		}
		for (const places of [-1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(exactDigitsWhereDoubleCannot(9007199254740994, { exact: lit("9007199254740993.5") }, places)).toBeUndefined();
		}
		expect(exactDigitsWhereDoubleCannot(1e300, { exact: lit("1" + "0".repeat(300) + ".5") }, 100)?.length).toBe(402);
	});

	test("the decimal is read before the fraction", () => {
		expect(exactDigitsWhereDoubleCannot(9007199254740994, { exact: lit("9007199254740993.5"), rational: rational(1n, 3n) }, 2)).toBe("9007199254740993.50");
	});
});

describe("an operand's exact reading takes its decimal before its double", () => {
	const literal = numberValueExact(9007199254740994, decimalFromLiteral("9007199254740993.5"));

	test("compareRationalOperands", () => {
		expect(compareRationalOperands(literal, exactWholeLiteral("9007199254740994")!)).toBe(-1);
		expect(compareRationalOperands(literal, exactWholeLiteral("9007199254740993")!)).toBe(1);
		expect(compareRationalOperands(literal, literal)).toBe(0);
		// A plain whole double with no sidecar still reads as its integer.
		expect(compareRationalOperands(numberValue(5), numberValueExact(5, decimalFromLiteral("5.0")))).toBe(0);
	});

	test("exactRationalOp", () => {
		const sum = exactRationalOp(literal, exactWholeLiteral("1")!, "add");
		expect(sum?.rational).toEqual(rational(18014398509481989n, 2n));
		expect(exactRationalOp(numberValue(Number.NaN), exactWholeLiteral("1")!, "add")).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: a decimal literal as long as a line allows, a long sum of them, and a literal past any double", () => {
		expectHonestLine("9".repeat(300) + ".5", { budgetMs: 2_000 });
		expectHonestLine("9".repeat(400) + ".5", { budgetMs: 2_000 });
		expectHonestLine(RESOURCE_PROBES.longSum(1_000).replace(/\d+/g, "9007199254740993.5"), { budgetMs: 5_000 });
	});

	test("security: look-alike digits, zero-width characters, markup and prototype words around the literal", () => {
		for (const line of ["９００７１９９２５４７４０９９３.５", "9007199254740993​.5", "‮9007199254740993.5"]) expectHonestLine(line);
		for (const line of fill("9007199254740993.5 X", TEXT_EDGES)) expectHonestLine(line);
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectHonestLine(`9007199254740993.5 + ${word}`);
		});
	});

	test("realistic: the literal from the line above, a check of it and a total, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("a = 9007199254740993.5\na + 1\ncheck a > 9007199254740993\ntotal above");
		expect(batch.slice(0, 3)).toEqual(["= 9,007,199,254,740,993.50", "= 9,007,199,254,740,994.50", "= ✓"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge beside the literal", () => {
		for (const line of fill("9007199254740993.5 + X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("X * 9007199254740993.5", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("X / 9007199254740993.5", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
