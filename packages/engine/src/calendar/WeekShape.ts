/**
 * The shape of a week: which days are the weekend, and which day a week starts
 * on (#702).
 *
 * Working-day arithmetic, `is a weekend`, and the week forms (`this week`,
 * `start of week`) read it. Saturday and Sunday are the weekend and Monday the
 * first day unless the host says otherwise, through `date.weekend` and
 * `date.firstDayOfWeek`, or through a locale tag with a region
 * (`createEngine({ locale: "ar-SA" })`), where the runtime reports the region's
 * week through `Intl.Locale`.
 *
 * Resolved once per engine and carried on its context, as the calendar is: the
 * answer cannot change within a process, and the working-day walk asks it once
 * per day stepped.
 */

import { DatetimeErrorCodes } from "@solve-js/errors/ErrorCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/** A day of the week by name, as the configuration spells it. */
export type WeekdayName = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

/** The shape of a week, days numbered 0 (Sunday) to 6 (Saturday), as `CalendarFields.weekday` numbers them. */
export interface WeekShape {
	/** The weekend days. Empty when every day is a working day. */
	readonly weekend: ReadonlySet<number>;
	/** The day a week starts on. */
	readonly firstDay: number;
	/** Where the shape came from: the configuration, the locale's region, or the default. */
	readonly source: "config" | "locale" | "default";
}

/** Saturday and Sunday off, the week starting on Monday: the ISO week, and what the engine did before #702. */
export const DEFAULT_WEEK: WeekShape = Object.freeze({ weekend: new Set([0, 6]), firstDay: 1, source: "default" as const });

/** Each day's name to its number. A Map, so a name such as `__proto__` is simply not a day. */
const WEEKDAY_NUMBERS: ReadonlyMap<string, number> = new Map([
	["sunday", 0], ["monday", 1], ["tuesday", 2], ["wednesday", 3], ["thursday", 4], ["friday", 5], ["saturday", 6],
]);

/** The week information `Intl.Locale` reports, days numbered 1 (Monday) to 7 (Sunday). */
interface IntlWeekInfo {
	readonly firstDay: number;
	readonly weekend: readonly number[];
}

/** The part of `Intl` the inference reads, so a test can hand in a runtime with no week information. */
export interface WeekIntl {
	readonly Locale: new (tag: string) => object;
}

/**
 * The week a locale tag's region keeps, or null when the tag names no region or
 * the runtime does not say.
 *
 * A bare language (`en`, the engine's default) names no region, and the week is
 * a region's: `Intl` reads `en` as the United States, where the week starts on
 * Sunday, so inferring from it would move every default engine's week. Only a
 * tag with a region (`en-GB`, `ar-SA`) is read. The runtime reports the week
 * through `getWeekInfo()` in newer engines and a `weekInfo` getter in older
 * ones; one with neither leaves the default in place.
 *
 * @param tag - The engine's locale tag.
 * @param intl - The `Intl` to ask; the runtime's own unless a test hands one in.
 */
export function weekFromLocale(tag: string, intl: WeekIntl = Intl as unknown as WeekIntl): WeekShape | null {
	if (typeof tag !== "string" || !/^[a-z]{2,8}(?:[-_][a-z]{4})?[-_](?:[a-z]{2}|\d{3})(?:[-_]|$)/i.test(tag)) return null;
	let info: IntlWeekInfo | undefined;
	try {
		const locale = new intl.Locale(tag.replace(/_/g, "-")) as { getWeekInfo?: () => IntlWeekInfo; weekInfo?: IntlWeekInfo };
		info = typeof locale.getWeekInfo === "function" ? locale.getWeekInfo() : locale.weekInfo;
	} catch {
		return null;
	}
	if (info === undefined || !Number.isInteger(info.firstDay) || !Array.isArray(info.weekend)) return null;
	return Object.freeze({
		weekend: new Set(info.weekend.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).map((d) => d % 7)),
		firstDay: info.firstDay % 7,
		source: "locale" as const,
	});
}

/** A configured day name to its number, or the refusal naming the setting. */
function dayNumber(name: unknown, setting: string): number {
	const day = typeof name === "string" ? WEEKDAY_NUMBERS.get(name.toLowerCase()) : undefined;
	if (day === undefined) {
		throw ErrorFactory.config(
			DatetimeErrorCodes.DATE_WEEKDAY_INVALID,
			`${setting} takes days of the week by name, such as "friday", and ${JSON.stringify(name) ?? String(name)} is not one.`,
			{ setting, value: typeof name === "string" ? name : String(name) },
		);
	}
	return day;
}

/**
 * The engine's week: the configured days where the host set them, the locale's
 * region where it has one, and the default otherwise. Each of the two settings
 * stands on its own, so a host can set the weekend and let the locale choose
 * the first day.
 *
 * @param localeTag - The engine's locale tag.
 * @param weekend - `date.weekend`, if set.
 * @param firstDayOfWeek - `date.firstDayOfWeek`, if set.
 * @param intl - The `Intl` to ask; the runtime's own unless a test hands one in.
 * @returns The week, frozen.
 * @throws {EngineError} `DATE_WEEKDAY_INVALID` when a setting names a day that is not one.
 */
export function resolveWeekShape(
	localeTag: string,
	weekend: readonly WeekdayName[] | undefined,
	firstDayOfWeek: WeekdayName | undefined,
	intl?: WeekIntl,
): WeekShape {
	if (weekend !== undefined && !Array.isArray(weekend)) {
		throw ErrorFactory.config(
			DatetimeErrorCodes.DATE_WEEKDAY_INVALID,
			`date.weekend takes a list of days by name, such as ["friday", "saturday"].`,
			{ setting: "date.weekend", value: String(weekend) },
		);
	}
	const configuredWeekend = weekend === undefined ? undefined : new Set(weekend.map((d) => dayNumber(d, "date.weekend")));
	const configuredFirst = firstDayOfWeek === undefined ? undefined : dayNumber(firstDayOfWeek, "date.firstDayOfWeek");
	const inferred = configuredWeekend !== undefined && configuredFirst !== undefined ? null : weekFromLocale(localeTag, intl);
	const base = inferred ?? DEFAULT_WEEK;
	if (configuredWeekend === undefined && configuredFirst === undefined) return base;
	return Object.freeze({
		weekend: configuredWeekend ?? base.weekend,
		firstDay: configuredFirst ?? base.firstDay,
		source: "config" as const,
	});
}

/**
 * The week a line computes with: its engine's, or the default where the line
 * has no engine behind it.
 *
 * @param context - The line's execution context, if any.
 */
export function weekOf(context?: { readonly week?: WeekShape }): WeekShape {
	return context?.week ?? DEFAULT_WEEK;
}
