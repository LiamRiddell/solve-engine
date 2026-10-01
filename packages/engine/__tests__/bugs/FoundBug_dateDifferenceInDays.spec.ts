import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { dateDifference } from "@solve-js/vm/DateDifference";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { datetimeValue, numberValue, ValueType } from "@solve-js/vm/Value";

/**
 * Found bug: `25/12/2026 - 24/12/2026` answered `= 24:00`, and so did
 * `2026-12-25 - 2026-12-24`. The slash form was read as two dates, not as a
 * division or a time: two datetimes subtract to a span in milliseconds marked
 * to show on a clock, the right reading for `9:30 - 8:30`, and the wrong one
 * for two calendar days. Two dates written without a time of day now subtract
 * to a count of days (`dateDifference`), counted on the calendar as `days
 * between` counts it, so a day the clocks change in is still one day.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

/** Local midnight of a day, as a date literal holds it. */
function day(year: number, month: number, date: number): number {
	return DATE_CALENDAR.localMidnight(year, month - 1, date);
}

describe("the lines that exposed it", () => {
	test.each([
		["25/12/2026 - 24/12/2026", "1 day"],
		["2026-12-25 - 2026-12-24", "1 day"],
		["25 December 2026 - 24 December 2026", "1 day"],
		["24/12/2026 - 25/12/2026", "-1 day"],
		["2026-12-25 - 2026-12-25", "0 days"],
		["2024-03-01 - 2024-02-28", "2 days"],
		["2025-01-01 - 2024-01-01", "366 days"],
		["31/03/2024 - 30/03/2024", "1 day"],
		["(25/12/2026 - 24/12/2026) * 2", "2 days"],
		["(2026-12-25 - 2026-12-24) in hours", "24 hours"],
		["(2026-12-25 - 2026-12-24) as iso8601", "P1D"],
		["2026-12-24 + (2026-12-25 - 2026-12-24)", "Friday, December 25, 2026"],
		["check 25/12/2026 - 24/12/2026 == 1 day", "✓"],
	])("%s is %s", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test("a side with a time of day keeps the clock, as before", () => {
		expect(outcome("2026-12-25 09:00 - 2026-12-24")).toBe("33:00");
		expect(outcome("9:30 - 8:30")).toBe("1:00");
		expect(outcome("now - now")).toBe("0:00");
	});

	test("a date difference agrees with days between", () => {
		for (const [a, b] of [["2026-12-25", "2026-01-01"], ["2024-03-31", "2024-03-30"], ["2024-02-29", "2023-02-28"]]) {
			expect(newTrackedEngine().evaluateExpression(`${a} - ${b}`).toNumber()).toBe(newTrackedEngine().evaluateExpression(`days between ${a} and ${b}`).toNumber());
		}
	});
});

describe("dateDifference", () => {
	test("ordinary: two dates are a signed count of days, singular for one", () => {
		const one = dateDifference(datetimeValue(day(2026, 12, 25), "date"), datetimeValue(day(2026, 12, 24), "date"), DATE_CALENDAR)!;
		expect([one.type, one.unit, one.toNumber()]).toEqual([ValueType.Uom, "day", 1]);
		const back = dateDifference(datetimeValue(day(2026, 1, 1), "date"), datetimeValue(day(2026, 12, 25), "date"), DATE_CALENDAR)!;
		expect([back.unit, back.toNumber()]).toEqual(["days", -358]);
	});

	test("boundary: the same day, a leap day, a clock change, and the ends of the calendar", () => {
		expect(dateDifference(datetimeValue(day(2026, 6, 1), "date"), datetimeValue(day(2026, 6, 1), "date"), DATE_CALENDAR)!.toNumber()).toBe(0);
		expect(dateDifference(datetimeValue(day(2024, 3, 1), "date"), datetimeValue(day(2024, 2, 28), "date"), DATE_CALENDAR)!.toNumber()).toBe(2);
		expect(dateDifference(datetimeValue(day(2024, 3, 31), "date"), datetimeValue(day(2024, 3, 30), "date"), DATE_CALENDAR)!.toNumber()).toBe(1);
		expect(dateDifference(datetimeValue(day(2024, 10, 27), "date"), datetimeValue(day(2024, 10, 26), "date"), DATE_CALENDAR)!.toNumber()).toBe(1);
		expect(dateDifference(datetimeValue(day(9999, 12, 31), "date"), datetimeValue(day(1, 1, 1), "date"), DATE_CALENDAR)!.toNumber()).toBe(3_652_058);
	});

	test("hostile: a side that is not a calendar date is left to the elapsed span", () => {
		const date = datetimeValue(day(2026, 12, 25), "date");
		expect(dateDifference(date, datetimeValue(day(2026, 12, 24), "datetime"), DATE_CALENDAR)).toBeNull();
		expect(dateDifference(datetimeValue(day(2026, 12, 24), "instant"), date, DATE_CALENDAR)).toBeNull();
		expect(dateDifference(date, datetimeValue(day(2026, 12, 24)), DATE_CALENDAR)).toBeNull();
		expect(dateDifference(date, numberValue(5), DATE_CALENDAR)).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: prototype words as names for the dates, markup beside them, long chains", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch } = expectHonestDocument(`${word} = 2026-12-25\n${word} - 2026-12-24\n2026-12-24 - ${word}`);
				expect(batch.slice(1)).toEqual(["= 1 day", "= -1 day"]);
			}
		});
		for (const line of fill("25/12/2026 - 24/12/2026 + X", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		expectHonestLine(Array.from({ length: 500 }, () => "(2026-12-25 - 2026-12-24)").join(" + "), { budgetMs: 10_000 });
	});

	test("realistic: dates on lines above, a total, a what-if and a check, both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("start = 01/03/2026\nend = 25/12/2026\nend - start\n(end - start) in weeks\nline 3 with start = 24/12/2026\ncheck end - start > 200 days");
		expect(batch.slice(2)).toEqual(["= 299 days", "= 42.71 weeks", "= 1 day", "= ✓"]);
		expect(incremental).toEqual(batch);
		const { batch: column } = expectHonestDocument("25/12/2026 - 24/12/2026\n2026-12-31 - 2026-12-25\ntotal above");
		expect(column).toEqual(["= 1 day", "= 6 days", "= 7 days"]);
	});

	test("edge: a day difference scaled by every numeric edge is a quantity or a refusal by name", () => {
		for (const line of fill("(2026-12-25 - 2026-12-24) * X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		expect(outcome("25/12/2026 / 24/12/2026")).toMatch(/^INVALID_DATETIME_OP: /);
		expect(outcome("29/02/2025 - 28/02/2025")).toMatch(/^[A-Z_]+: /);
		expect(outcome("01/01/2027 - 31/12/2026")).toBe("1 day");
	});
});
