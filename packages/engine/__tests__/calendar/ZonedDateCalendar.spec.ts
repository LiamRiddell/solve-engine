/**
 * `dateCalendarInZone`: the `Date` backend computing in a named zone rather
 * than the host process's.
 *
 * What was missing: `CalendarBackend`'s contract says "local" means the
 * backend's own zone, and the only backend that carried a zone of its own was
 * the `Temporal` one. `typeof globalThis.Temporal` is `undefined` on Node 24
 * and in Safari, so "pass a `Temporal` backend" put naming a zone out of reach
 * for most hosts. This factory gives the capability on the backend everyone
 * already has, and there is deliberately no `date.zone` config field beside it:
 * two owners for one fact is how they drift apart.
 *
 * What is pinned here:
 *
 * - Every zone-dependent method answers in the zone it was given, across both
 *   2026 London transitions (a 23-hour day and a 25-hour one), a
 *   southern-hemisphere zone whose transitions run the other way, a zone whose
 *   offset is not a whole number of hours (Asia/Kolkata, UTC+5:30), and a zone
 *   with no daylight saving at all.
 * - A day step holds the wall clock across a transition rather than adding
 *   twenty-four hours of milliseconds, which is the whole reason a backend
 *   answers this rather than arithmetic.
 * - A zone this runtime does not know is refused at construction, not per line.
 * - The default `DATE_CALENDAR` is untouched: the class with no zone is the
 *   same code it always was, so the singleton every engine shares still reads
 *   the process's zone.
 */
import { describe, expect, test } from "@jest/globals";
import { DATE_CALENDAR, DateCalendar, dateCalendarInZone } from "@solve-js/calendar/DateCalendar";

/** The zone the host process itself reads, which the default backend computes in. */
const HOST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The 2026 London transitions, and their southern-hemisphere counterpart. */
const SPRING_FORWARD_LONDON = Date.parse("2026-03-29T01:00:00Z");
const FALL_BACK_LONDON = Date.parse("2026-10-25T01:00:00Z");

describe("the zone decides what local means", () => {
	const tokyo = dateCalendarInZone("Asia/Tokyo");

	test("fields read the named zone, not the process's", () => {
		// 15:00 UTC on 2 April is already the 3rd in Tokyo, and a Friday there.
		const f = tokyo.fields(Date.parse("2026-04-02T15:00:00Z"));
		expect(f).toMatchObject({ year: 2026, month0: 3, day: 3, weekday: 5, hour: 0, minute: 0, second: 0 });
	});

	test("the millisecond survives the read", () => {
		expect(tokyo.fields(Date.parse("2026-04-02T15:00:00Z") + 789).millisecond).toBe(789);
	});

	test("local midnight is midnight there", () => {
		expect(tokyo.localMidnight(2026, 3, 3)).toBe(Date.parse("2026-04-02T15:00:00Z"));
	});

	test("a wall clock is a reading there, minutes rolling into hours", () => {
		expect(tokyo.localWallClock(2026, 3, 3, 570)).toBe(Date.parse("2026-04-03T00:30:00Z"));
	});

	test("the offset is the zone's", () => {
		expect(tokyo.utcOffsetMinutes(Date.parse("2026-04-03T00:00:00Z"))).toBe(540);
	});

	test("the backend names its own zone", () => {
		expect(tokyo.zone?.()).toBe("Asia/Tokyo");
		// The default reads the process's and says nothing rather than claiming a
		// name it does not itself compute in.
		expect(DATE_CALENDAR.zone).toBeUndefined();
	});

	test("dates and times are written out in the named zone", () => {
		const instant = Date.parse("2026-04-02T15:30:00Z");
		expect(tokyo.formatLongDate(instant, "en")).toBe("Friday, April 3, 2026");
		expect(tokyo.formatTimeOfDay(instant, "en")).toBe("12:30:00 AM");
	});
});

describe("a day step holds the wall clock across a transition", () => {
	const london = dateCalendarInZone("Europe/London");

	test("the spring-forward day is twenty-three hours long", () => {
		// Midnight on the 29th to midnight on the 30th, London: the clocks go
		// forward at 01:00, so the calendar day is 23 hours of elapsed time.
		const start = london.localMidnight(2026, 2, 29);
		const next = london.addDays(start, 1);
		expect(next - start).toBe(23 * 3_600_000);
		expect(london.fields(next)).toMatchObject({ year: 2026, month0: 2, day: 30, hour: 0 });
		expect(start).toBeLessThan(SPRING_FORWARD_LONDON);
	});

	test("the fall-back day is twenty-five hours long", () => {
		const start = london.localMidnight(2026, 9, 25);
		const next = london.addDays(start, 1);
		expect(next - start).toBe(25 * 3_600_000);
		expect(london.fields(next)).toMatchObject({ year: 2026, month0: 9, day: 26, hour: 0 });
		expect(start).toBeLessThan(FALL_BACK_LONDON);
	});

	test("a month step clamps the day and holds the reading", () => {
		// 31 January plus a month is 28 February, never 3 March.
		const jan31 = london.localWallClock(2026, 0, 31, 9 * 60 + 30);
		expect(london.fields(london.addMonths(jan31, 1))).toMatchObject({ year: 2026, month0: 1, day: 28, hour: 9, minute: 30 });
	});

	test("a step across a transition keeps the seconds and milliseconds", () => {
		const before = london.localMidnight(2026, 2, 29) + 12 * 3_600_000 + 34_567;
		const after = london.addDays(before, 1);
		expect(london.fields(after).second).toBe(london.fields(before).second);
		expect(london.fields(after).millisecond).toBe(london.fields(before).millisecond);
	});
});

describe("zones the northern-hemisphere cases would not catch", () => {
	test("a southern-hemisphere zone transitions the other way round", () => {
		const sydney = dateCalendarInZone("Australia/Sydney");
		// Sydney goes BACK on the first Sunday in April, so early April is the
		// long day there while London's long day is in October.
		const start = sydney.localMidnight(2026, 3, 5);
		expect(sydney.addDays(start, 1) - start).toBe(25 * 3_600_000);
		expect(sydney.utcOffsetMinutes(Date.parse("2026-01-15T00:00:00Z"))).toBe(660);
		expect(sydney.utcOffsetMinutes(Date.parse("2026-07-15T00:00:00Z"))).toBe(600);
	});

	test("a half-hour offset is carried whole", () => {
		const kolkata = dateCalendarInZone("Asia/Kolkata");
		expect(kolkata.utcOffsetMinutes(Date.parse("2026-04-03T00:00:00Z"))).toBe(330);
		expect(kolkata.localMidnight(2026, 3, 3)).toBe(Date.parse("2026-04-02T18:30:00Z"));
		expect(kolkata.fields(Date.parse("2026-04-02T18:30:00Z"))).toMatchObject({ year: 2026, month0: 3, day: 3, hour: 0, minute: 0 });
	});

	test("a far-east zone resolves a reading the transition is a day away from", () => {
		// The wall-clock conversion reads its first offset at the naive instant,
		// which is wrong by the zone's own offset. In Auckland that is thirteen
		// hours, enough to land on the far side of a transition from the reading
		// itself: measured, 22:30 on 4 April 2026 answered 10:30 UTC on a single
		// pass, an hour late, because the naive instant falls past the 14:00 UTC
		// transition on the 4th. A second pass at the first guess narrows the
		// window to the transition itself.
		const auckland = dateCalendarInZone("Pacific/Auckland");
		expect(auckland.localWallClock(2026, 3, 4, 22 * 60 + 30)).toBe(Date.parse("2026-04-04T09:30:00Z"));
		expect(auckland.fields(Date.parse("2026-04-04T09:30:00Z"))).toMatchObject({ year: 2026, month0: 3, day: 4, hour: 22, minute: 30 });
	});

	test("a zone with no daylight saving has days of one length", () => {
		const phoenix = dateCalendarInZone("America/Phoenix");
		for (const [month0, day] of [[2, 8], [9, 31], [6, 4]] as const) {
			const start = phoenix.localMidnight(2026, month0, day);
			expect(phoenix.addDays(start, 1) - start).toBe(24 * 3_600_000);
		}
		expect(phoenix.utcOffsetMinutes(Date.parse("2026-01-15T00:00:00Z"))).toBe(-420);
		expect(phoenix.utcOffsetMinutes(Date.parse("2026-07-15T00:00:00Z"))).toBe(-420);
	});
});

describe("the one ISO reading that depends on a zone", () => {
	const tokyo = dateCalendarInZone("Asia/Tokyo");

	test("a date-time with no offset is local time, and local is the named zone", () => {
		// Otherwise the backend contradicted itself: `2026-04-03` computed at
		// Tokyo midnight while `2026-04-03T09:30` was read in the host process's
		// zone. The `Temporal` backend already resolves a bare wall clock in its
		// own zone, so this is also what keeps the two agreeing.
		expect(tokyo.parseIso8601("2026-04-03T09:30")).toBe(Date.parse("2026-04-03T00:30:00Z"));
		expect(tokyo.parseIso8601("2026-04-03T09:30:15.250")).toBe(Date.parse("2026-04-03T00:30:15.250Z"));
	});

	test("the two readings the interface freezes are unchanged", () => {
		// A date-only string is UTC midnight, and an explicit offset is
		// subtracted: both are the ECMAScript readings, and the contract says
		// every backend reproduces them.
		expect(tokyo.parseIso8601("2026-04-03")).toBe(Date.parse("2026-04-03T00:00:00Z"));
		expect(tokyo.parseIso8601("2026-04-03T09:30:00Z")).toBe(Date.parse("2026-04-03T09:30:00Z"));
		expect(tokyo.parseIso8601("2026-04-03T09:30:00+09:00")).toBe(Date.parse("2026-04-03T00:30:00Z"));
		expect(Number.isNaN(tokyo.parseIso8601("not a date"))).toBe(true);
	});

	test("the default backend still reads a bare date-time in the process's zone", () => {
		expect(DATE_CALENDAR.parseIso8601("2026-04-03T09:30")).toBe(new Date(2026, 3, 3, 9, 30).getTime());
	});
});

describe("a zone the runtime does not know", () => {
	test("is refused at construction, with its own code", () => {
		expect(() => dateCalendarInZone("Europe/Atlantis")).toThrow(/not a time zone this runtime knows/);
		try {
			dateCalendarInZone("Europe/Atlantis");
		} catch (error) {
			expect((error as { code?: string }).code).toBe("DATE_ZONE_UNKNOWN");
		}
	});
});

describe("the default backend is unchanged", () => {
	const bare = new DateCalendar();
	const host = dateCalendarInZone(HOST_ZONE);
	const instants = [
		Date.parse("2026-04-03T09:30:00Z"),
		Date.parse("2026-01-15T23:45:07Z") + 123,
		SPRING_FORWARD_LONDON + 7_200_000,
		FALL_BACK_LONDON + 7_200_000,
	];

	test.each(instants)("the zoned backend for the host's own zone agrees with it at %p", (instant) => {
		expect(host.fields(instant)).toEqual(bare.fields(instant));
		expect(host.utcOffsetMinutes(instant)).toBe(bare.utcOffsetMinutes(instant));
		expect(host.addDays(instant, 1)).toBe(bare.addDays(instant, 1));
		expect(host.addMonths(instant, 1)).toBe(bare.addMonths(instant, 1));
		expect(host.formatLongDate(instant, "en")).toBe(bare.formatLongDate(instant, "en"));
		expect(host.formatTimeOfDay(instant, "en")).toBe(bare.formatTimeOfDay(instant, "en"));
	});

	test("local midnight and a wall clock agree too", () => {
		expect(host.localMidnight(2026, 3, 3)).toBe(bare.localMidnight(2026, 3, 3));
		expect(host.localWallClock(2026, 3, 3, 570)).toBe(bare.localWallClock(2026, 3, 3, 570));
	});

	test("the shared singleton still reads the process's zone", () => {
		// Its oracle is `Date` itself, the same one `DateCalendar.spec.ts` uses:
		// the singleton every engine that configures nothing shares must not have
		// moved because a zoned subclass now exists.
		const instant = Date.parse("2026-04-03T09:30:00Z");
		const d = new Date(instant);
		expect(DATE_CALENDAR.fields(instant)).toEqual({
			year: d.getFullYear(), month0: d.getMonth(), day: d.getDate(), weekday: d.getDay(),
			hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), millisecond: d.getMilliseconds(),
		});
		expect(DATE_CALENDAR.utcOffsetMinutes(instant)).toBe(0 - d.getTimezoneOffset());
	});
});
