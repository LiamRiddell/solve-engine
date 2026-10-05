import { describe, expect, test } from "@jest/globals";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, evaluateLine, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, numberValue, numberValueExact, numberValueRational, stringValue, uomValue, uomValueExact, type Value } from "@solve-js/vm/Value";
import { decimalFromLiteral, decimalToString } from "@solve-js/decimal";
import { rational } from "@solve-js/symbolic";
import { exactPastTheDouble, valueInUnit } from "@solve-js/vm/MoneyExact";
import { exactLargeQuantityOp } from "@solve-js/vm/VMConversion";
import { roundExactQuantityToWhole } from "@solve-js/vm/ExactDecimals";

/**
 * Found bug: `ceil((2^60 + 0.5) m)` and `round((2^60 + 0.5) m)` answered
 * 1,152,921,504,606,846,976.00 m, a metre short of ...977, and `(2^60 + 0.5) m`
 * itself was written ...976.00 m. `floor` and `trunc` were right only because
 * the error happened to fall their way. A plain `2^60 + 0.5` keeps its exact
 * value (FoundBug_roundingExactFractionsPastSafeRange), but giving it a unit
 * (`valueInUnit`) kept the exact value for money only, and past 2^53 a double
 * holds no fraction, so the half was gone before any rounding ran.
 *
 * A number past 2^53 now keeps its exact value when it is given any unit
 * (`exactPastTheDouble`), the formatter writes a quantity from that value, the
 * rounding functions already read it (`roundExactQuantityToWhole`), and adding
 * another amount in the same unit or scaling by a plain number keeps it exact
 * (`exactLargeQuantityOp`). Below 2^53 nothing changes. A conversion into
 * another unit, a product of two quantities and `mod` still read the double.
 */

/** A line's answer or its refusal, as the reader sees it. */
function shown(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	return `${o.kind === "crashed" ? "CRASH" : "ERROR"} ${o.message}`;
}

const text = (v: Value): string => formatValue(v).replace(/^=\s*/, "");
const TWO_60 = 1152921504606846976n;
/** 2^60 + 0.5, as the engine builds it: the double 2^60 and the exact fraction. */
const sixtyAndAHalf = (): Value => numberValueRational(Number(TWO_60), rational(2n * TWO_60 + 1n, 2n));

describe("the lines that exposed it", () => {
	test.each([
		["(2^60+0.5) m", "1,152,921,504,606,846,976.50 m"],
		["floor((2^60+0.5) m)", "1,152,921,504,606,846,976.00 m"],
		["ceil((2^60+0.5) m)", "1,152,921,504,606,846,977.00 m"],
		["round((2^60+0.5) m)", "1,152,921,504,606,846,977.00 m"],
		["trunc((2^60+0.5) m)", "1,152,921,504,606,846,976.00 m"],
		["int((2^60+0.5) m)", "1,152,921,504,606,846,976.00 m"],
		["floor(-(2^60+0.5) m)", "-1,152,921,504,606,846,977.00 m"],
		["ceil(-(2^60+0.5) m)", "-1,152,921,504,606,846,976.00 m"],
		["2^60 m", "1,152,921,504,606,846,976.00 m"],
		["(2^60+1) m", "1,152,921,504,606,846,977.00 m"],
		["9007199254740993 m", "9,007,199,254,740,993.00 m"],
		["9007199254740993.5 kg", "9,007,199,254,740,993.50 kg"],
		["ceil(9007199254740993.5 kg)", "9,007,199,254,740,994.00 kg"],
		["9007199254740993.5 m as int", "9,007,199,254,740,993"],
		["(2^60+0.5) days", "1,152,921,504,606,846,976.50 days"],
		["ceil((2^60+0.5) days)", "1,152,921,504,606,846,977 days"],
		["(2^60+0.5) m to 4 dp", "1,152,921,504,606,846,976.5000 m"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("arithmetic that keeps the unit keeps the exact value", () => {
		expect(shown("(2^60+0.5) m + 1 m")).toBe("1,152,921,504,606,846,977.50 m");
		expect(shown("(2^60+0.5) m - 2^60 m")).toBe("0.50 m");
		expect(shown("(2^60+0.5) m * 2")).toBe("2,305,843,009,213,693,953.00 m");
		expect(shown("2 * (2^60+0.5) m")).toBe("2,305,843,009,213,693,953.00 m");
		expect(shown("(2^60+0.5) m / 2")).toBe("576,460,752,303,423,488.25 m");
	});

	test("what was right stays right: small quantities, money, plain numbers", () => {
		expect(shown("round(2.5 m)")).toBe("3.00 m");
		expect(shown("ceil(3.2 m)")).toBe("4.00 m");
		expect(shown("1 m + 2 m")).toBe("3.00 m");
		expect(shown("0.1 m + 0.2 m")).toBe("0.30 m");
		expect(shown("floor($9007199254740993.5)")).toBe("$9,007,199,254,740,993.00");
		expect(shown("ceil(2^60 + 0.5)")).toBe("1,152,921,504,606,846,977");
		expect(shown("3 days")).toBe("3 days");
	});

	test("the boundary: a conversion, a product of quantities, mod and a fraction that never ends read the double", () => {
		expect(shown("(2^60+0.5) m in km")).toBe("1,152,921,504,606,847.00 km");
		expect(shown("(2^60+0.5) m * 1 m")).toBe("1,152,921,504,606,846,976.00 m²");
		expect(shown("(2^60+0.5) m mod 2")).toBe("0.00 m");
		expect(shown("(2^60+1/3) m")).toBe("1,152,921,504,606,846,976.00 m");
		expect(shown("sqrt(2^106) m")).toBe("9,007,199,254,740,992.00 m");
	});

	test("the three entry points agree, and a value from the line above keeps it", () => {
		const { batch, incremental } = expectHonestDocument("x = (2^60+0.5) m\nceil(x)\nround(x)\nx + 1 m\nfloor(x)");
		expect(batch).toEqual([
			"= 1,152,921,504,606,846,976.50 m",
			"= 1,152,921,504,606,846,977.00 m",
			"= 1,152,921,504,606,846,977.00 m",
			"= 1,152,921,504,606,846,977.50 m",
			"= 1,152,921,504,606,846,976.00 m",
		]);
		expect(incremental).toEqual(batch);
	});
});

describe("exactPastTheDouble and valueInUnit", () => {
	test("ordinary: an exact fraction, an exact decimal, an exact whole number past 2^53", () => {
		expect(decimalToString(exactPastTheDouble(sixtyAndAHalf())!)).toBe("1152921504606846976.5");
		expect(decimalToString(exactPastTheDouble(numberValueExact(9007199254740994, decimalFromLiteral("9007199254740993.5")))!)).toBe("9007199254740993.5");
		const m = valueInUnit(sixtyAndAHalf(), "m");
		expect(m.unit).toBe("m");
		expect(m.toNumber()).toBe(Number(TWO_60));
		expect(text(m)).toBe("1,152,921,504,606,846,976.50 m");
	});

	test("null below 2^53, without a sidecar, and for a fraction that never ends", () => {
		expect(exactPastTheDouble(numberValueExact(0.5, decimalFromLiteral("0.5")))).toBeNull();
		expect(exactPastTheDouble(numberValue(2 ** 60))).toBeNull();
		expect(exactPastTheDouble(numberValueRational(Number(TWO_60), rational(3n * TWO_60 + 1n, 3n)))).toBeNull();
		expect(valueInUnit(numberValueExact(0.1, decimalFromLiteral("0.1")), "m").exact).toBeUndefined();
	});

	test("boundary: exactly 2^53, its negative, the infinities, NaN, negative zero, text", () => {
		expect(exactPastTheDouble(numberValueExact(2 ** 53, decimalFromLiteral("9007199254740992")))).not.toBeNull();
		expect(exactPastTheDouble(numberValueExact(-(2 ** 53), decimalFromLiteral("-9007199254740992")))).not.toBeNull();
		expect(exactPastTheDouble(numberValueExact(2 ** 53 - 1, decimalFromLiteral("9007199254740991")))).toBeNull();
		expect(exactPastTheDouble(numberValue(Infinity))).toBeNull();
		expect(exactPastTheDouble(numberValue(NaN))).toBeNull();
		expect(exactPastTheDouble(numberValue(-0))).toBeNull();
		expect(exactPastTheDouble(stringValue("9007199254740993"))).toBeNull();
	});

	test("hostile: a prototype word as the unit keeps the value it is given", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const v = valueInUnit(sixtyAndAHalf(), word);
				expect(v.unit).toBe(word);
				expect(v.exact).toBeDefined();
			}
		});
	});
});

describe("exactLargeQuantityOp", () => {
	const big = (): Value => uomValueExact(Number(TWO_60), "m", decimalFromLiteral("1152921504606846976.5"));

	test("ordinary: same unit added and taken away, scaled by a plain number", () => {
		expect(text(exactLargeQuantityOp(big(), uomValue(1, "m"), "add")!)).toBe("1,152,921,504,606,846,977.50 m");
		expect(text(exactLargeQuantityOp(big(), uomValueExact(0.5, "m", decimalFromLiteral("0.5")), "sub")!)).toBe("1,152,921,504,606,846,976.00 m");
		expect(text(exactLargeQuantityOp(big(), numberValue(2), "mul")!)).toBe("2,305,843,009,213,693,953.00 m");
		expect(text(exactLargeQuantityOp(numberValue(2), big(), "mul")!)).toBe("2,305,843,009,213,693,953.00 m");
		expect(text(exactLargeQuantityOp(big(), numberValue(2), "div")!)).toBe("576,460,752,303,423,488.25 m");
	});

	test("null where the unit would change or nothing is exact", () => {
		expect(exactLargeQuantityOp(big(), uomValue(1, "km"), "add")).toBeNull();
		expect(exactLargeQuantityOp(big(), uomValue(1, "m"), "mul")).toBeNull();
		expect(exactLargeQuantityOp(numberValue(2), big(), "div")).toBeNull();
		expect(exactLargeQuantityOp(big(), numberValue(1), "add")).toBeNull();
		expect(exactLargeQuantityOp(uomValue(1, "m"), uomValue(2, "m"), "add")).toBeNull();
		expect(exactLargeQuantityOp(numberValue(1), numberValue(2), "add")).toBeNull();
	});

	test("boundary and hostile: a zero divisor, a scalar with no exact reading, a non-number, prototype units", () => {
		expect(exactLargeQuantityOp(big(), numberValue(0), "div")).toBeNull();
		expect(exactLargeQuantityOp(big(), numberValue(Math.SQRT2), "mul")).toBeNull();
		expect(exactLargeQuantityOp(big(), uomValue(0.1 + 0.2, "m"), "add")).toBeNull();
		expect(exactLargeQuantityOp(big(), stringValue("2"), "mul")).toBeNull();
		expect(exactLargeQuantityOp(big(), numberValue(-0), "mul")?.type).toBe(ValueType.Uom);
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const left = uomValueExact(Number(TWO_60), word, decimalFromLiteral("1152921504606846976.5"));
				expect(exactLargeQuantityOp(left, uomValue(1, word), "add")?.unit).toBe(word);
				expect(exactLargeQuantityOp(left, uomValue(1, "m"), "add")).toBeNull();
			}
		});
	});
});

describe("roundExactQuantityToWhole on a length", () => {
	test("each mode either side of the half, and the sign", () => {
		const half = uomValueExact(Number(TWO_60), "m", decimalFromLiteral("1152921504606846976.5"));
		const less = uomValueExact(-Number(TWO_60), "m", decimalFromLiteral("-1152921504606846976.5"));
		expect(text(roundExactQuantityToWhole(half, "ceil")!)).toBe("1,152,921,504,606,846,977.00 m");
		expect(text(roundExactQuantityToWhole(half, "floor")!)).toBe("1,152,921,504,606,846,976.00 m");
		expect(text(roundExactQuantityToWhole(half, "round")!)).toBe("1,152,921,504,606,846,977.00 m");
		expect(text(roundExactQuantityToWhole(less, "trunc")!)).toBe("-1,152,921,504,606,846,976.00 m");
		expect(roundExactQuantityToWhole(uomValue(2.5, "m"), "round")).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: a huge power and a long sum as the magnitude, prototype words as the unit, look-alike and markup text", () => {
		expectHonestLine(`ceil((${RESOURCE_PROBES.hugePower()}) m)`, { budgetMs: 5_000 });
		expectHonestLine(`round((${RESOURCE_PROBES.longSum(1_000)} + 2^60 + 0.5) m)`, { budgetMs: 5_000 });
		expectHonestLine(`ceil(${RESOURCE_PROBES.deepParens(200)} * (2^60 + 0.5) m)`, { budgetMs: 5_000 });
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`ceil((2^60 + 0.5) ${word})`);
				expectHonestDocument(`${word} = (2^60 + 0.5) m\nceil(${word})`);
			}
		});
		for (const line of fill("ceil((2^60 + 0.5) m) X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("(X + 2^60 + 0.5) m", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a unit that does not fit, a check over it, a conversion back, a total of a column", () => {
		expect(shown("(2^60 + 0.5) m + 1 kg")).toMatch(/^ERROR/);
		const { batch, incremental } = expectHonestDocument("(2^60 + 0.5) m\n1 m\ntotal above\ncheck ceil((2^60 + 0.5) m) > (2^60 + 0.5) m\n((2^60 + 0.5) m in km) in m");
		expect(batch[3]).toBe("= ✓");
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge as the magnitude, each rounding, and the document edges around it", () => {
		for (const form of ["ceil((X) m)", "round((X) m)", "floor((X) kg)", "trunc((X) days)", "(X) m + 1 m", "(X) m * 2", "(X) m / 3"]) {
			for (const line of fill(form, NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		}
		expect(shown("(2^1023 * 1.5) m")).not.toMatch(/^CRASH/);
		expect(shown("ceil(-0 m)")).not.toMatch(/^CRASH/);
		for (const doc of DOCUMENT_EDGES) expectHonestDocument(`${doc}\nceil((2^60 + 0.5) m)`);
		expectHonestDocument("ceil((2^60 + 0.5) m)\r\nround((2^60 + 0.5) m)\r\n");
	});
});
