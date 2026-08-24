/**
 * Moving a date by a duration: the arithmetic behind `<date> + N days`,
 * `+ N months`, `tomorrow`, and `next <weekday>`.
 *
 * Every one of these used to be a multiplication. A day was 86,400,000 ms, a
 * month 30 of those and a year 365, and the result was added to the date's
 * epoch milliseconds. That is wrong twice over:
 *
 * - A day is only 86,400,000 ms when no daylight-saving transition falls
 *   inside it. The day a zone springs forward is 23 hours long and the day it
 *   falls back is 25, so adding a flat day to a local midnight landed an hour
 *   either side of the next one, and an hour either side of midnight is a
 *   different calendar day. In Los Angeles `2024-11-03 + 1 day` answered
 *   November 3 again; in London `26/10/2024 + 2 days` answered October 27.
 * - A month is 28 to 31 days and a year is 365 or 366, so no fixed ratio can
 *   land on the date a person means. `2024-01-01 + 1 year` answered December
 *   31 2024 and `2024-01-31 + 1 month` answered March 1.
 *
 * The expectations below are calendar facts, worked out independently of the
 * engine. Where an expectation depends on the host zone (a date literal is
 * local midnight) it is built with the same `Date` constructor the production
 * code uses, so the file says the same thing in Sydney as in Los Angeles. That
 * matters more here than anywhere else in the suite: the whole class of bug
 * only appears in a zone that observes daylight saving, on two days a year, so
 * these have to be run under several zones to mean anything. They pass under
 * `America/Los_Angeles`, `Europe/London`, `Australia/Sydney` and `UTC`.
 */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

/** Local midnight for a calendar date, mirroring how a date literal is built. */
function localMidnight(year: number, month: number, day: number): number {
	return new Date(year, month - 1, day).getTime();
}

/** The local calendar date of an instant, as `[year, month, day]` with a
 *  1-based month, plus the wall-clock time, for assertions that want to say
 *  "the same time on the following day" without naming a zone. */
function localFields(epochMs: number): [number, number, number, number, number] {
	const d = new Date(epochMs);
	return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
}

const MS_PER_HOUR = 3_600_000;

describe("a day is a calendar day, not 86,400,000 milliseconds", () => {
	test("the day a zone falls back still has a tomorrow", () => {
		// November 3 2024 is 25 hours long in Los Angeles. Adding a flat day to
		// its midnight lands at 23:00 on the SAME date, which is what this
		// answered before.
		expect(evaluate("2024-11-03 + 1 day").toNumber()).toBe(localMidnight(2024, 11, 4));
		// October 27 2024 is the same day in London, reached two days out.
		expect(evaluate("26/10/2024 + 2 days").toNumber()).toBe(localMidnight(2024, 10, 28));
		// And April 7 2024 in Sydney.
		expect(evaluate("2024-04-06 + 1 day").toNumber()).toBe(localMidnight(2024, 4, 7));
	});

	test("the day a zone springs forward does not grow a time of day", () => {
		// March 10 2024 is 23 hours long in Los Angeles, so a flat day added to
		// March 10's midnight overshot into "March 11, 1:00:00 AM". A date-only
		// literal has no time of day and the answer must not invent one.
		const result = evaluate("2024-03-10 + 1 day").toNumber();
		expect(result).toBe(localMidnight(2024, 3, 11));
		expect(localFields(result)).toEqual([2024, 3, 11, 0, 0]);

		// The same date in Sydney, whose clocks go forward on October 6 2024.
		expect(evaluate("2024-10-05 + 1 day").toNumber()).toBe(localMidnight(2024, 10, 6));
	});

	test("subtracting a day is the day before, on both sides of a transition", () => {
		expect(evaluate("2024-11-04 - 1 day").toNumber()).toBe(localMidnight(2024, 11, 3));
		expect(evaluate("2024-03-11 - 1 day").toNumber()).toBe(localMidnight(2024, 3, 10));
		expect(evaluate("28/10/2024 - 2 days").toNumber()).toBe(localMidnight(2024, 10, 26));
	});

	test("every date in a whole year has the next one a day later", () => {
		// The sweep is the point: whichever two days of the year the host zone
		// changes its offset on, this walks over them. One engine for all 366
		// lines, the per-line work is a single expression.
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		try {
			const cursor = new Date(2024, 0, 1);
			let checked = 0;
			while (cursor.getFullYear() === 2024) {
				const [year, month, day] = [cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()];
				const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
				const next = new Date(cursor);
				next.setDate(next.getDate() + 1);

				const [value] = engine.evaluateExpression(`${iso} + 1 day`);
				expect([iso, value.toNumber()]).toEqual([iso, next.getTime()]);

				cursor.setDate(cursor.getDate() + 1);
				checked++;
			}
			expect(checked).toBe(366); // 2024 is a leap year
		} finally {
			engine.clear();
		}
	});

	test("a week and a fortnight are whole days too", () => {
		// A week spanning a transition is not 7 x 86,400,000 ms. October 31 plus
		// a week crosses Los Angeles's November 3 change.
		expect(evaluate("2024-10-31 + 1 week").toNumber()).toBe(localMidnight(2024, 11, 7));
		expect(evaluate("2024-10-20 + 1 fortnight").toNumber()).toBe(localMidnight(2024, 11, 3));
		expect(evaluate("2024-10-14 + 2 weeks").toNumber()).toBe(localMidnight(2024, 10, 28));
	});

	test("workday arithmetic, which was already right, still is", () => {
		// The pattern the fix above was taken from: `26/10/2024 + 1 workday`
		// was correct while `+ 1 day` was not, because it stepped the day field.
		expect(evaluate("26/10/2024 + 1 workday").toNumber()).toBe(localMidnight(2024, 10, 28));
		expect(evaluate("2024-11-01 + 1 workday").toNumber()).toBe(localMidnight(2024, 11, 4));
	});

	test("anything shorter than a day stays elapsed time, deliberately", () => {
		// "36 hours from now" means 36 hours of the clock ticking, transition
		// included, so these stay linear. In a zone where November 3 is 25 hours
		// long, a day's worth of hours does NOT reach the 4th, and that is the
		// right answer for a duration written in hours.
		expect(num("2024-11-03 + 24 hours")).toBe(localMidnight(2024, 11, 3) + 24 * MS_PER_HOUR);
		expect(num("2024-11-03 + 90 minutes")).toBe(localMidnight(2024, 11, 3) + 90 * 60_000);
		expect(num("2024-03-10 + 3600 seconds")).toBe(localMidnight(2024, 3, 10) + MS_PER_HOUR);
	});

	test("a fractional day is a calendar day and then the remainder", () => {
		const result = evaluate("2024-06-01 + 1.5 days").toNumber();
		expect(result).toBe(localMidnight(2024, 6, 2) + 12 * MS_PER_HOUR);
		expect(localFields(result)).toEqual([2024, 6, 2, 12, 0]);
	});
});

describe("months and years are calendar fields, not fixed lengths", () => {
	test("a year later is the same date a year on", () => {
		expect(evaluate("2024-01-01 + 1 year").toNumber()).toBe(localMidnight(2025, 1, 1));
		expect(evaluate("2023-06-15 + 1 year").toNumber()).toBe(localMidnight(2024, 6, 15));
		expect(evaluate("2024-01-01 - 1 year").toNumber()).toBe(localMidnight(2023, 1, 1));
	});

	test("and does not drift when several are added at once", () => {
		// The old fixed 365-day year lost a day per leap year, so the error grew
		// with the span: ten years out it was three days short.
		expect(evaluate("2024-01-01 + 10 years").toNumber()).toBe(localMidnight(2034, 1, 1));
		expect(evaluate("2000-01-01 + 100 years").toNumber()).toBe(localMidnight(2100, 1, 1));
		expect(evaluate("2024-01-01 + 1 decade").toNumber()).toBe(localMidnight(2034, 1, 1));
	});

	test("the leap day clamps to February 28 in a common year", () => {
		// February 29 is the one date with no counterpart a year later.
		expect(evaluate("2024-02-29 + 1 year").toNumber()).toBe(localMidnight(2025, 2, 28));
		expect(evaluate("2024-02-29 + 4 years").toNumber()).toBe(localMidnight(2028, 2, 29));
	});

	test("a month later is the same day of the next month", () => {
		expect(evaluate("2024-01-15 + 1 month").toNumber()).toBe(localMidnight(2024, 2, 15));
		expect(evaluate("2024-01-15 - 1 month").toNumber()).toBe(localMidnight(2023, 12, 15));
		expect(evaluate("2024-12-31 + 1 month").toNumber()).toBe(localMidnight(2025, 1, 31));
	});

	test("a day of the month the next month does not have clamps to its last", () => {
		// January 31 plus a month is February 29 in 2024 and February 28 in
		// 2023, and is never March. Rolling over instead is what "+ 1 month"
		// did, which put the answer in the month AFTER the one asked for.
		expect(evaluate("2024-01-31 + 1 month").toNumber()).toBe(localMidnight(2024, 2, 29));
		expect(evaluate("2023-01-31 + 1 month").toNumber()).toBe(localMidnight(2023, 2, 28));
		expect(evaluate("2024-05-31 + 1 month").toNumber()).toBe(localMidnight(2024, 6, 30));
		expect(evaluate("2024-03-31 - 1 month").toNumber()).toBe(localMidnight(2024, 2, 29));
		expect(evaluate("2024-10-31 - 1 month").toNumber()).toBe(localMidnight(2024, 9, 30));
	});

	test("the clamp applies once, to where the shift lands, not step by step", () => {
		// January 31 plus two months is March 31. Clamping to February first and
		// then moving on would give March 29.
		expect(evaluate("2024-01-31 + 2 months").toNumber()).toBe(localMidnight(2024, 3, 31));
		expect(evaluate("2024-01-31 + 12 months").toNumber()).toBe(localMidnight(2025, 1, 31));
	});

	test("more than twelve months rolls the year over", () => {
		expect(evaluate("2024-01-01 + 18 months").toNumber()).toBe(localMidnight(2025, 7, 1));
		expect(evaluate("2024-01-01 - 13 months").toNumber()).toBe(localMidnight(2022, 12, 1));
	});

	test("a month across a transition keeps local midnight", () => {
		// Both spans contain a change of offset somewhere in the world:
		// October 27 in London, November 3 in Los Angeles, October 6 in Sydney.
		expect(evaluate("2024-10-15 + 1 month").toNumber()).toBe(localMidnight(2024, 11, 15));
		expect(evaluate("2024-09-20 + 1 month").toNumber()).toBe(localMidnight(2024, 10, 20));
		expect(localFields(evaluate("2024-10-15 + 1 month").toNumber())).toEqual([2024, 11, 15, 0, 0]);
	});

	test("the unit table's fixed month and year are untouched, because duration maths needs them", () => {
		// The fix is in the date path only. A duration on its own is still a
		// fixed length, which is what `convert` and every rate calculation in
		// the engine reads out of the same table.
		expect(num("2 years in days")).toBe(730);
		expect(num("1 month in days")).toBe(30);
		expect(num("1 year in days")).toBe(365);
		expect(num("6 months in weeks")).toBeCloseTo(180 / 7, 9);
	});
});

describe("`tomorrow`, `yesterday` and `next <weekday>` move by the calendar too", () => {
	// These are relative to the clock, so the system time is pinned to instants
	// that are just after midnight on a transition day somewhere. That is the
	// only window where the old millisecond arithmetic named the wrong DAY
	// rather than merely the wrong hour: from 00:30 on a 25-hour day, a flat
	// 86,400,000 ms lands at 23:30 on the same date.
	const TRANSITION_INSTANTS: ReadonlyArray<readonly [string, string]> = [
		["Los Angeles falls back", "2024-11-03T07:30:00Z"],
		["Los Angeles springs forward", "2024-03-10T08:30:00Z"],
		["London falls back", "2024-10-26T23:30:00Z"],
		["London springs forward", "2024-03-30T23:30:00Z"],
		["Sydney falls back", "2024-04-06T13:30:00Z"],
		["Sydney springs forward", "2024-10-05T13:30:00Z"],
	];

	afterEach(() => {
		jest.useRealTimers();
	});

	function at(instant: string): ExpressionEngine {
		jest.useFakeTimers();
		jest.setSystemTime(new Date(instant));
		return newTrackedEngine();
	}

	test.each(TRANSITION_INSTANTS)("tomorrow is the next date at the same time (%s)", (_label, instant) => {
		const engine = at(instant);
		const now = new Date();
		const expected = new Date(now);
		expected.setDate(expected.getDate() + 1);

		const [value] = engine.evaluateExpression("tomorrow");
		expect(value.type).toBe(ValueType.Datetime);
		expect(value.toNumber()).toBe(expected.getTime());
		expect(localFields(value.toNumber()).slice(0, 3)).toEqual(localFields(expected.getTime()).slice(0, 3));
	});

	test.each(TRANSITION_INSTANTS)("yesterday is the previous date at the same time (%s)", (_label, instant) => {
		const engine = at(instant);
		const now = new Date();
		const expected = new Date(now);
		expected.setDate(expected.getDate() - 1);

		const [value] = engine.evaluateExpression("yesterday");
		expect(value.toNumber()).toBe(expected.getTime());
	});

	test("`next <weekday>` lands on that weekday even when the week is not 7 x 24 hours", () => {
		// A week starting Monday October 28 2024 contains Los Angeles's fall
		// back on November 3, so it is 169 hours long. Adding 7 x 86,400,000 ms
		// from just after midnight landed at 23:30 on the Sunday.
		const engine = at("2024-10-28T07:30:00Z");
		const now = Date.now();

		const [value] = engine.evaluateExpression("next monday");
		const landed = new Date(value.toNumber());
		expect(landed.getDay()).toBe(1); // Monday
		expect(value.toNumber()).toBeGreaterThan(now);
		expect(landed.getHours()).toBe(new Date(now).getHours());
		expect(landed.getMinutes()).toBe(new Date(now).getMinutes());
	});

	test("`last <weekday>` does the same going backwards", () => {
		const engine = at("2024-11-04T08:30:00Z");
		const now = Date.now();

		const [value] = engine.evaluateExpression("last monday");
		const landed = new Date(value.toNumber());
		expect(landed.getDay()).toBe(1);
		expect(value.toNumber()).toBeLessThan(now);
		expect(landed.getHours()).toBe(new Date(now).getHours());
	});
});

describe("colon-separated numbers that are not a time", () => {
	// A clock time the normalizer accepts is fused during lexing and never
	// leaves a COLON token behind. One it refuses does, and that COLON used to
	// be read as a label separator, so the line was answered with whatever
	// stood to the right of it: "24:00" came back as 0 and "9:60" as 60. Both
	// are ordinary things to type, and a silent number is the worst possible
	// response to either.
	test("an hour no clock shows is refused rather than answered", () => {
		expect(() => evaluate("24:00")).toThrow(/not a valid time/);
		expect(() => evaluate("25:00")).toThrow(/not a valid time/);
		expect(() => evaluate("99:00")).toThrow(/not a valid time/);
	});

	test("and so is a minute no clock shows", () => {
		expect(() => evaluate("9:60")).toThrow(/not a valid time/);
		expect(() => evaluate("10:70")).toThrow(/not a valid time/);
		expect(() => evaluate("0:99")).toThrow(/not a valid time/);
	});

	test("the message names the literal that was refused, not the fragment after the colon", () => {
		expect(() => evaluate("24:00")).toThrow(/"24:00"/);
		expect(() => evaluate("100:5")).toThrow(/"100:5"/);
	});

	test("an invalid time inside a larger expression is refused as well", () => {
		// The old fallback compiled only what followed the colon, so this
		// answered 1 plus whatever the minute field happened to be.
		expect(() => evaluate("24:00 + 1")).toThrow(/not a valid time/);
		expect(() => evaluate("9:60 - 30 minutes")).toThrow(/not a valid time/);
	});

	test("the times that are real still work exactly as before", () => {
		expect(evaluate("23:59").type).toBe(ValueType.Datetime);
		expect(evaluate("0:00").type).toBe(ValueType.Datetime);
		expect(evaluate("12:00am").type).toBe(ValueType.Datetime);
		expect(num("03:04:05")).toBe(3 * 3600 + 4 * 60 + 5);
		// A lap time is allowed hours a clock is not, and is a duration rather
		// than a time of day, so it is fused by its own rule and unaffected.
		expect(num("99:59:59")).toBe(99 * 3600 + 59 * 60 + 59);
		expect(num("25:00:00")).toBe(25 * 3600);
	});

	test("and so do labelled lines, which is what the fallback is for", () => {
		expect(num("pi approximation: 355/113")).toBeCloseTo(Math.PI, 4);
		expect(num("total: 5 + 3")).toBe(8);
		expect(num("label one: label two: 5 + 3")).toBe(8);
		// The guard only fires when there is nothing BUT numbers in front of
		// the colon, so a label with a word in it is untouched even when a
		// clock time follows.
		const engine = newTrackedEngine();
		const [labelled] = engine.evaluateExpression("meeting notes: 9:30 + 5");
		const [plain] = engine.evaluateExpression("9:30 + 5");
		expect(labelled.value).toBe(plain.value);
	});
});

describe("a datetime on the wrong side of an operator", () => {
	test("subtracting a date from a number is refused, not answered with its epoch", () => {
		// "100 - 12-25-2023" answered -1,703,462,399,900: the date's epoch
		// milliseconds, negated, with 100 taken off. ADD has refused the
		// mirror-image case since it was written; SUB had no guard at all.
		const value = evaluate("100 - 12-25-2023");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("INVALID_DATETIME_OP");
	});

	test("whatever the left-hand quantity is", () => {
		expect(evaluate("5 kg - 12-25-2023").type).toBe(ValueType.Error);
		expect(evaluate("1 day - 12-25-2023").type).toBe(ValueType.Error);
	});

	test("adding two datetimes is still refused", () => {
		const value = evaluate("12-25-2023 + 12-25-2023");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("INVALID_DATETIME_OP");
	});

	test("but addition commutes, so a date on the right is still a date", () => {
		// This fell through to ordinary numeric arithmetic and produced
		// "1,703,491,200,001 days", the epoch wearing a unit.
		expect(evaluate("1 day + 12-25-2023").toNumber()).toBe(localMidnight(2023, 12, 26));
		expect(evaluate("1 month + 12-25-2023").toNumber()).toBe(localMidnight(2024, 1, 25));
		expect(evaluate("100 + 12-25-2023").toNumber()).toBe(localMidnight(2023, 12, 25) + 100);
	});

	test("a date minus a date is still a duration, and a date minus a number still a date", () => {
		const difference = evaluate("2023-12-25 - 2023-12-24");
		expect(difference.type).toBe(ValueType.Uom);
		expect(difference.unit).toBe("ms");
		expect(evaluate("12-25-2023 - 100").type).toBe(ValueType.Datetime);
	});
});
