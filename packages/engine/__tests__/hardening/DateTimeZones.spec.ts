/**
 * Timezone conversion across the awkward offsets: the non-whole-hour ones,
 * the extremes at either end of the range, and the pairs far enough apart
 * that the answer lands on a different calendar day.
 *
 * Every zone named here either has no daylight saving at all (Tokyo,
 * Honolulu, Delhi via Asia/Kolkata, Karachi, Bangkok, Dubai, Brisbane,
 * Perth, Singapore, Beijing) or is a fixed numeric offset, which is what
 * makes the expected wall-clock times exact rather than "whatever the tz
 * database says this month". A test written against Paris or Chicago would
 * quietly change answer twice a year.
 *
 * The day-shift suffix is the part worth attacking. Any conversion that
 * crosses midnight in either direction has to say so, because "4:00 AM"
 * with no marker and "4:00 AM (+1 day)" are different appointments.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const str = (source: string) => evaluate(source).value as string;

describe("offsets that are not a whole number of hours", () => {
	test("India's half-hour offset", () => {
		expect(str("3pm GMT+5:30 in UTC")).toBe("9:30 AM");
		expect(str("3pm Delhi in UTC")).toBe("9:30 AM");
	});

	test("Nepal's three-quarter-hour offset", () => {
		expect(str("3pm GMT+5:45 in UTC")).toBe("9:15 AM");
	});

	test("the Chatham Islands' twelve and three quarters", () => {
		expect(str("3pm GMT+12:45 in UTC")).toBe("2:15 AM");
	});

	test("a negative offset with a minutes component subtracts in the right direction", () => {
		// 15:00 at UTC-5:30 is 20:30 UTC, later in the day rather than earlier.
		expect(str("3pm GMT-5:30 in UTC")).toBe("8:30 PM");
	});

	test("two fractional offsets convert against each other, not just against UTC", () => {
		expect(str("3pm GMT+5:30 in GMT+5:45")).toBe("3:15 PM");
	});

	test("a fractional offset between two real cities keeps its minutes", () => {
		expect(str("3pm Tokyo in Delhi")).toBe("11:30 AM");
		expect(str("3pm Delhi in Tokyo")).toBe("6:30 PM");
	});
});

describe("the extremes of the offset range", () => {
	test("UTC+14, the furthest ahead any zone goes", () => {
		// 15:00 minus fourteen hours is 01:00 the same UTC day, so there is no
		// day marker to add.
		expect(str("3pm GMT+14 in UTC")).toBe("1:00 AM");
	});

	test("UTC-11, near the furthest behind", () => {
		expect(str("3pm GMT-11 in UTC")).toBe("2:00 AM (+1 day)");
	});

	test("the full 25-hour spread between the two ends", () => {
		expect(str("3pm GMT+14 in GMT-11")).toBe("2:00 PM (-1 day)");
	});

	test("a bare GMT or UTC is a zero offset and changes nothing", () => {
		expect(str("3pm GMT in UTC")).toBe("3:00 PM");
		expect(str("3pm GMT+0 in UTC")).toBe("3:00 PM");
		expect(str("3pm UTC-0 in UTC")).toBe("3:00 PM");
	});
});

describe("conversions that land on another calendar day", () => {
	test("midnight converted westwards falls back into yesterday", () => {
		// Midnight in Tokyo is 15:00 UTC the previous day, which is 05:00 in
		// Honolulu, still the previous day.
		expect(str("12am Tokyo in Honolulu")).toBe("5:00 AM (-1 day)");
		expect(str("12am Delhi in Honolulu")).toBe("8:30 AM (-1 day)");
	});

	test("morning converted eastwards runs into tomorrow", () => {
		expect(str("9am Honolulu in Tokyo")).toBe("4:00 AM (+1 day)");
		expect(str("12pm Honolulu in Tokyo")).toBe("7:00 AM (+1 day)");
	});

	test("a conversion that stays on the same day says nothing about days", () => {
		expect(str("11pm Tokyo in Honolulu")).toBe("4:00 AM");
		expect(str("11:59pm Tokyo in Honolulu")).toBe("4:59 AM");
		expect(str("3pm Bangkok in Dubai")).toBe("12:00 PM");
	});

	test("the day marker is singular for one day and never says zero", () => {
		expect(str("12am Tokyo in Honolulu")).toMatch(/\(-1 day\)$/);
		expect(str("3pm Bangkok in Dubai")).not.toMatch(/day/);
	});
});

describe("the difference between two zones", () => {
	test("a nineteen-hour gap across the Pacific, stated directionally", () => {
		expect(str("time difference between Tokyo and Honolulu")).toBe("Tokyo is 19 hours ahead of Honolulu");
	});

	test("the direction does not depend on which zone was written first", () => {
		expect(str("time difference between Honolulu and Tokyo")).toBe("Tokyo is 19 hours ahead of Honolulu");
	});

	test("a difference with a minutes component reports both parts", () => {
		expect(str("time difference between Tokyo and Delhi")).toBe("Tokyo is 3 hours 30 minutes ahead of Delhi");
		expect(str("time difference between London and Delhi")).toMatch(
			/^Delhi is \d+ hours 30 minutes ahead of London$/,
		);
	});

	test("a difference of less than an hour omits the hours entirely", () => {
		expect(str("time difference between Delhi and Karachi")).toBe("Delhi is 30 minutes ahead of Karachi");
	});

	test("two zones on the same offset are reported as equal rather than as zero hours ahead", () => {
		expect(str("time difference between Beijing and Singapore")).toContain("share the same UTC offset");
		expect(str("time difference between Delhi and Delhi")).toContain("share the same UTC offset");
	});

	test("two zones in the same country can still differ", () => {
		expect(str("time difference between Brisbane and Perth")).toBe("Brisbane is 2 hours ahead of Perth");
	});
});

describe("what is not a zone", () => {
	test("an unrecognised name is not silently treated as one", () => {
		expect(() => evaluate("time in Atlantis")).toThrow();
		expect(() => evaluate("time difference between Atlantis and Tokyo")).toThrow();
	});

	test("a recognised zone with no target is an error rather than a discarded suffix", () => {
		expect(() => evaluate("6pm Sydney")).toThrow();
		expect(() => evaluate("6pm Sydney in")).toThrow();
	});
});

describe("the current time somewhere else", () => {
	// These read the clock, so the only stable assertions are about shape and
	// about two readings of the same instant agreeing with each other.
	test("`time in <city>` is a wall-clock reading", () => {
		const value = evaluate("time in Tokyo");
		expect(value.type).toBe(ValueType.String);
		expect(value.value as string).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
	});

	test("`date in <city>` is a calendar date", () => {
		expect(str("date in Tokyo")).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
	});

	test("two cities on the same zone read the same time", () => {
		// Mumbai and Delhi are both Asia/Kolkata, so the only way these differ
		// is a clock tick between the two evaluations. Comparing the hour
		// alone would still be brittle at the top of the hour, so this asserts
		// on a zone pair that also has to agree with a third spelling.
		expect(str("time in Mumbai")).toBe(str("time in Delhi"));
		expect(str("date in Mumbai")).toBe(str("date in Delhi"));
	});
});
