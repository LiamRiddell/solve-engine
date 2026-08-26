/**
 * The two configurable date-format surfaces added in 2.4.0: the input order
 * that reads an ambiguous numeric literal (`date.inputOrder`), and the output
 * format that renders a Datetime (`FormattingSettings.dateResult.format`).
 *
 * The input order is read live by the numeric date-literal rule, which is why
 * it is registered against the engine's own config; the output format flows
 * through `formatValue` per render, so neither needs the engine rebuilt beyond
 * constructing one with the setting.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import type { DateInputOrder } from "@solve-js/constants/Configuration";
import type { DateOutputFormat } from "@solve-js/format/FormattingSettings";
import { ValueType } from "@solve-js/vm/Value";

function evaluateWith(source: string, inputOrder: DateInputOrder) {
	const engine = newTrackedEngine({ config: { date: { inputOrder } } });
	return engine.evaluateExpression(source);
}

/** A resolved date as a Y-M-D triple, or null when it did not parse as a date. */
function ymd(source: string, inputOrder: DateInputOrder): [number, number, number] | null {
	const value = evaluateWith(source, inputOrder);
	if (value.type !== ValueType.Datetime) return null;
	const d = new Date(value.toNumber());
	return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

describe("input order: auto keeps the historic per-separator reading", () => {
	test("a slash date is day-first", () => {
		expect(ymd("25/12/2023", "auto")).toEqual([2023, 12, 25]);
	});

	test("a hyphen date is month-first, or ISO when it starts with four digits", () => {
		expect(ymd("12-25-2023", "auto")).toEqual([2023, 12, 25]);
		expect(ymd("2023-12-25", "auto")).toEqual([2023, 12, 25]);
	});

	test("a US slash date does not parse under auto", () => {
		// 12/25 read day-first is month 25, not a date, so it stays arithmetic.
		expect(ymd("12/25/2023", "auto")).toBeNull();
	});
});

describe("input order: an explicit order reads every numeric separator the same", () => {
	test("MDY lets a US slash date parse", () => {
		expect(ymd("12/25/2023", "MDY")).toEqual([2023, 12, 25]);
	});

	test("MDY reads a day-first date as month-first, so it may not be a date", () => {
		expect(ymd("25/12/2023", "MDY")).toBeNull();
	});

	test("DMY reads a hyphen date day-first too", () => {
		expect(ymd("25-12-2023", "DMY")).toEqual([2023, 12, 25]);
		expect(ymd("12-25-2023", "DMY")).toBeNull();
	});

	test("YMD reads a year-first date on either separator", () => {
		expect(ymd("2023/12/25", "YMD")).toEqual([2023, 12, 25]);
		expect(ymd("2023-12-25", "YMD")).toEqual([2023, 12, 25]);
	});

	test("a spelled-out month is never affected by the order", () => {
		expect(ymd("March 9, 2024", "MDY")).toEqual([2024, 3, 9]);
		expect(ymd("March 9, 2024", "DMY")).toEqual([2024, 3, 9]);
	});
});

describe("output format", () => {
	function render(source: string, format: DateOutputFormat): string {
		const value = newTrackedEngine().evaluateExpression(source);
		return formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, dateResult: { format } });
	}

	test("long is the spelled-out default", () => {
		expect(render("25/12/2023", "long")).toBe("= Monday, December 25, 2023");
	});

	test("iso, dmy and mdy are the numeric forms", () => {
		expect(render("25/12/2023", "iso")).toBe("= 2023-12-25");
		expect(render("25/12/2023", "dmy")).toBe("= 25/12/2023");
		expect(render("25/12/2023", "mdy")).toBe("= 12/25/2023");
	});

	test("a missing dateResult falls back to long", () => {
		const value = newTrackedEngine().evaluateExpression("25/12/2023");
		expect(formatValue(value, DEFAULT_FORMATTING_SETTINGS)).toBe("= Monday, December 25, 2023");
	});

	test("a computed date honours the format", () => {
		expect(render("2nd Tuesday of March 2026", "iso")).toBe("= 2026-03-10");
	});
});
