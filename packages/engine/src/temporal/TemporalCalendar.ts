/**
 * The `Temporal` calendar backend: the engine's date questions answered
 * through a `Temporal` implementation the host supplies, in a time zone the
 * host chooses.
 *
 * `Temporal` is the JavaScript standard library's replacement for `Date`. It
 * ships unflagged in Node 26 and in current Chrome, Firefox and Deno, but not
 * in Safari nor in Node 22 and 24, and the smallest polyfill adds about twenty
 * kilobytes gzipped to a bundle. The engine therefore imports no `Temporal`
 * and no polyfill: this module is reached only through the
 * `solve-engine/temporal` entry, and the host hands it the implementation to
 * use, `globalThis.Temporal` on a runtime that has one or a polyfill's export.
 * A host that never imports the entry pays nothing for it.
 *
 * The backend answers exactly what the `Date` backend answers. That is a
 * design constraint rather than a hope: `Temporal` and `Date` differ in what
 * they do with an out-of-range instant (`RangeError` against `NaN`), a
 * fractional millisecond (a throw against truncation), a day past the end of
 * a month (a clamp or a throw against a roll into the next month) and a year
 * from 0 to 99 (read literally against read as the 1900s), and every one of
 * those is reproduced here the way `Date` does it, because the engine's
 * results are measured against `Date` and a host switching backends must see
 * no result move. The differential suite under `__tests__/temporal/` is what
 * holds that line.
 *
 * The one thing that does change is the zone. `Date` reads the process's own
 * zone and nothing else; this backend reads the zone it was constructed with,
 * so a document can be computed in Tokyo from a server in London, or in a
 * zone the reader picks. That is the capability the backend adds, and the
 * only observable difference.
 *
 * The named-zone display strings go through the same `Intl.DateTimeFormat`
 * helpers the `Date` backend uses (`calendar/IntlZone.ts`), and the zone-free
 * arithmetic through `calendar/Gregorian.ts`, so the two backends share one
 * implementation wherever an answer does not depend on which backend is in
 * use. The one piece of arithmetic `Date` keeps inside its own setters, the
 * normalisation of overflowing fields, is written out in `CivilDays.ts`.
 *
 * @module TemporalCalendar
 */

import type { CalendarBackend, CalendarFields, ZonedFields } from "@solve-js/calendar/CalendarBackend";
import { daysInMonth } from "@solve-js/calendar/Gregorian";
import { civilDayNumber, civilFromDayNumber } from "./CivilDays";
import { dateInZone, timeInZone } from "@solve-js/calendar/IntlZone";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { CoreErrorCodes } from "@solve-js/errors/ErrorCode";

/**
 * The part of a `Temporal.Instant` the backend reads: its epoch milliseconds,
 * and the zoned date-time it shows in a named zone.
 */
export interface TemporalInstantLike {
	readonly epochMilliseconds: number;
	toZonedDateTimeISO(timeZone: string): TemporalZonedDateTimeLike;
}

/**
 * The part of a `Temporal.ZonedDateTime` the backend reads: the calendar
 * fields (a one-based month and an ISO weekday, Monday 1 to Sunday 7, both
 * translated at the boundary), the offset, and the instant.
 */
export interface TemporalZonedDateTimeLike {
	readonly year: number;
	/** One-based month, 1 is January, as `Temporal` counts. */
	readonly month: number;
	readonly day: number;
	/** ISO weekday: Monday is 1, Sunday is 7. */
	readonly dayOfWeek: number;
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
	readonly millisecond: number;
	/** The zone's offset from UTC at this instant, in nanoseconds, positive when ahead. */
	readonly offsetNanoseconds: number;
	readonly epochMilliseconds: number;
	/** The zone's canonical IANA identifier. */
	readonly timeZoneId: string;
}

/** The part of a `Temporal.PlainDateTime` the backend uses: resolving a wall-clock time to an instant in a zone. */
export interface TemporalPlainDateTimeLike {
	toZonedDateTime(
		timeZone: string,
		options?: { disambiguation?: "compatible" | "earlier" | "later" | "reject" },
	): TemporalZonedDateTimeLike;
}

/** The wall-clock fields a `Temporal.PlainDateTime` is built from, with a one-based month. */
export interface TemporalDateTimeFields {
	year: number;
	/** One-based month, 1 is January. */
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
}

/**
 * The subset of the `Temporal` namespace the backend uses, as a structural
 * type, so the engine compiles and ships with no `Temporal` type installed
 * and a host passes whichever implementation it has: `globalThis.Temporal`
 * on Node 26 or a current browser, or the export of a polyfill such as
 * `temporal-polyfill`. Both satisfy this shape as they are.
 */
export interface TemporalLike {
	readonly Now: {
		instant(): TemporalInstantLike;
		timeZoneId(): string;
	};
	readonly Instant: {
		fromEpochMilliseconds(epochMilliseconds: number): TemporalInstantLike;
	};
	readonly PlainDateTime: {
		from(fields: TemporalDateTimeFields, options?: { overflow?: "constrain" | "reject" }): TemporalPlainDateTimeLike;
	};
}

/** What {@link createTemporalCalendar} takes beside the implementation. */
export interface TemporalCalendarOptions {
	/**
	 * The IANA time zone the engine computes dates in (`"Asia/Tokyo"`,
	 * `"UTC"`). Defaults to the runtime's own zone, `Temporal.Now.timeZoneId()`,
	 * which is what the `Date` backend reads. A zone the implementation does
	 * not know is refused at construction with `TEMPORAL_TIME_ZONE_UNKNOWN`.
	 */
	timeZone?: string;
	/**
	 * The clock `now()` reads, in epoch milliseconds. Defaults to
	 * `Temporal.Now.instant()`. A test pins a date with this: a fake-timer
	 * library replaces `Date.now`, which the `Date` backend reads, but not
	 * `Temporal.Now`, so this backend needs telling separately.
	 */
	now?: () => number;
}

/** The fields the `Date` backend answers for an instant it cannot represent. */
const NAN_FIELDS: CalendarFields = Object.freeze({
	year: Number.NaN, month0: Number.NaN, day: Number.NaN, weekday: Number.NaN,
	hour: Number.NaN, minute: Number.NaN, second: Number.NaN, millisecond: Number.NaN,
});

/** The largest magnitude `Date` represents, in milliseconds either side of the epoch. */
const MAX_INSTANT = 8.64e15;

/** Milliseconds in a day of wall-clock fields, before any zone is consulted. */
const MS_PER_DAY = 86_400_000;

/**
 * An instant as `Date` would hold it: truncated to a whole millisecond, or
 * `NaN` when it is not finite or lies past the range `Date` represents. This
 * is `Date`'s own clip (its `TimeClip`), applied before an instant reaches
 * `Temporal`, which throws for both cases where `Date` answers `NaN`.
 */
function clip(epochMs: number): number {
	if (!Number.isFinite(epochMs) || Math.abs(epochMs) > MAX_INSTANT) return Number.NaN;
	return Math.trunc(epochMs);
}

/**
 * Wall-clock fields normalised the way `Date`'s `MakeDay` and `MakeTime`
 * normalise them, with nothing clipped: the day number of the date the
 * fields land on after any overflow rolls, and the time within that day.
 * Each field is truncated to an integer first, as `Date` truncates it.
 */
interface WallClock {
	readonly dayNumber: number;
	readonly timeOfDay: number;
}

/** `MakeDay` and `MakeTime`, then `MakeDate`, with a time past midnight carried into the day. */
function normaliseWallClock(year: number, month0: number, day: number, hour: number, minute: number, second: number, millisecond: number): WallClock {
	const time = Math.trunc(hour) * 3_600_000 + Math.trunc(minute) * 60_000 + Math.trunc(second) * 1_000 + Math.trunc(millisecond);
	const dayNumber = civilDayNumber(year, month0, day) + Math.floor(time / MS_PER_DAY);
	return { dayNumber, timeOfDay: ((time % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY };
}

/**
 * The ECMAScript date-time string format, as the `Date` constructor reads it:
 * a four-digit or six-digit signed year, an optional month and day, an
 * optional time to the millisecond (longer fractions are truncated), and an
 * optional `Z` or offset. The `T` and `Z` may be lower case, and an offset
 * may omit its colon; both are what the runtime's parser accepts.
 */
const ISO_DATE_TIME =
	/^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?([Zz]|[+-]\d{2}:?\d{2})?$/;

/**
 * A {@link CalendarBackend} over a `Temporal` implementation, computing in
 * one named time zone. Build one with {@link createTemporalCalendar}.
 *
 * Every method answers what the `Date` backend answers for the same inputs
 * when the zone is the process's own; see the module comment for the
 * differences between `Temporal` and `Date` that are reproduced deliberately.
 * The local methods answer `NaN` for an instant or a date the backend cannot
 * represent and never throw; the four named-zone methods throw the runtime's
 * `RangeError` for a zone it does not know or an instant it cannot represent,
 * which is the contract the interface states.
 */
export class TemporalCalendar implements CalendarBackend {
	/** The IANA zone every local answer is computed in, in its canonical spelling. */
	readonly timeZone: string;

	private readonly temporal: TemporalLike;
	private readonly clock: () => number;

	constructor(temporal: TemporalLike, options: TemporalCalendarOptions = {}) {
		assertTemporalLike(temporal);
		this.temporal = temporal;
		const requested = options.timeZone ?? temporal.Now.timeZoneId();
		let probe: TemporalZonedDateTimeLike;
		try {
			probe = temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(requested);
		} catch (error) {
			throw ErrorFactory.config(
				CoreErrorCodes.TEMPORAL_TIME_ZONE_UNKNOWN,
				`The Temporal implementation does not know the time zone "${requested}"`,
				{ timeZone: requested, cause: error instanceof Error ? error.message : String(error) },
			);
		}
		// The canonical spelling, so a zone given as `asia/tokyo` reads back as
		// the identifier the implementation itself uses.
		this.timeZone = probe.timeZoneId;
		this.clock = options.now ?? (() => temporal.Now.instant().epochMilliseconds);
	}

	now(): number {
		return this.clock();
	}

	fields(epochMs: number): CalendarFields {
		const z = this.zoned(epochMs, this.timeZone);
		if (z === null) return NAN_FIELDS;
		return {
			year: z.year,
			month0: z.month - 1,
			day: z.day,
			// ISO's Monday 1 to Sunday 7 becomes Date's Sunday 0 to Saturday 6.
			weekday: z.dayOfWeek % 7,
			hour: z.hour,
			minute: z.minute,
			second: z.second,
			millisecond: z.millisecond,
		};
	}

	localMidnight(year: number, month0: number, day: number): number {
		return this.wallClock(year, month0, day, 0, 0, 0, 0);
	}

	localWallClock(year: number, month0: number, day: number, minutesPastMidnight: number): number {
		// `Date`'s sequence exactly: anchor at midnight, then set the minutes
		// FIELD, which reads the hour, second and millisecond back from the
		// anchored local time. On a day whose midnight falls in a
		// daylight-saving gap the anchor resolves to 1 am, and the hour it
		// reads back is 1, which is what makes the two backends agree there.
		const anchored = this.localMidnight(year, month0, day);
		const a = this.fields(anchored);
		if (Number.isNaN(a.year)) return Number.NaN;
		return this.wallClock(a.year, a.month0, a.day, a.hour, minutesPastMidnight, a.second, a.millisecond);
	}

	addDays(epochMs: number, days: number): number {
		// `setDate()`: the day field moves and the local time of day is held.
		const f = this.fields(epochMs);
		if (Number.isNaN(f.year)) return Number.NaN;
		return this.wallClock(f.year, f.month0, f.day + days, f.hour, f.minute, f.second, f.millisecond);
	}

	addMonths(epochMs: number, months: number): number {
		// The `Date` backend's three field writes, each resolved to an instant
		// and read back before the next, so that a wall-clock time landing in
		// a transition on an intermediate date shifts the same way it does
		// there: park on the 1st, move the month, then clamp the day.
		const f0 = this.fields(epochMs);
		if (Number.isNaN(f0.year)) return Number.NaN;
		const dayOfMonth = f0.day;
		const f1 = this.fields(this.wallClock(f0.year, f0.month0, 1, f0.hour, f0.minute, f0.second, f0.millisecond));
		if (Number.isNaN(f1.year)) return Number.NaN;
		const f2 = this.fields(this.wallClock(f1.year, f1.month0 + months, f1.day, f1.hour, f1.minute, f1.second, f1.millisecond));
		if (Number.isNaN(f2.year)) return Number.NaN;
		const day = Math.min(dayOfMonth, daysInMonth(f2.year, f2.month0));
		return this.wallClock(f2.year, f2.month0, day, f2.hour, f2.minute, f2.second, f2.millisecond);
	}

	utcOffsetMinutes(epochMs: number): number {
		const z = this.zoned(epochMs, this.timeZone);
		if (z === null) return Number.NaN;
		// `getTimezoneOffset()` answers whole minutes, truncated toward zero,
		// which only shows for the local-mean-time offsets in force before a
		// zone adopted standard time (London's was -00:01:15 until 1847).
		// `|| 0` folds the -0 a small negative offset truncates to.
		return Math.trunc(z.offsetNanoseconds / 60_000_000_000) || 0;
	}

	parseIso8601(text: string): number {
		// Only the format itself. The `Date` constructor falls back to a
		// legacy parser for a string the format rejects (one with a space
		// around it, say) and may guess an instant from it; the engine's own
		// gate admits only the format, so the two backends cannot disagree
		// through it, and outside it this backend answers NaN rather than guess.
		const m = ISO_DATE_TIME.exec(text);
		if (m === null) return Number.NaN;
		const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zoneText] = m;
		// An expanded year of `-000000` names no year, by the format's own rule.
		if (yearText === "-000000") return Number.NaN;
		const year = Number(yearText);
		const month = monthText === undefined ? 1 : Number(monthText);
		const day = dayText === undefined ? 1 : Number(dayText);
		const hour = hourText === undefined ? 0 : Number(hourText);
		const minute = minuteText === undefined ? 0 : Number(minuteText);
		const second = secondText === undefined ? 0 : Number(secondText);
		// Only the first three digits of a fraction are milliseconds; the rest
		// are dropped rather than rounded, as the runtime's parser does.
		const millisecond = fractionText === undefined ? 0 : Number(fractionText.slice(0, 3).padEnd(3, "0"));
		// The runtime checks a day against 31, not against the month, and lets
		// 30 February roll into March; 24:00 is the end of the day and nothing
		// past it is a time.
		if (month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN;
		if (hour > 24 || minute > 59 || second > 59) return Number.NaN;
		if (hour === 24 && (minute !== 0 || second !== 0 || millisecond !== 0)) return Number.NaN;

		// The year is taken literally: the format has no 1900s window for a
		// year from 0 to 99, unlike the constructor.
		const wall = normaliseWallClock(year, month - 1, day, hour, minute, second, millisecond);
		if (zoneText === undefined && hourText !== undefined) {
			// A date-time with no offset is local time, by the format's own rule.
			return this.resolve(wall);
		}
		// A date-only string is UTC midnight, and an offset is subtracted.
		let offsetMinutes = 0;
		if (zoneText !== undefined && zoneText !== "Z" && zoneText !== "z") {
			const digits = zoneText.slice(1).replace(":", "");
			const offsetHours = Number(digits.slice(0, 2));
			const offsetMinutesPart = Number(digits.slice(2, 4));
			if (offsetHours > 23 || offsetMinutesPart > 59) return Number.NaN;
			offsetMinutes = (zoneText[0] === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutesPart);
		}
		const instant = wall.dayNumber * MS_PER_DAY + wall.timeOfDay - offsetMinutes * 60_000;
		return Math.abs(instant) > MAX_INSTANT ? Number.NaN : instant;
	}

	formatLongDate(epochMs: number, locale: string): string {
		const t = clip(epochMs);
		// `toLocaleDateString()` on an invalid date, rather than the throw
		// `Intl` would raise.
		if (Number.isNaN(t)) return "Invalid Date";
		return new Intl.DateTimeFormat(locale, {
			timeZone: this.timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric",
		}).format(t);
	}

	formatTimeOfDay(epochMs: number, locale: string): string {
		const t = clip(epochMs);
		if (Number.isNaN(t)) return "Invalid Date";
		// `toLocaleTimeString()` with no options is the hour, minute and second
		// in the locale's own style.
		return new Intl.DateTimeFormat(locale, {
			timeZone: this.timeZone, hour: "numeric", minute: "numeric", second: "numeric",
		}).format(t);
	}

	zoneOffsetMinutes(zone: string, epochMs: number): number {
		// A fault here is the caller's to see, as the contract states, so no
		// clip: a non-finite instant reaches `Temporal` and throws its
		// RangeError, as an unknown zone does.
		const t = Number.isFinite(epochMs) ? Math.trunc(epochMs) : epochMs;
		const z = this.temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(zone);
		// The `Date` backend reads the zone's wall clock to the second and
		// rounds the difference from the instant to whole minutes; the same
		// arithmetic on the exact offset keeps the two answers identical for
		// the pre-standard-time offsets that are not whole minutes.
		const wallSecond = Math.floor((t + z.offsetNanoseconds / 1e6) / 1000) * 1000;
		return Math.round((wallSecond - epochMs) / 60_000) || 0;
	}

	fieldsInZone(zone: string, epochMs: number): ZonedFields {
		const t = Number.isFinite(epochMs) ? Math.trunc(epochMs) : epochMs;
		const z = this.temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(zone);
		return { year: z.year, month0: z.month - 1, day: z.day, hour: z.hour, minute: z.minute, second: z.second };
	}

	/** The IANA zone this backend computes in, which is what `CalendarBackend.zone` documents. */
	zone(): string {
		return this.timeZone;
	}

	formatTimeInZone(zone: string, epochMs: number): string {
		return timeInZone(zone, epochMs);
	}

	formatDateInZone(zone: string, epochMs: number): string {
		return dateInZone(zone, epochMs);
	}

	/** The zoned date-time of an instant, or `null` where `Date` would answer `NaN`. */
	private zoned(epochMs: number, zone: string): TemporalZonedDateTimeLike | null {
		const t = clip(epochMs);
		if (Number.isNaN(t)) return null;
		try {
			return this.temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(zone);
		} catch {
			// Past the range the implementation represents in this zone.
			return null;
		}
	}

	/**
	 * The instant a set of local wall-clock fields names, with the fields
	 * normalised the way `Date`'s constructor and setters normalise them
	 * (month 12 is next January, day 0 the last of the month before, a year
	 * from 0 to 99 the 1900s) before the zone is consulted.
	 */
	private wallClock(year: number, month0: number, day: number, hour: number, minute: number, second: number, millisecond: number): number {
		// The constructor's two-digit-year window, applied to the year as
		// written and before any overflow, as `Date` applies it.
		const windowed = year >= 0 && year <= 99 ? 1900 + Math.trunc(year) : year;
		return this.resolve(normaliseWallClock(windowed, month0, day, hour, minute, second, millisecond));
	}

	/**
	 * Normalised wall-clock fields resolved to an instant in the backend's
	 * zone, clipped to the range `Date` represents only then, as `Date` clips
	 * last. `compatible` disambiguation is `Date`'s rule: a time in a
	 * spring-forward gap moves later by the gap, and a time that occurs twice
	 * on a fall-back day is its first occurrence.
	 */
	private resolve(wall: WallClock): number {
		const civil = civilFromDayNumber(wall.dayNumber);
		if (Number.isNaN(civil.year)) return Number.NaN;
		const hour = Math.floor(wall.timeOfDay / 3_600_000);
		const minute = Math.floor(wall.timeOfDay / 60_000) % 60;
		const second = Math.floor(wall.timeOfDay / 1_000) % 60;
		const millisecond = wall.timeOfDay % 1_000;
		try {
			const plain = this.temporal.PlainDateTime.from(
				{ year: civil.year, month: civil.month0 + 1, day: civil.day, hour, minute, second, millisecond },
				{ overflow: "reject" },
			);
			const instant = plain.toZonedDateTime(this.timeZone, { disambiguation: "compatible" }).epochMilliseconds;
			return Math.abs(instant) > MAX_INSTANT ? Number.NaN : instant;
		} catch {
			// Past the range the implementation represents: `Date` answers NaN.
			return Number.NaN;
		}
	}
}

/** Refuse anything that is not a usable `Temporal` before a method can fail on it obscurely. */
function assertTemporalLike(temporal: unknown): asserts temporal is TemporalLike {
	const candidate = temporal as Partial<TemporalLike> | null | undefined;
	const missing =
		typeof candidate?.Now?.instant !== "function" ? "Now.instant" :
		typeof candidate?.Now?.timeZoneId !== "function" ? "Now.timeZoneId" :
		typeof candidate?.Instant?.fromEpochMilliseconds !== "function" ? "Instant.fromEpochMilliseconds" :
		typeof candidate?.PlainDateTime?.from !== "function" ? "PlainDateTime.from" :
		null;
	if (missing !== null) {
		throw ErrorFactory.config(
			CoreErrorCodes.TEMPORAL_IMPLEMENTATION_INVALID,
			`createTemporalCalendar needs a Temporal implementation (globalThis.Temporal on a runtime that ships it, or a polyfill's export); the value given has no ${missing}`,
			{ missing },
		);
	}
}

/**
 * A calendar backend over the host's `Temporal`, for the engine's `calendar`
 * option.
 *
 * ```ts
 * import { createEngine } from "solve-engine";
 * import { createTemporalCalendar } from "solve-engine/temporal";
 *
 * const calendar = createTemporalCalendar(globalThis.Temporal, { timeZone: "Asia/Tokyo" });
 * const engine = createEngine({ calendar });
 * ```
 *
 * @param temporal - The `Temporal` implementation: `globalThis.Temporal` where the runtime ships one, or a polyfill's export.
 * @param options - The zone to compute in and, for a test, the clock to read; see {@link TemporalCalendarOptions}.
 * @returns A backend that computes every date in that zone and answers what the `Date` backend would in it.
 * @throws `TEMPORAL_IMPLEMENTATION_INVALID` when `temporal` lacks the members the backend uses, and
 *   `TEMPORAL_TIME_ZONE_UNKNOWN` when the implementation does not know the zone asked for.
 */
export function createTemporalCalendar(temporal: TemporalLike, options: TemporalCalendarOptions = {}): TemporalCalendar {
	return new TemporalCalendar(temporal, options);
}
