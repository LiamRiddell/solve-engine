/**
 * The weekend/holiday skipping logic in isolation.
 *
 * `vm/BusinessDays.ts` is the pure core the workday grammar walks: no `Value`,
 * no engine, so the skip rules can be pinned exactly and the calendar cases a
 * wrong implementation gets wrong (landing on a Saturday, a holiday, a month
 * boundary) are cheap to enumerate here rather than only through a whole
 * expression. The end-to-end grammar and the holiday calendar are exercised
 * through the engine in `__tests__/hardening/DateTimeWorkdays.spec.ts`.
 */

import { describe, expect, test } from "@jest/globals";
import {
	isWeekend,
	isBusinessDay,
	addBusinessDays,
	countBusinessDaysBetween,
} from "@solve-js/vm/BusinessDays";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

/** Local midnight of a calendar date, the granularity the walk works in. */
const ms = (year: number, month: number, day: number) => new Date(year, month - 1, day).getTime();

/** A holiday predicate over a fixed set of `YYYY-M-D` calendar days. */
function holidaysFrom(...days: Array<[number, number, number]>): (epochMs: number) => boolean {
	const set = new Set(days.map(([y, m, d]) => ms(y, m, d)));
	return (epochMs: number) => {
		const date = new Date(epochMs);
		return set.has(ms(date.getFullYear(), date.getMonth() + 1, date.getDate()));
	};
}

const NO_CAP = 1_000_000;

describe("isWeekend", () => {
	test("Saturday and Sunday are the weekend", () => {
		// March 30 2024 was a Saturday, March 31 a Sunday.
		expect(isWeekend(ms(2024, 3, 30), DATE_CALENDAR)).toBe(true);
		expect(isWeekend(ms(2024, 3, 31), DATE_CALENDAR)).toBe(true);
	});

	test("Monday through Friday are not", () => {
		// April 1 2024 (Mon) through April 5 (Fri).
		for (let day = 1; day <= 5; day++) {
			expect(isWeekend(ms(2024, 4, day), DATE_CALENDAR)).toBe(false);
		}
	});
});

describe("isBusinessDay", () => {
	test("a weekday with no calendar is a business day", () => {
		expect(isBusinessDay(ms(2024, 4, 1), undefined, DATE_CALENDAR)).toBe(true);
	});

	test("a weekday the calendar marks a holiday is not", () => {
		const isHoliday = holidaysFrom([2024, 12, 25]);
		expect(isBusinessDay(ms(2024, 12, 25), isHoliday, DATE_CALENDAR)).toBe(false);
		// Christmas Day 2024 was a Wednesday, a weekday, so only the calendar
		// takes it out.
		expect(isBusinessDay(ms(2024, 12, 25), undefined, DATE_CALENDAR)).toBe(true);
	});

	test("a weekend is never a business day, holiday calendar or not", () => {
		const isHoliday = holidaysFrom([2024, 3, 30]);
		expect(isBusinessDay(ms(2024, 3, 30), undefined, DATE_CALENDAR)).toBe(false);
		expect(isBusinessDay(ms(2024, 3, 30), isHoliday, DATE_CALENDAR)).toBe(false);
	});
});

describe("addBusinessDays skips weekends", () => {
	test("Friday plus one lands on Monday", () => {
		// March 29 2024 was a Friday.
		expect(addBusinessDays(ms(2024, 3, 29), 1, undefined, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 4, 1));
	});

	test("a full working week lands a calendar week on", () => {
		expect(addBusinessDays(ms(2024, 3, 29), 5, undefined, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 4, 5));
	});

	test("zero is the identity, even starting on a weekend", () => {
		expect(addBusinessDays(ms(2024, 3, 29), 0, undefined, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 3, 29));
		expect(addBusinessDays(ms(2024, 3, 30), 0, undefined, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 3, 30));
	});

	test("negative retreats over the weekend the same way", () => {
		// Monday April 1 minus one working day is the Friday before.
		expect(addBusinessDays(ms(2024, 4, 1), -1, undefined, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 3, 29));
	});

	test("a fractional count is truncated to whole working days", () => {
		expect(addBusinessDays(ms(2024, 3, 29), 1.9, undefined, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 4, 1));
	});
});

describe("addBusinessDays skips holidays too", () => {
	test("Christmas and Boxing Day are stepped over", () => {
		// Tuesday Dec 24 2024, with the 25th (Wed) and 26th (Thu) marked, so the
		// next working day is Friday the 27th.
		const isHoliday = holidaysFrom([2024, 12, 25], [2024, 12, 26]);
		expect(addBusinessDays(ms(2024, 12, 24), 1, isHoliday, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 12, 27));
	});

	test("the same span with no calendar stops at the 25th", () => {
		expect(addBusinessDays(ms(2024, 12, 24), 1, undefined, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 12, 25));
	});

	test("a holiday on the landing day pushes one more forward", () => {
		// Friday Dec 20 + 1 normally lands Monday Dec 23; marking the 23rd moves
		// it to Tuesday the 24th.
		const isHoliday = holidaysFrom([2024, 12, 23]);
		expect(addBusinessDays(ms(2024, 12, 20), 1, isHoliday, NO_CAP, DATE_CALENDAR)).toBe(ms(2024, 12, 24));
	});
});

describe("addBusinessDays respects the step cap", () => {
	test("a calendar that marks every day a holiday returns null rather than looping", () => {
		const everyDay = () => true;
		expect(addBusinessDays(ms(2024, 1, 1), 1, everyDay, 500, DATE_CALENDAR)).toBeNull();
	});

	test("an offset needing more calendar days than the cap allows returns null", () => {
		// One working day is at least one calendar step, so a cap of zero can
		// never reach it.
		expect(addBusinessDays(ms(2024, 3, 29), 1, undefined, 0, DATE_CALENDAR)).toBeNull();
	});

	test("an in-cap offset still returns the date", () => {
		expect(addBusinessDays(ms(2024, 3, 29), 1, undefined, 3, DATE_CALENDAR)).toBe(ms(2024, 4, 1));
	});
});

describe("countBusinessDaysBetween is inclusive and order-independent", () => {
	test("every working day in January 2024, both ends counted", () => {
		// Jan 1 2024 (Mon) through Jan 31 (Wed): 23 weekdays.
		expect(countBusinessDaysBetween(ms(2024, 1, 1), ms(2024, 1, 31), undefined, NO_CAP, DATE_CALENDAR)).toBe(23);
	});

	test("the two dates may be written in either order", () => {
		expect(countBusinessDaysBetween(ms(2024, 1, 31), ms(2024, 1, 1), undefined, NO_CAP, DATE_CALENDAR)).toBe(23);
	});

	test("a single weekday is one, a single weekend day is zero", () => {
		expect(countBusinessDaysBetween(ms(2024, 4, 1), ms(2024, 4, 1), undefined, NO_CAP, DATE_CALENDAR)).toBe(1);
		expect(countBusinessDaysBetween(ms(2024, 3, 30), ms(2024, 3, 30), undefined, NO_CAP, DATE_CALENDAR)).toBe(0);
	});

	test("a single working week is five", () => {
		// Monday April 1 through Sunday April 7 2024.
		expect(countBusinessDaysBetween(ms(2024, 4, 1), ms(2024, 4, 7), undefined, NO_CAP, DATE_CALENDAR)).toBe(5);
	});

	test("holidays inside the window are not counted", () => {
		// Mon Dec 23 through Fri Dec 27 2024 is three weekdays after removing the
		// 25th and 26th (23, 24, 27).
		const isHoliday = holidaysFrom([2024, 12, 25], [2024, 12, 26]);
		expect(countBusinessDaysBetween(ms(2024, 12, 23), ms(2024, 12, 27), isHoliday, NO_CAP, DATE_CALENDAR)).toBe(3);
		expect(countBusinessDaysBetween(ms(2024, 12, 23), ms(2024, 12, 27), undefined, NO_CAP, DATE_CALENDAR)).toBe(5);
	});

	test("the time of day on either endpoint does not tip the count", () => {
		const startOfDay = ms(2024, 1, 1);
		const lateInDay = startOfDay + 23 * 60 * 60 * 1000;
		expect(countBusinessDaysBetween(lateInDay, ms(2024, 1, 31), undefined, NO_CAP, DATE_CALENDAR)).toBe(23);
	});

	test("a span wider than the cap returns null", () => {
		expect(countBusinessDaysBetween(ms(2024, 1, 1), ms(2024, 1, 31), undefined, 5, DATE_CALENDAR)).toBeNull();
	});
});
