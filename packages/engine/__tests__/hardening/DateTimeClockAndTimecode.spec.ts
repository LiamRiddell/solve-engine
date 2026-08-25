/**
 * Clock times, spans that roll past midnight, duration spelling, and video
 * timecode carry.
 *
 * The recurring theme is the twelve-hour clock's two confusable hours and
 * the carry that happens one unit below the one being written. 12am is hour
 * zero and 12pm is hour twelve, an interval that ends earlier than it starts
 * has crossed midnight rather than gone negative, and a frame number one
 * below the frame rate is the last frame of its second rather than the first
 * of the next.
 *
 * The timecode group at the bottom covers the two directions of the same
 * conversion, `HH:MM:SS:FF at <fps>` going in and `<N> frames at <fps>`
 * coming back out. They have to agree: at 29.97 fps they disagreed by four
 * seconds per hour, because one multiplied by the exact rate while the other
 * divided by the rounded one.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();
const str = (source: string) => evaluate(source).value as string;

/** The local wall-clock hour and minute a Datetime value lands on. */
function wallClock(source: string): [number, number] {
	const d = new Date(evaluate(source).toNumber());
	return [d.getHours(), d.getMinutes()];
}

describe("the twelve-hour clock's two awkward hours", () => {
	test("12am is midnight, the start of the day and not hour twelve", () => {
		expect(wallClock("12:00am")).toEqual([0, 0]);
		expect(wallClock("12am")).toEqual([0, 0]);
	});

	test("12pm is noon", () => {
		expect(wallClock("12:00pm")).toEqual([12, 0]);
		expect(wallClock("12pm")).toEqual([12, 0]);
	});

	test("the minutes after each of them stay in the same hour", () => {
		expect(wallClock("12:01am")).toEqual([0, 1]);
		expect(wallClock("12:59am")).toEqual([0, 59]);
		expect(wallClock("12:01pm")).toEqual([12, 1]);
		expect(wallClock("12:59pm")).toEqual([12, 59]);
	});

	test("11:59pm and 11:59am are an hour either side of them", () => {
		expect(wallClock("11:59pm")).toEqual([23, 59]);
		expect(wallClock("11:59am")).toEqual([11, 59]);
	});

	test("the 24-hour spellings agree with the 12-hour ones", () => {
		expect(wallClock("0:00")).toEqual(wallClock("12:00am"));
		expect(wallClock("12:00")).toEqual(wallClock("12:00pm"));
		expect(wallClock("23:59")).toEqual(wallClock("11:59pm"));
	});

	test("an hour above the twelve-hour range is not a clock time", () => {
		// "13pm" has no reading, so the fusion has to decline rather than
		// wrap it to 1am.
		expect(() => evaluate("13pm")).toThrow();
		expect(() => evaluate("0pm")).toThrow();
	});
});

describe("clock arithmetic that rolls past midnight", () => {
	test("adding hours across midnight moves onto the next calendar day", () => {
		// Measured as a difference so the assertion does not depend on what
		// time the test runs: three hours after 11pm is three hours later, and
		// the two evaluations share the same anchor date.
		expect(num("11:00pm + 3 hours") - num("11:00pm")).toBe(3 * 3_600_000);
		const [hour] = wallClock("11:00pm + 3 hours");
		expect(hour).toBe(2);
	});

	test("subtracting back across midnight returns to where it started", () => {
		expect(num("11:00pm + 3 hours - 3 hours")).toBe(num("11:00pm"));
	});

	test("a minute past 11:59pm is the next day's midnight", () => {
		expect(wallClock("11:59pm + 1 minute")).toEqual([0, 0]);
	});

	test("subtracting two clock times gives a signed duration, not a date", () => {
		const forwards = evaluate("9:30 - 8:30");
		expect(forwards.type).toBe(ValueType.Uom);
		expect(forwards.unit).toBe("ms");
		expect(forwards.toNumber()).toBe(3_600_000);
		// The reverse order is genuinely negative rather than absolute.
		expect(num("8:30 - 9:30")).toBe(-3_600_000);
	});
});

describe("clock-time intervals", () => {
	test("an ordinary same-day span", () => {
		expect(num("9am to 5pm")).toBe(8 * 60);
		expect(num("7:30 to 20:45")).toBe(13 * 60 + 15);
	});

	test("an end earlier than the start has rolled over midnight, not gone negative", () => {
		expect(num("4pm to 3am")).toBe(11 * 60);
		expect(num("11:30pm to 12:30am")).toBe(60);
		expect(num("11:59pm to 12:00am")).toBe(1);
	});

	test("both halves of a day are twelve hours", () => {
		expect(num("12am to 12pm")).toBe(720);
		expect(num("12pm to 12am")).toBe(720);
	});

	test("a whole day less a minute is 1439 minutes", () => {
		expect(num("12:00am to 11:59pm")).toBe(1439);
	});

	test("an interval that starts and ends at the same time is zero, not a full day", () => {
		expect(num("9am to 9am")).toBe(0);
		expect(num("12am to 12am")).toBe(0);
	});

	test("the result converts like any other duration", () => {
		expect(num("7:30 to 20:45 in hours")).toBeCloseTo(13.25, 9);
		expect(num("4pm to 3am in hours")).toBe(11);
	});
});

describe("writing a duration out", () => {
	test("as a spoken timespan, largest unit first, skipping the empty ones", () => {
		expect(str("90061 seconds as timespan")).toBe("1 day 1 hour 1 minute 1 second");
		expect(str("5.5 minutes as timespan")).toBe("5 minutes 30 seconds");
		expect(str("1 hour as timespan")).toBe("1 hour");
		expect(str("86399 seconds as timespan")).toBe("23 hours 59 minutes 59 seconds");
	});

	test("the singular and plural forms follow the count", () => {
		expect(str("1 second as timespan")).toBe("1 second");
		expect(str("2 seconds as timespan")).toBe("2 seconds");
		expect(str("1 week as timespan")).toBe("1 week");
		expect(str("8 days as timespan")).toBe("1 week 1 day");
	});

	test("zero has to say something rather than nothing", () => {
		expect(str("0 seconds as timespan")).toBe("0 seconds");
		expect(str("0 seconds as laptime")).toBe("00:00:00");
	});

	test("a negative duration keeps its sign in front of the whole reading", () => {
		expect(str("-90 seconds as timespan")).toBe("-1 minute 30 seconds");
		expect(str("-90 seconds as laptime")).toBe("-00:01:30");
	});

	test("a laptime past 24 hours does not wrap around", () => {
		// Wrapping a 25-hour measurement to 1 hour would be silently wrong,
		// and a race or a shift genuinely can run that long.
		expect(str("25 hours as laptime")).toBe("25:00:00");
		expect(str("2 days as laptime")).toBe("48:00:00");
	});

	test("a fractional remainder survives rather than being rounded away", () => {
		expect(str("1.5 seconds as laptime")).toBe("00:00:01.500");
		expect(str("00:00:01.5 as timespan")).toBe("1.5 seconds");
	});

	test("a quantity that is not a duration is refused by name", () => {
		expect(str("5 kg as timespan")).toContain("needs a duration");
		expect(str("5 kg as laptime")).toContain("needs a duration");
	});

	test("a laptime literal round-trips through the spoken form", () => {
		expect(str("03:04:05 as timespan")).toBe("3 hours 4 minutes 5 seconds");
		expect(num("03:04:05")).toBe(3 * 3600 + 4 * 60 + 5);
		expect(num("1:2:3")).toBe(3723);
		expect(num("99:59:59")).toBe(99 * 3600 + 59 * 60 + 59);
	});
});

describe("video timecode carry at the frame-rate boundary", () => {
	test("the last frame of a second plus one is the first frame of the next", () => {
		expect(num("00:00:00:29 at 30 fps + 1 frames")).toBe(30);
		expect(str("30 frames at 30 fps")).toBe("00:00:01:00");
	});

	test("the carry propagates through minutes", () => {
		expect(num("00:00:59:29 at 30 fps + 1 frames")).toBe(1800);
		expect(str("1800 frames at 30 fps")).toBe("00:01:00:00");
	});

	test("and through hours", () => {
		expect(num("00:59:59:29 at 30 fps + 1 frames")).toBe(108000);
		expect(str("108000 frames at 30 fps")).toBe("01:00:00:00");
	});

	test("a frame number equal to the frame rate does not exist", () => {
		// Valid frame indices are 0 to fps-1, so 30 at 30fps is already the
		// next second and has to be rejected rather than silently carried.
		expect(() => evaluate("00:00:00:30 at 30 fps")).toThrow(/out of range/i);
		expect(() => evaluate("00:00:00:24 at 24 fps")).toThrow(/out of range/i);
	});
});

describe("timecode at a broadcast (fractional) frame rate", () => {
	// Non-drop-frame timecode at 29.97 fps still labels thirty frames per
	// second. That mismatch against wall-clock time is precisely what
	// drop-frame notation exists to correct, and it means the frame count for
	// a given HH:MM:SS:FF is the same at 29.97 as at 30.
	test("frame 29 is valid at 29.97 fps, and frame 23 at 23.976", () => {
		// Both used to be rejected, because the range check floored the rate
		// to 29 and 23 while the display side rounded it to 30 and 24.
		expect(num("00:00:00:29 at 29.97 fps")).toBe(29);
		expect(num("00:00:00:23 at 23.976 fps")).toBe(23);
	});

	test("one hour of timecode is 108,000 frames and comes back out as one hour", () => {
		// This used to produce 107,892 frames going in and "00:59:56:12"
		// coming back out.
		expect(num("01:00:00:00 at 29.97 fps in frames")).toBe(108000);
		expect(str("108000 frames at 29.97 fps")).toBe("01:00:00:00");
	});

	test("an arbitrary timecode survives the round trip intact", () => {
		expect(num("01:02:03:04 at 29.97 fps in frames")).toBe(111694);
		expect(str("111694 frames at 29.97 fps")).toBe("01:02:03:04");
	});

	test("the frame count matches the whole-numbered rate it rounds to", () => {
		expect(num("01:02:03:04 at 29.97 fps in frames")).toBe(num("01:02:03:04 at 30 fps in frames"));
		expect(num("00:10:00:00 at 23.976 fps in frames")).toBe(num("00:10:00:00 at 24 fps in frames"));
	});

	test("mixing two different declared rates is still an error, not silent math", () => {
		expect(evaluate("00:00:01:00 at 30 fps - 00:00:01:00 at 25 fps").type).toBe(ValueType.Error);
	});
});
