import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, datetimeValue, numberValue, uomValue } from "@solve-js/vm/Value";
import { datetimeArithmeticRefused, datetimeTakesNoUnit, datetimeConversionRefused } from "@solve-js/vm/VMConversion";
import { datetimeArgumentRefused } from "@solve-js/vm/VMBuiltins";

/**
 * Issue #625: a date or time in arithmetic answered its epoch milliseconds.
 * Only ADD and SUB guarded a Datetime, so `1:30 * 3` gave 5,370,888,600,000 on
 * 25 September 2026, `round(1:30)` the instant itself and `1:30 hours` that
 * many hours. Each is now refused by name, and points at the ways a length of
 * time is written. Comparisons, `min`/`max`, `as number`, `to timestamp` and
 * spans are unchanged.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

const MOMENTS = ["1:30", "9am", "2026-01-01", "1 Jan 2026", "today", "now", "2026-01-01T09:30"];

describe("the helpers", () => {
	test("datetimeArithmeticRefused names the operation", () => {
		expect(datetimeArithmeticRefused("mul").errorMessage).toMatch(/^A date or time cannot be multiplied:/);
		expect(datetimeArithmeticRefused("div").errorMessage).toMatch(/^A date or time cannot be divided:/);
		expect(datetimeArithmeticRefused("neg").errorMessage).toMatch(/^A date or time cannot be negated:/);
		expect(datetimeArithmeticRefused().errorMessage).toMatch(/^A date or time cannot be used in this arithmetic:/);
		expect(datetimeArithmeticRefused().errorCode).toBe("INVALID_DATETIME_OP");
	});

	test("datetimeTakesNoUnit names the unit", () => {
		expect(datetimeTakesNoUnit("hours").errorMessage).toMatch(/^A date or time cannot take a unit, hours:/);
	});

	test("datetimeConversionRefused refuses only a date or time", () => {
		expect(datetimeConversionRefused(numberValue(5), "a percentage")).toBeNull();
		expect(datetimeConversionRefused(uomValue(5, "kg"), "a percentage")).toBeNull();
		expect(datetimeConversionRefused(datetimeValue(0), "a percentage")?.errorMessage).toMatch(/^A date or time cannot be written as a percentage:/);
	});

	test("datetimeArgumentRefused names a builtin a reader calls, and no internal name", () => {
		expect(datetimeArgumentRefused(8, [datetimeValue(0)])?.errorMessage).toMatch(/^round takes a number, not a date or time/);
		// 97 is `to N dp`, reached through a phrase: its name is the engine's.
		expect(datetimeArgumentRefused(97, [datetimeValue(0), numberValue(2)])?.errorMessage).toMatch(/^This calculation takes a number/);
		// max reads order, not size.
		expect(datetimeArgumentRefused(10, [datetimeValue(0), datetimeValue(1)])).toBeNull();
		expect(datetimeArgumentRefused(8, [numberValue(1.5)])).toBeNull();
	});
});

describe("every arithmetic form refuses a moment, on either side", () => {
	const forms = ["X * 3", "3 * X", "X / 5", "5 / X", "X mod 7", "X ^ 2", "2 ^ X", "-X", "- X", "10% of X", "10% on X", "10% off X"];
	const lines = MOMENTS.flatMap((m) => forms.map((f) => f.replace("X", m)));
	test.each(lines)("%s", (line) => {
		const value = newTrackedEngine().evaluateExpression(line);
		expect(value.type).toBe(ValueType.Error);
		expect(value.errorCode).toBe("INVALID_DATETIME_OP");
		expect(formatValue(value)).toMatch(/cannot be (multiplied|divided|negated|used in this arithmetic)/);
	});
});

describe("every numeric builtin refuses a moment", () => {
	const functions = ["round", "floor", "ceil", "trunc", "abs", "sqrt", "cbrt", "log", "exp", "sin", "cos", "tan", "sign", "fact"];
	test.each(functions)("%s(1:30)", (fn) => {
		expect(show(`${fn}(1:30)`)).toMatch(new RegExp(`^${fn} takes a number, not a date or time`));
	});

	test("a phrase-reached builtin does not leak its internal name", () => {
		expect(show("1:30 to 2 dp")).toMatch(/^This calculation takes a number/);
	});
});

describe("a unit or a numeric form after a moment is refused", () => {
	test.each([
		["1:30 hours", /^A date or time cannot take a unit, hours:/],
		["1:30 hours in minutes", /^A date or time cannot take a unit, hours:/],
		["5:30 minutes", /^A date or time cannot take a unit, minutes:/],
		["1 Jan 2026 as %", /^A date or time cannot be written as a percentage:/],
		["today as fraction", /^A date or time cannot be written as a fraction:/],
		["today as multiplier", /^A date or time cannot be written as a multiplier:/],
		["today as sci", /^A date or time cannot be written as scientific notation:/],
	])("%s", (line, pattern) => {
		expect(show(line)).toMatch(pattern);
	});
});

describe("the boundary: what reads order or asks for the number stays", () => {
	test.each([
		["9:00 > 8:00", "= true"],
		["today > 1 Jan 2026", "= true"],
		["1 Jan 2026 as number", "= 1,767,225,600,000"],
		["1 Jan 2026 to timestamp", "= 1,767,225,600"],
		["(9:30 - 8:30) * 3", "= 3:00"],
		["1:30:00 * 3", "= 16,200.00 s"],
		["1h30m * 3", "= 270 minutes"],
		["count of 9:00, 10:00", "= 2"],
		["total of 1:30, 2:00", "A date or time cannot be added: only numbers and quantities can."],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("max and min of two times answer a time", () => {
		expect(newTrackedEngine().evaluateExpression("max(9:00, 10:00)").type).toBe(ValueType.Datetime);
		expect(newTrackedEngine().evaluateExpression("min(9:00, 10:00)").type).toBe(ValueType.Datetime);
	});
});

describe("adversarial: held in a variable, and through both document passes", () => {
	test("a moment in a variable is refused the same way", () => {
		const text = "start = 9:00\nstart * 3\n-start\nround(start)\nstart hours";
		const read = (lines: { result: unknown; error?: string | null }[]) =>
			lines.map((l) => {
				const v = l.result as { isError(): boolean; errorCode?: string } | null;
				return v?.isError() ? String(v.errorCode) : l.error ? "line-error" : "ok";
			});
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		expect(batch).toEqual(["ok", "INVALID_DATETIME_OP", "INVALID_DATETIME_OP", "INVALID_DATETIME_OP", "INVALID_DATETIME_OP"]);
		expect(read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines)).toEqual(batch);
	});

	test("the single-expression path refuses too, rather than throwing", () => {
		const value = newTrackedEngine().evaluateLine(1, "1:30 * 3");
		expect(value.errorCode).toBe("INVALID_DATETIME_OP");
	});
});
