import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { temporalForTests } from "@tools/temporalTestKit";
import { expectPrototypeUntouched } from "@tools/adversarial";
import { createTemporalCalendar } from "@solve-js/temporal/TemporalCalendar";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { EngineError } from "@solve-js/errors/EngineError";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";

/**
 * Issue #826: the `Temporal` backend's `now` option was not checked. A clock
 * answering `NaN` reached the display as `Invalid Date, Invalid Date`, and one
 * that was not a function failed with an uncoded TypeError on first use,
 * where the `Date` backend's clock (`dateCalendarInZone(zone, { now })`, #721)
 * refuses both as `DATE_CLOCK_INVALID`. Both backends now wrap the host's
 * clock in the same check (`calendar/Clock.ts`), so these cases are the `Date`
 * backend's own, run against each.
 */

const temporal = temporalForTests();

/** The two ways a host hands a backend its clock, by name. */
const BUILDERS: Array<[string, (now: unknown) => CalendarBackend]> = [
	["Temporal", (now) => createTemporalCalendar(temporal, { timeZone: "UTC", now: now as () => number })],
	["Date", (now) => dateCalendarInZone("UTC", { now: now as () => number })],
];

/** What reading the clock through `today` did: the code it was refused with, or the answer. */
function today(calendar: CalendarBackend): string {
	try {
		const engine = newTrackedEngine({ calendar });
		return engine.formatValue(engine.evaluateExpression("today"), { dateResult: { format: "iso" } });
	} catch (e) {
		return e instanceof EngineError ? e.code : `RAW ${(e as Error).name}`;
	}
}

describe("the Temporal backend's clock is checked as the Date backend's is", () => {
	for (const [name, build] of BUILDERS) {
		describe(name, () => {
			test("a pinned clock pins today", () => {
				expect(today(build(() => Date.UTC(2020, 0, 1)))).toBe("= 2020-01-01");
			});

			test.each<[string, unknown]>([
				["NaN", () => Number.NaN],
				["Infinity", () => Number.POSITIVE_INFINITY],
				["-Infinity", () => Number.NEGATIVE_INFINITY],
				["past the range", () => 8.64e15 + 1],
				["a string", () => "2020-01-01"],
				["undefined", () => undefined],
				["a throw", () => { throw new Error("clock down"); }],
			])("a reading of %s is refused on the line with DATE_CLOCK_INVALID", (_reading, now) => {
				expect(today(build(now))).toBe("DATE_CLOCK_INVALID");
			});

			test.each<[string, unknown]>([["5", 5], ["a string", "now"], ["null", null], ["an object", { now: () => 0 }]])(
				"a clock of %s is refused when the backend is built",
				(_given, now) => {
					let caught: unknown;
					try { build(now); } catch (e) { caught = e; }
					expect(caught).toBeInstanceOf(EngineError);
					expect((caught as EngineError).code).toBe("DATE_CLOCK_INVALID");
				},
			);
		});
	}

	test("the refusal names the call the clock was given to", () => {
		let caught: EngineError | undefined;
		try { createTemporalCalendar(temporal, { now: 5 as unknown as () => number }); } catch (e) { caught = e as EngineError; }
		expect(caught?.message).toBe(
			"The clock given to createTemporalCalendar is 5, not a function, so today and now cannot be read. It should return the current moment in epoch milliseconds.",
		);
		const calendar = createTemporalCalendar(temporal, { timeZone: "UTC", now: () => Number.NaN });
		expect(() => calendar.now()).toThrow(
			"The clock given to createTemporalCalendar answered NaN, which is not a moment in time, so today and now cannot be read. It should return the current moment in epoch milliseconds.",
		);
	});

	test("no clock reads Temporal.Now, unchecked, as before", () => {
		const before = Date.now();
		expect(createTemporalCalendar(temporal, { timeZone: "UTC" }).now()).toBeGreaterThanOrEqual(before);
		expect(createTemporalCalendar(temporal, { timeZone: "UTC", now: undefined }).now()).toBeGreaterThanOrEqual(before);
	});

	test("a good reading is truncated to a whole millisecond, as Date truncates", () => {
		expect(createTemporalCalendar(temporal, { timeZone: "UTC", now: () => 1_000.9 }).now()).toBe(1_000);
	});
});

describe("adversarial", () => {
	test("security: a clock that throws a hostile object is refused by code, and Object.prototype is untouched", () => {
		expectPrototypeUntouched(() => {
			const hostile = () => { throw { toString: () => "[object Object]", __proto__: null }; };
			expect(today(createTemporalCalendar(temporal, { timeZone: "UTC", now: hostile }))).toBe("DATE_CLOCK_INVALID");
		});
	});

	test("realistic breakage: a bad clock fails only the lines that read it, and the two backends and two passes agree", () => {
		const doc = "today\n2 + 2\n3 April 2026\nnow + 1 day";
		const read = (calendar: CalendarBackend, pass: "batch" | "incremental") => {
			const engine = newTrackedEngine({ calendar });
			const result = pass === "batch" ? engine.parseDocument(doc) : evaluateDocument(engine, doc);
			return result.lines.map((l) => l.errorCode ?? (l.result === null ? null : l.result.value));
		};
		const expected = ["DATE_CLOCK_INVALID", 4, Date.UTC(2026, 3, 3), "DATE_CLOCK_INVALID"];
		for (const [, build] of BUILDERS) {
			expect(read(build(() => Number.NaN), "batch")).toEqual(expected);
			expect(read(build(() => Number.NaN), "incremental")).toEqual(expected);
		}
	});

	test("edge cases: the epoch, negative zero and both ends of the range are moments", () => {
		for (const [, build] of BUILDERS) {
			expect(today(build(() => 0))).toBe("= 1970-01-01");
			expect(today(build(() => -0))).toBe("= 1970-01-01");
			expect(today(build(() => 8.64e15))).toBe("= +275760-09-13");
			expect(build(() => -8.64e15).now()).toBe(-8.64e15);
		}
	});
});
