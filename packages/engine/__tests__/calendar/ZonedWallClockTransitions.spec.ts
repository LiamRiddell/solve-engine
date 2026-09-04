/**
 * A wall-clock reading near a daylight-saving transition resolves forwards.
 *
 * Turning "10:30 in Tokyo" into an instant needs that zone's offset, and the
 * offset depends on the instant, so the resolution is a fixed point. The code
 * guessed with the offset at the naive instant and, when a second look
 * disagreed, took the second offset on trust. In a zone behind UTC that moved
 * the answer the wrong way: asking for a reading on a spring-forward morning
 * in New York landed an hour earlier, and at midnight that is the previous
 * calendar day.
 *
 * Each candidate is now read back, and the one that really shows the wall
 * clock asked for is kept. A reading a spring-forward skipped shows neither,
 * because it never happened; the later instant is chosen, which is the same
 * choice `Temporal`'s `disambiguation: 'compatible'` makes, so the two
 * backends agree on a reading that is a choice either way.
 */

import { describe, expect, test } from "@jest/globals";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { zonedWallClockToUtcMs } from "@solve-js/calendar/IntlZone";
import { zonedFields } from "@solve-js/calendar/IntlZone";

/** The wall clock `zone` shows for the instant that resolver returns. */
const roundTrip = (zone: string, year: number, month0: number, day: number, hour: number, minute: number) => {
	const ms = zonedWallClockToUtcMs(year, month0, day, hour, minute, zone, DATE_CALENDAR);
	const f = zonedFields(zone, ms);
	return { year: f.year, month0: f.month0, day: f.day, hour: f.hour, minute: f.minute };
};

describe("an ordinary reading", () => {
	test("round-trips in a zone ahead of UTC and one behind it", () => {
		expect(roundTrip("Asia/Tokyo", 2026, 3, 3, 10, 30)).toEqual({ year: 2026, month0: 3, day: 3, hour: 10, minute: 30 });
		expect(roundTrip("America/New_York", 2026, 3, 3, 10, 30)).toEqual({ year: 2026, month0: 3, day: 3, hour: 10, minute: 30 });
	});

	test("including midnight, which is where a wrong turn changes the day", () => {
		expect(roundTrip("America/New_York", 2026, 2, 8, 0, 0)).toEqual({ year: 2026, month0: 2, day: 8, hour: 0, minute: 0 });
		expect(roundTrip("America/Santiago", 2026, 8, 6, 0, 0).day).toBe(6);
	});
});

describe("a reading either side of a spring-forward", () => {
	test("the hour before and the hour after are themselves", () => {
		// New York moves 02:00 to 03:00 on 8 March 2026.
		expect(roundTrip("America/New_York", 2026, 2, 8, 1, 30)).toMatchObject({ day: 8, hour: 1, minute: 30 });
		expect(roundTrip("America/New_York", 2026, 2, 8, 3, 30)).toMatchObject({ day: 8, hour: 3, minute: 30 });
	});

	test("and the hour that never happened lands after the transition, on the same day", () => {
		// 02:30 does not exist. The answer is a choice; it must not be a jump
		// backwards, and it must not change the date.
		const skipped = roundTrip("America/New_York", 2026, 2, 8, 2, 30);
		expect(skipped.day).toBe(8);
		expect(skipped.hour).toBeGreaterThanOrEqual(3);
	});
});

describe("a reading in a repeated hour", () => {
	test("resolves to a real instant on the day asked for", () => {
		// New York moves 02:00 back to 01:00 on 1 November 2026, so 01:30
		// happens twice. Either occurrence is defensible; the day is not.
		const repeated = roundTrip("America/New_York", 2026, 10, 1, 1, 30);
		expect(repeated).toMatchObject({ day: 1, hour: 1, minute: 30 });
	});
});
