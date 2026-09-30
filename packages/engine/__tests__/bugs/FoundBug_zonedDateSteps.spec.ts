import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, expectHonestDocument, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { dateCalendarInZone, DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { addZonedCalendarDays, addZonedCalendarMonths, fieldsInZoneRef } from "@solve-js/calendar/ZonedSteps";
import { encodeFixedOffset } from "@solve-js/calendar/IntlZone";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Found bug: a day step on a date read in a zone used the host's calendar
 * rather than the date's zone. `2024-11-02 12:00 in New York + 1 day` answered
 * 11:00 on 3 November on a host in UTC (twenty-four hours on, across the night
 * New York falls back), where New York's clock reads 12:00 a day later; the
 * same line on a host in London or Kiritimati stepped London's or Kiritimati's
 * calendar, so the answer depended on where the engine ran. Weeks, fortnights,
 * months and years had the same fault.
 *
 * A date that carries a zone now steps its days and months on that zone's
 * calendar (`calendar/ZonedSteps.ts`); hours stay elapsed time, as they always
 * were. The boundary: workdays still walk the backend's calendar, pinned below,
 * because the workday walk is being reshaped by #832 (weekend shapes) and the
 * zone belongs in it after that lands. Displaying a zoned date past the range a
 * calendar holds, the other half of this report, threw a raw `RangeError`;
 * #832 refuses such a date where it is made (`DATE_OUT_OF_RANGE`), and the
 * pin below turns green with it.
 */

const ZONES = ["UTC", "Europe/London", "America/New_York", "Pacific/Kiritimati", "Asia/Kolkata"];

/** The line's answer on an engine whose calendar sits in `zone`, or the error it threw. */
function on(zone: string, line: string): string {
	const engine = newTrackedEngine({ calendar: dateCalendarInZone(zone) });
	try {
		return engine.formatValue(engine.evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).name}: ${(e as Error).message}`;
	}
}

/** The line's answer on every backend zone, asserted to be one answer. */
function everywhere(line: string): string {
	const answers = new Set(ZONES.map((zone) => on(zone, line)));
	expect({ line, answers: [...answers] }).toEqual({ line, answers: [on("UTC", line)] });
	return on("UTC", line);
}

describe("the reported case: a day on a zoned date is a day on that zone's clock", () => {
	test.each([
		["2024-11-02 12:00 in New York + 1 day", "= Sunday, November 3, 2024, 12:00:00 PM"],
		["2024-03-09 10:00 in New York + 1 day", "= Sunday, March 10, 2024, 10:00:00 AM"],
		["2024-03-10 01:30 in New York + 1 day", "= Monday, March 11, 2024, 1:30:00 AM"],
		["2024-03-30 12:00 in London + 1 day", "= Sunday, March 31, 2024, 12:00:00 PM"],
		["2024-03-31 12:00 in London - 1 day", "= Saturday, March 30, 2024, 12:00:00 PM"],
		["2024-10-30 09:00 in New York + 1 week", "= Wednesday, November 6, 2024, 9:00:00 AM"],
		["2024-11-02 12:00 in New York + 2 fortnights", "= Saturday, November 30, 2024, 12:00:00 PM"],
		["2024-10-15 09:00 in New York + 1 month", "= Friday, November 15, 2024, 9:00:00 AM"],
		["2024-01-31 12:00 in Tokyo + 1 month", "= Thursday, February 29, 2024, 12:00:00 PM"],
		["2024-02-29 08:00 in Sydney + 1 year", "= Friday, February 28, 2025, 8:00:00 AM"],
		["2024-11-02 in New York + 1 day", "= Sunday, November 3, 2024"],
	])("%s is %s on every host zone", (line, answer) => {
		expect(everywhere(line)).toBe(answer);
	});

	test("an hour stays elapsed time: 24 hours across the fall-back night is 11:00", () => {
		expect(everywhere("2024-11-02 12:00 in New York + 24 hours")).toBe("= Sunday, November 3, 2024, 11:00:00 AM");
	});

	test("a date with no zone still steps the backend's calendar", () => {
		expect(on("America/New_York", "2024-11-02 12:00 + 1 day")).toBe("= Sunday, November 3, 2024, 12:00:00 PM");
		expect(on("Europe/London", "2024-10-26 12:00 + 1 day")).toBe("= Sunday, October 27, 2024, 12:00:00 PM");
	});

	// Workdays walk the backend's calendar still; see this file's header.
	test.failing("a workday on a zoned date is counted on that zone's calendar (after #832)", () => {
		expect(new Set(ZONES.map((zone) => on(zone, "2024-11-02 12:00 in New York + 3 workdays"))).size).toBe(1);
	});

	// The display half of the report, fixed where the date is made by #832.
	test.failing("a zoned date past the calendar's range is refused by name, not a raw RangeError (#832)", () => {
		expect(on("UTC", "2024-01-01 in Tokyo + 1e15 days")).not.toMatch(/RangeError/);
	});
});

describe("the three entry points", () => {
	test("a single expression, the batch pass and the incremental pass agree", () => {
		const text = ["2024-11-02 12:00 in New York + 1 day", "2024-11-02 12:00 in New York + 24 hours", "2024-01-31 12:00 in Tokyo + 1 month"].join("\n");
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch).toEqual(incremental);
		expect(batch[0]).toBe(formatValue(newTrackedEngine().evaluateExpression("2024-11-02 12:00 in New York + 1 day")));
	});
});

describe("the parts", () => {
	const NY = "America/New_York";
	const noonBeforeFallBack = Date.UTC(2024, 10, 2, 16, 0); // 12:00 EDT
	const utc = (y: number, m0: number, d: number, h = 0, min = 0) => Date.UTC(y, m0, d, h, min);

	test("fieldsInZoneRef: a named zone and a fixed offset", () => {
		expect(fieldsInZoneRef(NY, noonBeforeFallBack, DATE_CALENDAR)).toEqual({ year: 2024, month0: 10, day: 2, hour: 12, minute: 0, second: 0 });
		expect(fieldsInZoneRef(encodeFixedOffset(330), utc(2024, 0, 1, 23, 45), DATE_CALENDAR)).toEqual({ year: 2024, month0: 0, day: 2, hour: 5, minute: 15, second: 0 });
		expect(fieldsInZoneRef(encodeFixedOffset(-600), utc(2024, 0, 1, 5), DATE_CALENDAR).day).toBe(31);
	});

	test("addZonedCalendarDays: ordinary steps across both transitions, back and forth", () => {
		expect(addZonedCalendarDays(noonBeforeFallBack, 1, NY, DATE_CALENDAR)).toBe(utc(2024, 10, 3, 17));
		expect(addZonedCalendarDays(utc(2024, 10, 3, 17), -1, NY, DATE_CALENDAR)).toBe(noonBeforeFallBack);
		expect(addZonedCalendarDays(utc(2024, 2, 9, 15), 1, NY, DATE_CALENDAR)).toBe(utc(2024, 2, 10, 14));
		expect(addZonedCalendarDays(noonBeforeFallBack, 0, NY, DATE_CALENDAR)).toBe(noonBeforeFallBack);
	});

	test("addZonedCalendarDays: a fraction is elapsed time, and the milliseconds are kept", () => {
		expect(addZonedCalendarDays(noonBeforeFallBack, 1.5, NY, DATE_CALENDAR)).toBe(utc(2024, 10, 3, 17) + 12 * 3_600_000);
		expect(addZonedCalendarDays(noonBeforeFallBack + 1_234, 1, NY, DATE_CALENDAR)).toBe(utc(2024, 10, 3, 17) + 1_234);
		expect(addZonedCalendarDays(noonBeforeFallBack - 1, 1, NY, DATE_CALENDAR)).toBe(utc(2024, 10, 3, 17) - 1);
	});

	test("addZonedCalendarDays: a fixed offset is 24 hours a day", () => {
		const zone = encodeFixedOffset(300);
		expect(addZonedCalendarDays(utc(2024, 10, 2, 7), 1, zone, DATE_CALENDAR)).toBe(utc(2024, 10, 3, 7));
	});

	test("addZonedCalendarMonths: the day is clamped, the year rolls, and back again", () => {
		const month = 30.436875 * 86_400_000;
		const tokyoNoon = (y: number, m0: number, d: number) => Date.UTC(y, m0, d, 3);
		expect(addZonedCalendarMonths(tokyoNoon(2024, 0, 31), 1, "Asia/Tokyo", DATE_CALENDAR, month)).toBe(tokyoNoon(2024, 1, 29));
		expect(addZonedCalendarMonths(tokyoNoon(2023, 0, 31), 1, "Asia/Tokyo", DATE_CALENDAR, month)).toBe(tokyoNoon(2023, 1, 28));
		expect(addZonedCalendarMonths(tokyoNoon(2024, 11, 15), 1, "Asia/Tokyo", DATE_CALENDAR, month)).toBe(tokyoNoon(2025, 0, 15));
		expect(addZonedCalendarMonths(tokyoNoon(2024, 0, 15), -1, "Asia/Tokyo", DATE_CALENDAR, month)).toBe(tokyoNoon(2023, 11, 15));
		expect(addZonedCalendarMonths(tokyoNoon(2024, 2, 31), -13, "Asia/Tokyo", DATE_CALENDAR, month)).toBe(tokyoNoon(2023, 1, 28));
	});

	test("hostile: an instant or a count that is not finite falls back to the linear step, and throws nothing", () => {
		expect(addZonedCalendarDays(Number.NaN, 1, NY, DATE_CALENDAR)).toBeNaN();
		expect(addZonedCalendarDays(8.64e15, 1, NY, DATE_CALENDAR)).toBe(8.64e15 + 86_400_000);
		expect(addZonedCalendarDays(noonBeforeFallBack, Number.POSITIVE_INFINITY, NY, DATE_CALENDAR)).toBe(Number.POSITIVE_INFINITY);
		expect(addZonedCalendarMonths(noonBeforeFallBack, 1e15, NY, DATE_CALENDAR, 1)).toBe(noonBeforeFallBack + 1e15);
	});

	test("hostile: a zone the runtime does not know falls back to the linear step", () => {
		expectPrototypeUntouched(() => {
			for (const zone of [...PROTOTYPE_WORDS, "Not/AZone"]) {
				expect(addZonedCalendarDays(noonBeforeFallBack, 1, zone, DATE_CALENDAR)).toBe(noonBeforeFallBack + 86_400_000);
			}
		});
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("%s as a zone name is refused honestly", (word) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(`2024-11-02 12:00 in ${word} + 1 day`);
		});
	});

	test("a step of a million days in a zone is answered within budget", () => {
		const started = performance.now();
		expect(everywhere("2024-11-02 12:00 in New York + 1000000 days")).toBe("= Sunday, September 30, 4762, 12:00:00 PM");
		expect(performance.now() - started).toBeLessThan(5_000);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a step read from a line above, and a step in a zone read into another", () => {
		const text = ["meeting = 2024-11-02 12:00 in New York", "meeting + 1 day", "(meeting + 1 day) in Tokyo"].join("\n");
		const { batch } = expectHonestDocument(text);
		expect(batch[1]).toBe("= Sunday, November 3, 2024, 12:00:00 PM");
	});

	test("stepping forward and back returns the same instant", () => {
		expect(everywhere("2024-11-02 12:00 in New York + 1 day - 1 day")).toBe("= Saturday, November 2, 2024, 12:00:00 PM");
		expect(everywhere("2024-03-10 01:30 in New York + 1 week - 1 week")).toBe("= Sunday, March 10, 2024, 1:30:00 AM");
	});
});

describe("adversarial: edge cases", () => {
	test("a leap day, a month end and a year end in a zone", () => {
		expect(everywhere("2024-02-28 09:00 in Tokyo + 1 day")).toBe("= Thursday, February 29, 2024, 9:00:00 AM");
		expect(everywhere("2024-12-31 23:30 in Tokyo + 1 day")).toBe("= Wednesday, January 1, 2025, 11:30:00 PM");
		expect(everywhere("2023-03-31 12:00 in Sydney + 1 month")).toBe("= Sunday, April 30, 2023, 12:00:00 PM");
	});

	// A step far enough to leave the calendar's range is the display half of
	// the report, pinned above until #832 lands; the edges within range here.
	const withinRange = NUMERIC_EDGES.filter((edge) => !/[/e^]/.test(edge) && edge.length < 16);
	test.each(withinRange)("a step of %s days is honest on every host zone", (edge) => {
		for (const zone of ZONES) {
			const engine = newTrackedEngine({ calendar: dateCalendarInZone(zone) });
			expectHonestLine(`2024-11-02 12:00 in New York + (${edge}) days`, { engine });
		}
	});
});
