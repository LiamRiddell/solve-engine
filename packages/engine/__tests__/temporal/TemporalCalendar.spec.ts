/**
 * The `Temporal` calendar backend, method by method, against the `Date`
 * backend it must agree with, and then the one thing it adds.
 *
 * `temporal/TemporalCalendar.ts` answers the engine's date questions through
 * a `Temporal` the host supplies. Its promise is that a host switching to it
 * sees no result move, so the oracle for every method is the `Date` backend
 * in the process's own zone, over a grid wide enough to reach the places the
 * two libraries differ by design: the daylight-saving transition days, the
 * 1800s (local mean time, which `Date` truncates to whole minutes), a year
 * from 0 to 99, a 30 February, a fractional millisecond, and the edge of the
 * range `Date` represents. The differential suite beside this file does the
 * same through the engine; this one isolates each method.
 *
 * What it adds is a zone of its own, so the second half builds backends in
 * named zones and reads them against the `Date` backend's named-zone methods,
 * which are the engine's existing source of truth for a zone that is not the
 * process's.
 *
 * The implementation under test is the polyfill's own, or the runtime's
 * native `Temporal` when `SOLVE_TEMPORAL=native` (see `tools/temporalTestKit.ts`).
 */

import { describe, expect, test } from "@jest/globals";
import { Temporal } from "temporal-polyfill/implementation";
import { createTemporalCalendar, TemporalCalendar, type TemporalLike } from "@solve-js/temporal/TemporalCalendar";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { CoreErrorCodes } from "@solve-js/errors/ErrorCode";
import { EngineError } from "@solve-js/errors/EngineError";
import { polyfillMisreads, temporalForTests, temporalSource } from "@tools/temporalTestKit";

// The structural type is honest against the published `Temporal` types: the
// polyfill's export, typed by `temporal-spec`, satisfies it with no cast. A
// compile-time check; the value is not otherwise used.
const structurallyTemporal: TemporalLike = Temporal;
void structurallyTemporal;

const temporal = temporalForTests();
const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const calendar = createTemporalCalendar(temporal, { timeZone: hostZone });
const date = DATE_CALENDAR;

/** Local midnight through the oracle, the instant a date literal evaluates to. */
const midnight = (year: number, month: number, day: number) => date.localMidnight(year, month - 1, day);

/** Instants just after local midnight on a day that contains a transition somewhere, from the Date backend's own spec. */
const TRANSITION_INSTANTS = [
	Date.parse("2024-11-03T07:30:00Z"), // Los Angeles falls back
	Date.parse("2024-03-10T08:30:00Z"), // Los Angeles springs forward
	Date.parse("2024-10-26T23:30:00Z"), // London falls back
	Date.parse("2024-03-30T23:30:00Z"), // London springs forward
	Date.parse("2024-04-06T13:30:00Z"), // Sydney falls back
	Date.parse("2024-10-05T13:30:00Z"), // Sydney springs forward
	Date.parse("2024-09-28T13:30:00Z"), // Auckland springs forward
	Date.parse("2024-04-06T13:30:00Z"), // Auckland falls back
	midnight(2024, 6, 10),
	midnight(2024, 1, 15),
	Date.UTC(2024, 1, 29, 12, 34, 56, 789),
];

/**
 * A sweep across the years, six instants in each, chosen to land on the days
 * a zone changes offset in either hemisphere, so every zone the suite runs in
 * meets its own transitions somewhere in the grid.
 */
function sweep(): number[] {
	const out: number[] = [];
	for (let year = 1840; year <= 2120; year++) {
		out.push(
			Date.UTC(year, 0, 15, 12),
			Date.UTC(year, 2, 31, 1, 30),
			Date.UTC(year, 6, 1, 0),
			Date.UTC(year, 9, 27, 1, 30),
			Date.UTC(year, 10, 3, 9, 30),
			Date.UTC(year, 11, 31, 23, 30),
		);
	}
	return out;
}

/** The edges: the range `Date` represents, just past it, and the inputs `Date` clips. */
const EDGE_INSTANTS = [0, -1, 1, 8.64e15, -8.64e15, 8.64e15 + 1, -8.64e15 - 1, 8.7e15, Number.NaN, Number.POSITIVE_INFINITY, 1000.7, -1000.7, 1_700_000_000_123.5];

/** Every instant the process-zone comparisons run over, less the window the polyfill is known to misread in this zone. */
const INSTANTS = [...TRANSITION_INSTANTS, ...sweep(), ...EDGE_INSTANTS].filter((instant) => !polyfillMisreads(hostZone, instant));

describe("construction", () => {
	test("refuses a value with no Temporal shape, naming the first missing member", () => {
		for (const [candidate, missing] of [
			[{}, "Now.instant"],
			[{ Now: { instant: () => null } }, "Now.timeZoneId"],
			[{ Now: { instant: () => null, timeZoneId: () => "UTC" } }, "Instant.fromEpochMilliseconds"],
			[{ Now: { instant: () => null, timeZoneId: () => "UTC" }, Instant: { fromEpochMilliseconds: () => null } }, "PlainDateTime.from"],
		] as const) {
			let error: unknown;
			try {
				createTemporalCalendar(candidate as unknown as TemporalLike);
			} catch (e) {
				error = e;
			}
			expect(error).toBeInstanceOf(EngineError);
			expect((error as EngineError).code).toBe(CoreErrorCodes.TEMPORAL_IMPLEMENTATION_INVALID);
			expect((error as EngineError).message).toContain(missing);
		}
	});

	test("refuses a zone the implementation does not know, at construction", () => {
		let error: unknown;
		try {
			createTemporalCalendar(temporal, { timeZone: "Mars/Olympus" });
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(EngineError);
		expect((error as EngineError).code).toBe(CoreErrorCodes.TEMPORAL_TIME_ZONE_UNKNOWN);
		expect((error as EngineError).message).toContain("Mars/Olympus");
	});

	test("defaults to the runtime's own zone, and canonicalises a zone's spelling", () => {
		expect(createTemporalCalendar(temporal).timeZone).toBe(temporal.Now.timeZoneId());
		expect(createTemporalCalendar(temporal, { timeZone: "asia/tokyo" }).timeZone).toBe("Asia/Tokyo");
		expect(createTemporalCalendar(temporal, { timeZone: "utc" }).timeZone).toBe("UTC");
		expect(calendar).toBeInstanceOf(TemporalCalendar);
	});

	test("`now` reads Temporal.Now by default and the option when given", () => {
		const before = Date.now();
		const read = createTemporalCalendar(temporal).now();
		expect(Math.abs(read - before)).toBeLessThan(5_000);
		expect(createTemporalCalendar(temporal, { now: () => 1234 }).now()).toBe(1234);
	});
});

describe(`agrees with the Date backend in the process's zone (${hostZone}, ${temporalSource()} Temporal)`, () => {
	test("fields, over the sweep, the transitions and the edges", () => {
		for (const instant of INSTANTS) {
			expect({ instant, fields: calendar.fields(instant) }).toEqual({ instant, fields: date.fields(instant) });
		}
	});

	test("localMidnight, with Date's overflow, its two-digit-year window and its NaN past the range", () => {
		const years = [-1, 0, 50, 99, 100, 1847, 1899, 1900, 1969, 1970, 1999, 2000, 2023, 2024, 2025, 2038, 2100, 275760, 300000];
		const months = [-1, 0, 1, 2, 5, 11, 12, 13];
		const days = [0, 1, 15, 28, 29, 30, 31, 32];
		for (const y of years) for (const m of months) for (const d of days) {
			expect({ y, m, d, ms: calendar.localMidnight(y, m, d) }).toEqual({ y, m, d, ms: date.localMidnight(y, m, d) });
		}
		expect(calendar.localMidnight(Number.NaN, 0, 1)).toBeNaN();
	});

	test("localWallClock, as a clock reading on the date rather than an elapsed span", () => {
		const minutes = [0, 90, 540, 750, 1439, 1440, 1500, -60, 9 * 60 + 0.5];
		for (const instant of INSTANTS.filter((_, i) => i < TRANSITION_INSTANTS.length || i % 7 === 0)) {
			if (!Number.isFinite(instant)) continue;
			const f = date.fields(instant);
			for (const m of minutes) {
				expect({ instant, m, ms: calendar.localWallClock(f.year, f.month0, f.day, m) })
					.toEqual({ instant, m, ms: date.localWallClock(f.year, f.month0, f.day, m) });
			}
		}
	});

	test("addDays, holding the wall-clock time across the transition days", () => {
		const steps = [1, -1, 7, 30, -365, 0, 1.5, 1e9];
		for (const instant of INSTANTS) {
			for (const days of steps) {
				const expected = date.addDays(instant, days);
				// A step can land inside the window the polyfill misreads from a start outside it.
				if (polyfillMisreads(hostZone, expected)) continue;
				expect({ instant, days, ms: calendar.addDays(instant, days) }).toEqual({ instant, days, ms: expected });
			}
		}
	});

	test("addMonths, with the park-on-the-first clamp", () => {
		const steps = [1, -1, 13, -25, 12, 0, 3];
		for (const instant of INSTANTS) {
			for (const months of steps) {
				const expected = date.addMonths(instant, months);
				if (polyfillMisreads(hostZone, expected)) continue;
				expect({ instant, months, ms: calendar.addMonths(instant, months) }).toEqual({ instant, months, ms: expected });
			}
		}
		expect(calendar.addMonths(midnight(2024, 1, 31), 1)).toBe(midnight(2024, 2, 29));
		expect(calendar.addMonths(midnight(2024, 3, 31), -1)).toBe(midnight(2024, 2, 29));
	});

	test("utcOffsetMinutes, whole minutes truncated toward zero as getTimezoneOffset answers", () => {
		for (const instant of INSTANTS) {
			expect({ instant, offset: calendar.utcOffsetMinutes(instant) }).toEqual({ instant, offset: date.utcOffsetMinutes(instant) });
		}
	});

	test("parseIso8601, the ECMAScript grammar with the runtime's own tolerances", () => {
		const strings = [
			"2019-04-01", "2019-04-31", "2019-02-30", "2019-13-01", "2019-00-10", "2019-04-00", "2019-04-32",
			"2019-04-01T24:00:00", "2019-04-01T24:00:01", "2019-04-01T25:00:00", "2019-04-01T15:60:00", "2019-04-01T15:30:60",
			"2019-04-01T15:30:00.1234567", "2019-04-01T15:30:00.9999Z", "2019-04-01T15:30:00.9995Z", "2019-04-01T15:30:00.5", "2019-04-01T15:30:00.",
			"2019-04-01T15:30:00+1100", "2019-04-01T15:30:00+11:00", "2019-04-01T15:30:00-05", "2019-04-01T15:30:00-05:00", "2019-04-01T15:30:00+24:00", "2019-04-01T15:30:00+23:59", "2019-04-01T15:30:00+05:60",
			"2019-04-01T15:30", "2019-04-01T15", "2019-04", "2019", "+002019-04-01", "-000001-01-01", "0099-01-01", "0000-01-01", "0050-06-15T12:00:00",
			"2019-04-01t15:30:00z", "2019-04-01T15:30:00 Z", "not a date", "",
			"2024-02-29T00:00:00", "2023-02-29T00:00:00", "1969-12-31T23:59:59.999Z", "1970-01-01T00:00:00Z",
			"+275760-09-13T00:00:00Z", "+275760-09-13T00:00:00.001Z", "-271821-04-20T00:00:00Z", "-271821-04-19T23:59:59.999Z",
			"2024-03-31T01:30:00", "2024-10-27T01:30:00", "2024-03-10T02:30:00", "2024-11-03T01:30:00",
		];
		for (const text of strings) {
			expect({ text, ms: calendar.parseIso8601(text) }).toEqual({ text, ms: date.parseIso8601(text) });
		}
		// Outside the format the Date constructor falls back to a legacy parser
		// and guesses (`-000000-01-01` reads as 2001 in V8); this backend does
		// not. The engine's gate admits only the format, so nothing reaches
		// either backend from outside it.
		expect(calendar.parseIso8601("-000000-01-01")).toBeNaN();
		expect(calendar.parseIso8601("April 1, 2019")).toBeNaN();
		// So are a space around the string and the slash and basic forms: V8
		// reads " 2019-04-01" and "2019/04/01" through the legacy parser as
		// local midnight.
		expect(calendar.parseIso8601(" 2019-04-01")).toBeNaN();
		expect(calendar.parseIso8601("2019-04-01 ")).toBeNaN();
		expect(calendar.parseIso8601("2019/04/01")).toBeNaN();
		expect(calendar.parseIso8601("20190401")).toBeNaN();
	});

	test("formatLongDate and formatTimeOfDay, through the same Intl the Date backend formats with", () => {
		const locales = ["en", "en-GB", "de", "fr", "ja", "ar-EG"];
		const sample = [...TRANSITION_INSTANTS, ...sweep().filter((_, i) => i % 23 === 0), ...EDGE_INSTANTS];
		for (const instant of sample) {
			for (const locale of locales) {
				expect({ instant, locale, s: calendar.formatLongDate(instant, locale) }).toEqual({ instant, locale, s: date.formatLongDate(instant, locale) });
				expect({ instant, locale, s: calendar.formatTimeOfDay(instant, locale) }).toEqual({ instant, locale, s: date.formatTimeOfDay(instant, locale) });
			}
		}
		expect(calendar.formatLongDate(Number.NaN, "en")).toBe("Invalid Date");
		expect(calendar.formatTimeOfDay(8.7e15, "en")).toBe("Invalid Date");
	});

	const ZONES = ["UTC", "Asia/Tokyo", "Asia/Kolkata", "Asia/Kathmandu", "Pacific/Honolulu", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Amsterdam", "Australia/Sydney", "Pacific/Auckland", "Pacific/Chatham", "America/St_Johns"];

	test("the named-zone reads, including the local-mean-time offsets the Date backend rounds", () => {
		const sample = [...TRANSITION_INSTANTS, ...sweep().filter((_, i) => i % 5 === 0)];
		for (const zone of ZONES) {
			for (const instant of sample) {
				if (polyfillMisreads(zone, instant)) continue;
				expect({ zone, instant, o: calendar.zoneOffsetMinutes(zone, instant) }).toEqual({ zone, instant, o: date.zoneOffsetMinutes(zone, instant) });
				expect({ zone, instant, f: calendar.fieldsInZone(zone, instant) }).toEqual({ zone, instant, f: date.fieldsInZone(zone, instant) });
			}
			for (const instant of TRANSITION_INSTANTS) {
				expect(calendar.formatTimeInZone(zone, instant)).toBe(date.formatTimeInZone(zone, instant));
				expect(calendar.formatDateInZone(zone, instant)).toBe(date.formatDateInZone(zone, instant));
			}
		}
	});

	test("the polyfill's known misreading is still there, so its exclusion has not outlived it", () => {
		// London, 31 March 1947, 01:30 UTC: summer time since 16 March. The
		// native Temporal and Intl read +60; temporal-polyfill 1.0.4 reads 0.
		const instant = Date.UTC(1947, 2, 31, 1, 30);
		expect(date.zoneOffsetMinutes("Europe/London", instant)).toBe(60);
		const read = calendar.zoneOffsetMinutes("Europe/London", instant);
		if (temporalSource() === "polyfill") {
			expect(polyfillMisreads("Europe/London", instant)).toBe(true);
			expect(read).toBe(0);
		} else {
			expect(polyfillMisreads("Europe/London", instant)).toBe(false);
			expect(read).toBe(60);
		}
	});

	test("the named-zone methods throw the runtime's RangeError, as the contract states", () => {
		const instant = Date.UTC(2024, 0, 1, 16, 0);
		expect(() => calendar.zoneOffsetMinutes("Mars/Olympus", instant)).toThrow(RangeError);
		expect(() => calendar.fieldsInZone("Mars/Olympus", instant)).toThrow(RangeError);
		expect(() => calendar.formatTimeInZone("Mars/Olympus", instant)).toThrow(RangeError);
		expect(() => calendar.formatDateInZone("Mars/Olympus", instant)).toThrow(RangeError);
		expect(() => calendar.zoneOffsetMinutes("UTC", Number.NaN)).toThrow(RangeError);
		expect(() => calendar.fieldsInZone("UTC", Number.NaN)).toThrow(RangeError);
		expect(() => calendar.formatTimeInZone("UTC", Number.NaN)).toThrow(RangeError);
		expect(() => calendar.formatDateInZone("UTC", 8.7e15)).toThrow(RangeError);
	});

	test("the local methods answer NaN past the range and never throw", () => {
		expect(calendar.localMidnight(300000, 0, 1)).toBeNaN();
		expect(calendar.addDays(midnight(2024, 1, 1), 1e9)).toBeNaN();
		expect(calendar.addMonths(Number.NaN, 1)).toBeNaN();
		expect(calendar.utcOffsetMinutes(Number.NaN)).toBeNaN();
		expect(calendar.parseIso8601("2019-04-01T25:00:00")).toBeNaN();
		expect(Object.values(calendar.fields(Number.POSITIVE_INFINITY)).every(Number.isNaN)).toBe(true);
	});
});

describe("computes in a zone of its own", () => {
	const ZONES = ["UTC", "Asia/Tokyo", "Asia/Kolkata", "America/New_York", "Pacific/Auckland", "Pacific/Chatham"];
	const backends = new Map(ZONES.map((zone) => [zone, createTemporalCalendar(temporal, { timeZone: zone })]));

	/** The Date backend's own reading of a zone, the engine's existing source of truth for one that is not the process's. */
	function expectedFields(zone: string, instant: number) {
		const f = date.fieldsInZone(zone, instant);
		// The zone read carries no weekday or millisecond; both follow from the date and the instant.
		return { ...f, weekday: new Date(Date.UTC(f.year, f.month0, f.day)).getUTCDay(), millisecond: ((instant % 1000) + 1000) % 1000 };
	}

	test("fields are the zone's own, matching the Date backend's read of that zone", () => {
		// From 1950, past every local-mean-time era in the list, where the
		// zone offsets are whole minutes and the two readings must be exact.
		const sample = [...TRANSITION_INSTANTS, ...sweep().filter((instant, i) => i % 3 === 0 && instant >= Date.UTC(1950, 0, 1))];
		for (const [zone, backend] of backends) {
			for (const instant of sample) {
				const f = backend.fields(instant);
				expect({ zone, instant, f }).toEqual({ zone, instant, f: expectedFields(zone, instant) });
				expect({ zone, instant, o: backend.utcOffsetMinutes(instant) }).toEqual({ zone, instant, o: date.zoneOffsetMinutes(zone, instant) });
			}
		}
	});

	test("a date literal is midnight in the backend's zone", () => {
		expect(backends.get("Asia/Tokyo")!.localMidnight(2024, 0, 1)).toBe(Date.UTC(2023, 11, 31, 15));
		expect(backends.get("America/New_York")!.localMidnight(2024, 0, 1)).toBe(Date.UTC(2024, 0, 1, 5));
		expect(backends.get("Pacific/Chatham")!.localMidnight(2024, 0, 1)).toBe(Date.UTC(2023, 11, 31, 10, 15));
		expect(backends.get("UTC")!.localMidnight(2024, 0, 1)).toBe(Date.UTC(2024, 0, 1));
	});

	test("a day step holds the zone's wall clock across the zone's own transition", () => {
		const newYork = backends.get("America/New_York")!;
		// 9 am on 9 March 2024, the day before New York springs forward.
		const start = newYork.localWallClock(2024, 2, 9, 9 * 60);
		const next = newYork.addDays(start, 1);
		expect(newYork.fields(next)).toMatchObject({ year: 2024, month0: 2, day: 10, hour: 9, minute: 0 });
		// Twenty-three hours of elapsed time, not twenty-four.
		expect(next - start).toBe(23 * 3_600_000);
		// The same step in Tokyo, which has no transition, is a plain day.
		const tokyo = backends.get("Asia/Tokyo")!;
		const tokyoStart = tokyo.localWallClock(2024, 2, 9, 9 * 60);
		expect(tokyo.addDays(tokyoStart, 1) - tokyoStart).toBe(24 * 3_600_000);
	});

	test("a clock time in a gap and in an overlap resolves the way Date resolves the process's", () => {
		const newYork = backends.get("America/New_York")!;
		// 02:30 on 10 March 2024 does not exist in New York; it reads as 03:30.
		expect(newYork.fields(newYork.localWallClock(2024, 2, 10, 2 * 60 + 30))).toMatchObject({ hour: 3, minute: 30 });
		// 01:30 on 3 November 2024 happens twice; the first, daylight-time one wins.
		expect(newYork.utcOffsetMinutes(newYork.localWallClock(2024, 10, 3, 60 + 30))).toBe(-240);
	});

	test("an offset-less ISO date-time is local to the backend's zone; a date-only string stays UTC", () => {
		expect(backends.get("Asia/Tokyo")!.parseIso8601("2019-04-01T15:30:00")).toBe(Date.UTC(2019, 3, 1, 6, 30));
		expect(backends.get("America/New_York")!.parseIso8601("2019-04-01T15:30:00")).toBe(Date.UTC(2019, 3, 1, 19, 30));
		expect(backends.get("Asia/Tokyo")!.parseIso8601("2019-04-01")).toBe(Date.UTC(2019, 3, 1));
		expect(backends.get("Asia/Tokyo")!.parseIso8601("2019-04-01T15:30:00Z")).toBe(Date.UTC(2019, 3, 1, 15, 30));
	});

	test("the display names the zone's day", () => {
		const instant = Date.UTC(2024, 0, 1, 16, 0);
		expect(backends.get("Asia/Tokyo")!.formatLongDate(instant, "en")).toBe("Tuesday, January 2, 2024");
		expect(backends.get("America/New_York")!.formatLongDate(instant, "en")).toBe("Monday, January 1, 2024");
		expect(backends.get("Asia/Tokyo")!.formatTimeOfDay(instant, "en")).toBe("1:00:00 AM");
		expect(backends.get("Asia/Tokyo")!.utcOffsetMinutes(instant)).toBe(540);
	});

	test("the named-zone reads do not depend on the backend's own zone", () => {
		const instant = Date.UTC(2024, 6, 1, 12);
		for (const backend of backends.values()) {
			expect(backend.zoneOffsetMinutes("Asia/Kathmandu", instant)).toBe(345);
			expect(backend.fieldsInZone("Pacific/Honolulu", Date.UTC(2024, 0, 1, 20, 30, 15))).toEqual({ year: 2024, month0: 0, day: 1, hour: 10, minute: 30, second: 15 });
			expect(backend.formatTimeInZone("Asia/Tokyo", Date.UTC(2024, 0, 1, 16))).toBe("1:00 AM");
		}
	});
});
