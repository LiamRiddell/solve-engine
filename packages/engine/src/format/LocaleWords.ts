/**
 * The words in an answer written in the reader's language: a unit's long name
 * (`3,11 Meilen`), where a currency symbol goes (`5,00 €`), and a weekday or
 * month name (`Dienstag`, `März`), each taken from the runtime's `Intl` data.
 *
 * Every function here answers `undefined` when the answer should stay the
 * engine's own English: an English tag, a tag `Intl` has no data for, a
 * runtime built without full locale data, or a unit `Intl` has no name for.
 * The caller then writes what it always wrote, so an English host and a host
 * on a small runtime see no change.
 *
 * Output only. Nothing here reads a localised word back in: `3,11 Meilen` is
 * for reading, and a host that writes answers into a note keeps the engine's
 * spelling (`FormattingSettings.wordsResult`).
 */

import type { CalendarName } from "@solve-js/vm/Value";

/**
 * The simple units ECMA-402 sanctions for `Intl.NumberFormat`'s `unit` style,
 * keyed by each long spelling the engine carries on a value, singular and
 * plural, British and American. A symbol (`km`, `kg`, `h`) is not a key: the
 * engine writes symbols as they are in every language.
 */
export const INTL_UNIT_OF_ENGINE_NAME: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
	acre: "acre", acres: "acre",
	bit: "bit", bits: "bit",
	byte: "byte", bytes: "byte",
	celsius: "celsius",
	centimetre: "centimeter", centimetres: "centimeter", centimeter: "centimeter", centimeters: "centimeter",
	day: "day", days: "day",
	degree: "degree", degrees: "degree",
	fahrenheit: "fahrenheit",
	"US fluid ounce": "fluid-ounce", "US fluid ounces": "fluid-ounce",
	foot: "foot", feet: "foot",
	gallon: "gallon", gallons: "gallon",
	gigabit: "gigabit", gigabits: "gigabit",
	gigabyte: "gigabyte", gigabytes: "gigabyte",
	gram: "gram", grams: "gram",
	hectare: "hectare", hectares: "hectare",
	hour: "hour", hours: "hour",
	inch: "inch", inches: "inch",
	kilobit: "kilobit", kilobits: "kilobit",
	kilobyte: "kilobyte", kilobytes: "kilobyte",
	kilogram: "kilogram", kilograms: "kilogram",
	kilometre: "kilometer", kilometres: "kilometer", kilometer: "kilometer", kilometers: "kilometer",
	litre: "liter", litres: "liter", liter: "liter", liters: "liter",
	megabit: "megabit", megabits: "megabit",
	megabyte: "megabyte", megabytes: "megabyte",
	metre: "meter", metres: "meter", meter: "meter", meters: "meter",
	microsecond: "microsecond", microseconds: "microsecond",
	mile: "mile", miles: "mile",
	millilitre: "milliliter", millilitres: "milliliter", milliliter: "milliliter", milliliters: "milliliter",
	millimetre: "millimeter", millimetres: "millimeter", millimeter: "millimeter", millimeters: "millimeter",
	millisecond: "millisecond", milliseconds: "millisecond",
	minute: "minute", minutes: "minute",
	month: "month", months: "month",
	nanosecond: "nanosecond", nanoseconds: "nanosecond",
	ounce: "ounce", ounces: "ounce",
	petabyte: "petabyte", petabytes: "petabyte",
	pound: "pound", pounds: "pound",
	second: "second", seconds: "second",
	stone: "stone", stones: "stone",
	terabit: "terabit", terabits: "terabit",
	terabyte: "terabyte", terabytes: "terabyte",
	week: "week", weeks: "week",
	yard: "yard", yards: "yard",
	year: "year", years: "year",
}));

/** Past this many entries a cache is emptied and refilled, so a host passing many tags cannot grow it without bound. */
const MAX_CACHED = 512;

/** Past this length a tag is not looked up at all: no real tag is this long. */
const MAX_TAG_LENGTH = 64;

/** Whether each tag writes its words in its own language, looked up once per tag. */
const localisesByTag = new Map<string, boolean>();

/**
 * Whether answers under `tag` take the locale's words: a tag that is not
 * English, that `Intl` can read, and whose number and date data this runtime
 * actually has in that language. A runtime built with English data only
 * resolves `de` to `en-US`, and is treated as English rather than trusted.
 *
 * @param tag - The number locale, `numberResult.decimalSeparatorLocale`.
 * @returns True when the locale's own words should be written.
 */
export function localisesWords(tag: string): boolean {
	if (typeof tag !== "string" || tag === "" || tag.length > MAX_TAG_LENGTH) return false;
	const known = localisesByTag.get(tag);
	if (known !== undefined) return known;
	let answer = false;
	try {
		const [canonical] = Intl.getCanonicalLocales(tag);
		const language = languageOf(canonical);
		if (language !== "" && language !== "en" && Intl.NumberFormat.supportedLocalesOf([canonical]).length > 0) {
			answer = languageOf(new Intl.NumberFormat(canonical).resolvedOptions().locale) === language
				&& languageOf(new Intl.DateTimeFormat(canonical).resolvedOptions().locale) === language;
		}
	} catch {
		answer = false;
	}
	if (localisesByTag.size >= MAX_CACHED) localisesByTag.clear();
	localisesByTag.set(tag, answer);
	return answer;
}

/** The language subtag of a locale tag, lower case, or `""` for something that is not a tag. */
function languageOf(tag: string | undefined): string {
	if (typeof tag !== "string") return "";
	const dash = tag.indexOf("-");
	return (dash < 0 ? tag : tag.slice(0, dash)).toLowerCase();
}

/** The `Intl` part types that make up the number itself, which the engine's own digits replace. */
const NUMBER_PART_TYPES: ReadonlySet<string> = new Set([
	"integer", "group", "decimal", "fraction", "minusSign", "plusSign",
	"exponentSeparator", "exponentMinusSign", "exponentInteger", "compact", "infinity", "nan",
]);

/** One unit formatter per tag, unit and place count; null where the runtime refused to build one. */
const unitFormatters = new Map<string, Intl.NumberFormat | null>();

/**
 * The formatter that writes `unit`'s long name in `tag`, or null when the
 * runtime has none (an old runtime without the `unit` style).
 */
function unitFormatter(tag: string, unit: string, fractionDigits: number | undefined): Intl.NumberFormat | null {
	const key = `${tag}\u0000${unit}\u0000${fractionDigits ?? "s"}`;
	const cached = unitFormatters.get(key);
	if (cached !== undefined) return cached;
	let formatter: Intl.NumberFormat | null;
	try {
		formatter = new Intl.NumberFormat(tag, fractionDigits === undefined
			? { style: "unit", unit, unitDisplay: "long", maximumSignificantDigits: 3 }
			: { style: "unit", unit, unitDisplay: "long", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
	} catch {
		formatter = null;
	}
	if (unitFormatters.size >= MAX_CACHED) unitFormatters.clear();
	unitFormatters.set(key, formatter);
	return formatter;
}

/**
 * A quantity written with its unit's long name in `tag`'s language: the
 * engine's own number text, placed where the locale puts a number beside that
 * unit, and the name in the grammatical form the count takes (`1 Meile`, `2
 * Meilen`, and Polish's three forms), which `Intl` chooses from the count and
 * the places shown.
 *
 * @param numberText - The number as the engine wrote it, sign, digits and marks included.
 * @param unit - The unit the value carries (`miles`, `days`).
 * @param count - The value, for the grammatical form of the name.
 * @param fractionDigits - How many places `numberText` shows, or undefined when it is not a plain decimal.
 * @param tag - The number locale.
 * @returns The quantity in the locale's words, or undefined to keep the engine's own.
 */
export function withLocalUnitName(numberText: string, unit: string, count: number, fractionDigits: number | undefined, tag: string): string | undefined {
	if (!Number.isFinite(count) || !localisesWords(tag)) return undefined;
	if (!Object.prototype.hasOwnProperty.call(INTL_UNIT_OF_ENGINE_NAME, unit)) return undefined;
	const formatter = unitFormatter(tag, INTL_UNIT_OF_ENGINE_NAME[unit], fractionDigits);
	if (formatter === null) return undefined;
	let parts: Intl.NumberFormatPart[];
	try {
		// The count without its sign: the engine's text carries the sign, and a
		// locale that writes the minus elsewhere must not show two.
		parts = formatter.formatToParts(Math.abs(count));
	} catch {
		return undefined;
	}
	let first = -1;
	let last = -1;
	for (let i = 0; i < parts.length; i++) {
		if (!NUMBER_PART_TYPES.has(parts[i].type)) continue;
		if (first < 0) first = i;
		last = i;
	}
	if (first < 0 || !parts.some((part) => part.type === "unit")) return undefined;
	let out = "";
	for (let i = 0; i < parts.length; i++) {
		if (i === first) out += numberText;
		if (i >= first && i <= last) continue;
		// A no-break space between the number and the name is written as a plain
		// one, as a currency symbol's space is, so the two read alike.
		out += parts[i].type === "literal" ? parts[i].value.replace(/[  ]/g, " ") : parts[i].value;
	}
	return out;
}

/** Where a currency symbol goes in a locale: before the amount or after it, and whether a space parts them. */
export interface CurrencyPlacement {
	readonly position: "prefix" | "suffix";
	readonly spaced: boolean;
}

/** One placement per tag and currency; null where `Intl` could not place it. */
const placements = new Map<string, CurrencyPlacement | null>();

/**
 * Where `tag` writes the symbol of the currency `code`, from `Intl`'s own
 * rendering of one unit of it: `suffix` and spaced for the euro under `de`
 * (`5,00 €`), `prefix` and unspaced under `ja`. Only the place is taken; the
 * symbol, the places and the sign stay the engine's.
 *
 * @param code - An ISO 4217 code, upper case.
 * @param tag - The number locale.
 * @returns The placement, or undefined to keep the engine's own.
 */
export function localCurrencyPlacement(code: string, tag: string): CurrencyPlacement | undefined {
	if (!/^[A-Z]{3}$/.test(code) || !localisesWords(tag)) return undefined;
	const key = `${tag}\u0000${code}`;
	const cached = placements.get(key);
	if (cached !== undefined) return cached ?? undefined;
	let placement: CurrencyPlacement | null = null;
	try {
		const parts = new Intl.NumberFormat(tag, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(1);
		const currency = parts.findIndex((part) => part.type === "currency");
		const integer = parts.findIndex((part) => part.type === "integer");
		if (currency >= 0 && integer >= 0) {
			const [from, to] = currency < integer ? [currency, integer] : [integer, currency];
			// Only what lies between the amount and the symbol: a fraction on the
			// way from the integer to a suffix symbol is not a space.
			let between = "";
			for (let i = from + 1; i < to; i++) if (parts[i].type === "literal") between += parts[i].value;
			placement = { position: currency < integer ? "prefix" : "suffix", spaced: /\s/.test(between) };
		}
	} catch {
		placement = null;
	}
	if (placements.size >= MAX_CACHED) placements.clear();
	placements.set(key, placement);
	return placement ?? undefined;
}

/** What a name drawn from a date is: the day of the week, or the month. */
export type CalendarNameKind = CalendarName["kind"];

/** One name list per tag and kind; null where `Intl` could not write them. */
const nameLists = new Map<string, readonly string[] | null>();

/**
 * A weekday or month name in `tag`'s language: Sunday is weekday 0, January
 * month 0, as the calendar backends count. The month is the form a month takes
 * named on its own (Polish `marzec`, not the `marca` of a date).
 *
 * @param kind - A weekday or a month.
 * @param index - 0 to 6 for a weekday, 0 to 11 for a month.
 * @param tag - The number locale.
 * @returns The name, or undefined to keep the engine's own English.
 */
export function localCalendarName(kind: CalendarNameKind, index: number, tag: string): string | undefined {
	const count = kind === "weekday" ? 7 : 12;
	if (!Number.isInteger(index) || index < 0 || index >= count || !localisesWords(tag)) return undefined;
	const key = `${tag}\u0000${kind}`;
	let names = nameLists.get(key);
	if (names === undefined) {
		try {
			const format = new Intl.DateTimeFormat(tag, kind === "weekday" ? { weekday: "long", timeZone: "UTC" } : { month: "long", timeZone: "UTC" });
			// 4 January 2026 is a Sunday; the fifteenth sits clear of any month end.
			names = Array.from({ length: count }, (_, i) => format.format(kind === "weekday" ? Date.UTC(2026, 0, 4 + i) : Date.UTC(2026, i, 15)));
		} catch {
			names = null;
		}
		if (nameLists.size >= MAX_CACHED) nameLists.clear();
		nameLists.set(key, names);
	}
	return names === null ? undefined : names[index];
}
