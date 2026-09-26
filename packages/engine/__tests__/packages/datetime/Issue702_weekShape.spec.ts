/**
 * #702: a configurable weekend and first day of the week, inferred from a
 * locale's region where the runtime reports it.
 *
 * Working-day arithmetic hard-coded Saturday and Sunday, so where the weekend
 * is Friday and Saturday no configuration could make Sunday a working day. The
 * week now has a shape: `date.weekend` and `date.firstDayOfWeek`, or the
 * region of the engine's locale tag, or Saturday and Sunday off with the week
 * starting on Monday.
 *
 * Each engine runs on a pinned clock (Wednesday 11 March 2026, noon, London)
 * on the calendar backend under test.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { calendarUnderTest, temporalCalendarForTests } from "@tools/temporalTestKit";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { DEFAULT_WEEK, resolveWeekShape, weekFromLocale, type WeekIntl, type WeekdayName } from "@solve-js/calendar/WeekShape";
import { isWeekend, addBusinessDays, countBusinessDaysBetween } from "@solve-js/vm/BusinessDays";

interface Setup {
	locale?: string;
	weekend?: WeekdayName[];
	firstDayOfWeek?: WeekdayName;
	holidays?: (ms: number) => boolean;
}

/** An engine on the pinned clock, with the week settings given. */
function engine(setup: Setup = {}) {
	const inner = calendarUnderTest() === "temporal" ? temporalCalendarForTests({ timeZone: "Europe/London" }) : dateCalendarInZone("Europe/London");
	const calendar = new RecordingCalendar(Date.parse("2026-03-11T12:00:00Z"), inner);
	const date: Record<string, unknown> = {};
	if (setup.weekend !== undefined) date.weekend = setup.weekend;
	if (setup.firstDayOfWeek !== undefined) date.firstDayOfWeek = setup.firstDayOfWeek;
	if (setup.holidays !== undefined) date.holidays = setup.holidays;
	const e = newTrackedEngine({ locale: setup.locale, calendar, config: { network: { enabled: false }, date } as never });
	return {
		e,
		// Written through the engine's calendar, so a date reads in London whatever the host's zone.
		show: (line: string): string => formatValue(e.evaluateExpression(line), { ...DEFAULT_FORMATTING_SETTINGS, calendar }).replace(/^=\s*/, ""),
	};
}

const FRIDAY_SATURDAY: WeekdayName[] = ["friday", "saturday"];

describe("#702: the default is unchanged", () => {
	const { show } = engine();
	test.each([
		["1 working day after 2026-01-01", "Friday, January 2, 2026"],
		["working days between 2026-01-01 and 2026-01-11", "7"],
		["2026-01-04 is a weekend", "true"],
		["2026-01-02 is a weekend", "false"],
		["start of week", "Monday, March 9, 2026"],
		["end of week", "Sunday, March 15, 2026"],
		["week number of 2026-03-11", "11"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("a bare language names no region, so the default engine's week does not move", () => {
		expect(engine({ locale: "en" }).show("start of week")).toBe("Monday, March 9, 2026");
		expect(weekFromLocale("en")).toBeNull();
		expect(weekFromLocale("de")).toBeNull();
	});
});

describe("#702: a configured weekend", () => {
	const { show } = engine({ weekend: FRIDAY_SATURDAY });

	test.each([
		["1 working day after 2026-01-01", "Sunday, January 4, 2026"],
		["1 working day before 2026-01-04", "Thursday, January 1, 2026"],
		["working days between 2026-01-01 and 2026-01-11", "7"],
		["2026-01-02 is a weekend", "true"],
		["2026-01-03 is a weekend", "true"],
		["2026-01-04 is a weekend", "false"],
		["2026-01-04 is a workday", "true"],
		["2026-01-02 is a workday", "false"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("is a weekend on each day of a week", () => {
		const days = ["2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10"].map((d) => show(`${d} is a weekend`));
		expect(days).toEqual(["false", "false", "false", "false", "false", "true", "true"]);
	});

	test("the weekend is read as a list of names in any case", () => {
		expect(engine({ weekend: ["Friday", "SATURDAY"] as WeekdayName[] }).show("2026-01-02 is a weekend")).toBe("true");
	});

	test("a weekend and a holiday predicate both apply", () => {
		// Sunday 4 January is a holiday as well as the first working day.
		const holidays = (ms: number) => new Date(ms).getUTCDate() === 4 && new Date(ms).getUTCMonth() === 0;
		const { show: s } = engine({ weekend: FRIDAY_SATURDAY, holidays });
		expect(s("1 working day after 2026-01-01")).toBe("Monday, January 5, 2026");
		expect(s("working days between 2026-01-01 and 2026-01-11")).toBe("6");
	});

	test("an empty weekend makes every day a working day", () => {
		const { show: s } = engine({ weekend: [] });
		expect(s("1 working day after 2026-01-02")).toBe("Saturday, January 3, 2026");
		expect(s("working days between 2026-01-01 and 2026-01-07")).toBe("7");
		expect(s("2026-01-03 is a weekend")).toBe("false");
	});

	test("a weekend of all seven days is refused before any walk, not after a hang", () => {
		const { e, show: s } = engine({ weekend: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] });
		expect(() => e.evaluateExpression("1 working day after 2026-01-01")).toThrow(
			expect.objectContaining({ code: "DATE_OFFSET_LIMIT_EXCEEDED", message: expect.stringMatching(/the configured weekend is every day of the week, so no day is a working day/) }),
		);
		expect(s("working days between 2026-01-01 and 2026-01-31")).toBe("0");
		expect(s("2026-01-05 is a workday")).toBe("false");
	});
});

describe("#702: the first day of the week", () => {
	test("a configured first day moves the week forms", () => {
		const { show } = engine({ firstDayOfWeek: "sunday" });
		expect(show("start of week")).toBe("Sunday, March 8, 2026");
		expect(show("end of week")).toBe("Saturday, March 14, 2026");
		expect(show("next week")).toBe("Sunday, March 15, 2026");
		expect(show("last week")).toBe("Sunday, March 1, 2026");
	});

	test("the ISO week number stays ISO", () => {
		expect(engine({ firstDayOfWeek: "sunday" }).show("week number of 2026-03-08")).toBe("10");
	});

	test("a first day later in the week than today counts back into the week before", () => {
		// Wednesday, with the week starting on Saturday: this week began on Saturday 7 March.
		expect(engine({ firstDayOfWeek: "saturday" }).show("this week")).toBe("Saturday, March 7, 2026");
		expect(engine({ firstDayOfWeek: "wednesday" }).show("this week")).toBe("Wednesday, March 11, 2026");
		expect(engine({ firstDayOfWeek: "thursday" }).show("this week")).toBe("Thursday, March 5, 2026");
	});
});

describe("#702: inferred from the locale's region", () => {
	test.each([
		["en-GB", "Monday, March 9, 2026", "2026-01-04 is a weekend", "true"],
		["en-US", "Sunday, March 8, 2026", "2026-01-04 is a weekend", "true"],
		["ar-SA", "Sunday, March 8, 2026", "2026-01-02 is a weekend", "true"],
		["he-IL", "Sunday, March 8, 2026", "2026-01-03 is a weekend", "true"],
		["fa-IR", "Saturday, March 7, 2026", "2026-01-03 is a weekend", "false"],
	])("%s", (locale, weekStart, weekendLine, weekendAnswer) => {
		const { show } = engine({ locale });
		expect(show("start of week")).toBe(weekStart);
		expect(show(weekendLine)).toBe(weekendAnswer);
	});

	test("ar-SA's Friday and Saturday weekend reaches the working-day walk", () => {
		expect(engine({ locale: "ar-SA" }).show("1 working day after 2026-01-01")).toBe("Sunday, January 4, 2026");
	});

	test("an explicit setting overrides the locale, each setting on its own", () => {
		const { show } = engine({ locale: "ar-SA", weekend: ["saturday", "sunday"] });
		expect(show("1 working day after 2026-01-01")).toBe("Friday, January 2, 2026");
		// The first day still comes from the locale.
		expect(show("start of week")).toBe("Sunday, March 8, 2026");
		expect(engine({ locale: "en-US", firstDayOfWeek: "monday" }).show("start of week")).toBe("Monday, March 9, 2026");
	});

	test("a POSIX underscore tag is read as its hyphenated form", () => {
		expect(weekFromLocale("ar_SA")?.weekend).toEqual(new Set([5, 6]));
	});
});

describe("#702 adversarial: settings and runtimes", () => {
	test.each([
		[{ weekend: ["fri"] }],
		[{ weekend: ["__proto__"] }],
		[{ weekend: ["constructor"] }],
		[{ firstDayOfWeek: "funday" }],
		[{ firstDayOfWeek: "toString" }],
		[{ weekend: "friday" }],
		[{ weekend: [5] }],
	])("%j is refused at construction with DATE_WEEKDAY_INVALID", (date) => {
		expect(() => newTrackedEngine({ config: { date } as never })).toThrow(expect.objectContaining({ code: "DATE_WEEKDAY_INVALID" }));
	});

	test("a runtime with no week information leaves the default in place", () => {
		const noWeekInfo: WeekIntl = { Locale: class { constructor(_tag: string) {} } };
		expect(weekFromLocale("ar-SA", noWeekInfo)).toBeNull();
		expect(resolveWeekShape("ar-SA", undefined, undefined, noWeekInfo)).toBe(DEFAULT_WEEK);
	});

	test("a runtime that throws on the tag leaves the default in place", () => {
		const throwing: WeekIntl = { Locale: class { constructor(_tag: string) { throw new RangeError("bad tag"); } } };
		expect(resolveWeekShape("ar-SA", undefined, undefined, throwing)).toBe(DEFAULT_WEEK);
	});

	test("an older runtime's weekInfo getter is read as the newer getWeekInfo() is", () => {
		const older: WeekIntl = { Locale: class { weekInfo = { firstDay: 6, weekend: [5], minimalDays: 1 }; constructor(_tag: string) {} } };
		const week = weekFromLocale("fa-IR", older);
		expect(week?.firstDay).toBe(6);
		expect(week?.weekend).toEqual(new Set([5]));
	});

	test("week information out of range is dropped rather than trusted", () => {
		const odd: WeekIntl = { Locale: class { getWeekInfo() { return { firstDay: 7, weekend: [6, 7, 9, -1, 2.5] }; } constructor(_tag: string) {} } };
		expect(weekFromLocale("xx-YY", odd)?.weekend).toEqual(new Set([6, 0]));
	});

	test("a tag with no region, or not a tag at all, is not read", () => {
		for (const tag of ["en", "ar", "", "__proto__", "x".repeat(10_000), "en-", "123"]) {
			expect(weekFromLocale(tag)).toBeNull();
		}
	});

	test("the pure functions default to Saturday and Sunday", () => {
		// Read in UTC, so the days are the same days in every host zone.
		const utc = dateCalendarInZone("UTC");
		const saturday = Date.UTC(2026, 0, 3, 12);
		expect(isWeekend(saturday, utc)).toBe(true);
		expect(isWeekend(saturday, utc, new Set([5]))).toBe(false);
		expect(addBusinessDays(Date.UTC(2026, 0, 1, 12), 1, undefined, 30, utc, new Set([5, 6]))).toBe(Date.UTC(2026, 0, 4, 12));
		expect(countBusinessDaysBetween(Date.UTC(2026, 0, 1, 12), Date.UTC(2026, 0, 11, 12), undefined, 30, utc, new Set([5, 6]))).toBe(7);
	});
});
