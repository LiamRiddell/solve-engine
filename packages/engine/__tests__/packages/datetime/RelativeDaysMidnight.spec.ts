/**
 * `date.relativeDays: 'midnight'`: `today`, `tomorrow`, `yesterday`, `next
 * friday`, `this friday`, `3 days ago` and the count in `days until` read from
 * the start of the day, so each is a date with no time of day, while `now` and
 * a span shorter than a day keep the clock. The default, `'now'`, is the
 * reading every version before the setting had, and is pinned here unchanged.
 *
 * Every engine runs on a pinned clock in a named zone, on the calendar backend
 * under test (`Date`, or `Temporal` under `test:temporal`). The pins are the
 * docs moment, the first and last millisecond of a day, a leap day, a month
 * and a year end, the daylight-saving changes in London and New York, and a
 * day whose midnight the zone skips (Santiago springs forward at 00:00).
 *
 * The parts (the setting's check, the opcode, the day-start helpers) are
 * tested directly in `calendar/RelativeDays.spec.ts`.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { calendarUnderTest, temporalCalendarForTests } from "@tools/temporalTestKit";
import { PROTOTYPE_WORDS, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import type { RelativeDayAnchor } from "@solve-js/calendar/RelativeDays";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/** The docs moment: noon on Wednesday 11 March 2026 in London. */
const DOCS = "2026-03-11T12:00:00Z";

/** An engine whose clock is stopped at `iso` in `zone`, reading relative days as `relativeDays` (unset when undefined). */
function at(iso: string, relativeDays?: RelativeDayAnchor, zone = "Europe/London") {
	const inner = calendarUnderTest() === "temporal" ? temporalCalendarForTests({ timeZone: zone }) : dateCalendarInZone(zone);
	const calendar = new RecordingCalendar(Date.parse(iso), inner);
	const date = relativeDays === undefined ? {} : { relativeDays };
	const config = { network: { enabled: false }, date };
	const make = () => newTrackedEngine({ config, calendar });
	const engine = make();
	const settings = { ...DEFAULT_FORMATTING_SETTINGS, calendar };
	const show = (line: string): string => formatValue(engine.evaluateExpression(line), settings).replace(/^=\s*/, "");
	const lines = (result: ParsingResult): string[] =>
		result.lines.map((l) => (l.result ? formatValue(l.result, settings).replace(/^=\s*/, "") : `error: ${l.error ?? ""}`));
	const batch = (text: string): string[] => lines(make().parseDocument(text));
	const incremental = (text: string): string[] => lines(evaluateDocument(make(), text));
	return { engine, make, show, batch, incremental, calendar, config };
}

/** Each form at the docs moment: the default reading, then the start-of-day one. */
const AT_DOCS_MOMENT: ReadonlyArray<readonly [string, string, string]> = [
	["today", "Wednesday, March 11, 2026, 12:00:00 PM", "Wednesday, March 11, 2026"],
	["tomorrow", "Thursday, March 12, 2026, 12:00:00 PM", "Thursday, March 12, 2026"],
	["yesterday", "Tuesday, March 10, 2026, 12:00:00 PM", "Tuesday, March 10, 2026"],
	["next friday", "Friday, March 13, 2026, 12:00:00 PM", "Friday, March 13, 2026"],
	["last monday", "Monday, March 9, 2026, 12:00:00 PM", "Monday, March 9, 2026"],
	["this friday", "Friday, March 13, 2026, 12:00:00 PM", "Friday, March 13, 2026"],
	["this wednesday", "Wednesday, March 11, 2026, 12:00:00 PM", "Wednesday, March 11, 2026"],
	["friday + 1 week", "Friday, March 20, 2026, 12:00:00 PM", "Friday, March 20, 2026"],
	["3 days from today", "Saturday, March 14, 2026, 12:00:00 PM", "Saturday, March 14, 2026"],
	["3 days before today", "Sunday, March 8, 2026, 12:00:00 PM", "Sunday, March 8, 2026"],
	["3 days ago", "Sunday, March 8, 2026, 12:00:00 PM", "Sunday, March 8, 2026"],
	["2 weeks ago", "Wednesday, February 25, 2026, 12:00:00 PM", "Wednesday, February 25, 2026"],
	["1 year ago", "Tuesday, March 11, 2025, 12:00:00 PM", "Tuesday, March 11, 2025"],
	["3 workdays ago", "Friday, March 6, 2026, 12:00:00 PM", "Friday, March 6, 2026"],
	["today + 3 weeks", "Wednesday, April 1, 2026, 12:00:00 PM", "Wednesday, April 1, 2026"],
	["days until 25 december", "288.50 days", "289 days"],
	["days since 1 january", "69.50 days", "69 days"],
	["weeks until 25 december", "41.21 weeks", "41.29 weeks"],
	["days until friday", "2 days", "2 days"],
	["25/12/2026 - today", "6924:00", "289 days"],
	["tomorrow - today", "24:00", "1 day"],
	["next friday - today", "48:00", "2 days"],
];

/** Forms that ask about the clock, the same under both settings. */
const CLOCK_FORMS: ReadonlyArray<readonly [string, string]> = [
	["now", "Wednesday, March 11, 2026, 12:00:00 PM"],
	["2 hours ago", "Wednesday, March 11, 2026, 10:00:00 AM"],
	["90 minutes ago", "Wednesday, March 11, 2026, 10:30:00 AM"],
	["hours until 5pm", "5 hours"],
	["now + 3 days", "Saturday, March 14, 2026, 12:00:00 PM"],
	["next week", "Monday, March 16, 2026"],
	["end of month", "Tuesday, March 31, 2026"],
	["what day is it", "Wednesday"],
	["workdays between today and 20/3/2026", "8"],
];

describe("each form at the docs moment, under both settings", () => {
	const unset = at(DOCS);
	const now = at(DOCS, "now");
	const midnight = at(DOCS, "midnight");

	test.each(AT_DOCS_MOMENT)("%s", (line, before, after) => {
		expect(unset.show(line)).toBe(before);
		expect(now.show(line)).toBe(before);
		expect(midnight.show(line)).toBe(after);
	});

	test.each(CLOCK_FORMS)("a question about the clock is the same under both: %s", (line, answer) => {
		expect(now.show(line)).toBe(answer);
		expect(midnight.show(line)).toBe(answer);
	});

	test("a time added to the start of the day is a time on it, and a day added keeps that time", () => {
		expect(midnight.show("today + 2 hours")).toBe("Wednesday, March 11, 2026, 2:00:00 AM");
		expect(midnight.show("today + 2 hours + 1 day")).toBe("Thursday, March 12, 2026, 2:00:00 AM");
	});
});

describe("edges: the clock at the boundaries of a day", () => {
	test.each([
		// The first and last millisecond of a day are both that day.
		["2026-03-11T00:00:00.000Z", "Wednesday, March 11, 2026", "Thursday, March 12, 2026"],
		["2026-03-11T23:59:59.999Z", "Wednesday, March 11, 2026", "Thursday, March 12, 2026"],
		// A leap day, a month end and a year end.
		["2028-02-28T23:30:00Z", "Monday, February 28, 2028", "Tuesday, February 29, 2028"],
		["2026-01-31T10:00:00Z", "Saturday, January 31, 2026", "Sunday, February 1, 2026"],
		["2026-12-31T23:59:59.999Z", "Thursday, December 31, 2026", "Friday, January 1, 2027"],
		// London's clocks go forward at 01:00 on 29 March and back on 25 October.
		["2026-03-28T23:30:00Z", "Saturday, March 28, 2026", "Sunday, March 29, 2026"],
		["2026-03-29T00:30:00Z", "Sunday, March 29, 2026", "Monday, March 30, 2026"],
		["2026-10-25T00:30:00Z", "Sunday, October 25, 2026", "Monday, October 26, 2026"],
	])("in London at %s, today is %s and tomorrow %s", (iso, today, tomorrow) => {
		const { show } = at(iso, "midnight");
		expect(show("today")).toBe(today);
		expect(show("tomorrow")).toBe(tomorrow);
	});

	test("New York's spring change: the day is 23 hours long and still one day", () => {
		const { show } = at("2026-03-08T12:00:00Z", "midnight", "America/New_York");
		expect(show("today")).toBe("Sunday, March 8, 2026");
		expect(show("tomorrow")).toBe("Monday, March 9, 2026");
		expect(show("tomorrow - today")).toBe("1 day");
	});

	test("a zone that skips midnight: Santiago's 6 September 2026 begins at 01:00, and shows as a date", () => {
		const day = at("2026-09-06T12:00:00Z", "midnight", "America/Santiago");
		expect(day.show("today")).toBe("Sunday, September 6, 2026");
		expect(day.show("tomorrow")).toBe("Monday, September 7, 2026");
		expect(day.show("yesterday")).toBe("Saturday, September 5, 2026");
		expect(day.show("next sunday")).toBe("Sunday, September 13, 2026");
		expect(day.show("1 month ago")).toBe("Thursday, August 6, 2026");
		expect(day.show("today + 2 hours")).toBe("Sunday, September 6, 2026, 3:00:00 AM");
		const before = at("2026-09-05T12:00:00Z", "midnight", "America/Santiago");
		expect(before.show("tomorrow")).toBe("Sunday, September 6, 2026");
		expect(before.show("this sunday")).toBe("Sunday, September 6, 2026");
	});

	test("a date literal on a skipped midnight shows as a date too, and steps to midnights", () => {
		// The same repair, reached by a literal under the default setting.
		const { show } = at("2026-09-01T12:00:00Z", undefined, "America/Santiago");
		expect(show("6 september 2026")).toBe("Sunday, September 6, 2026");
		expect(show("6 september 2026 + 1 day")).toBe("Monday, September 7, 2026");
		expect(show("7 september 2026 - 1 day")).toBe("Sunday, September 6, 2026");
	});

	test("in another zone the day is that zone's", () => {
		// 20:00 UTC on 11 March is 05:00 on 12 March in Tokyo.
		const { show } = at("2026-03-11T20:00:00Z", "midnight", "Asia/Tokyo");
		expect(show("today")).toBe("Thursday, March 12, 2026");
		expect(show("now")).toBe("Thursday, March 12, 2026, 5:00:00 AM");
	});

	test("a day past the calendar's range is refused, not shown as Invalid Date", () => {
		const { show } = at(DOCS, "midnight");
		expect(show("99999999999 days ago")).toMatch(/range|calendar/i);
		expect(show("today + 99999999999 days")).toMatch(/range|calendar/i);
	});
});

describe("realistic breakage: the forms meeting the rest of a document", () => {
	const DOCUMENT = [
		"# Plan",
		"start = today",
		"due = start + 2 weeks",
		"due - start",
		"days until due",
		"check tomorrow - today == 1 day",
		"tomorrow #work",
		"next friday #work",
		"line 4 with start = 1 april 2026",
		"line 3 with start = tomorrow",
		"prev - 1 day",
		"inputs of line 4",
		"workdays between today and due",
	].join("\n");

	test("the start-of-day answers, line by line", () => {
		const { batch } = at(DOCS, "midnight");
		expect(batch(DOCUMENT).slice(1)).toEqual([
			"Wednesday, March 11, 2026",
			"Wednesday, March 25, 2026",
			"14 days",
			"14 days",
			"✓",
			"Thursday, March 12, 2026",
			"Friday, March 13, 2026",
			"14 days",
			"Thursday, March 26, 2026",
			"Wednesday, March 25, 2026",
			expect.stringMatching(/^14 days \(line 4\) <- /),
			"11",
		]);
	});

	test.each(["now", "midnight"] as const)("parseDocument and evaluateDocument agree value for value (%s)", (anchor) => {
		const { batch, incremental } = at(DOCS, anchor);
		expect(incremental(DOCUMENT)).toEqual(batch(DOCUMENT));
	});

	test("the single-expression path agrees with both document passes on a line that stands alone", () => {
		const { show, batch } = at(DOCS, "midnight");
		for (const [line] of AT_DOCS_MOMENT) expect(batch(line)).toEqual([show(line)]);
	});

	test("CRLF line ends and a trailing newline change nothing", () => {
		const { batch, incremental } = at(DOCS, "midnight");
		const text = "today\r\ntomorrow\r\n";
		expect(batch(text).slice(0, 2)).toEqual(["Wednesday, March 11, 2026", "Thursday, March 12, 2026"]);
		expect(incremental(text)).toEqual(batch(text));
	});

	test("a typo near a relative day is refused, not read as one", () => {
		const { engine } = at(DOCS, "midnight");
		// `ago` is claimed only straight after a length of time, so a note that
		// says `3 days ago I paid` stays text.
		for (const line of ["tomorow", "3 dayz ago", "3 days ago I paid"]) {
			expect(expectHonestLine(line, { engine }).kind).not.toBe("value");
		}
	});

	test("a snapshot taken and restored with the same setting keeps a stored day a day", () => {
		const { make, calendar, config } = at(DOCS, "midnight");
		const engine = make();
		engine.parseDocument("start = today\nfinish = start + 3 days");
		const restored = ExpressionEngine.fromJSON(engine.toJSON(), { config, calendar });
		const shown = formatValue(restored.evaluateExpression("finish - start"), { ...DEFAULT_FORMATTING_SETTINGS, calendar });
		expect(shown).toBe("= 3 days");
	});
});

describe("security: the setting and the words around it", () => {
	test.each(["today", "Midnight", "", "__proto__", "constructor", "toString"])("a value that is not one of the two is refused when the engine is built: %j", (value) => {
		expectPrototypeUntouched(() => {
			let code: string | null = null;
			try {
				newTrackedEngine({ config: { date: { relativeDays: value as RelativeDayAnchor } } });
			} catch (error) {
				code = error instanceof EngineError ? error.code : "not an EngineError";
			}
			expect(code).toBe("DATE_RELATIVE_DAYS_INVALID");
		});
	});

	test("the setting is one the engine knows, so naming it raises no unknown-option warning", () => {
		const warnings: unknown[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => { warnings.push(args); };
		try {
			newTrackedEngine({ config: { date: { relativeDays: "midnight" } } });
		} finally {
			console.warn = original;
		}
		expect(warnings).toEqual([]);
	});

	test.each(PROTOTYPE_WORDS)("a word naming an inherited property beside a relative day is an ordinary word: %s", (word) => {
		const { engine } = at(DOCS, "midnight");
		expectPrototypeUntouched(() => {
			for (const line of [`days until ${word}`, `${word} days ago`, `today + ${word}`, `next ${word}`]) {
				expect(expectHonestLine(line, { engine }).kind).not.toBe("value");
			}
		});
	});

	test("a document of thousands of relative days is answered within budget", () => {
		const { make } = at(DOCS, "midnight");
		const text = Array.from({ length: 2_000 }, (_, i) => (i % 2 === 0 ? `${i} days ago` : `days until today + ${i} days`)).join("\n");
		const started = performance.now();
		const result = make().parseDocument(text);
		expect(result.lines).toHaveLength(2_000);
		expect(performance.now() - started).toBeLessThan(10_000);
	});
});
