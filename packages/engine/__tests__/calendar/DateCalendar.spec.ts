/**
 * The `Date` calendar backend, method by method, against the `Date` code each
 * one replaced.
 *
 * `calendar/DateCalendar.ts` is the existing date code moved behind the
 * `CalendarBackend` interface, so the property that matters is that every
 * method answers exactly what the inline `Date` expression it replaced did.
 * Each case pairs the method with that expression as its oracle, which holds
 * in whatever zone the suite runs in, and adds a few fixed expectations that
 * no zone can move: leap years, named zones with no daylight saving, and the
 * ISO strings the ECMAScript grammar pins.
 *
 * The daylight-saving cases use the transition instants the arithmetic suite
 * pins (`hardening/DateTimeArithmetic.spec.ts`): stepping a day or a month
 * across one of them is exactly where an addition of milliseconds would land
 * an hour off, and where the field step has to hold the wall-clock time.
 */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { DateCalendar, DATE_CALENDAR, calendarOf } from "@solve-js/calendar/DateCalendar";

const calendar = new DateCalendar();

/** Local midnight, the instant a date literal evaluates to. */
const midnight = (year: number, month: number, day: number) => new Date(year, month - 1, day).getTime();

/** Instants just after local midnight on a day that contains a transition somewhere. */
const TRANSITION_INSTANTS = [
	Date.parse("2024-11-03T07:30:00Z"), // Los Angeles falls back
	Date.parse("2024-03-10T08:30:00Z"), // Los Angeles springs forward
	Date.parse("2024-10-26T23:30:00Z"), // London falls back
	Date.parse("2024-03-30T23:30:00Z"), // London springs forward
	Date.parse("2024-04-06T13:30:00Z"), // Sydney falls back
	Date.parse("2024-10-05T13:30:00Z"), // Sydney springs forward
	midnight(2024, 6, 10),
	midnight(2024, 1, 15),
	Date.UTC(2024, 1, 29, 12, 34, 56, 789),
];

describe("the default backend", () => {
	test("DATE_CALENDAR is a DateCalendar and calendarOf falls back to it", () => {
		expect(DATE_CALENDAR).toBeInstanceOf(DateCalendar);
		expect(calendarOf(undefined)).toBe(DATE_CALENDAR);
		expect(calendarOf({})).toBe(DATE_CALENDAR);
		const other = new DateCalendar();
		expect(calendarOf({ calendar: other })).toBe(other);
	});
});

describe("now", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	test("reads Date.now, so a pinned clock pins it too", () => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date("2026-08-26T10:00:00Z"));
		expect(calendar.now()).toBe(Date.parse("2026-08-26T10:00:00Z"));
	});
});

describe("fields", () => {
	test.each(TRANSITION_INSTANTS)("match the Date getters at %d", (instant) => {
		const d = new Date(instant);
		expect(calendar.fields(instant)).toEqual({
			year: d.getFullYear(),
			month0: d.getMonth(),
			day: d.getDate(),
			weekday: d.getDay(),
			hour: d.getHours(),
			minute: d.getMinutes(),
			second: d.getSeconds(),
			millisecond: d.getMilliseconds(),
		});
	});

	test("a local midnight reads back as that date with a zero time", () => {
		expect(calendar.fields(midnight(2024, 2, 29))).toEqual({
			year: 2024, month0: 1, day: 29, weekday: 4, hour: 0, minute: 0, second: 0, millisecond: 0,
		});
		// 0 is Sunday, 6 is Saturday: 30 March 2024 was a Saturday.
		expect(calendar.fields(midnight(2024, 3, 30)).weekday).toBe(6);
		expect(calendar.fields(midnight(2024, 3, 31)).weekday).toBe(0);
	});

	test("an unrepresentable instant reads as NaN in every field", () => {
		const f = calendar.fields(Number.NaN);
		expect(Object.values(f).every(Number.isNaN)).toBe(true);
		expect(Object.values(calendar.fields(8.7e15)).every(Number.isNaN)).toBe(true);
	});
});

describe("localMidnight", () => {
	test("is the Date constructor's local midnight", () => {
		expect(calendar.localMidnight(2024, 1, 29)).toBe(midnight(2024, 2, 29));
		expect(calendar.localMidnight(1990, 5, 15)).toBe(midnight(1990, 6, 15));
	});

	test("overflows the way Date does, which is what the rollover check relies on", () => {
		// Month 12 is January of the next year; day 0 is the last day of the
		// month before.
		expect(calendar.localMidnight(2024, 12, 1)).toBe(midnight(2025, 1, 1));
		expect(calendar.localMidnight(2024, 2, 0)).toBe(midnight(2024, 2, 29));
		// A 30 February rolls into March, so its fields no longer say February.
		const rolled = calendar.fields(calendar.localMidnight(2023, 1, 30));
		expect([rolled.month0, rolled.day]).toEqual([2, 2]);
	});

	test("answers NaN, never throws, past the range Date represents", () => {
		expect(calendar.localMidnight(300000, 0, 1)).toBeNaN();
	});
});

describe("localWallClock", () => {
	test("names a clock reading on the date, not an elapsed span", () => {
		const nine = calendar.localWallClock(2024, 5, 10, 9 * 60);
		expect(calendar.fields(nine)).toMatchObject({ year: 2024, month0: 5, day: 10, hour: 9, minute: 0 });
		const lateAfternoon = calendar.localWallClock(2024, 5, 10, 16 * 60 + 45);
		expect(calendar.fields(lateAfternoon)).toMatchObject({ hour: 16, minute: 45 });
	});

	test.each(TRANSITION_INSTANTS)("matches setMinutes on a midnight anchor at %d", (instant) => {
		const d = new Date(instant);
		for (const minutes of [0, 9 * 60, 12 * 60 + 30, 23 * 60 + 59]) {
			const anchored = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
			anchored.setMinutes(minutes);
			expect(calendar.localWallClock(d.getFullYear(), d.getMonth(), d.getDate(), minutes)).toBe(anchored.getTime());
		}
	});
});

describe("addDays", () => {
	test.each(TRANSITION_INSTANTS)("steps the day field like setDate at %d", (instant) => {
		for (const days of [1, -1, 7, 30, -365]) {
			const d = new Date(instant);
			d.setDate(d.getDate() + days);
			expect(calendar.addDays(instant, days)).toBe(d.getTime());
		}
	});

	test("holds the wall-clock time across a day that contains a transition", () => {
		// Whatever the host zone, the fields of the landing instant carry the
		// same hour and minute the start had; only the date moves.
		for (const instant of TRANSITION_INSTANTS) {
			const before = calendar.fields(instant);
			const after = calendar.fields(calendar.addDays(instant, 1));
			expect([after.hour, after.minute]).toEqual([before.hour, before.minute]);
		}
	});

	test("answers NaN, never throws, when the step leaves the representable range", () => {
		expect(calendar.addDays(midnight(2024, 1, 1), 1e9)).toBeNaN();
	});
});

describe("addMonths", () => {
	test("clamps the day to the month landed in", () => {
		expect(calendar.addMonths(midnight(2024, 1, 31), 1)).toBe(midnight(2024, 2, 29));
		expect(calendar.addMonths(midnight(2023, 1, 31), 1)).toBe(midnight(2023, 2, 28));
		expect(calendar.addMonths(midnight(2024, 3, 31), -1)).toBe(midnight(2024, 2, 29));
		expect(calendar.addMonths(midnight(2024, 1, 31), 3)).toBe(midnight(2024, 4, 30));
		expect(calendar.addMonths(midnight(2024, 1, 15), 12)).toBe(midnight(2025, 1, 15));
	});

	test("holds the wall-clock time", () => {
		const start = calendar.localWallClock(2024, 0, 31, 10 * 60 + 30);
		expect(calendar.fields(calendar.addMonths(start, 1))).toMatchObject({ year: 2024, month0: 1, day: 29, hour: 10, minute: 30 });
	});

	test.each(TRANSITION_INSTANTS)("matches the park-on-the-first setMonth sequence at %d", (instant) => {
		for (const months of [1, -1, 13, -25]) {
			const d = new Date(instant);
			const dayOfMonth = d.getDate();
			d.setDate(1);
			d.setMonth(d.getMonth() + months);
			d.setDate(Math.min(dayOfMonth, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
			expect(calendar.addMonths(instant, months)).toBe(d.getTime());
		}
	});
});

describe("utcOffsetMinutes", () => {
	test.each(TRANSITION_INSTANTS)("is the negated getTimezoneOffset at %d", (instant) => {
		// Subtracted from zero, as the backend does it, so a zero offset is 0
		// rather than the -0 a bare negation produces; the same number otherwise.
		expect(calendar.utcOffsetMinutes(instant)).toBe(0 - new Date(instant).getTimezoneOffset());
	});
});

describe("parseIso8601", () => {
	test("a date-only string is UTC midnight", () => {
		expect(calendar.parseIso8601("2019-04-01")).toBe(Date.UTC(2019, 3, 1));
	});

	test("an offset or Z is honoured", () => {
		expect(calendar.parseIso8601("2019-04-01T15:30:00Z")).toBe(Date.UTC(2019, 3, 1, 15, 30));
		expect(calendar.parseIso8601("2019-04-01T15:30:00+11:00")).toBe(Date.UTC(2019, 3, 1, 4, 30));
		expect(calendar.parseIso8601("2019-04-01T15:30:00.250-05:00")).toBe(Date.UTC(2019, 3, 1, 20, 30, 0, 250));
	});

	test("an offset-less date-time is local time", () => {
		expect(calendar.parseIso8601("2019-04-01T15:30:00")).toBe(new Date(2019, 3, 1, 15, 30).getTime());
	});

	test("anything else is NaN, never a throw", () => {
		expect(calendar.parseIso8601("not a date")).toBeNaN();
		expect(calendar.parseIso8601("2019-04-01T25:00:00")).toBeNaN();
	});
});

describe("the display forms", () => {
	const tenthOfMarch = midnight(2026, 3, 10);
	const morning = calendar.localWallClock(2026, 2, 10, 9 * 60 + 5) + 7000;

	test("formatLongDate spells the date out in the locale", () => {
		expect(calendar.formatLongDate(tenthOfMarch, "en")).toBe("Tuesday, March 10, 2026");
		expect(calendar.formatLongDate(tenthOfMarch, "de")).toBe(
			new Date(tenthOfMarch).toLocaleDateString("de", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
		);
	});

	test("formatTimeOfDay is toLocaleTimeString in the locale", () => {
		expect(calendar.formatTimeOfDay(morning, "en")).toBe(new Date(morning).toLocaleTimeString("en"));
		expect(calendar.formatTimeOfDay(morning, "en")).toContain("9:05:07");
	});
});

describe("named zones", () => {
	// Zones with no daylight saving, so the offsets are constants.
	test("zoneOffsetMinutes is positive ahead of UTC and handles the non-whole-hour offsets", () => {
		const instant = Date.UTC(2024, 6, 1, 12);
		expect(calendar.zoneOffsetMinutes("UTC", instant)).toBe(0);
		expect(calendar.zoneOffsetMinutes("Asia/Tokyo", instant)).toBe(540);
		expect(calendar.zoneOffsetMinutes("Asia/Kolkata", instant)).toBe(330);
		expect(calendar.zoneOffsetMinutes("Asia/Kathmandu", instant)).toBe(345);
		expect(calendar.zoneOffsetMinutes("Pacific/Honolulu", instant)).toBe(-600);
	});

	test("zoneOffsetMinutes follows a zone's daylight saving at the instant asked", () => {
		expect(calendar.zoneOffsetMinutes("America/New_York", Date.UTC(2024, 6, 1, 12))).toBe(-240);
		expect(calendar.zoneOffsetMinutes("America/New_York", Date.UTC(2024, 0, 15, 12))).toBe(-300);
		expect(calendar.zoneOffsetMinutes("Pacific/Auckland", Date.UTC(2024, 0, 15, 12))).toBe(780);
		expect(calendar.zoneOffsetMinutes("Pacific/Auckland", Date.UTC(2024, 6, 1, 12))).toBe(720);
	});

	test("fieldsInZone reads the zone's own calendar, crossing the date line where it must", () => {
		const instant = Date.UTC(2024, 0, 1, 20, 30, 15);
		expect(calendar.fieldsInZone("Asia/Tokyo", instant)).toEqual({ year: 2024, month0: 0, day: 2, hour: 5, minute: 30, second: 15 });
		expect(calendar.fieldsInZone("Pacific/Honolulu", instant)).toEqual({ year: 2024, month0: 0, day: 1, hour: 10, minute: 30, second: 15 });
		// Midnight is hour 0, never 24.
		expect(calendar.fieldsInZone("UTC", Date.UTC(2024, 0, 1, 0, 0, 0)).hour).toBe(0);
	});

	test("formatTimeInZone and formatDateInZone answer in the en-US style the timezone forms use", () => {
		const instant = Date.UTC(2024, 0, 1, 16, 0);
		expect(calendar.formatTimeInZone("Asia/Tokyo", instant)).toBe("1:00 AM");
		expect(calendar.formatDateInZone("Asia/Tokyo", instant)).toBe("January 2, 2024");
		expect(calendar.formatTimeInZone("UTC", instant)).toBe("4:00 PM");
		expect(calendar.formatDateInZone("UTC", instant)).toBe("January 1, 2024");
	});

	// The contract the four zone methods state, and the oracle a second
	// backend is measured against: an unknown zone or an unrepresentable
	// instant is a fault the caller sees, never a NaN or an empty string.
	test("an unknown zone throws the runtime's RangeError from every zone method", () => {
		const instant = Date.UTC(2024, 0, 1, 16, 0);
		expect(() => calendar.zoneOffsetMinutes("Mars/Olympus", instant)).toThrow(RangeError);
		expect(() => calendar.fieldsInZone("Mars/Olympus", instant)).toThrow(RangeError);
		expect(() => calendar.formatTimeInZone("Mars/Olympus", instant)).toThrow(RangeError);
		expect(() => calendar.formatDateInZone("Mars/Olympus", instant)).toThrow(RangeError);
	});

	test("an unrepresentable instant throws the runtime's RangeError from every zone method", () => {
		expect(() => calendar.zoneOffsetMinutes("UTC", Number.NaN)).toThrow(RangeError);
		expect(() => calendar.fieldsInZone("UTC", Number.NaN)).toThrow(RangeError);
		expect(() => calendar.formatTimeInZone("UTC", Number.NaN)).toThrow(RangeError);
		expect(() => calendar.formatDateInZone("UTC", 8.7e15)).toThrow(RangeError);
	});

	test("a zone read many times answers the same each time", () => {
		// The zone reads go through one shared Intl helper; repeating a read
		// must not change an answer.
		const instant = Date.UTC(2024, 6, 1, 12);
		const first = calendar.fieldsInZone("Asia/Kathmandu", instant);
		for (let i = 0; i < 5; i++) expect(calendar.fieldsInZone("Asia/Kathmandu", instant)).toEqual(first);
		expect(calendar.zoneOffsetMinutes("Asia/Kathmandu", instant)).toBe(345);
	});
});
