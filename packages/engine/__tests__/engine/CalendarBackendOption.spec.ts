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
import type { CalendarBackend, CalendarFields, ZonedFields } from "@solve-js/calendar/CalendarBackend";
import type { IAsyncResolver } from "@solve-js/resolvers/ResolverRegistry";
import { ValueType, numberValue } from "@solve-js/vm/Value";

/** A backend that delegates to `Date` but records every call and pins `now`. */
class RecordingCalendar implements CalendarBackend {
	readonly calls: string[] = [];
	constructor(private readonly inner: CalendarBackend, private readonly fixedNow: number) {}
	now(): number { this.calls.push("now"); return this.fixedNow; }
	fields(epochMs: number): CalendarFields { this.calls.push("fields"); return this.inner.fields(epochMs); }
	localMidnight(year: number, month0: number, day: number): number { this.calls.push("localMidnight"); return this.inner.localMidnight(year, month0, day); }
	localWallClock(year: number, month0: number, day: number, minutes: number): number { this.calls.push("localWallClock"); return this.inner.localWallClock(year, month0, day, minutes); }
	addDays(epochMs: number, days: number): number { this.calls.push("addDays"); return this.inner.addDays(epochMs, days); }
	addMonths(epochMs: number, months: number): number { this.calls.push("addMonths"); return this.inner.addMonths(epochMs, months); }
	utcOffsetMinutes(epochMs: number): number { this.calls.push("utcOffsetMinutes"); return this.inner.utcOffsetMinutes(epochMs); }
	parseIso8601(text: string): number { this.calls.push("parseIso8601"); return this.inner.parseIso8601(text); }
	formatLongDate(epochMs: number, locale: string): string { this.calls.push("formatLongDate"); return this.inner.formatLongDate(epochMs, locale); }
	formatTimeOfDay(epochMs: number, locale: string): string { this.calls.push("formatTimeOfDay"); return this.inner.formatTimeOfDay(epochMs, locale); }
	zoneOffsetMinutes(zone: string, epochMs: number): number { this.calls.push("zoneOffsetMinutes"); return this.inner.zoneOffsetMinutes(zone, epochMs); }
	fieldsInZone(zone: string, epochMs: number): ZonedFields { this.calls.push("fieldsInZone"); return this.inner.fieldsInZone(zone, epochMs); }
	formatTimeInZone(zone: string, epochMs: number): string { this.calls.push("formatTimeInZone"); return this.inner.formatTimeInZone(zone, epochMs); }
	formatDateInZone(zone: string, epochMs: number): string { this.calls.push("formatDateInZone"); return this.inner.formatDateInZone(zone, epochMs); }
}

const FIXED_NOW = Date.parse("2026-08-26T10:00:00Z");

function recordingEngine(): { engine: ExpressionEngine; calendar: RecordingCalendar } {
	const calendar = new RecordingCalendar(DATE_CALENDAR, FIXED_NOW);
	const engine = newTrackedEngine({ calendar });
	return { engine, calendar };
}

describe("the context carries the backend", () => {
	test("createEngineContext defaults to the Date backend", () => {
		expect(createEngineContext().calendar).toBe(DATE_CALENDAR);
		const custom = new RecordingCalendar(DATE_CALENDAR, FIXED_NOW);
		expect(createEngineContext({ calendar: custom }).calendar).toBe(custom);
	});

	test("an engine without the option computes with the Date backend", () => {
		const engine = newTrackedEngine();
		expect(engine.getVM().context.calendar).toBe(DATE_CALENDAR);
	});

	test("an engine with the option holds it, and a second engine is untouched", () => {
		const { engine, calendar } = recordingEngine();
		const other = newTrackedEngine();
		expect(engine.getVM().context.calendar).toBe(calendar);
		expect(other.getVM().context.calendar).toBe(DATE_CALENDAR);
		// The pinned clock belongs to the first engine only.
		expect(engine.evaluateExpression("today").toNumber()).toBe(FIXED_NOW);
		expect(other.evaluateExpression("today").toNumber()).not.toBe(FIXED_NOW);
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
		const calendar = new RecordingCalendar(DATE_CALENDAR, FIXED_NOW);
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
