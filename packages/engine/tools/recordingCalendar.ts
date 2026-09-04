/**
 * A calendar backend that delegates to another and records every call.
 *
 * The `calendar` engine option is proven by threading rather than by answers:
 * a form went through the engine's backend if the backend saw the call. This
 * wraps any backend (the `Date` one by default), notes each method name in
 * `calls`, and pins `now` so the relative forms have a fixed answer whatever
 * the wall clock says. The option spec, the worker harness and the `Temporal`
 * specs all use it.
 */
import type { CalendarBackend, CalendarFields, ZonedFields } from "@solve-js/calendar/CalendarBackend";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

/** A backend that delegates to `inner` but records every call and answers `fixedNow` for `now()`. */
export class RecordingCalendar implements CalendarBackend {
	readonly calls: string[] = [];

	constructor(
		private readonly fixedNow: number,
		private readonly inner: CalendarBackend = DATE_CALENDAR,
	) {}

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
