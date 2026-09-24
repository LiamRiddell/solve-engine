/**
 * Money is exact, because a price is a decimal and not a binary fraction.
 *
 * A currency value used to be an IEEE double underneath, so representation
 * error reached a user who had only typed two prices: "$0.10 + $0.20" summed to
 * 0.30000000000000004, and "$1.005" displayed as "$1.00" because the double
 * handed to `toFixed` already sat below the value that was typed. That is the
 * one class of wrong answer a calculator-you-can-write-money-in cannot afford,
 * and the first thing every ledger tool fixes.
 *
 * Money now carries an exact base-ten decimal (a bigint coefficient and a
 * scale) alongside the double. Same-currency `+`, `-`, `*`, `/` and comparison
 * read it, so the arithmetic is exact and the display rounds a half-cent the
 * way a person does. The double is still there for reading as a number, so
 * nothing that consumed `.value` or `toNumber()` had to change.
 *
 * The boundary is deliberate and is asserted at the bottom: exactness holds
 * only where a currency is involved. A bare "0.1 + 0.2" between two plain
 * numbers is still the double it always was, transcendental work (`sqrt`) is
 * still float, and a cross-currency conversion (whose rate is a double) is
 * still float.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/** The formatted, user-facing result of a single expression. */
function display(expr: string): string {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const value = engine.evaluateExpression(expr);
	return formatValue(value);
}

/** The evaluated Value, for asserting its type and exact sidecar directly. */
function evaluate(expr: string) {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const value = engine.evaluateExpression(expr);
	return value;
}

describe("same-currency arithmetic is exact", () => {
	test.each<[string, string]>([
		["$0.10 + $0.20", "= $0.30"],
		["$0.10 + $0.10 + $0.10", "= $0.30"],
		["$1.10 - $1.00", "= $0.10"],
		["$100 - $99.99", "= $0.01"],
		["$19.99 * 3", "= $59.97"],
		["$1.10 * 3", "= $3.30"],
		["$5.55 + $5.55", "= $11.10"],
		["$0.1 + $0.2", "= $0.30"],
	])("%s is %s", (expr, expected) => {
		expect(display(expr)).toBe(expected);
	});

	test("the reported case, which used to carry 0.30000000000000004", () => {
		const value = evaluate("$0.10 + $0.20");
		expect(display("$0.10 + $0.20")).toBe("= $0.30");
		// The double is now the correctly-rounded 0.3, not the drifted sum.
		expect(value.value).toBe(0.3);
	});
});

describe("a half-cent rounds the way a ledger rounds it, not the way a double does", () => {
	test.each<[string, string]>([
		["$1.005", "= $1.01"],
		["$2.675", "= $2.68"],
		["$0.145", "= $0.15"],
	])("%s is %s, where toFixed on the double rounds it down", (expr, expected) => {
		expect(display(expr)).toBe(expected);
	});
});

describe("money times or over a plain count stays money and stays exact", () => {
	test("a fractional multiplier does not reintroduce float", () => {
		// 0.70 * 1.10 is a tax-like line; the double product drifts, the
		// decimal one does not.
		expect(display("$0.70 * 1.10")).toBe("= $0.77");
	});

	test("bill-splitting rounds the repeating quotient for display", () => {
		expect(display("$10 / 3")).toBe("= $3.33");
	});

	test("adding a bare number to money reads it as that currency", () => {
		expect(display("$5 + 3")).toBe("= $8.00");
	});

	test("a thousands-separated amount keeps every digit", () => {
		expect(display("$1,000.50 + $0.50")).toBe("= $1,001.00");
	});
});

describe("a price per unit comes to the cent the plain product does (#579)", () => {
	// 12.3 * 0.15 is exactly 1.845. Its nearest double sits a hair under the
	// half cent, so every per-unit spelling showed $1.84 while the plain product
	// showed $1.85. Each spelling is pinned against the plain product itself.
	const plain = "$0.15 * 12.3";

	test.each([
		"12.3 kWh * $0.15/kWh",
		"$0.15/kWh * 12.3 kWh",
		"12.3 kg at $0.15/kg",
		"12.3 at $0.15/kg",
		"$0.15 per kg * 12.3 kg",
		"0.15 USD per kWh * 12.3 kWh",
		"$0.15 * 12.3 kWh",
		"12300 Wh * $0.15/kWh",
	])("%s is the plain product, $1.85", (expr) => {
		expect(display(plain)).toBe("= $1.85");
		expect(display(expr)).toBe(display(plain));
		expect(evaluate(expr).exact).toEqual(evaluate(plain).exact);
		expect(evaluate(`${expr} == $1.845`).value).toBe(true);
	});

	test("a half-cent price rounds as the amount on its own does", () => {
		expect(display("$1.005")).toBe("= $1.01");
		expect(display("$1.005 per kg * 1 kg")).toBe("= $1.01");
	});

	test("a price per unit keeps its decimal and is still shown as a rate", () => {
		const price = evaluate("$0.15/kWh");
		expect(display("$0.15/kWh")).toBe("= 0.15 USD/kWh");
		expect(price.type).toBe(ValueType.Uom);
		expect(price.exact).toEqual({ coef: 15n, scale: 2 });
		// A rate that is not a price has nothing to keep.
		expect(evaluate("0.5 km/h").exact).toBeUndefined();
	});

	test("a price per unit on its own rounds a half cent as money does, and keeps a price below a cent", () => {
		expect(display("$1.005/kg")).toBe("= 1.01 USD/kg");
		// A tenth of a cent a unit is a real price; on its own it is not payable.
		expect(display("$0.001/kWh")).toBe("= 0.001 USD/kWh");
		expect(display("$0.001")).toBe("= $0.00");
	});

	test("a count that is a double's rounding of a fraction keeps the double", () => {
		// A third of a kilowatt-hour prints as 0.3333333333333333, sixteen digits,
		// which is the double's rounding and not a decimal anyone wrote.
		expect(display("(1/3) kWh * $30/kWh")).toBe("= $10.00");
		expect(evaluate("(1/3) kWh * $30/kWh == $10").value).toBe(true);
		expect(evaluate("(1/3) kWh * $30/kWh").exact).toBeUndefined();
	});

	test("a price worked out by dividing is a double, as it was", () => {
		expect(evaluate("$1.20 / 0.4 kg * 1 kg").exact).toBeUndefined();
	});
});

describe("comparison is on the value, not on whichever doubles it landed on", () => {
	test("equal to the cent", () => {
		expect(evaluate("$0.1 + $0.2 == $0.3").value).toBe(true);
	});

	test("ordered correctly", () => {
		expect(evaluate("$0.10 < $0.20").value).toBe(true);
		expect(evaluate("$1.005 > $1.00").value).toBe(true);
	});
});

describe("the money value carries an exact decimal, and stays a Uom", () => {
	test("a currency literal is still a Uom (every existing currency path holds)", () => {
		const value = evaluate("$0.10");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.unit).toBe("USD");
	});

	test("both the symbol form and the code form are exact", () => {
		expect(display("$0.10 + $0.20")).toBe("= $0.30");
		expect(display("0.10 USD + 0.20 USD")).toBe("= $0.30");
	});

	test("exactness survives a variable reference", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const doc = engine.parseDocument("a = $0.10\nb = $0.20\na + b", { inputType: "plaintext" });
		const last = doc.lines[doc.lines.length - 1];
		expect(formatValue(last.result!)).toBe("= $0.30");
	});
});

describe("what must keep working", () => {
	test("a bare decimal sum between two plain numbers is exact too, and stays a Number", () => {
		// DECIDED (#511), reversing what this test used to pin. The boundary here
		// was the currency: "0.1 + 0.2" was not money, so it stayed the double
		// 0.30000000000000004. Plain decimals now have the same exact arithmetic
		// money has (vm/ExactDecimals.ts), and the sum is still a plain Number,
		// never money, which is what this test still guards.
		const value = evaluate("0.1 + 0.2");
		expect(value.type).toBe(ValueType.Number);
		expect(value.unit).toBeUndefined();
		expect(value.value).toBe(0.3);
	});

	test("a plain decimal literal is an ordinary Number that reads as itself", () => {
		const value = evaluate("1.005");
		expect(value.type).toBe(ValueType.Number);
		expect(value.value).toBe(1.005);
	});

	test("transcendental work is still float", () => {
		// sqrt(2)^2 is the canonical float-identity that must not be disturbed.
		expect(evaluate("sqrt(2)^2").toNumber()).toBeCloseTo(2, 10);
	});

	test("money and a physical unit still cannot be added", () => {
		expect(evaluate("$100 + 5 kg").type).toBe(ValueType.Error);
	});

	test("a non-currency unit is untouched, exact machinery and all", () => {
		expect(display("1.5 kg + 1.5 kg")).toBe("= 3.00 kg");
	});

	test("scientific notation is still a double, not a decimal literal", () => {
		expect(evaluate("2.5e-3").toNumber()).toBeCloseTo(0.0025, 10);
	});

	test("a plain integer amount is exact too", () => {
		expect(display("$100 * 3")).toBe("= $300.00");
	});
});
