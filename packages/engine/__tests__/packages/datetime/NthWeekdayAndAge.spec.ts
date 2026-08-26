/**
 * The 2.4.0 calendar-aware date forms through the engine: the nth weekday of a
 * month, the relative month anchors, and age.
 *
 * The nth-weekday cases are fixed months, so they assert a concrete date. The
 * age cases pin the reference date with `on <date>` (or the breakdown's own
 * reference), so they are deterministic despite age being relative to now by
 * default; the bare `age of <date>` form is only checked for its shape, since
 * its value moves with the calendar.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";

function evaluate(source: string) {
	return newTrackedEngine().evaluateExpression(source);
}

/** The date a form resolves to, as a local Y-M-D triple. */
function ymd(source: string): [number, number, number] {
	const d = new Date(evaluate(source).toNumber());
	return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

/** The displayed result, without the `= ` prefix. */
const text = (source: string) => formatValue(evaluate(source), DEFAULT_FORMATTING_SETTINGS).replace(/^= /, "");

describe("nth weekday of a fixed month", () => {
	test("2nd Tuesday of March 2026", () => {
		expect(ymd("2nd Tuesday of March 2026")).toEqual([2026, 3, 10]);
	});

	test("4th Thursday of November 2026", () => {
		expect(ymd("4th Thursday of November 2026")).toEqual([2026, 11, 26]);
	});

	test("last Friday of November 2026", () => {
		expect(ymd("last Friday of November 2026")).toEqual([2026, 11, 27]);
	});

	test("3rd and 1st read the same way as 2nd and 4th", () => {
		expect(ymd("1st Sunday of March 2026")).toEqual([2026, 3, 1]);
		expect(ymd("3rd Wednesday of March 2026")).toEqual([2026, 3, 18]);
	});

	test("an occurrence the month does not have is an error, not a wrap", () => {
		expect(evaluate("5th Friday of April 2026").type).toBe(ValueType.Error);
	});

	test("the result is a pure date, so it composes as one", () => {
		// `as weekday` reads the field off the computed date.
		expect(text("2nd Tuesday of March 2026 as weekday")).toBe("Tuesday");
	});
});

describe("the bare next/last weekday forms are untouched", () => {
	test("`last Friday` stays the previous Friday, not an nth-weekday error", () => {
		expect(evaluate("last Friday").type).toBe(ValueType.Datetime);
	});

	test("`next Monday` stays a date", () => {
		expect(evaluate("next Monday").type).toBe(ValueType.Datetime);
	});
});

describe("relative month anchors", () => {
	test("`next month` is the first of next month", () => {
		const now = new Date();
		const expected = new Date(now.getFullYear(), now.getMonth() + 1, 1);
		expect(ymd("next month")).toEqual([expected.getFullYear(), expected.getMonth() + 1, 1]);
	});

	test("`this month` is the first of this month", () => {
		const now = new Date();
		expect(ymd("this month")).toEqual([now.getFullYear(), now.getMonth() + 1, 1]);
	});

	test("`1st Monday of next month` composes the two", () => {
		const now = new Date();
		const anchor = new Date(now.getFullYear(), now.getMonth() + 1, 1);
		const firstMondayOffset = (1 - anchor.getDay() + 7) % 7;
		const expected = new Date(anchor.getFullYear(), anchor.getMonth(), 1 + firstMondayOffset);
		expect(ymd("1st Monday of next month")).toEqual([
			expected.getFullYear(), expected.getMonth() + 1, expected.getDate(),
		]);
	});
});

describe("age", () => {
	test("`age of <birth> on <date>` is whole calendar years", () => {
		expect(text("age of 15/06/1990 on 25/12/2030")).toBe("40 years");
		expect(text("age of 01/01/2020 on 01/01/2026")).toBe("6 years");
	});

	test("a birthday not yet reached on the reference date does not count", () => {
		expect(text("age of 15/06/1990 on 14/06/2026")).toBe("35 years");
		expect(text("age of 15/06/1990 on 15/06/2026")).toBe("36 years");
	});

	test("the years, months and days breakdown", () => {
		expect(text("age of 15/06/1990 on 26/08/2026 in years, months and days")).toBe("36 years, 2 months, 11 days");
	});

	test("the breakdown drops zero parts but keeps a whole-year answer", () => {
		expect(text("age of 01/01/2020 on 01/01/2026 in years, months and days")).toBe("6 years");
	});

	test("`age of <birth>` with no reference is a whole-year quantity", () => {
		const value = evaluate("age of 01/01/2000");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.unit).toBe("years");
	});
});
