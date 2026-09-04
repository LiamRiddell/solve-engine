/**
 * One document, three engines pinned to three different time zones, and what
 * has to agree between them.
 *
 * A date literal is local midnight, and "local" is whatever zone the calendar
 * backend computes in. Until `dateCalendarInZone` existed that zone was always
 * the host process's, so nothing could ask the question this file asks: does a
 * document of date literals read the same way for a reader in Auckland as for
 * one in New York?
 *
 * The answer has two halves, and both are pinned here because only one of them
 * is obvious:
 *
 * 1. **What agrees.** A calendar date reads as that calendar date in every
 *    zone, and it displays as that date when it is written out through the
 *    backend that computed it. A wall-clock literal reads as that reading, and
 *    an ISO literal carrying `Z` or an offset reads as one fixed instant, the
 *    same number everywhere. So does the grain each one records.
 * 2. **What legitimately differs.** The instants themselves: midnight in
 *    Auckland is not midnight in New York, and a document is not wrong for
 *    saying so. This is written out row by row rather than left implicit, so a
 *    change that quietly made two zones agree on an instant would fail here.
 *
 * The second block is also this phase's executable specification for the
 * whole-day and daylight-saving work deferred to phase 4. `<date> - <date>`
 * still answers a `ms` duration, so two calendar days either side of a
 * transition are 47 or 49 hours apart rather than two days, and the numbers
 * below say so. Changing that changes `value.unit` and not only the number,
 * which is why it is a separate change; the grain sidecar this phase records
 * is what phase 4 needs to make the distinction.
 */
import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The three zones the document is read in: one per hemisphere, one with no daylight saving. */
const ZONES = ["Europe/London", "America/New_York", "Pacific/Auckland"] as const;

/** A literal-only document: nothing here reads the clock, so every line is reproducible. */
const DOCUMENT = [
	"2026-04-03",
	"3 April 2026",
	"03/04/2026",
	"2026-04-03T09:30",
	"2026-04-03T10:30:00Z",
	"2026-04-03 + 1 day",
	"2026-04-03 in Tokyo",
	"30 March 2026 - 28 March 2026",
	"26 October 2026 - 24 October 2026",
	"days between 28 March 2026 and 30 March 2026",
];

interface ZonedRun {
	readonly zone: string;
	readonly calendar: CalendarBackend;
	readonly results: readonly Value[];
}

/** Evaluate the document on an engine pinned to one zone, through the batch pass. */
function runIn(zone: string): ZonedRun {
	const calendar = dateCalendarInZone(zone);
	const engine: ExpressionEngine = newTrackedEngine({ calendar });
	const parsed = engine.parseDocument(DOCUMENT.join("\n"), { inputType: "markdown" });
	return { zone, calendar, results: parsed.lines.map((line) => line.result as Value) };
}

/** Write a result out through the backend that computed it, which is what a host pinned to that zone does. */
function render(run: ZonedRun, index: number): string {
	return formatValue(run.results[index], { ...DEFAULT_FORMATTING_SETTINGS, calendar: run.calendar });
}

const runs = ZONES.map(runIn);

describe("what every zone agrees on", () => {
	test.each([0, 1, 2])("line %i, a calendar date, reads as that date in every zone", (index) => {
		for (const run of runs) {
			expect(run.results[index].grain).toBe("date");
			expect(render(run, index)).toBe("= Friday, April 3, 2026");
		}
	});

	test("a wall-clock literal reads as that reading in every zone", () => {
		for (const run of runs) {
			expect(run.results[3].grain).toBe("datetime");
			expect(render(run, 3)).toBe("= Friday, April 3, 2026, 9:30:00 AM");
		}
	});

	test("an ISO literal with an offset is one instant everywhere", () => {
		for (const run of runs) {
			expect(run.results[4].grain).toBe("instant");
			expect(run.results[4].zone).toBe("UTCOFFSET:0");
			expect(run.results[4].toNumber()).toBe(Date.parse("2026-04-03T10:30:00Z"));
		}
	});

	test("a date shifted by a day is the next date in every zone", () => {
		for (const run of runs) {
			expect(run.results[5].grain).toBe("date");
			expect(render(run, 5)).toBe("= Saturday, April 4, 2026");
		}
	});

	test("a date read in Tokyo is the same instant whoever reads it", () => {
		for (const run of runs) {
			expect(run.results[6].grain).toBe("instant");
			expect(run.results[6].zone).toBe("Asia/Tokyo");
			expect(run.results[6].toNumber()).toBe(Date.parse("2026-04-02T15:00:00Z"));
		}
	});

	test("a whole-day count is the same number of days in every zone", () => {
		for (const run of runs) {
			expect(formatValue(run.results[9], { ...DEFAULT_FORMATTING_SETTINGS, calendar: run.calendar })).toBe("= 2 days");
		}
	});
});

describe("what legitimately differs, row by row", () => {
	/** The instant each zone's engine computed for a line, keyed by zone. */
	function instants(index: number): Record<string, number> {
		return Object.fromEntries(runs.map((run) => [run.zone, run.results[index].toNumber()]));
	}

	test("midnight on one date is a different instant in each zone", () => {
		expect(instants(0)).toEqual({
			"Europe/London": Date.parse("2026-04-02T23:00:00Z"),
			"America/New_York": Date.parse("2026-04-03T04:00:00Z"),
			"Pacific/Auckland": Date.parse("2026-04-02T11:00:00Z"),
		});
	});

	test("a wall-clock reading is a different instant in each zone", () => {
		expect(instants(3)).toEqual({
			"Europe/London": Date.parse("2026-04-03T08:30:00Z"),
			"America/New_York": Date.parse("2026-04-03T13:30:00Z"),
			"Pacific/Auckland": Date.parse("2026-04-02T20:30:00Z"),
		});
	});

	test("two dates across a daylight-saving transition subtract to a duration, not a day count", () => {
		// Deferred to phase 4, and pinned here as it stands rather than left
		// implicit. `<date> - <date>` answers a `ms` Uom, so London's
		// spring-forward weekend is 47 hours and its fall-back weekend 49, while
		// a zone whose transition is elsewhere answers a flat 48. Fixing this
		// changes the unit as well as the number, which is why it is its own
		// change; the grain recorded this phase is what it needs.
		const springForward = Object.fromEntries(runs.map((run) => [run.zone, formatValue(run.results[7], { ...DEFAULT_FORMATTING_SETTINGS, calendar: run.calendar })]));
		expect(springForward).toEqual({
			"Europe/London": "= 47:00",
			"America/New_York": "= 48:00",
			"Pacific/Auckland": "= 48:00",
		});

		const fallBack = Object.fromEntries(runs.map((run) => [run.zone, formatValue(run.results[8], { ...DEFAULT_FORMATTING_SETTINGS, calendar: run.calendar })]));
		expect(fallBack).toEqual({
			"Europe/London": "= 49:00",
			"America/New_York": "= 48:00",
			"Pacific/Auckland": "= 48:00",
		});

		for (const run of runs) {
			expect(run.results[7].type).toBe(ValueType.Uom);
			expect(run.results[7].unit).toBe("ms");
		}
	});
});
