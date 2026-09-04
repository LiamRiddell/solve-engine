/**
 * Both calendar backends, side by side, through the engine.
 *
 * The `Temporal` backend's promise is that no result depends on which
 * backend an engine computes with, so this suite evaluates the same input on
 * two engines at once, one on the `Date` backend and one on the `Temporal`
 * backend in the same zone, and asserts the two answers are identical: the
 * value's type, its formatted text, and for a date its epoch milliseconds to
 * the millisecond.
 *
 * Two corpora. The first is every example in the published documentation,
 * read by the same collector `docs/DocExamples.spec.ts` uses, so the whole
 * language is covered and not only the date pages. The second is a corpus of
 * date and time forms evaluated at pinned instants, chosen so `now` falls on
 * the daylight-saving days of several zones, a leap day and a year boundary,
 * which is where a backend that reads a day as 86,400,000 milliseconds would
 * show. Both clocks are pinned to the same instant, and the `Temporal`
 * backend is given the process's zone, so the only thing that differs
 * between the two engines is the backend.
 *
 * The last section is the one difference the `Temporal` backend adds, a zone
 * of its own, proven through the engine: two engines in two zones disagree on
 * `today` exactly when the zones are on different days.
 *
 * Which zone this runs in is the process's; `scripts/test-temporal.mjs` runs
 * it under several. Which `Temporal` it uses is the polyfill's own, or the
 * runtime's under `SOLVE_TEMPORAL=native`.
 */

import { afterAll, describe, expect, test } from "@jest/globals";
import * as path from "path";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { createTemporalCalendar } from "@solve-js/temporal/TemporalCalendar";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { temporalForTests, temporalSource } from "@tools/temporalTestKit";
import { blockHasTable, collectAll, groupExamples } from "@tools/docExampleCollector";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs/src/content/docs");

const temporal = temporalForTests();
const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const engines: ExpressionEngine[] = [];
afterAll(() => {
	for (const engine of engines.splice(0)) engine.clear();
});

/** Two engines that differ in nothing but the backend, both clocks pinned to `now`. */
function pair(now: number): { date: ExpressionEngine; temporal: ExpressionEngine; dateCalendar: CalendarBackend; temporalCalendar: CalendarBackend } {
	const dateCalendar = new RecordingCalendar(now, DATE_CALENDAR);
	const temporalCalendar = createTemporalCalendar(temporal, { timeZone: hostZone, now: () => now });
	const date = new ExpressionEngine({ packages: BUILTIN_PACKAGES, calendar: dateCalendar });
	const temporalEngine = new ExpressionEngine({ packages: BUILTIN_PACKAGES, calendar: temporalCalendar });
	engines.push(date, temporalEngine);
	return { date, temporal: temporalEngine, dateCalendar, temporalCalendar };
}

/** Everything observable about a value: its type, its display through the backend, and a date's exact instant. */
function render(value: Value | null | undefined, calendar: CalendarBackend): string {
	if (value === undefined || value === null) return "(no value)";
	const text = formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, calendar });
	const instant = value.type === ValueType.Datetime ? ` @${value.toNumber()}` : "";
	return `${ValueType[value.type]} ${text}${instant}`;
}

/** Evaluate one line on one engine, an error reading as a string rather than a throw. */
function evaluate(engine: ExpressionEngine, line: number, source: string, calendar: CalendarBackend): string {
	try {
		return render(engine.evaluateLine(line, source), calendar);
	} catch (error) {
		return `threw ${(error as Error).message}`;
	}
}

/**
 * Instants `now` is pinned to. Each is a moment a naive day length would get
 * wrong somewhere: just either side of a transition in London, New York, Los
 * Angeles, Sydney and Auckland, plus a leap day, a year boundary and one
 * ordinary Wednesday.
 */
const INSTANTS: Array<[string, number]> = [
	["an ordinary Wednesday", Date.parse("2026-08-26T10:00:00Z")],
	["London springs forward, 30 minutes before", Date.parse("2024-03-31T00:30:00Z")],
	["London springs forward, 30 minutes after", Date.parse("2024-03-31T01:30:00Z")],
	["London falls back, 30 minutes before", Date.parse("2024-10-27T00:30:00Z")],
	["London falls back, 30 minutes after", Date.parse("2024-10-27T01:30:00Z")],
	["Los Angeles springs forward", Date.parse("2024-03-10T09:30:00Z")],
	["Los Angeles falls back", Date.parse("2024-11-03T08:30:00Z")],
	["New York falls back, in the repeated hour", Date.parse("2024-11-03T05:30:00Z")],
	["Sydney falls back", Date.parse("2024-04-06T15:30:00Z")],
	["Sydney springs forward", Date.parse("2024-10-05T15:30:00Z")],
	["Auckland springs forward", Date.parse("2024-09-28T13:30:00Z")],
	["Auckland falls back", Date.parse("2024-04-06T13:30:00Z")],
	["a leap day", Date.parse("2024-02-29T12:00:00Z")],
	["the last half hour of a year", Date.parse("2023-12-31T23:30:00Z")],
	["the last second of 1999", Date.parse("1999-12-31T23:59:59Z")],
];

/** Date and time forms, one of each shape the backend is consulted for. */
const CORPUS = [
	// Literals, in every order and spelling.
	"25/12/2023", "2023-12-25", "2024-5-3", "March 9, 2024", "9 March 2024", "March 2026", "29/02/2024", "31/12/1999", "01/01/2000", "5/1/23", "01/01/1900",
	'"2019-04-01" to date', '"2019-04-01T15:30:00" to date', '"2019-04-01T15:30:00Z" to date', '"2019-04-01T15:30:00+11:00" to date', "2019-04-01T15:30:00+11:00 to date",
	"1710028800 to date", "1710028800123 to date",
	// Stepping by calendar units, across month ends and transition days.
	"31/01/2024 + 1 month", "31/03/2024 - 1 month", "29/02/2024 + 1 year", "31/01/2023 + 1 month", "30/01/2024 + 1 month", "15/01/2024 + 12 months",
	"10/03/2024 + 1 day", "09/03/2024 + 1 day", "26/10/2024 + 2 days", "30/03/2024 + 1 day", "03/11/2024 + 1 day", "02/11/2024 + 1 day", "05/10/2024 + 1 day", "06/04/2024 + 1 day", "28/09/2024 + 1 day",
	"10/03/2024 + 1.5 days", "01/01/2024 + 3 weeks", "01/01/2024 + 36 hours", "15/06/2024 - 90 days", "01/01/2024 + 100 years", "01/01/2024 + 2 quarters", "01/01/2024 - 1 decade",
	"25/12/2023 + 20 days", "25/12/2023 + 5 workdays", "24/12/2024 + 1 workday", "01/01/2024 - 3 business days",
	// Relative to now, which is pinned.
	"now", "today", "tomorrow", "yesterday", "next monday", "next sunday", "last friday", "last saturday", "next month", "this month", "last month",
	"today + 1 week", "today - 1 month", "tomorrow + 1 day", "3 business days from today", "next friday + 2 weeks as weekday",
	"9:00am", "16:00", "9:00am + 3 hours", "23:30 + 1 hour", "7:30 to 20:45", "4pm to 3am", "9:30 - 8:30",
	// Differences.
	"days between 01/01/2024 and 01/06/2024", "weeks between 01/01/2024 and 01/06/2024", "months between 15/01/2024 and 15/06/2024", "years between 15/06/1990 and 15/06/2024",
	"01/06/2024 - 01/01/2024", "31/03/2024 - 30/03/2024", "days between 30/03/2024 and 31/03/2024", "hours between 30/03/2024 and 31/03/2024",
	"days since 01/01/2024", "days until 25/12/2026", "weeks since 01/01/2000", "days between today and 25/12/2026",
	"working days between 01/01/2024 and 31/01/2024", "working days between 25/12/2023 and 02/01/2024", "workdays in 3 weeks",
	// Reading a date's fields.
	"weekday on 10/03/2024", "10/03/2024 as weekday", "month on 10/03/2024", "10/03/2024 as month", "week number on 12/03/2021", "10/03/2024 as week", "01/01/2021 as week", "31/12/2024 as week",
	"10/03/2024 as iso8601", "now as iso8601", "10/03/2024 to timestamp", "is 10/03/2024 a weekend", "is 11/03/2024 a workday", "is today a weekend",
	"age of 15/06/1990", "age of 29/02/2000", "age of 15/06/1990 on 25/12/2030", "age of 15/06/1990 on 26/08/2026 in years, months and days", "age of 31/01/2000 on 01/03/2001 in years, months and days",
	// Calendar walks.
	"2nd Tuesday of March 2026", "4th Thursday of November 2026", "last Friday of November 2026", "5th Friday of April 2026", "1st Monday of next month",
	"days in February 2024", "days in February 2023", "days in Q1", "days in Q1 2024", "days in Q3 2023", "days in 2024", "days in 2023",
	// Named zones and fixed offsets.
	"3pm Tokyo in Delhi", "6pm Sydney in Chicago", "9am New York in London", "11pm London in Auckland", "3pm GMT+5:30 in UTC", "3pm GMT+14 in GMT-11",
	"time in Tokyo", "date in Tokyo", "time in Honolulu", "date in Auckland", "time difference between Tokyo and Delhi", "time difference between Seattle and Moscow",
	// The present year, read at evaluation time.
	"what is $100 from 1990",
	// A holiday-free walk and a Datetime in arithmetic with numbers.
	"1 working day after 24/12/2024", "today > 01/01/2000", "01/01/2024 < 02/01/2024",
];

describe(`the date and time corpus agrees under both backends (${hostZone}, ${temporalSource()} Temporal)`, () => {
	test.each(INSTANTS)("with now pinned to %s", (_label, now) => {
		const { date, temporal: temporalEngine, dateCalendar, temporalCalendar } = pair(now);
		CORPUS.forEach((source, i) => {
			const expected = evaluate(date, i + 1, source, dateCalendar);
			const actual = evaluate(temporalEngine, i + 1, source, temporalCalendar);
			expect(`${source} => ${actual}`).toBe(`${source} => ${expected}`);
		});
	});

	test("the corpus is not silently made of errors", () => {
		// A form that fails to parse on both engines agrees trivially; most of
		// the corpus must be real answers for the agreement to mean anything.
		const { date, dateCalendar } = pair(INSTANTS[0][1]);
		const answered = CORPUS.filter((source, i) => {
			const rendered = evaluate(date, i + 1, source, dateCalendar);
			return !rendered.startsWith("Error") && !rendered.startsWith("threw");
		});
		expect(answered.length).toBeGreaterThan(CORPUS.length * 0.9);
	});
});

describe(`the documented examples agree under both backends (${hostZone}, ${temporalSource()} Temporal)`, () => {
	const FIXED_NOW = Date.parse("2026-08-26T10:00:00Z");
	// Pages whose output is not a function of the input: a random draw or a
	// live network value differs between two engines whatever their backend.
	// The same pages `DocExamples.spec.ts` lists as unprovable for that reason.
	const NON_DETERMINISTIC_PAGES = new Set(["dice.md", "random.md", "weather.md", "stocks.md", "crypto.md", "knowledge.md"]);
	const deterministic = (file: string) => !NON_DETERMINISTIC_PAGES.has(path.basename(file));
	const collected = collectAll(DOCS_ROOT, [path.join(REPO_ROOT, "README.md")]);
	const groups = groupExamples(collected.examples).filter((group) => deterministic(group[0].file));
	const docBlocks = collected.docBlocks.filter((block) => deterministic(block.file));

	test("the documentation was found", () => {
		expect(groups.length).toBeGreaterThan(100);
		expect(docBlocks.length).toBeGreaterThan(10);
	});

	test("every per-line example", () => {
		for (const group of groups) {
			const { date, temporal: temporalEngine, dateCalendar, temporalCalendar } = pair(FIXED_NOW);
			group.forEach((example, i) => {
				const expected = evaluate(date, i + 1, example.expression, dateCalendar);
				const actual = evaluate(temporalEngine, i + 1, example.expression, temporalCalendar);
				const where = `${path.relative(REPO_ROOT, example.file)}:${example.line}`;
				expect(`${where} ${example.expression} => ${actual}`).toBe(`${where} ${example.expression} => ${expected}`);
			});
			date.clear();
			temporalEngine.clear();
		}
	});

	test("every whole-document block", () => {
		for (const block of docBlocks) {
			const { date, temporal: temporalEngine, dateCalendar, temporalCalendar } = pair(FIXED_NOW);
			const source = block.rows.map((r) => r.expression).join("\n");
			const run = (engine: ExpressionEngine) =>
				blockHasTable(block)
					? engine.parseDocument(source, { inputType: "markdown" })
					: evaluateDocument(engine, source, { inputType: "markdown" });
			const expected = run(date);
			const actual = run(temporalEngine);
			const where = `${path.relative(REPO_ROOT, block.file)}:${block.line}`;
			block.rows.forEach((row, i) => {
				const a = actual.lines[i];
				const e = expected.lines[i];
				const readA = a?.error ? `ERROR ${a.error}` : render(a?.result, temporalCalendar);
				const readE = e?.error ? `ERROR ${e.error}` : render(e?.result, dateCalendar);
				expect(`${where} ${row.expression} => ${readA}`).toBe(`${where} ${row.expression} => ${readE}`);
			});
			date.clear();
			temporalEngine.clear();
		}
	});
});

describe("what a zone of its own changes", () => {
	// 22:00 UTC on 26 August 2026: still the 26th in New York, already the 27th in Tokyo.
	const NOW = Date.parse("2026-08-26T22:00:00Z");

	function engineIn(zone: string): { engine: ExpressionEngine; calendar: CalendarBackend } {
		const calendar = createTemporalCalendar(temporal, { timeZone: zone, now: () => NOW });
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES, calendar });
		engines.push(engine);
		return { engine, calendar };
	}

	test("`today` is the zone's day, and displays as it through the backend on the settings", () => {
		const tokyo = engineIn("Asia/Tokyo");
		const newYork = engineIn("America/New_York");
		expect(render(tokyo.engine.evaluateExpression("today"), tokyo.calendar)).toBe(`Datetime = Thursday, August 27, 2026, 7:00:00 AM @${NOW}`);
		expect(render(newYork.engine.evaluateExpression("today"), newYork.calendar)).toBe(`Datetime = Wednesday, August 26, 2026, 6:00:00 PM @${NOW}`);
		expect(newYork.engine.evaluateExpression("today as weekday").value).toBe("Wednesday");
		expect(tokyo.engine.evaluateExpression("today as weekday").value).toBe("Thursday");
	});

	test("a date literal is midnight in the zone, and a clock time is on the zone's today", () => {
		const tokyo = engineIn("Asia/Tokyo");
		const newYork = engineIn("America/New_York");
		expect(tokyo.engine.evaluateExpression("01/01/2024").toNumber()).toBe(Date.UTC(2023, 11, 31, 15));
		expect(newYork.engine.evaluateExpression("01/01/2024").toNumber()).toBe(Date.UTC(2024, 0, 1, 5));
		expect(tokyo.engine.evaluateExpression("9:00am").toNumber()).toBe(Date.UTC(2026, 7, 27, 0));
		expect(newYork.engine.evaluateExpression("9:00am").toNumber()).toBe(Date.UTC(2026, 7, 26, 13));
	});

	test("the forms that read a literal while parsing read it in the zone", () => {
		// Midnight on 1 February in Tokyo is still 31 January in London and New
		// York; the parser reads the literal back through the zone that built it.
		const tokyo = engineIn("Asia/Tokyo");
		expect(tokyo.engine.evaluateExpression("days in February 2024").toNumber()).toBe(29);
		expect(tokyo.engine.evaluateExpression("days in Q1").toNumber()).toBe(90);
		const auckland = engineIn("Pacific/Auckland");
		expect(auckland.engine.evaluateExpression("days in February 2024").toNumber()).toBe(29);
	});

	test("the answers that are calendar facts do not move with the zone", () => {
		// `days between` is deliberately absent: it divides a millisecond span,
		// so a span that crosses a daylight-saving change is an hour short in
		// a zone that observes one, on either backend, as the engine has always
		// answered it.
		for (const zone of ["UTC", "Asia/Tokyo", "America/New_York", "Pacific/Chatham"]) {
			const { engine, calendar } = engineIn(zone);
			expect(render(engine.evaluateExpression("31/01/2024 + 1 month"), calendar)).toContain("Thursday, February 29, 2024");
			expect(engine.evaluateExpression("working days between 01/01/2024 and 31/01/2024").toNumber()).toBe(23);
			expect(engine.evaluateExpression("weekday on 10/03/2024").value).toBe("Sunday");
			expect(engine.evaluateExpression("2nd Tuesday of March 2026 as weekday").value).toBe("Tuesday");
			expect(engine.evaluateExpression("3pm Tokyo in Delhi").value).toBe("11:30 AM");
			expect(engine.evaluateExpression("time difference between Tokyo and Delhi").value).toBe("Tokyo is 3 hours 30 minutes ahead of Delhi");
		}
	});
});
