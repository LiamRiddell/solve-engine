/**
 * The `calendar` engine option reaches every place a date is computed.
 *
 * An engine computes dates through one `CalendarBackend`, held on its
 * `EngineContext`. The VM's own date opcodes read it through `vm.context`,
 * and a package's plugin functions and `as` converters read it through the
 * execution context the VM builds from the same object. The backend here
 * wraps the `Date` one and records which methods were called, so each form
 * proves it went through the engine's backend rather than a module-level
 * default, and pins `now` so the relative forms have a fixed answer.
 *
 * The `Date` backend's own answers are covered in
 * `__tests__/calendar/DateCalendar.spec.ts`; this file is about the threading.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { createEngineContext } from "@solve-js/engine/EngineContext";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { RecordingCalendar } from "@tools/recordingCalendar";
import type { IAsyncResolver } from "@solve-js/resolvers/ResolverRegistry";
import { ValueType, numberValue } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";

const FIXED_NOW = Date.parse("2026-08-26T10:00:00Z");

function recordingEngine(): { engine: ExpressionEngine; calendar: RecordingCalendar } {
	const calendar = new RecordingCalendar(FIXED_NOW);
	const engine = newTrackedEngine({ calendar });
	return { engine, calendar };
}

describe("the context carries the backend", () => {
	test("createEngineContext defaults to the Date backend", () => {
		expect(createEngineContext().calendar).toBe(DATE_CALENDAR);
		const custom = new RecordingCalendar(FIXED_NOW);
		expect(createEngineContext({ calendar: custom }).calendar).toBe(custom);
	});

	test("an engine without the option computes with the Date backend", () => {
		// Built directly rather than through the tracked helper, which under
		// `SOLVE_CALENDAR=temporal` supplies a backend of its own.
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		expect(engine.getVM().context.calendar).toBe(DATE_CALENDAR);
		engine.clear();
	});

	test("an engine with the option holds it, and a second engine is untouched", () => {
		const { engine, calendar } = recordingEngine();
		// Built directly, as above, so the run's own default backend is not in play.
		const other = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		expect(engine.getVM().context.calendar).toBe(calendar);
		expect(other.getVM().context.calendar).toBe(DATE_CALENDAR);
		// The pinned clock belongs to the first engine only.
		expect(engine.evaluateExpression("today").toNumber()).toBe(FIXED_NOW);
		expect(other.evaluateExpression("today").toNumber()).not.toBe(FIXED_NOW);
		other.clear();
	});

	test("a restored snapshot keeps the backend it is given", () => {
		const { engine, calendar } = recordingEngine();
		engine.evaluateExpression("1 + 1");
		const restored = ExpressionEngine.fromJSON(engine.toJSON(), { packages: BUILTIN_PACKAGES, calendar });
		expect(restored.getVM().context.calendar).toBe(calendar);
		restored.clear();
	});
});

describe("the VM's date opcodes read it", () => {
	test("`now` and `today` read the backend's clock", () => {
		const { engine, calendar } = recordingEngine();
		expect(engine.evaluateExpression("now").toNumber()).toBe(FIXED_NOW);
		expect(calendar.calls).toContain("now");
	});

	test("a month step goes through addMonths, with the clamp", () => {
		const { engine, calendar } = recordingEngine();
		const value = engine.evaluateExpression("31/01/2024 + 1 month");
		expect(value.toNumber()).toBe(DATE_CALENDAR.localMidnight(2024, 1, 29));
		expect(calendar.calls).toContain("addMonths");
	});

	test("a day step goes through addDays", () => {
		const { engine, calendar } = recordingEngine();
		const value = engine.evaluateExpression("10/03/2024 + 2 days");
		expect(value.toNumber()).toBe(DATE_CALENDAR.localMidnight(2024, 2, 12));
		expect(calendar.calls).toContain("addDays");
	});

	test("a working-day walk steps and reads the weekday through it", () => {
		const { engine, calendar } = recordingEngine();
		// Monday 1 January to Friday 5 January 2024, inclusive.
		expect(engine.evaluateExpression("working days between 01/01/2024 and 05/01/2024").toNumber()).toBe(5);
		expect(calendar.calls).toContain("addDays");
		expect(calendar.calls).toContain("fields");
	});

	test("a clock time is anchored to the backend's today", () => {
		const { engine, calendar } = recordingEngine();
		const value = engine.evaluateExpression("9:00am");
		const fixed = DATE_CALENDAR.fields(FIXED_NOW);
		expect(value.toNumber()).toBe(DATE_CALENDAR.localWallClock(fixed.year, fixed.month0, fixed.day, 9 * 60));
		expect(calendar.calls).toContain("localWallClock");
	});
});

describe("plugin functions and converters read it through the execution context", () => {
	test("`weekday on <date>` and `<date> as weekday` both read the weekday from it", () => {
		const { engine, calendar } = recordingEngine();
		expect(engine.evaluateExpression("weekday on 10/03/2024").value).toBe("Sunday");
		expect(calendar.calls).toContain("fields");
		calendar.calls.length = 0;
		expect(engine.evaluateExpression("10/03/2024 as weekday").value).toBe("Sunday");
		expect(calendar.calls).toContain("fields");
	});

	test("`as iso8601` writes the backend's local fields and offset", () => {
		const { engine, calendar } = recordingEngine();
		const value = engine.evaluateExpression("10/03/2024 as iso8601");
		expect(value.type).toBe(ValueType.String);
		expect(value.value as string).toMatch(/^2024-03-10T00:00:00[+-]\d{2}:\d{2}$/);
		expect(calendar.calls).toContain("utcOffsetMinutes");
	});

	test("age is counted from the backend's clock", () => {
		const { engine, calendar } = recordingEngine();
		const value = engine.evaluateExpression("age of 15/06/1990");
		expect(value.toNumber()).toBe(36);
		expect(value.unit).toBe("years");
		expect(calendar.calls).toContain("fields");
	});

	test("a timezone form resolves its zones through it", () => {
		const { engine, calendar } = recordingEngine();
		expect(engine.evaluateExpression("time difference between Tokyo and Delhi").value).toBe(
			"Tokyo is 3 hours 30 minutes ahead of Delhi",
		);
		expect(calendar.calls).toContain("zoneOffsetMinutes");
	});
});

describe("the literal rules build through it", () => {
	test("a numeric literal and a month-name literal are built by the same backend", () => {
		const { engine, calendar } = recordingEngine();
		expect(engine.evaluateExpression("09/03/2024").toNumber()).toBe(DATE_CALENDAR.localMidnight(2024, 2, 9));
		expect(calendar.calls).toContain("localMidnight");
		calendar.calls.length = 0;
		expect(engine.evaluateExpression("March 9, 2024").toNumber()).toBe(DATE_CALENDAR.localMidnight(2024, 2, 9));
		expect(calendar.calls).toContain("localMidnight");
	});

	test("a month-name literal with no year reads the year from the backend's clock", () => {
		const { engine, calendar } = recordingEngine();
		// The pinned clock says 2026, whatever the real year is.
		expect(engine.evaluateExpression("March 9").toNumber()).toBe(DATE_CALENDAR.localMidnight(2026, 2, 9));
		expect(calendar.calls).toContain("now");
	});
});

describe("a settled live value re-runs its line through it", () => {
	/** Flush the microtask queue, so a settled promise reaches the batcher. */
	const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

	test("the re-execution reads the backend the first pass did", async () => {
		// A resolver that puts the line into the pending state once, then lets
		// it through: the settled value makes the batcher re-execute the line,
		// which is the path that once ran with no execution context at all.
		let armed = true;
		const resolved = Promise.resolve(numberValue(1));
		const resolver: IAsyncResolver = {
			namespace: "once",
			preflight: () => {
				if (!armed) return null;
				armed = false;
				return { queryKey: "once:key", resolver: resolved, packageId: "test-once", signal: new AbortController().signal };
			},
			destroy: () => {},
		};
		const calendar = new RecordingCalendar(FIXED_NOW);
		const engine = newTrackedEngine({ calendar, packages: [...BUILTIN_PACKAGES, { name: "test-once", asyncResolvers: [resolver] }] });
		// A listener, so the batcher does not warn that nothing reads the value.
		engine.getBatcher().onLineResult = () => {};

		expect(engine.evaluateLine(1, "10/03/2024 as weekday").type).toBe(ValueType.Pending);
		calendar.calls.length = 0;
		await resolved;
		await tick();
		await tick();

		const entry = engine.getLineCache().getEntryForLine(1);
		expect(entry?.result.value).toBe("Sunday");
		expect(calendar.calls).toContain("fields");
	});
});

describe("the parser reads it for the forms that read a date while parsing", () => {
	test("`days in <month>` reads the fused literal back through it", () => {
		const { engine, calendar } = recordingEngine();
		// The literal is built by the month-name rule through the backend, and
		// the parselet reads its fields back through the same backend rather
		// than a module-level default, so a backend with its own zone names
		// the month the reader wrote.
		expect(engine.evaluateExpression("days in February 2024").toNumber()).toBe(29);
		expect(calendar.calls).toContain("localMidnight");
		expect(calendar.calls).toContain("fields");
	});

	test("`days in <quarter>` with no year reads the year from its clock", () => {
		const { engine, calendar } = recordingEngine();
		// 2026 is not a leap year, so Q1 is 90 days whatever the real year is.
		expect(engine.evaluateExpression("days in Q1").toNumber()).toBe(90);
		expect(calendar.calls).toContain("now");
	});

	test("the historical-currency date phrase reads the literal through it", () => {
		const { engine, calendar } = recordingEngine();
		// The rate is looked up asynchronously (and no provider is configured,
		// so it settles as an error), but the phrase has already read the fused
		// literal by the time the line goes pending.
		const value = engine.evaluateExpression("100 USD in GBP on 12/04/2005");
		expect([ValueType.Pending, ValueType.Error]).toContain(value.type);
		expect(calendar.calls).toContain("fields");
	});
});

describe("the display reads the backend on the formatting settings", () => {
	test("formatValue writes a date through `settings.calendar`", () => {
		const { engine, calendar } = recordingEngine();
		const value = engine.evaluateExpression("10/03/2024");
		calendar.calls.length = 0;
		expect(formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, calendar })).toBe("= Sunday, March 10, 2024");
		expect(calendar.calls).toContain("fields");
		expect(calendar.calls).toContain("formatLongDate");
	});

	test("formatValue with no backend on the settings reads the Date backend", () => {
		const { engine, calendar } = recordingEngine();
		const value = engine.evaluateExpression("10/03/2024");
		calendar.calls.length = 0;
		expect(formatValue(value)).toBe("= Sunday, March 10, 2024");
		expect(calendar.calls).toEqual([]);
	});
});
