import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, boolValue, numberValue, numberValueExact, numberValueRational, stringValue, uomValue } from "@solve-js/vm/Value";
import { rational, type Rational } from "@solve-js/symbolic";
import { roundExactDecimalToWhole, roundExactRationalToWhole, roundExactToWhole, type WholeRounding } from "@solve-js/vm/ExactDecimals";
import { truncateToWhole } from "@solve-js/packages/ip/IpPluginFunctions";

/**
 * Found bug: `floor(2^60 + 0.5)`, `int(2^60 + 0.5)` and `(2^60 + 0.5) as int`
 * answered 1,152,921,504,606,847,000 where the number is
 * 1,152,921,504,606,846,976.5. `2^60 + 0.5` is not a decimal anyone typed but
 * a sum, so it carries an exact fraction (2^61 + 1 halves, a `rational`
 * sidecar) rather than an exact decimal, and the rounding functions read an
 * exact integer or an exact decimal and otherwise fell back to the double,
 * which past 2^53 holds no fraction and was written in its sixteen digits.
 *
 * `floor`, `ceil`, `round`, `int`, `trunc` and `as int` now share one chain,
 * `roundExactToWhole`: an exact integer is handed back as it is, then an exact
 * fraction is divided out in whole numbers (`roundExactRationalToWhole`), then
 * an exact decimal is rounded in base ten (`roundExactDecimalToWhole`), and
 * only a value with none of these reads its double.
 */

function shown(line: string, engine = newTrackedEngine()): string {
	try {
		const v = engine.evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const text = (v: Value | null): string => (v === null ? "null" : formatValue(v).replace(/^=\s*/, ""));
const TWO_60 = 1152921504606846976n;
/** 2^60 + 0.5, as the engine builds it. */
const sixtyAndAHalf = (): Value => numberValueRational(Number(TWO_60), rational(2n * TWO_60 + 1n, 2n));
const fraction = (r: Rational): Value => numberValueRational(Number(r.n) / Number(r.d), r);

describe("the lines that exposed it", () => {
	test.each([
		["floor(2^60 + 0.5)", "1,152,921,504,606,846,976"],
		["int(2^60 + 0.5)", "1,152,921,504,606,846,976"],
		["(2^60 + 0.5) as int", "1,152,921,504,606,846,976"],
		["trunc(2^60 + 0.5)", "1,152,921,504,606,846,976"],
		["ceil(2^60 + 0.5)", "1,152,921,504,606,846,977"],
		["round(2^60 + 0.5)", "1,152,921,504,606,846,977"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test.each([
		["floor(-(2^60 + 0.5))", "-1,152,921,504,606,846,977"],
		["ceil(-(2^60 + 0.5))", "-1,152,921,504,606,846,976"],
		["round(-(2^60 + 0.5))", "-1,152,921,504,606,846,977"],
		["int(-(2^60 + 0.5))", "-1,152,921,504,606,846,976"],
		["trunc(-(2^60 + 0.5))", "-1,152,921,504,606,846,976"],
		["-(2^60 + 0.5) as int", "-1,152,921,504,606,846,976"],
	])("a negative rounds the right way: %s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("round takes a half away from zero and anything else to the nearer whole number", () => {
		expect(shown("round(2^60 + 1/3)")).toBe("1,152,921,504,606,846,976");
		expect(shown("round(2^60 + 2/3)")).toBe("1,152,921,504,606,846,977");
		expect(shown("round(-(2^60 + 1/3))")).toBe("-1,152,921,504,606,846,976");
		expect(shown("round(-(2^60 + 2/3))")).toBe("-1,152,921,504,606,846,977");
		expect(shown("round(5/2)")).toBe("3");
		expect(shown("round(-5/2)")).toBe("-3");
		expect(shown("round(2.5)")).toBe("3");
		expect(shown("round(-2.5)")).toBe("-3");
	});

	test("the answer is the exact whole number, so arithmetic on it stays exact", () => {
		expect(shown("floor(2^60 + 0.5) - 2^60")).toBe("0");
		expect(shown("ceil(2^60 + 0.5) - 2^60")).toBe("1");
		expect(shown("floor(2^60 + 0.5) == 2^60")).toBe("true");
		expect(shown("(2^60 + 0.5) as int")).toBe(shown("int(2^60 + 0.5)"));
		expect(shown("round(2^60 + 0.5)")).toBe(shown("round(2^60 + 0.5, 0)"));
	});

	test("ordinary small numbers are unchanged", () => {
		expect(shown("floor(3.7)")).toBe("3");
		expect(shown("ceil(3.2)")).toBe("4");
		expect(shown("round(3.5)")).toBe("4");
		expect(shown("int(-3.7)")).toBe("-3");
		expect(shown("floor(7/2)")).toBe("3");
		expect(shown("floor(-7/2)")).toBe("-4");
		expect(shown("ceil(-1/3)")).toBe("0");
		expect(shown("floor(1/3)")).toBe("0");
		expect(shown("3.7 as int")).toBe("3");
		expect(shown("floor(2^53 + 1)")).toBe("9,007,199,254,740,993");
		expect(shown("floor(9007199254740993.5)")).toBe("9,007,199,254,740,993");
	});

	test("the boundary: a value with no exact reading still reads its double", () => {
		expect(shown("floor(sqrt(2^106) + 0.5)")).toBe("9,007,199,254,740,992");
		expect(shown("floor((2^60 + 0.5) m)")).toBe(shown("(2^60) m"));
		expect(shown("floor(1e20 + 0.5)")).toBe(shown("1e20"));
	});
});

describe("roundExactRationalToWhole", () => {
	const modes: readonly WholeRounding[] = ["floor", "ceil", "trunc", "round"];

	test("ordinary: each rounding of 2^60 + 0.5 and of 7/2", () => {
		expect(text(roundExactRationalToWhole(sixtyAndAHalf(), "floor"))).toBe("1,152,921,504,606,846,976");
		expect(text(roundExactRationalToWhole(sixtyAndAHalf(), "ceil"))).toBe("1,152,921,504,606,846,977");
		expect(text(roundExactRationalToWhole(sixtyAndAHalf(), "trunc"))).toBe("1,152,921,504,606,846,976");
		expect(text(roundExactRationalToWhole(sixtyAndAHalf(), "round"))).toBe("1,152,921,504,606,846,977");
		expect(roundExactRationalToWhole(fraction(rational(7n, 2n)), "floor")?.value).toBe(3);
		expect(roundExactRationalToWhole(fraction(rational(-7n, 2n)), "floor")?.value).toBe(-4);
		expect(roundExactRationalToWhole(fraction(rational(-7n, 2n)), "ceil")?.value).toBe(-3);
		expect(roundExactRationalToWhole(fraction(rational(-7n, 2n)), "round")?.value).toBe(-4);
		expect(roundExactRationalToWhole(fraction(rational(7n, 3n)), "round")?.value).toBe(2);
	});

	test("boundary: zero results keep the sign of a negative value, and 2^53 ± a half", () => {
		expect(Object.is(roundExactRationalToWhole(fraction(rational(-1n, 3n)), "ceil")?.value, -0)).toBe(true);
		expect(Object.is(roundExactRationalToWhole(fraction(rational(-1n, 3n)), "trunc")?.value, -0)).toBe(true);
		expect(Object.is(roundExactRationalToWhole(fraction(rational(1n, 3n)), "floor")?.value, 0)).toBe(true);
		const below = fraction(rational(2n * 9007199254740991n + 1n, 2n));
		expect(roundExactRationalToWhole(below, "floor")?.value).toBe(9007199254740991);
		expect(text(roundExactRationalToWhole(below, "ceil"))).toBe("9,007,199,254,740,992");
		const above = fraction(rational(2n * 9007199254740993n + 1n, 2n));
		expect(text(roundExactRationalToWhole(above, "floor"))).toBe("9,007,199,254,740,993");
		expect(text(roundExactRationalToWhole(above, "round"))).toBe("9,007,199,254,740,994");
		// A 34-digit numerator over a small denominator.
		const long = fraction(rational(1234567890123456789012345678901234n, 7n));
		expect(roundExactRationalToWhole(long, "trunc")?.rational?.n).toBe(1234567890123456789012345678901234n / 7n);
		expect(text(roundExactRationalToWhole(long, "trunc"))).toBe("176,366,841,446,208,112,716,049,382,700,176");
		expect(text(roundExactRationalToWhole(long, "ceil"))).toBe("176,366,841,446,208,112,716,049,382,700,177");
	});

	test("hostile: no sidecar, a whole fraction, a broken denominator and other types are null, never thrown on", () => {
		for (const mode of modes) {
			expect(roundExactRationalToWhole(numberValue(3.7), mode)).toBeNull();
			expect(roundExactRationalToWhole(numberValue(Number.NaN), mode)).toBeNull();
			expect(roundExactRationalToWhole(numberValue(Number.MAX_VALUE), mode)).toBeNull();
			expect(roundExactRationalToWhole(numberValueRational(5, rational(5n)), mode)).toBeNull();
			expect(roundExactRationalToWhole(numberValueRational(1, { n: 1n, d: 0n }), mode)).toBeNull();
			expect(roundExactRationalToWhole(numberValueRational(-1, { n: 1n, d: -1n }), mode)).toBeNull();
			expect(roundExactRationalToWhole(stringValue("7/2"), mode)).toBeNull();
			expect(roundExactRationalToWhole(boolValue(true), mode)).toBeNull();
			expect(roundExactRationalToWhole(uomValue(3.5, "m"), mode)).toBeNull();
		}
	});
});

describe("roundExactDecimalToWhole", () => {
	test("ordinary and boundary: unchanged by the refactor onto the shared division", () => {
		const half = numberValueExact(9007199254740994, { coef: 90071992547409935n, scale: 1 });
		expect(text(roundExactDecimalToWhole(half, "floor"))).toBe("9,007,199,254,740,993");
		expect(text(roundExactDecimalToWhole(half, "ceil"))).toBe("9,007,199,254,740,994");
		expect(text(roundExactDecimalToWhole(half, "round"))).toBe("9,007,199,254,740,994");
		expect(roundExactDecimalToWhole(numberValueExact(-2.5, { coef: -25n, scale: 1 }), "round")?.value).toBe(-3);
		expect(roundExactDecimalToWhole(numberValueExact(2.5, { coef: 25n, scale: 1 }), "round")?.value).toBe(3);
		expect(roundExactDecimalToWhole(numberValueExact(3, { coef: 3n, scale: 0 }), "floor")?.value).toBe(3);
		expect(Object.is(roundExactDecimalToWhole(numberValueExact(-0.5, { coef: -5n, scale: 1 }), "ceil")?.value, -0)).toBe(true);
		const digits = numberValueExact(1.2345678901234568e33, { coef: 12345678901234567890123456789012345n, scale: 1 });
		expect(text(roundExactDecimalToWhole(digits, "trunc"))).toBe("1,234,567,890,123,456,789,012,345,678,901,234");
	});

	test("hostile: no sidecar and other types are null", () => {
		expect(roundExactDecimalToWhole(numberValue(2.5), "round")).toBeNull();
		expect(roundExactDecimalToWhole(stringValue("2.5"), "round")).toBeNull();
		expect(roundExactDecimalToWhole(numberValue(Number.NaN), "floor")).toBeNull();
	});
});

describe("roundExactToWhole", () => {
	test("ordinary: an exact integer comes back as it is, then the fraction, then the decimal", () => {
		const whole = numberValueRational(9007199254740992, rational(9007199254740993n));
		expect(roundExactToWhole(whole, "floor")).toBe(whole);
		expect(text(roundExactToWhole(sixtyAndAHalf(), "floor"))).toBe("1,152,921,504,606,846,976");
		const decimal = numberValueExact(9007199254740994, { coef: 90071992547409935n, scale: 1 });
		expect(text(roundExactToWhole(decimal, "trunc"))).toBe("9,007,199,254,740,993");
	});

	test("the fraction is read before the decimal when a value carries both", () => {
		const both = numberValueRational(3.5, rational(7n, 2n));
		both.exact = { coef: 99n, scale: 1 };
		expect(roundExactToWhole(both, "floor")?.value).toBe(3);
	});

	test("boundary: a plain double, zero, negative zero, 2^53 ± 1 and the largest double are null, so the caller keeps its path", () => {
		for (const n of [0, -0, 3.7, -3.7, 2 ** 53 - 1, 2 ** 53 + 2, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE]) {
			expect(roundExactToWhole(numberValue(n), "round")).toBeNull();
		}
	});

	test("hostile: NaN, the infinities, text, a boolean and a quantity are null, never thrown on", () => {
		for (const v of [numberValue(Number.NaN), numberValue(Number.POSITIVE_INFINITY), numberValue(Number.NEGATIVE_INFINITY), stringValue("2.5"), boolValue(false), uomValue(2.5, "m")]) {
			expect(roundExactToWhole(v, "floor")).toBeNull();
		}
	});

	test("truncateToWhole (as int) takes the same chain", () => {
		expect(text(truncateToWhole(sixtyAndAHalf()))).toBe("1,152,921,504,606,846,976");
		expect(text(truncateToWhole(fraction(rational(-(2n * TWO_60 + 1n), 2n))))).toBe("-1,152,921,504,606,846,976");
		expect(truncateToWhole(numberValue(3.7)).value).toBe(3);
		expect(truncateToWhole(numberValue(Number.NaN)).value).toBeNaN();
	});
});

describe("adversarial", () => {
	test("security: prototype words, deep brackets, a long sum, a huge power and look-alike digits", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`floor(${word} + 0.5)`);
				expectHonestDocument(`${word} = 2^60 + 0.5\nfloor(${word})\n${word} as int`);
			}
		});
		expectHonestLine(`floor(${RESOURCE_PROBES.deepParens(200)} + 2^60 + 1/3)`, { budgetMs: 5_000 });
		expectHonestLine(`round((${RESOURCE_PROBES.longSum(300)}) + 2^60 + 1/2)`, { budgetMs: 5_000 });
		expectHonestLine(`floor(${RESOURCE_PROBES.hugePower()} + 1/2)`, { budgetMs: 5_000 });
		expectHonestLine("floor(2^3000 + 1/3)", { budgetMs: 5_000 });
		for (const line of fill("floor(2^60 + 0.5) X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("ceil(X)", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("floor(２^６０ + 0.5)");
	});

	test("realistic: a value from the line above, a check, a what-if and both document passes", () => {
		const { batch, incremental } = expectHonestDocument("n = 2^60 + 0.5\nfloor(n)\nn as int\ncheck floor(n) == 2^60\nline 2 with n = -2.5");
		expect(batch.slice(0, 4)).toEqual(["= 1,152,921,504,606,846,976.50", "= 1,152,921,504,606,846,976", "= 1,152,921,504,606,846,976", "= ✓"]);
		expect(batch[4]).toBe("= -3");
		expect(incremental).toEqual(batch);
		expect(shown("flor(2^60 + 0.5)")).not.toBe("1,152,921,504,606,847,000");
		expect(shown("floor(2^60 + 0.5) * $1")).toBe("$1,152,921,504,606,846,976.00");
	});

	test("edge: every numeric edge, plus a third and a half, through each rounding", () => {
		for (const fn of ["floor", "ceil", "round", "int", "trunc"]) {
			for (const line of fill(`${fn}(X)`, NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
			for (const line of fill(`${fn}((X) + 1/3)`, NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
			for (const line of fill(`${fn}(-(X) - 1/2)`, NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		}
		expect(shown("floor(-0)")).toBe("0");
		expect(shown("round(2^53 + 1/2)")).toBe("9,007,199,254,740,993");
		expect(shown("round(2^53 - 1/2)")).toBe("9,007,199,254,740,992");
	});
});
