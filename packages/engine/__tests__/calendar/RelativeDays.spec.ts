/**
 * The parts behind `date.relativeDays`, called directly: the setting's check,
 * the instant `today` stands for, the test for a span of a day or more, the
 * DATE_TODAY opcode, and the two weekday finders that keep a calendar day a
 * calendar day. The answers a reader sees are proven in
 * `packages/datetime/RelativeDaysMidnight.spec.ts`.
 */

import { describe, expect, test } from "@jest/globals";
import { RELATIVE_DAY_ANCHORS, relativeDayInstant, resolveRelativeDays } from "@solve-js/calendar/RelativeDays";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { isDayOrLonger } from "@solve-js/uom/UomConverter";
import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { OpCode } from "@solve-js/parser/OpCode";
import { createEngineContext } from "@solve-js/engine/EngineContext";
import { ValueType, datetimeValue, numberValue } from "@solve-js/vm/Value";
import { thisWeekdayHandler } from "@solve-js/packages/datetime/parselets/SpokenDateFunctions";
import type { RelativeDayAnchor } from "@solve-js/calendar/RelativeDays";
import type { LineExecutionContext } from "@solve-js/vm/VM";

/** A London calendar whose clock is stopped at `iso`. */
const londonAt = (iso: string) => new RecordingCalendar(Date.parse(iso), dateCalendarInZone("Europe/London"));

/** The code of the refusal `run` throws, or null when it throws none. */
function refusalCode(run: () => unknown): string | null {
	try {
		run();
		return null;
	} catch (error) {
		return error instanceof EngineError ? error.code : `not an EngineError: ${String(error)}`;
	}
}

describe("resolveRelativeDays: the setting, checked once", () => {
	test("unset is the historic reading, and both values are taken as written", () => {
		expect(resolveRelativeDays(undefined)).toBe("now");
		expect(resolveRelativeDays("now")).toBe("now");
		expect(resolveRelativeDays("midnight")).toBe("midnight");
		expect(RELATIVE_DAY_ANCHORS).toEqual(["now", "midnight"]);
	});

	test.each(["today", "Midnight", "MIDNIGHT", " midnight", "midnight ", "", "start", "date", "midnight​", "mіdnight"])(
		"a near miss is refused by name, not read as either: %j",
		(value) => {
			expect(refusalCode(() => resolveRelativeDays(value))).toBe("DATE_RELATIVE_DAYS_INVALID");
		},
	);

	test.each([null, 0, 1, true, {}, ["midnight"], Symbol("midnight"), () => "midnight", Number.NaN])(
		"something that is not a string is refused: %p",
		(value) => {
			expect(refusalCode(() => resolveRelativeDays(value))).toBe("DATE_RELATIVE_DAYS_INVALID");
		},
	);

	test("the refusal names the setting and the two values it takes", () => {
		expect(() => resolveRelativeDays("today")).toThrow(/date\.relativeDays takes "now" or "midnight", and "today" is neither/);
		expect(() => resolveRelativeDays({})).toThrow(/and object is neither/);
	});

	test("hostile: a word naming an inherited property is refused and Object.prototype is unchanged", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(refusalCode(() => resolveRelativeDays(word))).toBe("DATE_RELATIVE_DAYS_INVALID");
			}
		});
	});

	test("hostile: a value sized to be expensive is refused at once", () => {
		const started = performance.now();
		expect(refusalCode(() => resolveRelativeDays("m".repeat(1_000_000)))).toBe("DATE_RELATIVE_DAYS_INVALID");
		expect(performance.now() - started).toBeLessThan(500);
	});
});

describe("relativeDayInstant: the instant today stands for", () => {
	test("'now' is the clock's reading, unchanged", () => {
		const calendar = londonAt("2026-03-11T12:34:56.789Z");
		expect(relativeDayInstant(calendar, "now")).toBe(Date.parse("2026-03-11T12:34:56.789Z"));
	});

	test("'midnight' is the local midnight that begins the day", () => {
		const calendar = londonAt("2026-03-11T12:34:56.789Z");
		expect(relativeDayInstant(calendar, "midnight")).toBe(Date.parse("2026-03-11T00:00:00Z"));
	});

	test.each([
		// The first and last moments of a day stay on that day.
		["2026-03-11T00:00:00.000Z", "2026-03-11T00:00:00Z"],
		["2026-03-11T23:59:59.999Z", "2026-03-11T00:00:00Z"],
		// In summer time London's midnight is 23:00 the evening before in UTC.
		["2026-07-01T22:59:59.999Z", "2026-06-30T23:00:00Z"],
		["2026-07-01T23:00:00.000Z", "2026-07-01T23:00:00Z"],
		// The days the clocks change: 23 and 25 hours long, each starting at its own midnight.
		["2026-03-29T12:00:00Z", "2026-03-29T00:00:00Z"],
		["2026-10-25T12:00:00Z", "2026-10-24T23:00:00Z"],
		// A leap day, a month end and a year end.
		["2028-02-29T18:00:00Z", "2028-02-29T00:00:00Z"],
		["2026-01-31T09:00:00Z", "2026-01-31T00:00:00Z"],
		["2026-12-31T23:30:00Z", "2026-12-31T00:00:00Z"],
	])("edge: at %s in London the day began at %s", (at, midnight) => {
		expect(relativeDayInstant(londonAt(at), "midnight")).toBe(Date.parse(midnight));
	});

	test("edge: the day is the one the calendar's own zone shows, not the host process's", () => {
		// 20:00 UTC on 11 March is already 12 March in Tokyo.
		const tokyo = new RecordingCalendar(Date.parse("2026-03-11T20:00:00Z"), dateCalendarInZone("Asia/Tokyo"));
		expect(relativeDayInstant(tokyo, "midnight")).toBe(Date.parse("2026-03-11T15:00:00Z"));
	});

	test("edge: before 1970 and far from it, the arithmetic holds", () => {
		expect(relativeDayInstant(londonAt("1900-06-15T12:00:00Z"), "midnight")).toBe(londonAt("1900-06-15T12:00:00Z").localMidnight(1900, 5, 15));
		expect(relativeDayInstant(londonAt("9999-12-31T12:00:00Z"), "midnight")).toBe(Date.parse("9999-12-31T00:00:00Z"));
	});
});

describe("isDayOrLonger: the spans a relative day counts in whole days", () => {
	test.each(["day", "days", "d", "week", "weeks", "fortnight", "month", "months", "year", "years", "workday", "workdays"])(
		"a span of a day or more: %s",
		(unit) => {
			expect(isDayOrLonger(unit)).toBe(true);
		},
	);

	test.each(["hour", "hours", "h", "minute", "minutes", "min", "second", "s", "ms"])("a span shorter than a day asks about the clock: %s", (unit) => {
		expect(isDayOrLonger(unit)).toBe(false);
	});

	test.each(["kg", "m", "USD", "", "ago", "today", undefined])("not a length of time at all: %p", (unit) => {
		expect(isDayOrLonger(unit)).toBe(false);
	});

	test("hostile: a prototype word is no unit and leaves Object.prototype alone", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(isDayOrLonger(word)).toBe(false);
		});
	});
});

describe("DATE_TODAY: the opcode `today` compiles to", () => {
	/** Runs DATE_TODAY on a VM whose context reads relative days as `anchor`. */
	function today(anchor: RelativeDayAnchor | undefined, iso = "2026-03-11T12:00:00Z") {
		const calendar = londonAt(iso);
		const context = createEngineContext({ calendar, relativeDays: anchor });
		const vm = createVM(sharedOpRegistry, 200, 50_000, undefined, undefined, undefined, undefined, undefined, undefined, context);
		return unwrapEvalResult(executeBytecode({ opcodes: new Uint8Array([OpCode.DATE_TODAY, OpCode.HALT]), numbers: new Float64Array(), strings: [] }, vm));
	}

	test("by default it is the clock's instant, exactly as DATE_NOW pushes it", () => {
		for (const anchor of [undefined, "now"] as const) {
			const value = today(anchor);
			expect(value.value).toBe(Date.parse("2026-03-11T12:00:00Z"));
			expect(value.grain).toBe("instant");
		}
	});

	test("under 'midnight' it is the start of the day, held as a calendar day", () => {
		const value = today("midnight");
		expect(value.value).toBe(Date.parse("2026-03-11T00:00:00Z"));
		expect(value.grain).toBe("date");
	});

	test("edge: one millisecond before midnight is still that day", () => {
		expect(today("midnight", "2026-03-11T23:59:59.999Z").value).toBe(Date.parse("2026-03-11T00:00:00Z"));
	});

	test("DATE_NOW is untouched by the setting", () => {
		const calendar = londonAt("2026-03-11T12:00:00Z");
		const context = createEngineContext({ calendar, relativeDays: "midnight" });
		const vm = createVM(sharedOpRegistry, 200, 50_000, undefined, undefined, undefined, undefined, undefined, undefined, context);
		const value = unwrapEvalResult(executeBytecode({ opcodes: new Uint8Array([OpCode.DATE_NOW, OpCode.HALT]), numbers: new Float64Array(), strings: [] }, vm));
		expect(value.value).toBe(Date.parse("2026-03-11T12:00:00Z"));
		expect(value.grain).toBe("instant");
	});

	test("next and last keep a calendar day a calendar day, and an instant an instant", () => {
		const calendar = londonAt("2026-03-11T12:00:00Z");
		for (const [anchor, grain, at] of [["midnight", "date", "2026-03-13T00:00:00Z"], ["now", undefined, "2026-03-13T12:00:00Z"]] as const) {
			const context = createEngineContext({ calendar, relativeDays: anchor });
			const vm = createVM(sharedOpRegistry, 200, 50_000, undefined, undefined, undefined, undefined, undefined, undefined, context);
			const program = { opcodes: new Uint8Array([OpCode.DATE_TODAY, OpCode.PUSH_NUMBER, 0, OpCode.DATE_NEXT_WEEKDAY, OpCode.HALT]), numbers: new Float64Array([5]), strings: [] };
			const value = unwrapEvalResult(executeBytecode(program, vm));
			expect(value.value).toBe(Date.parse(at));
			expect(value.grain).toBe(grain);
		}
	});
});

describe("thisWeekdayHandler: `this friday` keeps the grain it is given", () => {
	const context = { calendar: londonAt("2026-03-11T12:00:00Z") } as unknown as LineExecutionContext;

	test("a calendar day in, a calendar day out", () => {
		const value = thisWeekdayHandler([datetimeValue(Date.parse("2026-03-11T00:00:00Z"), "date"), numberValue(5)], context);
		expect(value.value).toBe(Date.parse("2026-03-13T00:00:00Z"));
		expect(value.grain).toBe("date");
	});

	test("an instant in, an instant out, as before", () => {
		const value = thisWeekdayHandler([datetimeValue(Date.parse("2026-03-11T12:00:00Z"), "instant"), numberValue(3)], context);
		expect(value.value).toBe(Date.parse("2026-03-11T12:00:00Z"));
		expect(value.grain).toBeUndefined();
	});

	test("hostile: something that is not a date is refused, not stepped", () => {
		const value = thisWeekdayHandler([numberValue(5), numberValue(5)], context);
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("DATE_EXPECTED");
	});
});
