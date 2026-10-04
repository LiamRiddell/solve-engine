/**
 * #704: the spoken relative dates. `3 days ago`, `next week`, `end of month`,
 * `noon`, `this friday`, `first Monday of next month`, `2nd Tuesday of March`
 * with no year, and `9am until 5pm`, each read as the shipped form it means.
 *
 * Every engine here runs on a pinned clock in a named zone, on the calendar
 * backend under test (`Date`, or `Temporal` under `test:temporal`), so the
 * answers are fixed strings. The pins cover the docs moment, a month end, a
 * leap February, a year end, a Sunday and a Friday (the week's edges), and the
 * daylight-saving changes in London and New York.
 *
 * The adversarial half checks the words these forms claim stay free where
 * they are prose or names (`start = 5`, `3 days ago I paid`, a `Friday`
 * heading), and that a date past the calendar's range is refused rather than
 * shown as `Invalid Date`.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { calendarUnderTest, temporalCalendarForTests } from "@tools/temporalTestKit";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { ValueType, numberValue, stringValue, type Value } from "@solve-js/vm/Value";
import { DATETIME_PACKAGE } from "@solve-js/packages/datetime/DatetimePackage";
import { periodEdgeHandler, thisWeekdayHandler, monthThisYearHandler } from "@solve-js/packages/datetime/parselets/SpokenDateFunctions";

/** An engine whose clock is stopped at `iso`, in `zone`. */
function at(iso: string, zone = "Europe/London") {
	const inner = calendarUnderTest() === "temporal" ? temporalCalendarForTests({ timeZone: zone }) : dateCalendarInZone(zone);
	const calendar = new RecordingCalendar(Date.parse(iso), inner);
	const engine = newTrackedEngine({ config: { network: { enabled: false } }, calendar });
	const value = (line: string): Value => engine.evaluateExpression(line);
	const show = (line: string): string => formatValue(value(line), { ...DEFAULT_FORMATTING_SETTINGS, calendar }).replace(/^=\s*/, "");
	const doc = (text: string): string[] =>
		engine.parseDocument(text).lines.map((l) => (l.result ? formatValue(l.result, { ...DEFAULT_FORMATTING_SETTINGS, calendar }).replace(/^=\s*/, "") : `error: ${l.error ?? ""}`));
	return { engine, value, show, doc };
}

/** The docs moment: noon on Wednesday 11 March 2026 in London. */
const DOCS = "2026-03-11T12:00:00Z";

describe("#704: each form at the docs moment", () => {
	const { show } = at(DOCS);
	test.each([
		["3 days ago", "Sunday, March 8, 2026, 12:00:00 PM"],
		["2 hours ago", "Wednesday, March 11, 2026, 10:00:00 AM"],
		["next week", "Monday, March 16, 2026"],
		["this week", "Monday, March 9, 2026"],
		["last week", "Monday, March 2, 2026"],
		["next year", "Friday, January 1, 2027"],
		["this year", "Thursday, January 1, 2026"],
		["last year", "Wednesday, January 1, 2025"],
		["start of month", "Sunday, March 1, 2026"],
		["end of month", "Tuesday, March 31, 2026"],
		["end of next month", "Thursday, April 30, 2026"],
		["start of year", "Thursday, January 1, 2026"],
		["end of year", "Thursday, December 31, 2026"],
		["start of week", "Monday, March 9, 2026"],
		["end of week", "Sunday, March 15, 2026"],
		["beginning of next week", "Monday, March 16, 2026"],
		["end of last year", "Wednesday, December 31, 2025"],
		["noon", "12:00:00 PM"],
		["midnight", "12:00:00 AM"],
		["noon + 90 minutes", "1:30:00 PM"],
		["9am until 5pm", "480 minutes"],
		["9am to noon", "180 minutes"],
		["this friday", "Friday, March 13, 2026, 12:00:00 PM"],
		["this wednesday", "Wednesday, March 11, 2026, 12:00:00 PM"],
		["friday + 1 week", "Friday, March 20, 2026, 12:00:00 PM"],
		["days until friday", "2 days"],
		["first Monday of next month", "Monday, April 6, 2026"],
		["second Tuesday of April", "Tuesday, April 14, 2026"],
		["2nd Tuesday of March", "Tuesday, March 10, 2026"],
		["last Friday of March", "Friday, March 27, 2026"],
		["next week + 2 days", "Wednesday, March 18, 2026"],
		["next week as weekday", "Monday"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});
});

describe("#704: each form is the shipped form it means", () => {
	const { value } = at(DOCS);
	test.each([
		["3 days ago", "3 days before today"],
		["2 hours ago", "2 hours before now"],
		["9am until 5pm", "9am to 5pm"],
		["5pm until 9am", "5pm to 9am"],
		["noon", "12pm"],
		["midnight", "12am"],
		["this friday", "next friday"],
		["first Monday of next month", "1st Monday of next month"],
		["2nd Tuesday of March", "2nd Tuesday of March 2026"],
		["next week", "16 March 2026"],
		["end of month", "31 March 2026"],
		["start of year", "1 January 2026"],
		["next year", "1 January 2027"],
		["this month", "start of month"],
		["next month", "start of next month"],
	])("%s is %s", (spoken, shipped) => {
		const a = value(spoken);
		const b = value(shipped);
		expect(a.type).toBe(b.type);
		expect(a.toNumber()).toBe(b.toNumber());
	});
});

describe("#704: a month end and a leap February", () => {
	test("on the last day of January", () => {
		const { show } = at("2026-01-31T10:00:00Z");
		expect(show("end of month")).toBe("Saturday, January 31, 2026");
		expect(show("end of next month")).toBe("Saturday, February 28, 2026");
		expect(show("start of next month")).toBe("Sunday, February 1, 2026");
		expect(show("this week")).toBe("Monday, January 26, 2026");
		expect(show("end of week")).toBe("Sunday, February 1, 2026");
		expect(show("this sunday")).toBe("Sunday, February 1, 2026, 10:00:00 AM");
		expect(show("3 days ago")).toBe("Wednesday, January 28, 2026, 10:00:00 AM");
		expect(show("1 month ago")).toBe("Wednesday, December 31, 2025, 10:00:00 AM");
		expect(show("first Monday of next month")).toBe("Monday, February 2, 2026");
	});

	test("February of a leap year ends on the 29th", () => {
		const { show } = at("2028-02-10T12:00:00Z");
		expect(show("end of month")).toBe("Tuesday, February 29, 2028");
		expect(show("end of year")).toBe("Sunday, December 31, 2028");
	});

	test("a month with no year is this year's, in whatever year now is", () => {
		const { show } = at("2027-06-01T12:00:00Z");
		expect(show("2nd Tuesday of March")).toBe("Tuesday, March 9, 2027");
		expect(show("last Friday of Dec")).toBe("Friday, December 31, 2027");
	});
});

describe("#704: a year end", () => {
	const { show } = at("2026-12-31T23:30:00Z");
	test.each([
		["next year", "Friday, January 1, 2027"],
		["end of year", "Thursday, December 31, 2026"],
		["this week", "Monday, December 28, 2026"],
		["next week", "Monday, January 4, 2027"],
		["end of week", "Sunday, January 3, 2027"],
		["this friday", "Friday, January 1, 2027, 11:30:00 PM"],
		["3 days ago", "Monday, December 28, 2026, 11:30:00 PM"],
		["2 hours ago", "Thursday, December 31, 2026, 9:30:00 PM"],
		["end of next month", "Sunday, January 31, 2027"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});
});

describe("#704: the week's edges", () => {
	test("a week runs Monday to Sunday, so on a Sunday this week began six days ago", () => {
		const { show } = at("2026-03-15T09:00:00Z");
		expect(show("this week")).toBe("Monday, March 9, 2026");
		expect(show("end of week")).toBe("Sunday, March 15, 2026");
		expect(show("next week")).toBe("Monday, March 16, 2026");
		expect(show("this sunday")).toBe("Sunday, March 15, 2026, 9:00:00 AM");
		expect(show("this monday")).toBe("Monday, March 16, 2026, 9:00:00 AM");
		expect(show("days until sunday")).toBe("0 days");
	});

	test("this friday on a Friday is today, where next friday steps over it", () => {
		const { show } = at("2026-03-13T12:00:00Z");
		expect(show("this friday")).toBe("Friday, March 13, 2026, 12:00:00 PM");
		expect(show("next friday")).toBe("Friday, March 20, 2026, 12:00:00 PM");
	});
});

describe("#704: across a daylight-saving change", () => {
	test("London springs forward on 29 March: the anchors are local midnights either side", () => {
		const { show, value } = at("2026-03-28T12:00:00Z");
		expect(show("this sunday")).toBe(show("next sunday"));
		expect(show("next week")).toBe("Monday, March 30, 2026");
		expect(value("next week").toNumber()).toBe(Date.parse("2026-03-29T23:00:00Z"));
		expect(show("end of week")).toBe("Sunday, March 29, 2026");
		expect(value("end of week").toNumber()).toBe(Date.parse("2026-03-29T00:00:00Z"));
	});

	test("a day ago keeps the time of day across the change, where 24 hours ago does not", () => {
		const { show, value } = at("2026-03-29T11:00:00Z");
		expect(show("1 day ago")).toBe("Saturday, March 28, 2026, 12:00:00 PM");
		expect(show("24 hours ago")).toBe("Saturday, March 28, 2026, 11:00:00 AM");
		expect(value("1 day ago").toNumber()).toBe(value("1 day before today").toNumber());
	});

	test("London falls back on 25 October", () => {
		const { value } = at("2026-10-26T12:00:00Z");
		expect(value("this week").toNumber()).toBe(Date.parse("2026-10-26T00:00:00Z"));
		expect(value("last week").toNumber()).toBe(Date.parse("2026-10-18T23:00:00Z"));
	});

	test("New York springs forward on 8 March", () => {
		const { value, show } = at("2026-03-09T16:00:00Z", "America/New_York");
		expect(show("this week")).toBe("Monday, March 9, 2026");
		expect(value("this week").toNumber()).toBe(Date.parse("2026-03-09T04:00:00Z"));
		expect(value("last week").toNumber()).toBe(Date.parse("2026-03-02T05:00:00Z"));
		expect(value("end of last week").toNumber()).toBe(Date.parse("2026-03-08T05:00:00Z"));
	});
});

describe("#704 adversarial: the words stay free in prose and as names", () => {
	const { doc, value } = at(DOCS);

	test("start, end, this and ago are still names", () => {
		expect(doc("start = 5\nstart + 1\nend = 9\nend - start")).toEqual(["5", "6", "9", "4"]);
		expect(doc("ago = 2\n3 * ago")).toEqual(["2", "6"]);
		expect(doc("this = 4\nthis * 2")).toEqual(["4", "8"]);
	});

	test("a variable named noon is read with its colon, as any name the engine also reads as a word", () => {
		expect(doc("noon = 12\n:noon * 2")).toEqual(["12", "24"]);
		expect(doc(":midnight = 3\n:midnight + 1")).toEqual(["3", "4"]);
	});

	test("a weekday alone on a line stays text, and says how to write the date", () => {
		const [line] = doc("Friday");
		expect(line).toMatch(/^error: .*this friday/);
		expect(doc("Friday: 3 hours")).toEqual(["3 hours"]);
	});

	test.each([
		"meeting on friday",
		"3 days ago I paid",
		"3 apples ago",
		"3 ago",
		"end of march",
		"end of the month",
		"start of",
		"the end of the week",
	])("%s is not read as a date", (line) => {
		// A fresh engine: the names assigned above would otherwise answer here.
		const [shown] = at(DOCS).doc(line);
		expect(shown).toMatch(/^error: /);
	});

	test("an ago after a length that is not time is left alone", () => {
		expect(() => value("3 kg ago")).toThrow();
	});

	test("the shipped forms these sit beside still answer as before", () => {
		const { show } = at(DOCS);
		expect(show("next friday")).toBe("Friday, March 13, 2026, 12:00:00 PM");
		expect(show("last friday")).toBe("Friday, March 6, 2026, 12:00:00 PM");
		expect(show("3 days before today")).toBe("Sunday, March 8, 2026, 12:00:00 PM");
		expect(show("days until 25 december")).toBe("288.50 days");
		expect(show("2nd Tuesday of March 2027")).toBe("Tuesday, March 9, 2027");
	});
});

describe("#704 adversarial: edges and refusals", () => {
	const { value, show } = at(DOCS);

	test.each([
		"99999999999 days ago",
		"today + 99999999999 days",
		"300000 years before today",
		"today + 1e20 hours",
		"today - 1e308 years",
	])("%s is refused as past the calendar's range, not shown as Invalid Date", (line) => {
		const result = value(line);
		expect(result.type).toBe(ValueType.Error);
		expect(result.value).toBe("DATE_OUT_OF_RANGE");
		expect(show(line)).not.toMatch(/Invalid/);
	});

	test("a negative length ago is that length ahead, as the arithmetic reads", () => {
		expect(show("-3 days ago")).toBe("Saturday, March 14, 2026, 12:00:00 PM");
		expect(value("0 days ago").toNumber()).toBe(value("now").toNumber());
	});

	test("an ordinal past fifth is not read, and a fifth the month lacks is refused", () => {
		expect(() => value("sixth Monday of March")).toThrow();
		const fifth = value("fifth Friday of February");
		expect(fifth.type).toBe(ValueType.Error);
		expect(fifth.value).toBe("NTH_WEEKDAY_OUT_OF_RANGE");
	});

	test("a doubled or dangling form is refused, not half read", () => {
		expect(() => value("this this friday")).toThrow();
		expect(() => value("start of start of month")).toThrow();
		expect(() => value("3 days ago ago")).toThrow();
	});

	test("dec after of is December, though it also names the decimal conversion", () => {
		expect(show("last Friday of Dec")).toBe("Friday, December 25, 2026");
		expect(show("255 as dec")).toBe("255");
	});

	test("a word naming an inherited property is not a named time, a period or an ordinal", () => {
		for (const word of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
			const [alone] = at(DOCS).doc(word);
			expect(alone).toMatch(/^error: /);
			expect(alone).not.toMatch(/object/i);
			expect(at(DOCS).doc(`end of ${word}`)[0]).toMatch(/^error: /);
			expect(at(DOCS).doc(`${word} Monday of March`)[0]).toMatch(/^error: /);
			// A number before the word is not a date with the word as its month.
			expect(at(DOCS).doc(`5 ${word}`)[0]).not.toMatch(/real date|NaN|undefined/);
			expect(at(DOCS).doc(`2nd Tuesday of ${word}`)[0]).toMatch(/^error: /);
		}
	});

	test("the fused tokens are coloured as dates", () => {
		for (const type of ["THIS_WEEKDAY", "PERIOD_START", "PERIOD_END", "WEEK_ANCHOR_NEXT", "YEAR_ANCHOR_LAST"]) {
			expect(DATETIME_PACKAGE.tokenCategories?.[type]).toBe("datetime");
		}
	});

	test("the plugin functions refuse an operand that is not a date", () => {
		for (const result of [
			periodEdgeHandler([numberValue(5), stringValue("week"), numberValue(0), stringValue("start")]),
			thisWeekdayHandler([stringValue("friday"), numberValue(5)]),
			monthThisYearHandler([numberValue(1), numberValue(2)]),
			periodEdgeHandler([]),
		]) {
			expect(result.type).toBe(ValueType.Error);
			expect(result.value).toBe("DATE_EXPECTED");
		}
	});
});
