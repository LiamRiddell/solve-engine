import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, expectHonestDocument, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { calendarUnderTest, temporalCalendarForTests } from "@tools/temporalTestKit";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { walkDatesInZone, zonedDateAsLocalMidnight } from "@solve-js/calendar/ZonedSteps";
import { encodeFixedOffset } from "@solve-js/calendar/IntlZone";
import type { EngineOptions } from "@solve-js/engine/ExpressionEngine";

/**
 * Found bug: a working day added to a date read in a zone was counted on the
 * host's calendar. `2024-11-01 23:30 in New York + 1 workday` is Friday night
 * in New York, so the next working day is Monday; on a host in UTC that
 * instant is already Saturday, and the line answered Sunday 10:30 PM, which is
 * no working day at all. Only a host in New York said Monday.
 * `3 working days after <a date in New York>` went further and dropped the
 * zone, so its answer was shown on the host's clock.
 *
 * `calendar/ZonedSteps.ts` now hands the walk the date that zone's calendar
 * shows (`walkDatesInZone`), and puts the zone's wall-clock time back on the
 * date it lands on, as the day and month steps already did. The weekend, the
 * host's holidays and the offset limits are the walk's own and are unchanged.
 * `working days between` reads a zoned endpoint as the day its zone shows.
 */

const ZONES = ["UTC", "Europe/London", "America/New_York", "Pacific/Kiritimati", "Asia/Kolkata"];

type Config = NonNullable<EngineOptions["config"]>;

/** An engine whose calendar sits in `zone`, on the backend under test. */
function engineIn(zone: string, config?: Config) {
	const calendar = calendarUnderTest() === "temporal" ? temporalCalendarForTests({ timeZone: zone }) : dateCalendarInZone(zone);
	return newTrackedEngine({ calendar, ...(config ? { config } : {}) });
}

/** The line's answer on an engine in `zone`, or the code it threw. */
function on(zone: string, line: string, config?: Config): string {
	const engine = engineIn(zone, config);
	try {
		return engine.formatValue(engine.evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as { code?: string }).code ?? (e as Error).name}`;
	}
}

/** The line's answer on every host zone, asserted to be one answer. */
function everywhere(line: string, config?: Config): string {
	const answers = new Set(ZONES.map((zone) => on(zone, line, config)));
	expect({ line, answers: [...answers] }).toEqual({ line, answers: [on("UTC", line, config)] });
	return on("UTC", line, config);
}

describe("the reported case: a working day on a zoned date is counted on that zone's calendar", () => {
	test.each([
		["2024-11-01 23:30 in New York + 1 workday", "= Monday, November 4, 2024, 11:30:00 PM"],
		["2024-11-02 12:00 in New York + 3 workdays", "= Wednesday, November 6, 2024, 12:00:00 PM"],
		["2024-11-01 23:30 in New York - 1 workday", "= Thursday, October 31, 2024, 11:30:00 PM"],
		["2024-11-01 23:30 in Tokyo + 1 workday", "= Monday, November 4, 2024, 11:30:00 PM"],
		["2024-11-01 23:30 in Tokyo - 1 workday", "= Thursday, October 31, 2024, 11:30:00 PM"],
		["2026-01-02 12:00 in UTC+14 + 1 workday", "= Monday, January 5, 2026, 12:00:00 PM"],
	])("%s is %s on every host zone", (line, answer) => {
		expect(everywhere(line)).toBe(answer);
	});

	test("the spoken form keeps the zone and counts on its calendar, as + workdays does", () => {
		expect(everywhere("3 working days after 2024-11-02 12:00 in New York")).toBe("= Wednesday, November 6, 2024, 12:00:00 PM");
		expect(everywhere("1 working day before 2024-11-04 00:30 in Tokyo")).toBe("= Friday, November 1, 2024, 12:30:00 AM");
		expect(everywhere("3 working days after 2024-11-02 12:00 in New York")).toBe(everywhere("2024-11-02 12:00 in New York + 3 workdays"));
	});

	test("the wall-clock time is kept across the zone's change of clocks", () => {
		// New York springs forward on Sunday 10 March 2024.
		expect(everywhere("2024-03-08 02:30 in New York + 2 workdays")).toBe("= Tuesday, March 12, 2024, 2:30:00 AM");
		// And falls back on Sunday 3 November 2024.
		expect(everywhere("2024-11-01 01:30 in New York + 1 workday")).toBe("= Monday, November 4, 2024, 1:30:00 AM");
	});

	test("working days between two zoned dates count the days their own zones show", () => {
		expect(everywhere("working days between (2024-11-01 23:30 in New York) and (2024-11-08 23:30 in New York)")).toBe("= 6");
		// Friday in New York and Monday in Tokyo: two working days, both ends included.
		expect(everywhere("working days between (2024-11-01 23:30 in New York) and (2024-11-04 00:30 in Tokyo)")).toBe("= 2");
	});

	test("a date with no zone still counts on the backend's calendar, unchanged", () => {
		expect(everywhere("1 working day after 2026-01-01")).toBe("= Friday, January 2, 2026");
		expect(everywhere("working days between 2024-11-01 and 2024-11-08")).toBe("= 6");
		expect(on("America/New_York", "2024-11-01 23:30 + 1 workday")).toBe("= Monday, November 4, 2024, 11:30:00 PM");
	});
});

describe("the walk's own rules still apply on the zone's calendar", () => {
	test("a host holiday is the calendar day the zone shows", () => {
		const config: Config = { date: { holidays: ["2024-11-04"] } };
		expect(everywhere("2024-11-01 23:30 in New York + 1 workday", config)).toBe("= Tuesday, November 5, 2024, 11:30:00 PM");
		expect(everywhere("working days between (2024-11-01 23:30 in New York) and (2024-11-05 23:30 in New York)", config)).toBe("= 2");
	});

	test("a configured weekend is read on the zone's calendar", () => {
		const config: Config = { date: { weekend: ["friday", "saturday"] } };
		// Thursday night in New York: Friday and Saturday are off, so Sunday.
		expect(everywhere("2024-10-31 23:30 in New York + 1 workday", config)).toBe("= Sunday, November 3, 2024, 11:30:00 PM");
	});

	test("the offset limit and a weekend of every day are refused as before", () => {
		expect(everywhere("2024-11-01 in New York + 100000000 workdays")).toBe("THROWS DATE_OFFSET_LIMIT_EXCEEDED");
		const allWeek: Config = { date: { weekend: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] } };
		expect(everywhere("2024-11-01 23:30 in New York + 1 workday", allWeek)).toBe("THROWS DATE_OFFSET_LIMIT_EXCEEDED");
	});

	test("zero working days and a fraction keep the instant's day, as on an unzoned date", () => {
		expect(everywhere("2024-11-02 12:00 in New York + 0 workdays")).toBe("= Saturday, November 2, 2024, 12:00:00 PM");
		expect(everywhere("2024-11-01 23:30 in New York + 1.9 workdays")).toBe(everywhere("2024-11-01 23:30 in New York + 1 workday"));
	});
});

describe("walkDatesInZone and zonedDateAsLocalMidnight", () => {
	const utc = dateCalendarInZone("UTC");
	// 15:30 on 1 November 2024 in UTC is 00:30 on 2 November in Tokyo.
	const instant = Date.UTC(2024, 10, 1, 15, 30, 7, 250);

	test("the walk is handed the zone's date as a local midnight, and the time is put back", () => {
		const seen: number[] = [];
		const moved = walkDatesInZone(instant, "Asia/Tokyo", utc, (midnight) => {
			seen.push(midnight);
			return utc.addDays(midnight, 1);
		});
		expect(seen).toEqual([Date.UTC(2024, 10, 2)]);
		// 00:30:07.250 on 3 November in Tokyo.
		expect(moved).toBe(Date.UTC(2024, 10, 2, 15, 30, 7, 250));
		expect(walkDatesInZone(instant, "Asia/Tokyo", utc, (midnight) => midnight)).toBe(instant);
	});

	test("a walk that gives up gives null, and an unreadable clock gives NaN", () => {
		expect(walkDatesInZone(instant, "Asia/Tokyo", utc, () => null)).toBeNull();
		expect(walkDatesInZone(Number.NaN, "Asia/Tokyo", utc, (m) => m)).toBeNaN();
		expect(walkDatesInZone(Number.POSITIVE_INFINITY, "Asia/Tokyo", utc, (m) => m)).toBeNaN();
		expect(walkDatesInZone(instant, "Mars/Olympus_Mons", utc, (m) => m)).toBeNaN();
		expect(walkDatesInZone(8.64e15 * 2, "Asia/Tokyo", utc, (m) => m)).toBeNaN();
	});

	test("a fixed offset is read as well as a named zone", () => {
		expect(walkDatesInZone(instant, encodeFixedOffset(14 * 60), utc, (m) => m)).toBe(instant);
		expect(walkDatesInZone(instant, encodeFixedOffset(-12 * 60), utc, (m) => utc.addDays(m, 1))).toBe(instant + 86_400_000);
		expect(zonedDateAsLocalMidnight(instant, "Asia/Tokyo", utc)).toBe(Date.UTC(2024, 10, 2));
		expect(zonedDateAsLocalMidnight(instant, "America/New_York", utc)).toBe(Date.UTC(2024, 10, 1));
		expect(zonedDateAsLocalMidnight(Number.NaN, "Asia/Tokyo", utc)).toBeNaN();
		expect(zonedDateAsLocalMidnight(instant, "Mars/Olympus_Mons", utc)).toBeNaN();
	});

	test("an error the walk raises that is not a range error is not swallowed", () => {
		expect(() => walkDatesInZone(instant, "Asia/Tokyo", utc, () => { throw new TypeError("walk failed"); })).toThrow("walk failed");
	});
});

describe("adversarial", () => {
	test("security: prototype words as a zone reach no inherited property and leave Object.prototype alone", () => {
		const utc = dateCalendarInZone("UTC");
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(walkDatesInZone(Date.UTC(2024, 10, 1), word, utc, (m) => m)).toBeNaN();
				expect(zonedDateAsLocalMidnight(Date.UTC(2024, 10, 1), word, utc)).toBeNaN();
				expectHonestLine(`2024-11-01 23:30 in ${word} + 1 workday`);
				expectHonestLine(`3 working days after 2024-11-01 in ${word}`);
			}
		});
	});

	test("realistic: every numeric edge as the count is answered or refused by name", () => {
		for (const edge of NUMERIC_EDGES) {
			expectHonestLine(`2024-11-01 23:30 in New York + ${edge} workdays`);
			expectHonestLine(`${edge} working days after 2024-11-01 23:30 in New York`);
		}
	});

	test("realistic: a document of zoned working days agrees through both passes", () => {
		expectHonestDocument([
			"start = 2024-11-01 23:30 in New York",
			"start + 1 workday",
			"3 working days after start",
			"working days between start and (start + 5 workdays)",
		].join("\n"));
	});

	test("edge: the first and last days a date holds are refused, not thrown raw", () => {
		expectHonestLine("-271821-04-20 in Tokyo + 1 workday");
		expectHonestLine("275760-09-12 in Tokyo + 1 workday");
	});
});
