import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { OpCode } from "@solve-js/parser/OpCode";
import { ValueType, datetimeValue, errorValue, numberValue, percentageValue } from "@solve-js/vm/Value";
import type { Value } from "@solve-js/vm/Value";

/**
 * Issue #631: `a to b` compiled `b / a - 1` whatever the operands were, so two
 * dates divided their epoch milliseconds and `1 Jan 2026 to 1 Mar 2026`
 * answered 0.29%. The new PERCENT_CHANGE opcode decides when the line runs:
 * two dates give the signed span in days, a date against anything else is
 * refused, and everything else runs the same five opcodes as before.
 */

function show(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

/** PERCENT_CHANGE on two hand-made Values, straight through the VM. */
function percentChange(l: Value, r: Value): Value {
	const vm = createVM(sharedOpRegistry);
	vm.push(l);
	vm.push(r);
	return unwrapEvalResult(
		executeBytecode({ opcodes: new Uint8Array([OpCode.PERCENT_CHANGE, OpCode.HALT]), numbers: new Float64Array(), strings: [] }, vm),
	);
}

describe("the PERCENT_CHANGE opcode", () => {
	test("two numbers give the percentage change, as the old program did", () => {
		const v = percentChange(numberValue(10), numberValue(20));
		expect(v.type).toBe(ValueType.Percentage);
		expect(v.toNumber()).toBe(1);
	});

	test("two dates give a signed span in days", () => {
		const jan1 = new Date(2026, 0, 1).getTime();
		const mar1 = new Date(2026, 2, 1).getTime();
		expect(formatValue(percentChange(datetimeValue(jan1), datetimeValue(mar1)))).toBe("= 59 days");
		expect(formatValue(percentChange(datetimeValue(mar1), datetimeValue(jan1)))).toBe("= -59 days");
	});

	test("a date against a number is refused", () => {
		expect(percentChange(datetimeValue(0), numberValue(5)).errorCode).toBe("INVALID_DATETIME_OP");
		expect(percentChange(numberValue(5), datetimeValue(0)).errorCode).toBe("INVALID_DATETIME_OP");
	});

	test("a fault on either side is passed on as it is", () => {
		const fault = errorValue("SOME_FAULT", "broken");
		expect(percentChange(fault, numberValue(5)).errorCode).toBe("SOME_FAULT");
		expect(percentChange(percentageValue(0.1), fault).errorCode).toBe("SOME_FAULT");
	});
});

describe("to between two dates is the span", () => {
	test.each([
		["1 Jan 2026 to 1 Mar 2026", "= 59 days"],
		["1 Mar 2026 to 1 Jan 2026", "= -59 days"],
		["2 April 2026 to 6 September 2026", "= 157 days"],
		["(1 Jan 2026 to 1 Mar 2026) in weeks", "= 8.43 weeks"],
		["2026-03-28 to 2026-03-30", "= 2 days"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("two variables, through both passes", () => {
		const text = "start = 1 Jan 2026\nend = 1 Mar 2026\nstart to end";
		const read = (lines: { result: unknown }[]) => lines.map((l) => (l.result ? formatValue(l.result as never) : ""));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch[2]).toBe("= 59 days");
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});
});

describe("the boundary: the percentage change is unchanged", () => {
	test.each([
		["10 to 20", "= 100.00%"],
		["$100 to $150", "= 50.00%"],
		["0.1 to 0.3", "= 200.00%"],
		["1 m to 2 m", "= 100.00%"],
		["50 to 0", "= -100.00%"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("adversarial: a date against a number is refused, not spanned", () => {
		expect(show("1 Jan 2026 to 5")).toMatch(/^A date and a value that is not one have no span or change between them/);
		expect(show("5 to 1 Jan 2026")).toMatch(/^A date and a value that is not one/);
	});
});
