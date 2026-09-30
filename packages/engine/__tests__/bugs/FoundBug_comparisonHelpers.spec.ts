import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { orderHolds, orderHoldsFor, valuesEqual, valuesOrdered, type Order } from "@solve-js/vm/Comparisons";
import { Value, ValueType, bigIntValue, boolValue, colourValue, errorValue, matrixValue, numberValue, numberValueRational, pendingValue, stringValue, uomValue, type IpCidrData } from "@solve-js/vm/Value";

/**
 * Found bug: `executeBytecode`, the VM's dispatch loop, grew from 46,468 to
 * 54,504 bytes of bytecode over one pull request, against V8's ceiling of
 * 61,440, past which the whole loop stops being optimised (#575). Most of the
 * growth was the same type check added six times over: the four ordering
 * opcodes were four copies of one chain and EQ and NEQ two copies of another,
 * and each batch (IPv6, lists carrying a unit) added its branch to every copy.
 * The chains now live in `vm/Comparisons.ts`, one module-level function per
 * family called from each case after its plain-number fast path, and the
 * per-kind refusals at `CALL_BUILTIN` are one call; the loop measures 44,222.
 * These tests pin what the six opcodes answer, so the move changed nothing a
 * reader sees but the colour and IPv4 fixes that ride on it.
 */

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const bool = (v: Value): unknown => (v.type === ValueType.Boolean ? v.value : v.errorCode ?? v.type);
const ORDERS: readonly Order[] = [0, 1, 2, 3];

describe("the six comparison opcodes answer as they did", () => {
	test.each([
		["1 == 1", "true"],
		["1 != 1", "false"],
		["0.1 + 0.2 == 0.3", "true"],
		["1/49 * 49 == 1", "true"],
		["2^60 + 1 == 2^60", "false"],
		["2^60 + 1 > 2^60", "true"],
		['"a" == "b"', "false"],
		['"a" != "a"', "false"],
		["1 km == 1000 m", "true"],
		["1 km > 500 m", "true"],
		["30 min < 1 hour", "true"],
		["1 km >= 1000 m", "true"],
		["1 km > 1000 m", "false"],
		["1 kg == 1 m", "false"],
		["1 kg != 1 m", "true"],
		["1 kg < 1 m", "INCOMPATIBLE_UNITS: mass and length cannot be compared"],
		["[1, 2] < [2, 1]", "[true, false]"],
		["[1, 2] != [1, 3]", "[false, true]"],
		["[1 km, 2 km] < [1500 m, 1500 m]", "[true, false]"],
		["fe80::1 < fe80::2", "true"],
		["fe80::1 == fe80:0:0:0:0:0:0:1", "true"],
		["10n < 20n", "true"],
		["10n == 10", "true"],
		["true == true", "true"],
		["5% < 10%", "true"],
		["(1/0 - 1/0) == (1/0 - 1/0)", "false"],
		["(1/0 - 1/0) != (1/0 - 1/0)", "true"],
		["(1/0 - 1/0) < 1", "false"],
		["(1/0 - 1/0) >= 1", "false"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("a faulted operand propagates through every comparison", () => {
		for (const op of ["==", "!=", "<", "<=", ">", ">="]) {
			expect(shown(`(5 kg to m) ${op} 0`)).toMatch(/^INCOMPATIBLE_UNITS|^CONVERSION/);
		}
	});
});

describe("orderHolds and orderHoldsFor", () => {
	test("ordinary: each operator on two doubles", () => {
		expect(ORDERS.map((op) => orderHolds(op, 1, 2))).toEqual([true, true, false, false]);
		expect(ORDERS.map((op) => orderHolds(op, 2, 2))).toEqual([false, true, false, true]);
		expect(ORDERS.map((op) => orderHolds(op, 3, 2))).toEqual([false, false, true, true]);
	});

	test("boundary: negative zero, infinities and NaN", () => {
		expect(ORDERS.map((op) => orderHolds(op, -0, 0))).toEqual([false, true, false, true]);
		expect(ORDERS.map((op) => orderHolds(op, -Infinity, Infinity))).toEqual([true, true, false, false]);
		expect(ORDERS.map((op) => orderHolds(op, NaN, 1))).toEqual([false, false, false, false]);
		expect(ORDERS.map((op) => orderHolds(op, 1, NaN))).toEqual([false, false, false, false]);
	});

	test("an order already decided", () => {
		expect(ORDERS.map((op) => orderHoldsFor(op, -1))).toEqual([true, true, false, false]);
		expect(ORDERS.map((op) => orderHoldsFor(op, 0))).toEqual([false, true, false, true]);
		expect(ORDERS.map((op) => orderHoldsFor(op, 1))).toEqual([false, false, true, true]);
	});
});

describe("valuesEqual", () => {
	test("ordinary: numbers, exact fractions, bigints, text and quantities", () => {
		expect(bool(valuesEqual(numberValue(1), numberValue(1), false))).toBe(true);
		expect(bool(valuesEqual(numberValue(1), numberValue(1), true))).toBe(false);
		const third = numberValueRational(1 / 3, { n: 1n, d: 3n });
		expect(bool(valuesEqual(third, numberValueRational(1 / 3, { n: 1n, d: 3n }), false))).toBe(true);
		expect(bool(valuesEqual(bigIntValue(9007199254740993n), bigIntValue(9007199254740992n), false))).toBe(false);
		expect(bool(valuesEqual(stringValue("a"), stringValue("a"), false))).toBe(true);
		expect(bool(valuesEqual(uomValue(1, "km"), uomValue(1000, "m"), false))).toBe(true);
		expect(bool(valuesEqual(uomValue(1, "kg"), uomValue(1, "m"), true))).toBe(true);
	});

	test("boundary: NaN is unequal to itself both ways, and lists answer cell by cell", () => {
		expect(bool(valuesEqual(numberValue(NaN), numberValue(NaN), false))).toBe(false);
		expect(bool(valuesEqual(numberValue(NaN), numberValue(NaN), true))).toBe(true);
		const list = (a: number, b: number) => matrixValue(1, 2, [a, b]);
		expect(formatValue(valuesEqual(list(1, 2), list(1, 3), false))).toBe("= [true, false]");
		expect(formatValue(valuesEqual(list(1, 2), list(1, 3), true))).toBe("= [false, true]");
	});

	test("hostile: a fault, a pending value, a colour and an address against a number", () => {
		const fault = errorValue("BOOM", "no");
		expect(valuesEqual(fault, numberValue(1), false)).toBe(fault);
		expect(valuesEqual(numberValue(1), pendingValue("q"), true).type).toBe(ValueType.Pending);
		expect(bool(valuesEqual(colourValue({ r: 0, g: 0, b: 0, a: 1, format: "hex" }), numberValue(0), false))).toBe(false);
		const ip = new Value(ValueType.IpCidr, { addr: 1 } satisfies IpCidrData);
		expect(bool(valuesEqual(ip, numberValue(1), false))).toBe(false);
		expect(bool(valuesEqual(stringValue("constructor"), stringValue("__proto__"), false))).toBe(false);
		expect(bool(valuesEqual(boolValue(true), boolValue(true), false))).toBe(true);
	});
});

describe("valuesOrdered", () => {
	test("ordinary: numbers, bigints and quantities under each operator", () => {
		expect(ORDERS.map((op) => bool(valuesOrdered(bigIntValue(1n), bigIntValue(2n), op)))).toEqual([true, true, false, false]);
		expect(ORDERS.map((op) => bool(valuesOrdered(uomValue(1, "km"), uomValue(500, "m"), op)))).toEqual([false, false, true, true]);
	});

	test("boundary: two quantities EQ calls equal are neither less nor greater", () => {
		expect(ORDERS.map((op) => bool(valuesOrdered(uomValue(1, "km"), uomValue(1000, "m"), op)))).toEqual([false, true, false, true]);
	});

	test("hostile: a fault, two measures, a colour and an address against a number are refused", () => {
		const fault = errorValue("BOOM", "no");
		for (const op of ORDERS) {
			expect(valuesOrdered(numberValue(1), fault, op)).toBe(fault);
			expect(valuesOrdered(uomValue(1, "kg"), uomValue(1, "m"), op).errorCode).toBe("INCOMPATIBLE_UNITS");
			expect(valuesOrdered(colourValue({ r: 1, g: 2, b: 3, a: 1, format: "hex" }), numberValue(1), op).errorCode).toBe("COLOUR_ARITHMETIC");
			expect(valuesOrdered(new Value(ValueType.IpCidr, { addr6: 1n } satisfies IpCidrData), numberValue(1), op).errorCode).toBe("IPV6_ARITHMETIC");
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words compared, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} < 3`);
				const { batch, incremental } = expectHonestDocument(`${word} = 2\n${word} >= 2\n${word} != 2`);
				expect(batch.slice(1)).toEqual(["= true", "= false"]);
				expect(incremental).toEqual(batch);
			}
		});
	});

	test("security: a thousand comparisons in one document stay within budget", () => {
		const text = Array.from({ length: 1_000 }, (_, i) => `${i} km ${["<", "<=", ">", ">=", "==", "!="][i % 6]} ${i} m`).join("\n");
		expectHonestDocument(text);
	});

	test("realistic: values from the lines above, and a check over a comparison", () => {
		const text = "budget = $500\nspent = $480.50\nspent < budget\ncheck spent <= budget\nspent == budget";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch.slice(2)).toEqual(["= true", "= ✓", "= false"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge under every operator is honest", () => {
		for (const op of ["==", "!=", "<", "<=", ">", ">="]) {
			for (const line of fill(`X ${op} 0`, NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		}
		expect(shown("-0 == 0")).toBe("true");
		expect(shown("-0 < 0")).toBe("false");
		expect(shown("1e308 * 10 > 1e308")).toBe("true");
	});
});
