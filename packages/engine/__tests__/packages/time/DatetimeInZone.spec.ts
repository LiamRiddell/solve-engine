/**
 * `<datetime> in <zone>`: reading a date, or a time of day, in a named time
 * zone.
 *
 * What was wrong: `in` after a date fell through the unit-conversion opcode's
 * final branch, which reads the operand as a magnitude and labels it with
 * whatever name follows. `2026-04-03 in Tokyo` answered
 * `1,775,170,800,000.00 Tokyo`, the date's epoch milliseconds in a unit named
 * after a city, and `2026-04-03 in Atlantis` and `2026-04-03 in furlongs`
 * answered the same number under those names. Nothing about that was a result
 * anybody could build on, and nothing said so.
 *
 * What is pinned here, one case per row of the design's zone table:
 *
 *     expression                before                          now
 *     2026-04-03 in Tokyo       1,775,170,800,000.00 Tokyo      that day in Tokyo
 *     2026-04-03T09:00 in Tokyo 1,775,203,200,000.00 Tokyo      09:00 in Tokyo
 *     6pm in Chicago            (today's epoch) Chicago         18:00 in Chicago
 *     2026-04-03 in furlongs    1,775,170,800,000.00 furlongs   DATETIME_NOT_CONVERTIBLE
 *     2026-04-03 in Atlantis    1,775,170,800,000.00 Atlantis   DATETIME_ZONE_UNKNOWN
 *     5 in Tokyo                5.00 Tokyo                      5.00 Tokyo
 *
 * There is no new parselet behind any of this. The currency package already
 * registers an infix parselet on `IN`, and `ParseletRegistry.registerInfix`
 * overwrites on collision, so a second one would have unhooked currency
 * conversion; the branch sits in the VM's existing `UOM_CONVERT_IN` handler
 * instead. The last two rows are what proves it: an ordinary quantity and a
 * unit conversion still go through the same opcode untouched.
 *
 * Every expectation is written as a fixed instant or as a reading taken back
 * out of the named zone, never as a formatted string in the host's zone, since
 * this suite is re-run under three time zones and both calendar backends.
 */
import { describe, expect, test } from "@jest/globals";
import { Value, ValueType } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The one Value a line evaluates to, through the single-expression path. */
function evaluate(expression: string): Value {
	return newTrackedEngine().evaluateLine(1, expression);
}

/** The wall clock a named zone shows for the instant a line answered. */
function readingIn(zone: string, value: Value): { year: number; month0: number; day: number; hour: number; minute: number } {
	return DATE_CALENDAR.fieldsInZone(zone, value.toNumber());
}

describe("a date read in a zone", () => {
	test("a calendar day becomes that day in the named zone", () => {
		const value = evaluate("2026-04-03 in Tokyo");
		expect(value.type).toBe(ValueType.Datetime);
		expect(value.grain).toBe("instant");
		expect(value.zone).toBe("Asia/Tokyo");
		// Midnight on 3 April 2026 in Tokyo is one instant, whatever zone the
		// host reads it from: 15:00 UTC the day before.
		expect(value.toNumber()).toBe(Date.parse("2026-04-02T15:00:00Z"));
	});

	test("a spelled month reads the same way", () => {
		expect(evaluate("3 April 2026 in Tokyo").toNumber()).toBe(Date.parse("2026-04-02T15:00:00Z"));
	});

	test("a wall-clock reading becomes that reading in the named zone", () => {
		const value = evaluate("2026-04-03T09:00 in Tokyo");
		expect(value.grain).toBe("instant");
		expect(value.zone).toBe("Asia/Tokyo");
		expect(value.toNumber()).toBe(Date.parse("2026-04-03T00:00:00Z"));
	});

	test("a clock time becomes that time of day in the named zone", () => {
		// The date `6pm` anchors to is today's, so the instant moves with the
		// clock: what is fixed, and what the row is about, is that Chicago reads
		// six in the evening.
		const value = evaluate("6pm in Chicago");
		expect(value.grain).toBe("instant");
		expect(value.zone).toBe("America/Chicago");
		const chicago = readingIn("America/Chicago", value);
		expect(chicago.hour).toBe(18);
		expect(chicago.minute).toBe(0);
	});

	test("a fixed instant keeps its number and only gains the zone", () => {
		// `now` is a point on the timeline already: moving it would answer a
		// different question from the one asked.
		const engine = newTrackedEngine();
		const bare = engine.evaluateLine(1, "now").toNumber();
		const zoned = engine.evaluateLine(2, "now in Tokyo");
		expect(zoned.zone).toBe("Asia/Tokyo");
		expect(Math.abs(zoned.toNumber() - bare)).toBeLessThan(5000);
	});

	test("an abbreviation and a bare UTC both resolve", () => {
		expect(evaluate("2026-04-03 in EST").zone).toBe("America/New_York");
		expect(evaluate("2026-04-03 in UTC").zone).toBe("UTCOFFSET:0");
		expect(evaluate("2026-04-03 in UTC").toNumber()).toBe(Date.parse("2026-04-03T00:00:00Z"));
	});
});

describe("a name that is not a zone", () => {
	test("a real unit is a category error, and says so", () => {
		const value = evaluate("2026-04-03 in furlongs");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("DATETIME_NOT_CONVERTIBLE");
		expect(value.unit).toContain('A date cannot be read in "furlongs"');
	});

	test("a currency code is the same category error", () => {
		const value = evaluate("2026-04-03 in USD");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("DATETIME_NOT_CONVERTIBLE");
	});

	test("a name that is neither is an unknown zone, and names the shapes that work", () => {
		const value = evaluate("2026-04-03 in Atlantis");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("DATETIME_ZONE_UNKNOWN");
		expect(value.unit).toContain('"Atlantis" is not a time zone this engine knows');
		expect(value.unit).toContain("in Tokyo");
	});

	test("the refusal propagates rather than being swallowed", () => {
		const value = evaluate("2026-04-03 in Atlantis + 1 day");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("DATETIME_ZONE_UNKNOWN");
	});
});

describe("what the same opcode still does", () => {
	test("an ordinary quantity in a city name is unchanged", () => {
		// `5 in Tokyo` never reached the new branch: it is a Number, so it takes
		// the fall-through it always did and stays a unit-of-measurement value.
		expect(formatValue(evaluate("5 in Tokyo"))).toBe("= 5.00 Tokyo");
	});

	test("a unit conversion is unchanged", () => {
		expect(formatValue(evaluate("5 kg in lb"))).toBe("= 11.02 lb");
	});

	test("a currency conversion still reaches its own branch", () => {
		// Not a rate assertion: with no live rate cached the line reports the
		// missing data, which is still the currency path rather than the zone one.
		const value = evaluate("100 USD in GBP");
		expect(value.value).not.toBe("DATETIME_ZONE_UNKNOWN");
		expect(value.value).not.toBe("DATETIME_NOT_CONVERTIBLE");
	});

	test("the time package's own String zone form is untouched", () => {
		// `6pm Sydney in Chicago` is answered by the time package before the
		// conversion opcode ever sees it, and comes back as a String. The exact
		// clock reading moves with the daylight-saving offsets of two zones on
		// today's date, so what is pinned is that this is still a String of that
		// shape rather than anything the Datetime branch produced.
		const value = evaluate("6pm Sydney in Chicago");
		expect(value.type).toBe(ValueType.String);
		expect(value.value as string).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
	});
});
