/**
 * Exact decimal arithmetic for plain numbers (#511).
 *
 * A number written with a decimal point carries the decimal it was written as,
 * and `+`, `-`, `*`, `mod`, a terminating division, a whole power, a
 * percentage, the comparisons, the rounding family and the totals keep it
 * exact, so a comparison agrees with the answer on screen. See
 * vm/ExactDecimals.ts for the rules and the boundary this file pins.
 *
 * Every expectation is exact. A value's double is the nearest double to the
 * exact answer, so `toNumber()` is pinned with `toBe` against that double.
 */

import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { EXACT_DECIMAL_DIGITS } from "@solve-js/vm/ExactDecimals";

function evaluate(source: string): Value {
	return newTrackedEngine().evaluateExpression(source);
}

/** The line as the gutter shows it, without the display marker. */
const shown = (source: string): string => formatValue(evaluate(source)).replace(/^=\s*/, "");
const num = (source: string): number => evaluate(source).toNumber();

describe("the contradiction the issue reports", () => {
	test("0.1 + 0.2 == 0.3 and 1.1 * 1.1 == 1.21 are true", () => {
		expect(shown("0.1 + 0.2 == 0.3")).toBe("true");
		expect(shown("1.1 * 1.1 == 1.21")).toBe("true");
	});

	test("the answer on screen is unchanged", () => {
		expect(shown("0.1 + 0.2")).toBe("0.30");
		expect(shown("1.1 * 1.1")).toBe("1.21");
	});

	test("and the double behind it is the nearest one to the exact answer", () => {
		expect(num("0.1 + 0.2")).toBe(0.3);
		expect(num("0.1 * 3")).toBe(0.3);
		expect(num("1 - 0.9")).toBe(0.1);
		expect(num("1.1 * 1.1")).toBe(1.21);
	});

	test("a condition reads the exact comparison", () => {
		expect(shown("if 0.1 + 0.2 == 0.3 then 1 else 0")).toBe("1");
	});
});

describe("each operation", () => {
	test("addition and subtraction", () => {
		expect(shown("0.1 + 0.2 - 0.3")).toBe("0");
		expect(shown("-0.1 + -0.2 == -0.3")).toBe("true");
		expect(shown("0.3 - 0.1 == 0.2")).toBe("true");
	});

	test("multiplication, including by a whole number", () => {
		expect(shown("0.1 * 3 == 0.3")).toBe("true");
		expect(shown("3 * 0.1 == 0.3")).toBe("true");
		expect(shown("(0.7 + 0.1) * 10")).toBe("8");
	});

	test("a division that terminates is exact", () => {
		expect(shown("0.3 / 0.1")).toBe("3");
		expect(shown("1.2 / 0.4 == 3")).toBe("true");
		expect(num("1 / 0.8")).toBe(1.25);
	});

	test("a division that does not terminate carries the exact fraction", () => {
		const third = evaluate("0.1 / 3");
		expect(third.rational).toEqual({ n: 1n, d: 30n });
		expect(third.exact).toBeUndefined();
		expect(shown("0.1 / 3 * 3 == 0.1")).toBe("true");
		expect(shown("(0.1 / 3) as fraction")).toBe("1/30");
	});

	test("a fraction and a decimal combine and compare as fractions", () => {
		expect(evaluate("1/3 + 0.1").rational).toEqual({ n: 13n, d: 30n });
		expect(shown("1/3 < 0.34")).toBe("true");
		expect(shown("1/4 == 0.25")).toBe("true");
	});

	test("the remainder", () => {
		expect(shown("0.5 mod 0.2 == 0.1")).toBe("true");
		expect(num("-0.5 mod 0.2")).toBe(-0.1);
	});

	test("a whole power, positive or negative", () => {
		expect(shown("1.1 ^ 2 == 1.21")).toBe("true");
		expect(shown("pow(1.1, 2) == 1.21")).toBe("true");
		expect(num("2.5 ^ -2")).toBe(0.16);
		expect(evaluate("2.5 ^ -2").exact).toEqual({ coef: 16n, scale: 2 });
		// A negative power that does not terminate is the exact fraction.
		expect(evaluate("0.3 ^ -2").rational).toEqual({ n: 100n, d: 9n });
		expect(num("1.5 ^ 0")).toBe(1);
	});

	test("adding, taking and finding a percentage", () => {
		expect(shown("100 + 10%")).toBe("110");
		expect(shown("200 + 15%")).toBe("230");
		expect(shown("0.1 + 10% == 0.11")).toBe("true");
		expect(shown("10% of 0.1 == 0.01")).toBe("true");
		expect(shown("0.1 * 10% == 0.01")).toBe("true");
	});

	test("a percentage on a whole number, including the fraction and the large cases", () => {
		// The common shape is formed in doubles while it stays exact; a
		// fractional answer still carries its decimal.
		expect(evaluate("3 + 15%").exact).toEqual({ coef: 345n, scale: 2 });
		expect(shown("3 + 15% == 3.45")).toBe("true");
		expect(shown("200 + 0.5%")).toBe("201");
		const share = evaluate("12.5% of 80");
		expect(share.toNumber()).toBe(10);
		expect(share.exact).toBeUndefined();
		expect(shown("100 - 150%")).toBe("-50");
		expect(shown("7 * 12.5% == 0.875")).toBe("true");
		// Past the safe range the product is formed exactly in bigints.
		expect(shown("(9007199254740991 + 10%) == 9907919180215090.1")).toBe("true");
		// Zero keeps the sign the double gives it.
		expect(Object.is(num("0 + 10%"), 0)).toBe(true);
	});

	test("every comparison", () => {
		expect(shown("0.1 + 0.2 != 0.3")).toBe("false");
		expect(shown("0.1 + 0.2 <= 0.3")).toBe("true");
		expect(shown("0.1 + 0.2 > 0.3")).toBe("false");
		expect(shown("0.1 + 0.2 >= 0.3")).toBe("true");
		expect(shown("0.1 + 0.2 < 0.3")).toBe("false");
	});

	test("two decimals that share a nearest double still compare on their digits", () => {
		// Twenty places, past what a double resolves: both sides are the double
		// 0.1, and only the exact comparison can tell them apart.
		expect(shown("0.10000000000000000001 > 0.1")).toBe("true");
		expect(shown("0.10000000000000000001 == 0.1")).toBe("false");
	});
});

describe("rounding reads the exact value", () => {
	test("to N dp rounds a half away from zero on the exact result", () => {
		expect(shown("1.005 * 1 to 2 dp")).toBe("1.01");
		expect(shown("(0.5 + 0.505) to 2 dp")).toBe("1.01");
		expect(shown("round(2.675 * 1, 2)")).toBe("2.68");
	});

	test("and on a fraction", () => {
		expect(shown("(201/200) to 2 dp")).toBe("1.01");
		expect(shown("(1/3) to 3 dp")).toBe("0.333");
	});

	test("many places show the exact digits, not the double's", () => {
		expect(shown("(0.1 + 0.2) to 17 dp")).toBe("0.30000000000000000");
	});

	test("floor, ceil, trunc and round", () => {
		expect(shown("floor((0.7 + 0.1) * 10)")).toBe("8");
		expect(shown("ceil(0.1 * 3 * 10)")).toBe("3");
		expect(shown("trunc(-2.99999999999999999)")).toBe("-2");
		expect(shown("floor(2.99999999999999999)")).toBe("2");
		// round(x) keeps the rule it always had: a half goes up.
		expect(shown("round(2.5)")).toBe("3");
		expect(shown("round(-2.5)")).toBe("-2");
	});

	test("abs, min and max keep the exact decimal", () => {
		expect(shown("abs(-0.1) + 0.2 == 0.3")).toBe("true");
		expect(shown("max(0.1, 0.2) + 0.1 == 0.3")).toBe("true");
		expect(shown("min(0.3, 0.1 + 0.2) == 0.3")).toBe("true");
		// A display precision on the operand is not carried through abs.
		expect(shown("abs(-1.5 to 3 dp)")).toBe("1.50");
	});
});

describe("totals and averages", () => {
	test("of a list", () => {
		expect(shown("(total of 0.1, 0.2) == 0.3")).toBe("true");
		expect(shown("(average of 0.1, 0.2) == 0.15")).toBe("true");
		expect(evaluate("average of 0.1, 0.2, 0.3, 0.1").exact).toBeDefined();
		expect(evaluate("average of 0.1, 0.2, 0.2").rational).toEqual({ n: 1n, d: 6n });
	});

	test("of a column, a range and a tag, through both document passes", () => {
		const doc = ["0.1 #tip", "0.2 #tip", "total above", "line 3 == 0.3", "sum(line 1 : line 2) == 0.3", "total of #tip == 0.3", "average of #tip == 0.15"];
		const read = (result: { lines: { result?: Value; error?: string }[] }) =>
			result.lines.map((l) => (l.result ? formatValue(l.result).replace(/^=\s*/, "") : `ERROR ${l.error}`));
		const batch = read(newTrackedEngine().parseDocument(doc.join("\n"), { inputType: "markdown" }));
		const incremental = read(evaluateDocument(newTrackedEngine(), doc.join("\n"), { inputType: "markdown" }));
		expect(batch.slice(2)).toEqual(["0.30", "true", "true", "true", "true"]);
		expect(incremental).toEqual(batch);
	});

	test("a column of whole numbers keeps the plain sum", () => {
		const whole = evaluate("total of 1, 2, 3");
		expect(whole.toNumber()).toBe(6);
		expect(whole.exact).toBeUndefined();
	});
});

describe("what a result carries", () => {
	test("a whole-number result is a plain number, with no decimal sidecar", () => {
		const two = evaluate("0.5 * 4");
		expect(two.type).toBe(ValueType.Number);
		expect(two.toNumber()).toBe(2);
		expect(two.exact).toBeUndefined();
		expect(two.rational).toBeUndefined();
	});

	test("a fractional result carries its decimal, trailing zeros trimmed", () => {
		expect(evaluate("0.1 + 0.2").exact).toEqual({ coef: 3n, scale: 1 });
		expect(evaluate("1.10 * 1.10").exact).toEqual({ coef: 121n, scale: 2 });
	});

	test("whole numbers never take the decimal path", () => {
		const three = evaluate("1 + 2");
		expect(three.exact).toBeUndefined();
		expect(three.rational).toBeUndefined();
	});

	test("a variable keeps the decimal it was given", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "a = 0.1");
		engine.evaluateLine(2, "b = 0.2");
		expect(formatValue(engine.evaluateLine(3, "a + b == 0.3"))).toBe("= true");
	});

	test("money is unchanged, and a computed multiplier now reaches it exact", () => {
		expect(shown("$0.10 + $0.20")).toBe("$0.30");
		expect(shown("$0.70 * (0.1 + 1)")).toBe("$0.77");
	});
});

describe("a figure that carries its sources (#512)", () => {
	// A primed table, so a converted amount carries a record without reaching
	// the network. Ten dollars at 0.9 is nine euros, a whole number, so read as
	// a number it has an exact decimal and carries the USD/EUR rate's record.
	// A sourced operand leaves the plain fast paths, which is where the exact
	// path used to be left behind.
	const prime = (): void => {
		currencyExchangeService.primeRates("USD", { EUR: 0.9 }, { provider: "Test Bank", publishedAt: Date.UTC(2026, 8, 23, 16, 2) });
	};
	const NINE = "((10 USD in EUR) as number)";
	afterEach(() => currencyExchangeService.clearRates());

	test.each([
		// Each double is what floating point gave: 1.3499999999999999,
		// 8.700000000000001, 1000.0000000000001 and 0.1999999999999995.
		[`${NINE} * 0.15`, 1.35, "1.35"],
		[`${NINE} - 0.1 - 0.2`, 8.7, "8.70"],
		[`${NINE} / 0.009`, 1000, "1,000"],
		[`${NINE} mod 0.4`, 0.2, "0.20"],
	])("%s is exact and keeps the rate's record", (source, double, text) => {
		prime();
		const v = evaluate(source);
		expect(v.toNumber()).toBe(double);
		expect(formatValue(v).replace(/^=\s*/, "")).toBe(text);
		expect(v.sources?.map((s) => s.subject)).toEqual(["USD/EUR"]);
	});

	test("so a comparison on a sourced decimal agrees with the answer on screen", () => {
		prime();
		expect(shown(`${NINE} * 0.15 == 1.35`)).toBe("true");
	});

	test("an exact total carries the sources of what it added, through both document passes", () => {
		prime();
		const doc = [`${NINE} #fx`, "0.15 #fx", "total of #fx", "", NINE, "0.15", "total above", "average above"];
		const read = (result: { lines: { result?: Value }[] }) =>
			[2, 6, 7].map((i) => {
				const v = result.lines[i].result!;
				return `${formatValue(v).replace(/^=\s*/, "")} ${v.exact === undefined ? "double" : "exact"} ${v.sources?.map((s) => s.subject).join(",")}`;
			});
		const batch = read(newTrackedEngine().parseDocument(doc.join("\n"), { inputType: "markdown" }));
		const incremental = read(evaluateDocument(newTrackedEngine(), doc.join("\n"), { inputType: "markdown" }));
		expect(batch).toEqual(["9.15 exact USD/EUR", "9.15 exact USD/EUR", "4.58 exact USD/EUR"]);
		expect(incremental).toEqual(batch);
	});
});

describe("the boundary", () => {
	test("an irrational stays in floating point", () => {
		expect(shown("sqrt(2) * sqrt(2) == 2")).toBe("false");
		expect(evaluate("sqrt(2) + 0.1").exact).toBeUndefined();
	});

	test("scientific notation is read as floating point", () => {
		expect(shown("1e-1 + 2e-1 == 3e-1")).toBe("false");
		// And a typed large number is still not given digits it never had.
		expect(shown("1e16 + 1 - 1e16")).toBe("0");
	});

	test(`a result past ${EXACT_DECIMAL_DIGITS} digits falls back to the double it always was`, () => {
		// 0.1 ^ 34 has 34 places and stays exact; one more place is past the limit.
		expect(evaluate("0.1 ^ 34").exact).toEqual({ coef: 1n, scale: 34 });
		const past = evaluate("0.1 ^ 35");
		expect(past.exact).toBeUndefined();
		expect(past.toNumber()).toBe(Math.pow(0.1, 35));
		// Compound growth is 61 digits, so it answers the double.
		const growth = evaluate("1.05 ^ 30");
		expect(growth.exact).toBeUndefined();
		expect(growth.toNumber()).toBe(Math.pow(1.05, 30));
	});

	test("a huge whole power of a short decimal is refused from its size, not built", () => {
		const started = Date.now();
		expect(num("5.0 ^ 1000000000")).toBe(Infinity);
		expect(Date.now() - started).toBeLessThan(1000);
	});

	test("a zero keeps the sign IEEE gives it, where the sign is observable", () => {
		// A decimal has no negative zero; the engine keeps IEEE's, so an exact
		// zero takes the double's sign, as the whole-number path does.
		expect(num("1 / (0.0 * -1)")).toBe(-Infinity);
		expect(num("1 / (0 * -1)")).toBe(-Infinity);
		expect(Object.is(num("ceil(-0.5)"), -0)).toBe(true);
		expect(Object.is(num("-0.0 * 2.14"), -0)).toBe(true);
		// A zero the doubles did not reach is a plain zero.
		expect(Object.is(num("0.1 + 0.2 - 0.3"), 0)).toBe(true);
	});

	test("a zero divisor keeps the double's answer", () => {
		expect(num("0.5 / 0")).toBe(Infinity);
		expect(Number.isNaN(num("0.5 mod 0"))).toBe(true);
		expect(num("0.0 ^ -1")).toBe(Infinity);
	});

	test("a unit other than money keeps the double, and unit algebra answers as it did (#513)", () => {
		// An area, a reciprocal and a rate cancelling read their operands as
		// doubles, as they did before plain decimals were exact.
		expect(shown("2.5 m * 1.2 m")).toBe("3.00 m²");
		expect(evaluate("1.1 m * 1.1 m").exact).toBeUndefined();
		expect(shown("1.5 / (0.5 m)")).toBe("3.00 /m");
		expect(shown("2.4 m² / (0.3 m²/l)")).toBe("8.00 l");
		// Money reached through a price per unit is the product it was.
		expect(shown("3 kg * $5/kg")).toBe("$15.00");
		expect(shown("$12.50/h * 7.5 h")).toBe("$93.75");
	});

	test("a measurement with an uncertainty keeps the double", () => {
		expect(shown("(0.1 +/- 0.01) + 0.2")).toBe("0.3 ± 0.01");
		expect(evaluate("(0.1 +/- 0.01) + 0.2").exact).toBeUndefined();
	});

	test("a percentage that is not a typed decimal keeps the double", () => {
		// A third, as a percentage, is a computed proportion with no typed digits.
		expect(evaluate("3 * ((1/3) as %)").exact).toBeUndefined();
	});
});
