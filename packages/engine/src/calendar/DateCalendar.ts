import type { CalendarBackend, CalendarFields, ZonedFields } from "./CalendarBackend";
import { daysInMonth, utcMs } from "./Gregorian";
import { dateInZone, timeInZone, zonedFields } from "./IntlZone";

/**
 * The default {@link CalendarBackend}: the JavaScript `Date` object, read in
 * the host process's time zone, with `Intl.DateTimeFormat` for named zones.
 *
 * This is the calendar code the engine has always run, moved behind the
 * interface method by method rather than rewritten, so a host that configures
 * nothing sees the same instants and the same strings it did before the
 * backend existed. Where `Date` has a quirk (a two-digit year in a
 * constructor maps to the 1900s, an out-of-range instant answers `NaN`), the
 * quirk is kept here deliberately: the point of this backend is to be the
 * behaviour the `Temporal` backend is measured against, not to improve on it.
 *
 * It stays the default because it is the one calendar every supported runtime
 * has. `Temporal` ships unflagged in Node 26 and in current Chrome, Firefox
 * and Deno, but not in Safari or in the Node 22 and 24 the engine supports,
 * and the smallest polyfill adds about twenty kilobytes gzipped to a bundle
 * that a host doing plain arithmetic never needs. A host that wants
 * `Temporal` opts in through the engine's `calendar` option with the backend
 * from `solve-engine/temporal`, and pays for it only then.
 */
export class DateCalendar implements CalendarBackend {
	now(): number {
		return Date.now();
	}

	fields(epochMs: number): CalendarFields {
		const d = new Date(epochMs);
		return {
			year: d.getFullYear(),
			month0: d.getMonth(),
			day: d.getDate(),
			weekday: d.getDay(),
			hour: d.getHours(),
			minute: d.getMinutes(),
			second: d.getSeconds(),
			millisecond: d.getMilliseconds(),
		};
	}

	localMidnight(year: number, month0: number, day: number): number {
		return new Date(year, month0, day).getTime();
	}

	localWallClock(year: number, month0: number, day: number, minutesPastMidnight: number): number {
		// Anchored at midnight and then moved by the minutes FIELD, so the
		// result is the wall-clock reading asked for whatever the day's length.
		const anchored = new Date(year, month0, day, 0, 0, 0, 0);
		anchored.setMinutes(minutesPastMidnight);
		return anchored.getTime();
	}

	addDays(epochMs: number, days: number): number {
		const date = new Date(epochMs);
		date.setDate(date.getDate() + days);
		return date.getTime();
	}

	addMonths(epochMs: number, months: number): number {
		const date = new Date(epochMs);
		const dayOfMonth = date.getDate();
		// Parked on the 1st before the month field moves: `setMonth()` keeps
		// the day number, so a 31st aimed at a 30-day month would overflow
		// into the month after it. Clamping afterwards is what keeps the month
		// the caller asked for.
		date.setDate(1);
		date.setMonth(date.getMonth() + months);
		date.setDate(Math.min(dayOfMonth, daysInMonth(date.getFullYear(), date.getMonth())));
		return date.getTime();
	}

	utcOffsetMinutes(epochMs: number): number {
		// `getTimezoneOffset()` is (UTC minus local), so its sign is inverted
		// relative to the "+HH:MM ahead of UTC" reading every caller wants.
		return -new Date(epochMs).getTimezoneOffset();
	}

	parseIso8601(text: string): number {
		return new Date(text).getTime();
	}

	formatLongDate(epochMs: number, locale: string): string {
		return new Date(epochMs).toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
	}

	formatTimeOfDay(epochMs: number, locale: string): string {
		return new Date(epochMs).toLocaleTimeString(locale);
	}

	zoneOffsetMinutes(zone: string, epochMs: number): number {
		// The `Intl` round trip: read the instant as the zone's wall-clock
		// fields, re-read those fields as if they were UTC, and the difference
		// from the instant is the zone's offset then, daylight saving included.
		const f = zonedFields(zone, epochMs);
		return Math.round((utcMs(f.year, f.month0, f.day, f.hour, f.minute, f.second) - epochMs) / 60000);
	}

	fieldsInZone(zone: string, epochMs: number): ZonedFields {
		return zonedFields(zone, epochMs);
	}

	formatTimeInZone(zone: string, epochMs: number): string {
		return timeInZone(zone, epochMs);
	}

	formatDateInZone(zone: string, epochMs: number): string {
		return dateInZone(zone, epochMs);
	}
}

/**
 * The one `Date` backend, shared by every engine that configures no other.
 *
 * Stateless, so sharing is safe: it holds no zone of its own and reads the
 * process's. It is also what the sites with no engine in hand use (the
 * normaliser rules that fuse a literal, `days in <period>`, the stocks and
 * historical-currency date phrases, and `formatValue`), which is why an
 * engine's own backend is the default here rather than a second copy.
 */
export const DATE_CALENDAR: CalendarBackend = new DateCalendar();

/**
 * The backend a plugin function or converter should compute with: the one
 * on its execution context, or the `Date` backend when the handler was
 * called with no context (a direct call from a test, or an `as` converter
 * invoked outside the VM).
 *
 * @param context - The execution context the handler received, if any.
 * @returns The engine's backend when the context carries one, else {@link DATE_CALENDAR}.
 */
export function calendarOf(context?: { readonly calendar?: CalendarBackend }): CalendarBackend {
	return context?.calendar ?? DATE_CALENDAR;
}
