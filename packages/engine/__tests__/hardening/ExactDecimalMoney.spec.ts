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
	const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
	const [value] = engine.evaluateExpression(expr);
	return formatValue(value);
}

/** The evaluated Value, for asserting its type and exact sidecar directly. */
function evaluate(expr: string) {
	const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
	const [value] = engine.evaluateExpression(expr);
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
		expect(display("$1,000.50 + $0.50")).toBe("= $1001.00");
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
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const doc = engine.parseDocument("a = $0.10\nb = $0.20\na + b", { inputType: "plaintext" });
		const last = doc.lines[doc.lines.length - 1];
		expect(formatValue(last.result!)).toBe("= $0.30");
	});
});

describe("what must keep working", () => {
	test("a bare decimal sum between two plain numbers is still the double it was", () => {
		// The whole boundary rests on this. "0.1 + 0.2" is not money, so it is
		// not made exact, and the famous double answer is the right one to keep.
		const value = evaluate("0.1 + 0.2");
		expect(value.type).toBe(ValueType.Number);
		expect(value.value).toBe(0.30000000000000004);
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
