import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { temporalForTests } from "@tools/temporalTestKit";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue, isoYear, slashYear } from "@solve-js/format/FormatEngine";
import { DATE_CALENDAR, dateCalendarInZone, localDate } from "@solve-js/calendar/DateCalendar";
import { createTemporalCalendar } from "@solve-js/temporal/TemporalCalendar";
import { dayNumber, daysInMonth, isoWeekNumber, utcMs } from "@solve-js/calendar/Gregorian";
import {
	YEAR_ONE_UTC_MS,
	dateInZone,
	longDateInZone,
	longDateOptions,
	mayPrecedeYearOne,
	namedZoneWallClockToUtcMs,
	zonedFields,
} from "@solve-js/calendar/IntlZone";
import { describeUnrealDay } from "@solve-js/packages/datetime/DateReading";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import type { DateOutputFormat } from "@solve-js/format/FormattingSettings";

/**
 * Issue #823: a date before year 1 was shown without its era, so 975 BC read
 * as AD 975; the zone-bound `Date` backend read `Intl`'s era year as an
 * astronomical one and put `3000 years ago` in 2924; and `1 Jan 0001` was
 * refused as "not a real date", because every backend built the day through
 * `Date`'s reading of a year from 0 to 99 as the 1900s and then found 1901.
 *
 * The clock is pinned at noon on 11 March 2026 for the backends that take one;
 * the default `Date` backend is asked about literal dates only, so no line here
 * depends on when or where it runs.
 */

const NOON = Date.UTC(2026, 2, 11, 12);

/** The backends every document-level row is proven on. */
function backends(): Array<[string, CalendarBackend]> {
	return [
		["Date, the process zone", DATE_CALENDAR],
		["Date in Europe/London", dateCalendarInZone("Europe/London", { now: () => NOON })],
		["Date in America/New_York", dateCalendarInZone("America/New_York", { now: () => NOON })],
		["Temporal in Europe/London", createTemporalCalendar(temporalForTests(), { timeZone: "Europe/London", now: () => NOON })],
	];
}

/** A line as a reader sees it in one date format, or its refusal. */
function shown(calendar: CalendarBackend, line: string, format: DateOutputFormat = "long"): string {
	try {
		const value = newTrackedEngine({ calendar }).evaluateExpression(line);
		return formatValue(value, { calendar, dateResult: { format } });
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("a date before year 1 is shown with its era, on every backend", () => {
	const rows: Array<[string, string, string, string]> = [
		// line, long, iso, dmy
		["11 March 2026 - 3000 years", "= Saturday, March 11, 975 BC", "= -000974-03-11", "= 11/03/975 BC"],
		["11 March 2026 - 2100 years", "= Thursday, March 11, 75 BC", "= -000074-03-11", "= 11/03/75 BC"],
		["1 Jan 0001 - 1 day", "= Sunday, December 31, 1 BC", "= 0000-12-31", "= 31/12/1 BC"],
		["29 Feb 0000", "= Tuesday, February 29, 1 BC", "= 0000-02-29", "= 29/02/1 BC"],
	];
	for (const [name, calendar] of backends()) {
		test.each(rows)(`${name}: %s`, (line, long, iso, dmy) => {
			expect(shown(calendar, line)).toBe(long);
			expect(shown(calendar, line, "iso")).toBe(iso);
			expect(shown(calendar, line, "dmy")).toBe(dmy);
		});
	}

	test("the month-first form carries the era too", () => {
		expect(shown(DATE_CALENDAR, "11 March 2026 - 3000 years", "mdy")).toBe("= 03/11/975 BC");
	});

	test("a date in the common era is written as it always was, with no AD", () => {
		for (const [, calendar] of backends()) {
			expect(shown(calendar, "11 March 2026")).toBe("= Wednesday, March 11, 2026");
			expect(shown(calendar, "11 March 2026", "iso")).toBe("= 2026-03-11");
			expect(shown(calendar, "11 March 2026", "dmy")).toBe("= 11/03/2026");
		}
	});

	test("an ISO year below 1000 keeps four digits", () => {
		expect(shown(DATE_CALENDAR, "11 March 2026 - 1051 years")).toBe("= Saturday, March 11, 975");
		expect(shown(DATE_CALENDAR, "11 March 2026 - 1051 years", "iso")).toBe("= 0975-03-11");
	});

	test("the era follows the locale the date is written in", () => {
		const value = newTrackedEngine({ calendar: DATE_CALENDAR }).evaluateExpression("11 March 2026 - 3000 years");
		expect(formatValue(value, { numberResult: { decimalSeparatorLocale: "de-DE" } })).toBe("= Samstag, 11. März 975 v. Chr.");
		expect(formatValue(value, { numberResult: { decimalSeparatorLocale: "en-GB" } })).toBe("= Saturday, 11 March 975 BC");
	});
});

describe("the zone-bound Date backend reads the year before year 1 (the 2924 row)", () => {
	test("3000 years before noon on 11 March 2026 is 975 BC, at noon", () => {
		const calendar = dateCalendarInZone("Europe/London", { now: () => NOON });
		expect(shown(calendar, "today - 3000 years")).toBe("= Saturday, March 11, 975 BC, 12:00:00 PM");
	});

	test("it agrees with the Temporal backend in the same zone, instant for instant", () => {
		const zoned = dateCalendarInZone("Europe/London", { now: () => NOON });
		const temporal = createTemporalCalendar(temporalForTests(), { timeZone: "Europe/London", now: () => NOON });
		for (const line of ["today - 3000 years", "1 Jan 0001", "1 Jan 0001 - 1 day", "3 April 0026 + 1 day", "31 Jan 0001 + 1 month", "1 Jan 1800"]) {
			const a = newTrackedEngine({ calendar: zoned }).evaluateExpression(line);
			const b = newTrackedEngine({ calendar: temporal }).evaluateExpression(line);
			expect({ line, ms: a.value }).toEqual({ line, ms: b.value });
		}
	});
});

describe("year 1 and the first century are real years", () => {
	test.each([
		["1 Jan 0001", "= Monday, January 1, 1"],
		["0001-01-01", "= Monday, January 1, 1"],
		["2 Jan 0001", "= Tuesday, January 2, 1"],
		["3 April 0026", "= Friday, April 3, 26"],
		["3 April 0026 + 1 day", "= Saturday, April 4, 26"],
		["31 Jan 0001 + 1 month", "= Wednesday, February 28, 1"],
		["days between 1 Jan 0001 and 1 Jan 0002", "= 365 days"],
		["1 Jan 0001 as week", "= 1"],
	])("%s is %s on every backend", (line, expected) => {
		for (const [name, calendar] of backends()) {
			expect({ name, shown: shown(calendar, line) }).toEqual({ name, shown: expected });
		}
	});

	test("a day that year does not have is refused with the year as it was written", () => {
		expect(shown(DATE_CALENDAR, "30 Feb 0001")).toBe('"30 Feb 0001" is not a real date: February 0001 has 28 days.');
	});

	test("London before standard time: 1 January 1800 is that day on the zone-bound backend", () => {
		// London kept local mean time, 1 minute 15 seconds behind UTC, until
		// 1847; the offset rounded to a minute put midnight 15 seconds early.
		expect(shown(dateCalendarInZone("Europe/London"), "1 Jan 1800")).toBe("= Wednesday, January 1, 1800");
	});
});

describe("the parts", () => {
	describe("Gregorian helpers read the year as written", () => {
		test("utcMs", () => {
			expect(utcMs(1, 0, 1)).toBe(YEAR_ONE_UTC_MS);
			expect(new Date(utcMs(26, 3, 3)).getUTCFullYear()).toBe(26);
			expect(new Date(utcMs(0, 0, 1)).getUTCFullYear()).toBe(0);
			expect(new Date(utcMs(99, 12, 1)).getUTCFullYear()).toBe(100);
			expect(new Date(utcMs(100, -1, 1)).getUTCFullYear()).toBe(99);
			expect(new Date(utcMs(-1, 0, 1)).getUTCFullYear()).toBe(-1);
			// `Date.UTC` truncates -0.5 to year 0, and so does this.
			expect(new Date(utcMs(-0.5, 0, 1)).getUTCFullYear()).toBe(0);
			expect(utcMs(2026, 2, 11, 12)).toBe(NOON);
			expect(utcMs(Number.NaN, 0, 1)).toBeNaN();
			expect(utcMs(Number.POSITIVE_INFINITY, 0, 1)).toBeNaN();
		});

		test("dayNumber and isoWeekNumber", () => {
			expect(dayNumber(1, 0, 1) - dayNumber(0, 11, 31)).toBe(1);
			expect(dayNumber(1970, 0, 1)).toBe(0);
			// 1 January of year 1 is a Monday, so it is in week 1.
			expect(isoWeekNumber(1, 0, 1)).toBe(1);
			// 2000 years is five 400-year cycles, so the weeks fall the same way.
			expect(isoWeekNumber(26, 3, 3)).toBe(isoWeekNumber(2026, 3, 3));
		});

		test("daysInMonth", () => {
			expect(daysInMonth(0, 1)).toBe(29);
			expect(daysInMonth(1, 1)).toBe(28);
			expect(daysInMonth(100, 1)).toBe(28);
			expect(daysInMonth(-4, 1)).toBe(29);
		});
	});

	test("localDate builds local midnight on the year as written", () => {
		expect(localDate(26, 3, 3).getFullYear()).toBe(26);
		expect(localDate(0, 0, 1).getFullYear()).toBe(0);
		expect(localDate(99, 11, 31).getFullYear()).toBe(99);
		expect(localDate(26, 12, 1).getFullYear()).toBe(27);
		expect(localDate(2026, 2, 11).getTime()).toBe(new Date(2026, 2, 11).getTime());
		expect(localDate(-1, 0, 1).getFullYear()).toBe(-1);
		expect(localDate(Number.NaN, 0, 1).getTime()).toBeNaN();
		const d = localDate(1, 0, 1);
		expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
	});

	test("zonedFields gives an astronomical year before year 1", () => {
		const bc975 = newTrackedEngine({ calendar: DATE_CALENDAR }).evaluateExpression("11 March 2026 - 3000 years").value as number;
		expect(zonedFields("UTC", bc975).year).toBe(-974);
		expect(zonedFields("UTC", YEAR_ONE_UTC_MS).year).toBe(1);
		expect(zonedFields("UTC", YEAR_ONE_UTC_MS - 1).year).toBe(0);
		expect(zonedFields("UTC", 0)).toEqual({ year: 1970, month0: 0, day: 1, hour: 0, minute: 0, second: 0 });
	});

	test("mayPrecedeYearOne is a cheap bound, true near and before year 1", () => {
		expect(mayPrecedeYearOne(YEAR_ONE_UTC_MS)).toBe(true);
		expect(mayPrecedeYearOne(YEAR_ONE_UTC_MS - 1)).toBe(true);
		expect(mayPrecedeYearOne(-8.64e15)).toBe(true);
		expect(mayPrecedeYearOne(0)).toBe(false);
		expect(mayPrecedeYearOne(NOON)).toBe(false);
		expect(mayPrecedeYearOne(Number.NaN)).toBe(false);
		expect(mayPrecedeYearOne(Number.NEGATIVE_INFINITY)).toBe(true);
	});

	test("longDateOptions adds the era only when asked", () => {
		expect(longDateOptions(false)).toEqual({ weekday: "long", year: "numeric", month: "long", day: "numeric" });
		expect(longDateOptions(true)).toEqual({ weekday: "long", year: "numeric", month: "long", day: "numeric", era: "short" });
		// A fresh object each call, so a caller spreading it cannot change the next one.
		expect(longDateOptions(false)).not.toBe(longDateOptions(false));
	});

	test("longDateInZone and dateInZone write the era before year 1 only", () => {
		expect(longDateInZone("UTC", YEAR_ONE_UTC_MS - 1, "en-US")).toBe("Sunday, December 31, 1 BC");
		expect(longDateInZone("UTC", YEAR_ONE_UTC_MS, "en-US")).toBe("Monday, January 1, 1");
		expect(dateInZone("UTC", YEAR_ONE_UTC_MS - 1)).toBe("December 31, 1 BC");
		expect(dateInZone("UTC", NOON)).toBe("March 11, 2026");
		// A zone ahead of UTC is already in year 1 at that instant.
		expect(longDateInZone("Asia/Tokyo", YEAR_ONE_UTC_MS - 1, "en-US")).toBe("Monday, January 1, 1");
	});

	test("namedZoneWallClockToUtcMs resolves to the second", () => {
		expect(namedZoneWallClockToUtcMs(1800, 0, 1, 0, 0, "Europe/London")).toBe(Date.UTC(1800, 0, 1, 0, 1, 15));
		expect(namedZoneWallClockToUtcMs(2026, 2, 11, 12, 0, "Europe/London")).toBe(NOON);
		expect(namedZoneWallClockToUtcMs(2026, 6, 1, 0, 0, "Europe/London")).toBe(Date.UTC(2026, 5, 30, 23));
		// A spring-forward gap resolves later, as Temporal's "compatible" does.
		expect(namedZoneWallClockToUtcMs(2026, 2, 29, 1, 30, "Europe/London")).toBe(Date.UTC(2026, 2, 29, 1, 30));
		expect(namedZoneWallClockToUtcMs(1, 0, 1, 0, 0, "UTC")).toBe(YEAR_ONE_UTC_MS);
		expect(namedZoneWallClockToUtcMs(Number.NaN, 0, 1, 0, 0, "UTC")).toBeNaN();
		expect(namedZoneWallClockToUtcMs(300_000, 0, 1, 0, 0, "UTC")).toBeNaN();
	});

	test("isoYear", () => {
		expect([0, 1, 26, 975, 2026, 9999].map(isoYear)).toEqual(["0000", "0001", "0026", "0975", "2026", "9999"]);
		expect([10_000, 275_760, -1, -974, -271_821].map(isoYear)).toEqual(["+010000", "+275760", "-000001", "-000974", "-271821"]);
		expect(isoYear(Number.NaN)).toBe("NaN");
		expect(isoYear(-0)).toBe("0000");
	});

	test("slashYear", () => {
		expect([2026, 975, 1].map(slashYear)).toEqual(["2026", "975", "1"]);
		expect([0, -1, -974].map(slashYear)).toEqual(["1 BC", "2 BC", "975 BC"]);
		expect(slashYear(-0)).toBe("1 BC");
		expect(slashYear(Number.NaN)).toBe("NaN");
	});

	test("describeUnrealDay writes a year below 1000 as four digits", () => {
		expect(describeUnrealDay(30, 2, 1)).toBe("February 0001 has 28 days");
		expect(describeUnrealDay(31, 4, 26)).toBe("April 0026 has 30 days");
		expect(describeUnrealDay(30, 2, 2026)).toBe("February 2026 has 28 days");
		expect(describeUnrealDay(1, 13, 1)).toBe("there is no month 13");
	});

	test("the Temporal backend steps a day and a month in the first century without leaving it", () => {
		const calendar = createTemporalCalendar(temporalForTests(), { timeZone: "UTC" });
		const start = calendar.localMidnight(50, 5, 15);
		expect(calendar.fields(start).year).toBe(50);
		expect(calendar.fields(calendar.addDays(start, 1))).toMatchObject({ year: 50, month0: 5, day: 16 });
		expect(calendar.fields(calendar.addMonths(start, 1))).toMatchObject({ year: 50, month0: 6, day: 15 });
	});

	test("the zone-bound backend answers NaN, not a RangeError, past the range", () => {
		const calendar = dateCalendarInZone("Europe/London");
		expect(calendar.fields(Number.NaN).year).toBeNaN();
		expect(calendar.fields(9e15).year).toBeNaN();
		expect(calendar.addDays(Number.NaN, 1)).toBeNaN();
		expect(calendar.addMonths(Number.POSITIVE_INFINITY, 1)).toBeNaN();
		expect(calendar.utcOffsetMinutes(Number.NaN)).toBeNaN();
		expect(calendar.formatLongDate(Number.NaN, "en-US")).toBe("Invalid Date");
		expect(calendar.formatTimeOfDay(Number.NaN, "en-US")).toBe("Invalid Date");
	});
});

describe("adversarial", () => {
	describe("security", () => {
		test("a prototype word where the year goes is read as text, and Object.prototype is untouched", () => {
			expectPrototypeUntouched(() => {
				for (const line of fill("1 Jan X", PROTOTYPE_WORDS)) expectHonestLine(line);
				for (const line of fill("X - 3000 years", PROTOTYPE_WORDS)) expectHonestLine(line);
			});
		});

		test("look-alike digits and markup around a first-century date are honest", () => {
			for (const line of ["1 Jan ٠٠٠١", "1 Jan ０００１", "1 Jan 0​001", "‮1 Jan 0001", "<b>1 Jan 0001</b>", ...fill("1 Jan 0001 X", TEXT_EDGES)]) {
				expectHonestLine(line);
			}
		});

		test("a huge step back is refused or answered within the budget, never a raw error", () => {
			for (const calendar of [DATE_CALENDAR, dateCalendarInZone("Europe/London"), createTemporalCalendar(temporalForTests(), { timeZone: "UTC" })]) {
				const engine = newTrackedEngine({ calendar });
				for (const line of ["1 Jan 0001 - 300000 years", "1 Jan 0001 - 10^9 days", "11 March 2026 - 271821 years"]) {
					expectHonestLine(line, { engine, allowNaN: true, budgetMs: 2_000 });
					// Formatting it must not throw either.
					const v = engine.evaluateExpression(line);
					expect(() => formatValue(v, { calendar })).not.toThrow();
				}
			}
		});
	});

	describe("realistic breakage", () => {
		test("a first-century date from the line above, through both document passes", () => {
			const doc = "start = 1 Jan 0001\nstart - 1 day\nstart + 1 month\ndays between start and 1 Jan 0002";
			const calendar = dateCalendarInZone("Europe/London", { now: () => NOON });
			const batch = newTrackedEngine({ calendar }).parseDocument(doc).lines.map((l) => (l.result ? formatValue(l.result, { calendar }) : l.error));
			const incremental = evaluateDocument(newTrackedEngine({ calendar }), doc).lines.map((l) => (l.result ? formatValue(l.result, { calendar }) : l.error));
			expect(batch).toEqual(["= Monday, January 1, 1", "= Sunday, December 31, 1 BC", "= Thursday, February 1, 1", "= 365 days"]);
			expect(incremental).toEqual(batch);
		});

		test("the default formatter with no calendar still writes the era", () => {
			const value = newTrackedEngine({ calendar: DATE_CALENDAR }).evaluateExpression("1 Jan 0001 - 1 day");
			expect(formatValue(value)).toBe("= Sunday, December 31, 1 BC");
		});
	});

	describe("edge cases", () => {
		test("the last day of 1 BC and the first of AD 1 sit either side of the era", () => {
			expect(shown(DATE_CALENDAR, "1 Jan 0001 - 1 day")).toBe("= Sunday, December 31, 1 BC");
			expect(shown(DATE_CALENDAR, "31 Dec 0000 + 1 day")).toBe("= Monday, January 1, 1");
		});

		test("year 0 is a leap year and year 1 is not", () => {
			expect(shown(DATE_CALENDAR, "29 Feb 0000")).toBe("= Tuesday, February 29, 1 BC");
			expect(shown(DATE_CALENDAR, "29 Feb 0001")).toBe('"29 Feb 0001" is not a real date: February 0001 has 28 days.');
		});

		test("the year 99 rolls into 100 and the year 100 back into 99", () => {
			expect(shown(DATE_CALENDAR, "31 Dec 0099 + 1 day")).toBe("= Friday, January 1, 100");
			expect(shown(DATE_CALENDAR, "1 Jan 0100 - 1 day")).toBe("= Thursday, December 31, 99");
		});
	});
});
