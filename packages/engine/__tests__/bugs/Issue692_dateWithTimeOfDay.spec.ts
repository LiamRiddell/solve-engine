import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import { wallTimeOn } from "@solve-js/calendar/WallTime";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

/**
 * Issue #692: a date and a time of day together could be written only in the
 * ISO `T` form. The way people write a meeting or a deadline, a date and then a
 * time (bare, or after `at`), or a time and then `on` and a date, threw, and
 * the message quoted the clock time's minutes since midnight. Each now reads as
 * the `T` literal for that day and time: the same instant, the same grain.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("each spelling is the T literal for that day and time", () => {
	test.each([
		["2026-01-04 14:30", "2026-01-04T14:30"],
		["2026-01-04 2:30pm", "2026-01-04T14:30"],
		["2026-01-04 at 14:30", "2026-01-04T14:30"],
		["23 September 2026 3pm", "2026-09-23T15:00"],
		["23 September 2026 at 3pm", "2026-09-23T15:00"],
		["3pm on 23 September 2026", "2026-09-23T15:00"],
		["25/12/2026 9am", "2026-12-25T09:00"],
		["December 25 2026 9am", "2026-12-25T09:00"],
		["25 Dec 2026 at 9:30am", "2026-12-25T09:30"],
		["2026-01-04 3.30pm", "2026-01-04T15:30"],
		["2026-01-04 14:30:15", "2026-01-04T14:30:15"],
		["2026-01-04 12am", "2026-01-04T00:00"],
		["2026-01-04 00:00", "2026-01-04T00:00"],
		["2026-01-04 12pm", "2026-01-04T12:00"],
	])("%s is %s", (written, iso) => {
		expect(show(written)).toBe(show(iso));
		expect(show(written)).not.toMatch(/^THROWS/);
	});

	test("the answers a reader sees", () => {
		expect(show("2026-01-04 14:30")).toBe("= Sunday, January 4, 2026, 2:30:00 PM");
		expect(show("23 September 2026 3pm")).toBe("= Wednesday, September 23, 2026, 3:00:00 PM");
		expect(show("3pm on 23 September 2026")).toBe("= Wednesday, September 23, 2026, 3:00:00 PM");
		expect(show("2026-01-04 14:30:15")).toBe("= Sunday, January 4, 2026, 2:30:15 PM");
		// Midnight shows as the day alone, as the T literal's does.
		expect(show("2026-01-04 12am")).toBe("= Sunday, January 4, 2026");
	});

	test("the value carries the wall-clock grain the T literal does", () => {
		const engine = newTrackedEngine();
		const written = engine.evaluateExpression("23 September 2026 at 3pm");
		const iso = engine.evaluateExpression("2026-09-23T15:00");
		expect(written.type).toBe(ValueType.Datetime);
		expect(written.grain).toBe("datetime");
		expect(written.toNumber()).toBe(iso.toNumber());
		expect(engine.evaluateExpression("3pm on 23 September 2026").grain).toBe("datetime");
	});
});

describe("it goes wherever the T literal goes", () => {
	test.each([
		["2026-01-04 14:30 + 2 hours", "2026-01-04T14:30 + 2 hours"],
		["23 September 2026 3pm + 90 minutes", "2026-09-23T15:00 + 90 minutes"],
		["2026-01-10 5pm - 2026-01-04 9am", "2026-01-10T17:00 - 2026-01-04T09:00"],
		["days between 2026-01-04 9am and 2026-01-10 5pm", "days between 2026-01-04T09:00 and 2026-01-10T17:00"],
		["hours between 2026-01-04 9am and 2026-01-10 5pm", "hours between 2026-01-04T09:00 and 2026-01-10T17:00"],
		["2026-01-04 14:30 in Tokyo", "2026-01-04T14:30 in Tokyo"],
		["3pm on 23 September 2026 in Tokyo", "2026-09-23T15:00 in Tokyo"],
		["2026-01-04 9am frozen", "2026-01-04T09:00 frozen"],
	])("%s", (written, iso) => {
		expect(show(written)).toBe(show(iso));
		expect(show(written)).not.toMatch(/^THROWS/);
	});

	test("on the days the clocks change, a time in the skipped or repeated hour lands where the T literal's does", () => {
		expect(show("2026-03-29 1:30")).toBe(show("2026-03-29T01:30"));
		expect(show("2026-10-25 1:30")).toBe(show("2026-10-25T01:30"));
		expect(show("3pm on 29 March 2026")).toBe(show("2026-03-29T15:00"));
	});

	test("the three entry points give the same answer", () => {
		const lines = ["2026-01-04 14:30", "3pm on 23 September 2026", "hours between 2026-01-04 9am and 2026-01-10 5pm"];
		const single = lines.map((line) => formatValue(newTrackedEngine().evaluateLine(1, line)));
		const text = lines.join("\n");
		const batch = newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((l) => formatValue(l.result!));
		const incremental = evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }).lines.map((l) => formatValue(l.result!));
		expect(single).toEqual(["= Sunday, January 4, 2026, 2:30:00 PM", "= Wednesday, September 23, 2026, 3:00:00 PM", "= 152 hours"]);
		expect(batch).toEqual(single);
		expect(incremental).toEqual(single);
	});

	test("the date after on can be any line or name that gives a date", () => {
		const engine = newTrackedEngine();
		const result = engine.parseDocument(":meeting = 23 September 2026\n3pm on meeting", { inputType: "markdown" });
		expect(formatValue(result.lines[1].result!)).toBe("= Wednesday, September 23, 2026, 3:00:00 PM");
		const today = newTrackedEngine().evaluateExpression("3pm on today");
		expect(today.type).toBe(ValueType.Datetime);
		expect(formatValue(today)).toMatch(/3:00:00 PM$/);
	});
});

describe("what it must not break", () => {
	test("at before a rate and on after a percentage keep their meanings", () => {
		expect(show("40 hours at £15/hour")).toBe("= £600.00");
		expect(show("5% on $100")).toBe("= $105.00");
	});

	test("a clock interval, a lone clock time and a spaced subtraction are unchanged", () => {
		expect(show("9am to 5pm")).toBe("= 480 minutes");
		expect(show("2024 - 5 - 3")).toBe("= 2,016");
		expect(show("3pm London on 23 September 2026 in Tokyo")).toBe("= 11:00 PM");
	});

	test("a date alone before a colon is still a label", () => {
		expect(show("2026-01-04: 45")).toBe("= 45");
	});

	test("a date followed by a number that is not a time still refuses", () => {
		expect(show("2026-01-04 14")).toBe('THROWS Unexpected token after expression: "14"');
		expect(show("2026-01-04 13pm")).toBe('THROWS Unexpected token after expression: "13"');
	});

	test("a whole month takes no time, since no day was named", () => {
		expect(show("February 2026 3pm")).toBe('THROWS Unexpected token after expression: "3pm"');
	});

	test("a time that does not exist on the clock is refused by name, where it once answered 0", () => {
		expect(show("2026-01-04 24:00")).toBe('THROWS "24:00" is not a valid time');
		expect(show("2026-01-04 25:00")).toBe('THROWS "25:00" is not a valid time');
		expect(show("2026-01-04 at 9:60")).toBe('THROWS "9:60" is not a valid time');
	});

	test("a date that already has a time takes no second one", () => {
		expect(show("2026-01-04T14:30 3pm")).toBe('THROWS Unexpected token after expression: "3pm"');
		expect(show("3pm on 2026-01-04T09:00")).toBe(show("2026-01-04T15:00"));
	});
});

describe("the message quotes what was typed", () => {
	test.each([
		["tomorrow 3pm", "3pm"],
		["tomorrow 14:30", "14:30"],
		["2026-01-04 9am to 5pm", "9am to 5pm"],
		["5 14:30:15", "14:30:15"],
	])("%s names %s", (line, quoted) => {
		expect(show(line)).toBe(`THROWS Unexpected token after expression: "${quoted}"`);
	});
});

describe("adversarial", () => {
	test("on without a date, or with something that is not one, is refused by name", () => {
		expect(show("3pm on")).toMatch(/^THROWS Expected a date after "on"/);
		const engine = newTrackedEngine();
		const five = engine.evaluateExpression("3pm on 5");
		expect(five.errorCode).toBe("TIME_ZONE_EXPECTED_DATE");
		const text = engine.evaluateExpression('3pm on "tomorrow"');
		expect(text.errorCode).toBe("TIME_ZONE_EXPECTED_DATE");
	});

	test("a date that failed passes its own error through", () => {
		const engine = newTrackedEngine();
		const result = engine.parseDocument(":d = 1 / 0\n3pm on d", { inputType: "markdown" });
		expect(result.lines[1].result?.type === ValueType.Error || result.lines[1].error !== undefined).toBe(true);
	});

	test("prototype words after on are names like any other, not crashes", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(show(`3pm on ${word}`)).not.toMatch(/Cannot read|is not a function|of undefined|Maximum call stack/i);
		}
	});

	test("a long run of times after a date reads the first and refuses the next", () => {
		expect(show("2026-01-04 9am 10am")).toBe('THROWS Unexpected token after expression: "10am"');
		expect(show(`2026-01-04 ${Array(50).fill("9am").join(" ")}`)).toBe('THROWS Unexpected token after expression: "9am"');
	});

	test("wallTimeOn refuses what is not a time of day, or a year with no four-digit spelling", () => {
		const day = Date.UTC(2026, 0, 4, 12);
		expect(wallTimeOn(day, -1, DATE_CALENDAR)).toBeNull();
		expect(wallTimeOn(day, 86_400, DATE_CALENDAR)).toBeNull();
		expect(wallTimeOn(day, 1.5, DATE_CALENDAR)).toBeNull();
		expect(wallTimeOn(day, NaN, DATE_CALENDAR)).toBeNull();
		expect(wallTimeOn(Date.UTC(10_000, 0, 4, 12), 60, DATE_CALENDAR)).toBeNull();
		expect(wallTimeOn(day, 0, DATE_CALENDAR)).not.toBeNull();
	});

	test("the date's own reading is reported as before, with the time left out of it", () => {
		const engine = newTrackedEngine();
		const withTime = engine.readDates("03/04/2026 9am");
		const alone = engine.readDates("03/04/2026");
		expect(withTime.map((r) => ({ ...r }))).toEqual(alone.map((r) => ({ ...r })));
	});
});
