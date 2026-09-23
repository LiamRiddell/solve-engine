import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #530: `total of "Travel"` answered 0.
 *
 * The inline aggregates read every operand with no unit as `toNumber()`, and a
 * value with no numeric reading reads as 0 or as something stranger: text
 * through `parseFloat`, a date as its epoch milliseconds, a bracketed list or a
 * colour as 0. So `total of "Travel"` reported nothing spent, and
 * `average of 1:3` (a clock time) a thirteen-digit number. Each is now refused
 * with AGGREGATE_NON_NUMERIC, naming what it met. See nonNumericOperand() in
 * vm/VMConversion.ts.
 */

const value = (source: string) => newTrackedEngine().evaluateExpression(source);
const code = (source: string) => value(source).errorCode;

describe("the reported case", () => {
	test("a quoted name in a document is refused, pointing at tags", () => {
		const doc = newTrackedEngine().parseDocument("# Travel\nflights $500\nhotel $220\n\n# Summary\ntotal of \"Travel\"");
		const last = doc.lines[5].result;
		expect(last?.type).toBe(ValueType.Error);
		expect(last?.errorCode).toBe("AGGREGATE_NON_NUMERIC");
		expect(last?.errorMessage).toContain("total of #tag");
	});

	test("and so is the same line on its own", () => {
		expect(code(`total of "Travel"`)).toBe("AGGREGATE_NON_NUMERIC");
	});
});

describe("every aggregate refuses a value with no numeric reading", () => {
	test.each([
		`total of "a", 5`,
		`average of "a", 4`,
		`median of "a", 4, 6`,
		`spread of "a", 3`,
		`standard deviation of "a", 2, 4`,
		`sample standard deviation of "a", 2, 4`,
		`variance of today, 2`,
		`sample variance of today, 2`,
		`mode of "a", "a", 3`,
		`larger of "a" and 3`,
		`max(#ff0000, 1)`,
		`min("a", 3)`,
	])("%s", (source) => {
		expect(code(source)).toBe("AGGREGATE_NON_NUMERIC");
	});

	test("a date, a bracketed list and a colour are each named", () => {
		expect(value("total of today, 1").errorMessage).toContain("A date or time cannot be added");
		expect(value("total of 1:3").errorMessage).toContain("A date or time cannot be added");
		expect(value("total of [1, 2, 3]").errorMessage).toContain("List the values with commas");
		expect(value("total of #ff0000, 1").errorMessage).toContain("A colour cannot be added");
	});

	test("the tag hint names the matching phrase, and only where a tag fits", () => {
		expect(value(`average of "a", 4`).errorMessage).toContain("average of #tag");
		expect(value(`larger of "a" and 3`).errorMessage).not.toContain("#tag");
	});
});

describe("everything with a numeric reading still answers", () => {
	test.each([
		["total of 1, 2, 3", "= 6"],
		["total of true, 2", "= 3"],
		["total of 10%, 20%", "= 0.30"],
		["total of 5 kg, 2 kg", "= 7.00 kg"],
		["total of 0x10, 1", "= 17"],
		["total of 5n, 1", "= 6"],
		["total of $4.99, $12.50, $3.20", "= $20.69"],
		["average of 36, 42, 19 and 81", "= 44.50"],
		["max(1 km, 500 m)", "= 1.00 km"],
		[`count of "a", "b"`, "= 2"],
	])("%s is %s", (source, shown) => {
		expect(formatValue(value(source))).toBe(shown);
	});
});

describe("min and max of dates answer with the date", () => {
	test("the later and the earlier of two dates", () => {
		const later = value("max(25/12/2026, 1/1/2027)");
		expect(later.type).toBe(ValueType.Datetime);
		expect(formatValue(later)).toBe(formatValue(value("1/1/2027")));
		expect(formatValue(value("min(25/12/2026, 1/1/2027)"))).toBe(formatValue(value("25/12/2026")));
	});

	test("but a date among numbers is refused", () => {
		expect(code("max(today, 5)")).toBe("AGGREGATE_NON_NUMERIC");
	});
});
