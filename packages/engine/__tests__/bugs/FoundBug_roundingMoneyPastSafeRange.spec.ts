import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, numberValue, numberValueExact, stringValue, uomValue, uomValueExact } from "@solve-js/vm/Value";
import { roundExactQuantityToWhole, roundExactToWhole, wholeOfQuotientBig } from "@solve-js/vm/ExactDecimals";
import { truncateToWhole } from "@solve-js/packages/ip/IpPluginFunctions";

/**
 * Found bug: `floor((2^60 + 0.5) m)` showed ...976.00 m from the double. The
 * rounding functions read a plain number's exact value (`roundExactToWhole`
 * in vm/ExactDecimals.ts) but a quantity's double only. A length carries no
 * exact value to read: the unit is attached to the double, so `(2^60 + 1) m`
 * is already ...976.00 m before any rounding, and that is outside what a
 * rounding function can mend. The quantity that does carry one is money,
 * whose exact decimal `floor`, `ceil`, `round`, `trunc` and `int` passed over:
 * `floor($9007199254740993.5)` answered $...994.00, a dollar above the amount.
 * `roundExactToWhole` now rounds a quantity's exact decimal too
 * (`roundExactQuantityToWhole`) and keeps its unit, and `as int` cuts money
 * from the decimal while still answering a plain number. The plain-double path
 * is turned away on its first two reads, as before, so it allocates nothing.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

describe("the lines that exposed it", () => {
	test.each([
		["floor($9007199254740993.5)", "$9,007,199,254,740,993.00"],
		["ceil($9007199254740993.5)", "$9,007,199,254,740,994.00"],
		["round($9007199254740993.5)", "$9,007,199,254,740,994.00"],
		["trunc($9007199254740993.5)", "$9,007,199,254,740,993.00"],
		["int($9007199254740993.5)", "$9,007,199,254,740,993.00"],
		["floor(-$9007199254740993.5)", "-$9,007,199,254,740,994.00"],
		["trunc(-$9007199254740993.5)", "-$9,007,199,254,740,993.00"],
		["$9007199254740993.5 as int", "9,007,199,254,740,993"],
		["floor(£12345678901234567890.75)", "£12,345,678,901,234,567,890.00"],
	])("%s is %s", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test("what was right stays right: small amounts, a length, a plain number", () => {
		expect(outcome("floor($2.50)")).toBe("$2.00");
		expect(outcome("round($2.5)")).toBe("$3.00");
		expect(outcome("round(-$2.5)")).toBe("-$3.00");
		expect(outcome("ceil(-$0.50)")).toBe("$0.00");
		expect(outcome("floor(3.7 m)")).toBe("3.00 m");
		expect(outcome("floor(2^60 + 0.5)")).toBe("1,152,921,504,606,846,976");
		expect(outcome("$5.50 as int")).toBe("5");
		expect(outcome("floor(¥1234.5)")).toBe("¥1,234");
	});

	// This was the boundary: a length kept only its double, so these answered
	// ...976.00 m. A quantity past 2^53 now keeps its exact value
	// (FoundBug_quantityPastTheDouble.spec.ts).
	test("a length past 2^53 keeps its exact value, so its rounding reads that", () => {
		expect(outcome("(2^60 + 1) m")).toBe("1,152,921,504,606,846,977.00 m");
		expect(outcome("ceil((2^60 + 0.5) m)")).toBe("1,152,921,504,606,846,977.00 m");
	});
});

describe("roundExactQuantityToWhole", () => {
	test("ordinary: money rounds from its decimal and keeps its currency", () => {
		const r = roundExactQuantityToWhole(uomValueExact(2.5, "USD", { coef: 25n, scale: 1 }), "floor")!;
		expect(r.type).toBe(ValueType.Uom);
		expect(r.unit).toBe("USD");
		expect(r.exact).toEqual({ coef: 2n, scale: 0 });
		expect(r.value).toBe(2);
	});

	test("boundary: each mode either side of zero, a whole amount, a negative scale, a negative zero, past 2^53", () => {
		const m = (coef: bigint, scale: number, n: number) => uomValueExact(n, "USD", { coef, scale });
		expect(roundExactQuantityToWhole(m(-25n, 1, -2.5), "floor")!.exact).toEqual({ coef: -3n, scale: 0 });
		expect(roundExactQuantityToWhole(m(-25n, 1, -2.5), "ceil")!.exact).toEqual({ coef: -2n, scale: 0 });
		expect(roundExactQuantityToWhole(m(-25n, 1, -2.5), "round")!.exact).toEqual({ coef: -3n, scale: 0 });
		expect(roundExactQuantityToWhole(m(-25n, 1, -2.5), "trunc")!.exact).toEqual({ coef: -2n, scale: 0 });
		expect(roundExactQuantityToWhole(m(7n, 0, 7), "ceil")!.exact).toEqual({ coef: 7n, scale: 0 });
		expect(roundExactQuantityToWhole(m(7n, -3, 7000), "floor")!.exact).toEqual({ coef: 7000n, scale: 0 });
		expect(Object.is(roundExactQuantityToWhole(m(-5n, 1, -0.5), "ceil")!.value, -0)).toBe(true);
		expect(roundExactQuantityToWhole(m(90071992547409935n, 1, 9007199254740994), "floor")!.exact).toEqual({ coef: 9007199254740993n, scale: 0 });
	});

	test("hostile: a quantity without a decimal, a plain number and text are null, never thrown on", () => {
		expect(roundExactQuantityToWhole(uomValue(2.5, "m"), "floor")).toBeNull();
		expect(roundExactQuantityToWhole(numberValueExact(2.5, { coef: 25n, scale: 1 }), "floor")).toBeNull();
		expect(roundExactQuantityToWhole(stringValue("constructor"), "floor")).toBeNull();
	});
});

describe("roundExactToWhole and truncateToWhole", () => {
	test("the plain-double path is null on its first reads, so nothing is built", () => {
		expect(roundExactToWhole(numberValue(2.5), "floor")).toBeNull();
		expect(roundExactToWhole(uomValue(2.5, "m"), "floor")).toBeNull();
	});

	test("a plain number keeps its path, and money now takes the quantity's", () => {
		expect(roundExactToWhole(numberValueExact(2.5, { coef: 25n, scale: 1 }), "ceil")!.value).toBe(3);
		expect(roundExactToWhole(uomValueExact(2.5, "EUR", { coef: 25n, scale: 1 }), "ceil")!.unit).toBe("EUR");
	});

	test("as int answers a plain number for money, from its decimal", () => {
		const v = truncateToWhole(uomValueExact(9007199254740994, "USD", { coef: 90071992547409935n, scale: 1 }));
		expect(v.type).toBe(ValueType.Number);
		expect(formatValue(v)).toBe("= 9,007,199,254,740,993");
		expect(truncateToWhole(uomValue(5.5, "m")).value).toBe(5);
	});

	test("wholeOfQuotientBig: ordinary, boundary and hostile divisions", () => {
		expect(wholeOfQuotientBig(7n, 2n, "floor")).toBe(3n);
		expect(wholeOfQuotientBig(-7n, 2n, "floor")).toBe(-4n);
		expect(wholeOfQuotientBig(7n, 2n, "round")).toBe(4n);
		expect(wholeOfQuotientBig(-7n, 2n, "round")).toBe(-4n);
		expect(wholeOfQuotientBig(-7n, 2n, "ceil")).toBe(-3n);
		expect(wholeOfQuotientBig(6n, 2n, "ceil")).toBe(3n);
		expect(wholeOfQuotientBig(0n, 10n, "trunc")).toBe(0n);
		expect(wholeOfQuotientBig(BigInt(`1${"0".repeat(40)}`) + 5n, 10n, "round")).toBe(BigInt(`1${"0".repeat(39)}`) + 1n);
	});
});

describe("adversarial", () => {
	test("security: prototype words, a long sum, deep brackets, a huge power and look-alike text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`floor($${word})`);
				expectHonestDocument(`${word} = $9007199254740993.5\nfloor(${word})\nround(${word})`);
			}
		});
		expectHonestLine(`floor($1 * (${RESOURCE_PROBES.longSum(300)}) + $0.5)`, { budgetMs: 5_000 });
		expectHonestLine(`round(${RESOURCE_PROBES.deepParens(200)} * $1.5)`, { budgetMs: 5_000 });
		expectHonestLine(`floor($1 * ${RESOURCE_PROBES.hugePower()})`, { budgetMs: 5_000 });
		for (const line of fill("floor($X.5)", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("floor($９.5)");
	});

	test("realistic: an amount from the line above, a what-if, a check and a total, both passes", () => {
		const { batch, incremental } = expectHonestDocument("price = $9007199254740993.5\nfloor(price)\nline 2 with price = $2.75\ncheck floor(price) < price\nfloor(price) + $1");
		expect(batch[1]).toBe("= $9,007,199,254,740,993.00");
		expect(batch[2]).toBe("= $2.00");
		expect(batch[3]).toBe("= ✓");
		expect(batch[4]).toBe("= $9,007,199,254,740,994.00");
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge as money through each rounding", () => {
		for (const line of [...fill("floor((X) * $1)", NUMERIC_EDGES), ...fill("round(-(X) * $1)", NUMERIC_EDGES), ...fill("ceil($1 * (X) + $0.5)", NUMERIC_EDGES)]) {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		}
	});
});
