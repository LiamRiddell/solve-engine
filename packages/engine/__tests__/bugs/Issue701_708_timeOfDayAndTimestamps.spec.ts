import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { serializeValue } from "@solve-js/worker/serialize";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { ValueType, type Value } from "@solve-js/vm/Value";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";

/**
 * Issue #708: a clock time printed as a full date, `9:00am + 3 hours` showing
 * today's weekday and date, and nothing showed another date as a time of day.
 * A clock time now carries a time-of-day grain and prints as the time, with the
 * days it has moved beside it, and `as time` shows any date that way.
 *
 * Issue #701: an epoch conversion was spelled only with `to`; `as date` and
 * `as timestamp` now sit beside `to date` and `to timestamp`.
 */

function show(line: string, engine = newTrackedEngine()): string {
	try {
		return formatValue(engine.evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("a clock time is shown as a time of day", () => {
	test.each([
		["9am", "9:00:00 AM"],
		["9:00am", "9:00:00 AM"],
		["16:00", "4:00:00 PM"],
		["3.30pm", "3:30:00 PM"],
		["12am", "12:00:00 AM"],
		["12pm", "12:00:00 PM"],
		["9:00am + 3 hours", "12:00:00 PM"],
		["9am + 90 minutes", "10:30:00 AM"],
		["5pm - 30 minutes", "4:30:00 PM"],
	])("%s is %s", (line, shown) => {
		expect(show(line)).toBe(shown);
	});

	test("it carries the time-of-day grain", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("9am").grain).toBe("time");
		expect(engine.evaluateExpression("9am + 3 hours").grain).toBe("time");
		expect(engine.evaluateExpression("9am").type).toBe(ValueType.Datetime);
	});

	test("across midnight the day shift is shown, either way", () => {
		expect(show("11pm + 2 hours")).toBe("1:00:00 AM (+1 day)");
		expect(show("1am - 2 hours")).toBe("11:00:00 PM (-1 day)");
		expect(show("9am + 1 day")).toBe("9:00:00 AM (+1 day)");
		expect(show("9am + 3 days")).toBe("9:00:00 AM (+3 days)");
		expect(show("(11pm + 2 hours) - 2 hours")).toBe("11:00:00 PM");
	});

	test("the shift is fixed when the time is written, not counted from the day it is shown on", () => {
		const value = newTrackedEngine().evaluateExpression("11pm + 2 hours");
		const tomorrow: CalendarBackend = new Proxy(DATE_CALENDAR, {
			get(target, key, receiver) {
				if (key === "now") return () => target.now() + 86_400_000;
				return Reflect.get(target, key, receiver);
			},
		});
		expect(formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, calendar: tomorrow })).toBe("= 1:00:00 AM (+1 day)");
	});

	test("the numeric date formats write it as HH:MM:SS", () => {
		const value = newTrackedEngine().evaluateExpression("9:00am + 3 hours");
		expect(formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, dateResult: { format: "iso" } })).toBe("= 12:00:00");
		expect(formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, dateResult: { format: "dmy" } })).toBe("= 12:00:00");
	});

	test("in a zone it stays a time of day", () => {
		const value = newTrackedEngine().evaluateExpression("6pm in Chicago");
		expect(value.grain).toBe("time");
		expect(value.zone).toBe("America/Chicago");
		expect(formatValue(value)).toBe("= 6:00:00 PM");
	});

	test("the arithmetic between clock times is unchanged", () => {
		expect(show("9am to 5pm")).toBe("480 minutes");
		expect(show("5pm - 9am")).toBe("8:00");
		expect(show("9am < 5pm")).toBe("true");
		expect(show("3pm London in Tokyo")).toBe("11:00 PM");
	});
});

describe("as time", () => {
	test("shows a date and time as its time of day, with no shift until it moves", () => {
		expect(show("2026-04-03T09:30 as time")).toBe("9:30:00 AM");
		expect(show("2026-04-03T23:00 as time")).toBe("11:00:00 PM");
		expect(show("9:00am + 3 hours as time")).toBe("12:00:00 PM");
		expect(show("1710000000 as date as time")).toMatch(/^\d{1,2}:00:00 [AP]M$/);
	});

	test("the instant does not change", () => {
		const engine = newTrackedEngine();
		const date = engine.evaluateExpression("2026-04-03T09:30");
		const time = engine.evaluateExpression("2026-04-03T09:30 as time");
		expect(time.toNumber()).toBe(date.toNumber());
	});

	test.each([
		["5 as time"],
		['"2026-04-03T09:30" as time'],
		["5 kg as time"],
		["$5 as time"],
		["true as time"],
	])("%s is refused: it is not a date", (line) => {
		expect(show(line)).toMatch(/^as time shows a date and time as its time of day, and this value is not a date/);
	});
});

describe("as date and as timestamp", () => {
	test.each([
		["1710000000"],
		["1710000000000"],
		["2024-03-09"],
		['"2024-03-09T16:00:00Z"'],
		["-86400"],
	])("%s: as date is to date", (value) => {
		expect(show(`${value} as date`)).toBe(show(`${value} to date`));
		expect(show(`${value} as date`)).not.toMatch(/^THROWS|^as date/);
	});

	test("either side of the milliseconds threshold, a trillion", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("999999999999 as date").toNumber()).toBe(999999999999 * 1000);
		expect(engine.evaluateExpression("1000000000000 as date").toNumber()).toBe(1e12);
		expect(engine.evaluateExpression("-1000000000000 as date").toNumber()).toBe(-1e12);
	});

	test("a fraction of a second is kept", () => {
		expect(newTrackedEngine().evaluateExpression("1.5 as date").toNumber()).toBe(1500);
	});

	test("as timestamp writes whole seconds, reading a timestamp in milliseconds first", () => {
		expect(show("2024-03-09 as timestamp")).toBe(show("2024-03-09 to timestamp"));
		expect(show("1710000000000 as timestamp")).toBe("1,710,000,000");
		expect(show("1710000000 as timestamp")).toBe("1,710,000,000");
		expect(show('"2024-03-09T16:00:00Z" as timestamp')).toBe("1,710,000,000");
		expect(show("1710000000.9 as timestamp")).toBe("1,710,000,000");
	});

	test.each([
		["5 kg as date", /^as date reads a Unix timestamp/],
		["true as date", /^as date reads a Unix timestamp/],
		["[1, 2] as date", /^as date reads a Unix timestamp/],
		["5 kg as timestamp", /^as timestamp writes a date/],
		['"not a date" as date', /is not a recognizable ISO8601/],
		["1e300 as date", /outside the dates the engine can hold/],
	])("%s is refused by name", (line, message) => {
		expect(show(line)).toMatch(message);
	});
});

describe("the new grain survives a snapshot and the worker", () => {
	test("a snapshot restores a time of day with its grain and its anchor", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		engine.parseDocument(":late = 11pm + 2 hours", { inputType: "markdown" });
		const before = engine.getVM().getVar("late") as Value;
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		const after = restored.getVM().getVar("late") as Value;
		expect(after.grain).toBe("time");
		expect(after.timeAnchor).toBe(before.timeAnchor);
		expect(formatValue(after)).toBe(formatValue(before));
		expect(formatValue(after)).toBe("= 1:00:00 AM (+1 day)");
	});

	test("a snapshot with a malformed anchor is refused", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		engine.parseDocument(":late = 11pm", { inputType: "markdown" });
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));
		const text = JSON.stringify(snapshot).replace(/"ta":[^,}]+/, '"ta":"soon"');
		expect(() => ExpressionEngine.fromJSON(JSON.parse(text), { packages: BUILTIN_PACKAGES })).toThrow();
	});

	test("a worker result carries the grain and the anchor", () => {
		const value = newTrackedEngine().evaluateExpression("11pm + 2 hours");
		const dto = serializeValue(value);
		expect(dto.grain).toBe("time");
		expect(dto.timeAnchor).toBe(value.timeAnchor);
		expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
	});
});

describe("adversarial", () => {
	test("prototype words before as time, as date and as timestamp are names, not crashes", () => {
		for (const word of PROTOTYPE_WORDS) {
			for (const form of ["time", "date", "timestamp"]) {
				expect(show(`${word} as ${form}`)).not.toMatch(/Cannot read|is not a function|of undefined/);
			}
		}
	});

	test("a time of day far from its day shows the whole shift", () => {
		expect(show("9am + 400 days")).toBe("9:00:00 AM (+400 days)");
		expect(show("9am - 1 day")).toBe("9:00:00 AM (-1 day)");
	});
});
