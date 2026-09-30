import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
/**
 * How a Datetime value is rendered.
 *
 * - `'long'`: the spelled-out form, "Tuesday, March 10, 2026" (the default).
 * - `'iso'`: "2026-03-10" (ISO 8601, with a `T`-separated time when present).
 * - `'dmy'`: "10/03/2026" (day first).
 * - `'mdy'`: "03/10/2026" (month first).
 *
 * The weekday and long month name in `'long'` are localised through the same
 * locale the number separators come from; the numeric forms are locale-neutral.
 */
export type DateOutputFormat = "long" | "iso" | "dmy" | "mdy";

/**
 * Minimal formatting settings interface for the engine
 * This allows the engine to format values without depending on app-specific settings
 */
export interface FormattingSettings {
  /**
   * The calendar backend a date is written out through: which local day and
   * wall-clock time an instant shows as. Pass the backend the engine computes
   * with, so a date displays in the zone it was computed in, or format with
   * `ExpressionEngine.formatValue`, which applies it already. Absent means the
   * built-in `Date` backend, the process's own zone.
   *
   * A backend is an object of functions, so it cannot cross a `postMessage`
   * boundary: a worker runtime takes its backend from `WorkerRuntimeOptions`
   * and writes with its engine's own settings, the formatting it receives
   * merged over them.
   */
  calendar?: CalendarBackend;
  floatResult: {
    decimalPlaces: number;
    enableSeperator: boolean;
    /**
     * Whether a number drops the zeros that only pad it out to `decimalPlaces`,
     * so `1.5` shows as `1.5` and `2.5 km` as `2.5 km` rather than `1.50` and
     * `2.50 km`. Off by default, and what a missing field reads as. Applies to
     * a plain number, a list's entries, a quantity and a percentage. Money keeps its currency's
     * places (`$1.50`), and a line that names its own precision (`3.14159 to
     * 4 dp`) keeps every place it asked for.
     */
    trimTrailingZeros?: boolean;
    /**
     * The size from which a number is written compactly, the form `as compact`
     * writes: `1500000` shows as `1.5M` and `$3,300,000` as `$3.3M`, with the
     * suffixes `k`, `M`, `B` and `T` the engine reads back. Absent (the
     * default) never writes one. The figure is rounded to three significant
     * digits, so `1234567` shows `1.23M`, which reads back as 1,230,000: a host
     * that copies answers back into a note should leave this off. A threshold
     * below 1,000 acts as 1,000, since a smaller number has no suffix to take,
     * and a number of a thousand trillion or more keeps its ordinary form for
     * the same reason, past the largest suffix (`2^64` stays exact).
     * Applies to a plain number and a quantity, money included; a line that
     * names its own precision, and a measurement with a tolerance, keep their
     * full form.
     */
    compactFrom?: number;
  };
  numberResult: {
    decimalSeparatorLocale: string;
  };
  hexResult: {
    enablePadding: boolean;
    paddingZeros: number;
  };
  unitOfMeasurementResult: {
    decimalPlaces: number;
    /**
     * Where an amount of money takes its place count from when the line names
     * none (a `to N dp` always wins).
     *
     * - `'currency'` (the default, and what a missing field reads as): the
     *   currency's own minor unit, so `¥1000 / 3` is `¥333`, `100 KWD / 3` is
     *   `33.333 KWD` and `$100 / 3` is `$33.33`. A price per unit keeps at
     *   least that and up to `decimalPlaces`; a cryptocurrency shows between
     *   two places and its own figure (see `uom/CurrencyMinorUnits.ts`).
     * - `'setting'`: `decimalPlaces` for every currency, as before the minor
     *   units were read, for a host that wants one place count everywhere.
     */
    currencyPlaces?: "currency" | "setting";
  };
  percentageResult: {
    decimalPlaces: number;
  };
  /**
   * Optional so a host that built a `FormattingSettings` before this field
   * existed still compiles; a missing `dateResult` reads as `'long'`, the
   * historic output.
   */
  dateResult?: {
    format: DateOutputFormat;
  };
  /**
   * Whether the words in an answer follow the number locale.
   *
   * - `'locale'` (the default, and what a missing group reads as): under a
   *   locale that is not English, a unit's long name is written in the
   *   locale's language where `Intl` has one (`3,11 Meilen` under `de`), a
   *   currency symbol takes the locale's place (`5,00 €`), and a weekday or
   *   month name answered by `as weekday` or `as month` is the locale's own
   *   (`Dienstag`). English locales are unchanged.
   * - `'engine'`: the engine's own spelling everywhere (`3,11 miles`, `€5,00`,
   *   `Tuesday`), the digits and separators still the locale's. For a host
   *   that writes answers back into a note, since the engine reads its own
   *   spelling back in and not every localised one.
   */
  wordsResult?: {
    spelling: "locale" | "engine";
  };
}

/** Formatting used when a host supplies none. */
export const DEFAULT_FORMATTING_SETTINGS: FormattingSettings = {
  floatResult: {
    decimalPlaces: 2,
    enableSeperator: true,
  },
  numberResult: {
    decimalSeparatorLocale: "en-US",
  },
  hexResult: {
    enablePadding: false,
    paddingZeros: 0,
  },
  unitOfMeasurementResult: {
    decimalPlaces: 2,
  },
  percentageResult: {
    decimalPlaces: 2,
  },
  dateResult: {
    format: "long",
  },
};

/**
 * A settings object that names only what it changes: any group, and any field
 * within a group, may be left out, and what is left out is taken from the
 * settings it is merged over.
 *
 * `formatValue` takes one of these as well as a complete
 * {@link FormattingSettings}, which is one too, and `ExpressionEngine.formatValue`
 * takes one as its overrides. `{ calendar }` alone is the common case: the
 * one key the calendar option asks every host to pass (#721).
 */
export type FormattingOverrides = {
  calendar?: CalendarBackend;
} & {
  [Group in Exclude<keyof FormattingSettings, "calendar">]?: Partial<NonNullable<FormattingSettings[Group]>>;
};

/** The groups a settings object holds, each merged field by field. */
const SETTINGS_GROUPS = [
  "floatResult",
  "numberResult",
  "hexResult",
  "unitOfMeasurementResult",
  "percentageResult",
  "dateResult",
  "wordsResult",
] as const;

/** Keys that would reach an object's prototype if written, never copied from an override. */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** The fields every group requires, which a complete settings object has. */
const REQUIRED_FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["floatResult", ["decimalPlaces", "enableSeperator"]],
  ["numberResult", ["decimalSeparatorLocale"]],
  ["hexResult", ["enablePadding", "paddingZeros"]],
  ["unitOfMeasurementResult", ["decimalPlaces"]],
  ["percentageResult", ["decimalPlaces"]],
];

/** A group an overrides object really carries: an own property holding an object, and not an array. */
function groupOf(overrides: object, group: string): Record<string, unknown> | undefined {
  // An own property only, so a group named by `Object.prototype` is never read.
  if (!Object.prototype.hasOwnProperty.call(overrides, group)) return undefined;
  const candidate = (overrides as Record<string, unknown>)[group];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return undefined;
  return candidate as Record<string, unknown>;
}

/**
 * Whether a settings object is already complete: every required group, each
 * with every required field. Such an object is used as it is, so a host that
 * passes one, or changes one in place between calls, formats exactly as it
 * did before partial settings were read.
 */
function isComplete(overrides: object): boolean {
  for (const [group, fields] of REQUIRED_FIELDS) {
    const present = groupOf(overrides, group);
    if (present === undefined) return false;
    for (const field of fields) if (present[field] === undefined) return false;
  }
  return true;
}

/**
 * Settings with some groups or fields replaced, merged group by group.
 *
 * A group the overrides name is merged field by field over the base's, so
 * `{ numberResult: { decimalSeparatorLocale: "de-DE" } }` changes the locale
 * and keeps every other setting. A field set to `undefined` leaves the base's
 * value, as a missing one does. `calendar` is taken from the overrides when
 * they name one. A value that is not an object where a group belongs, and a
 * key that is not a group, are ignored rather than thrown on, so a settings
 * object from an older or newer host still formats.
 *
 * @param base - The complete settings to start from.
 * @param overrides - What to change, or nothing for the base unchanged.
 * @returns Complete settings: `base` itself when there is nothing to merge,
 *   and a new object otherwise. Nothing is remembered between calls, so a
 *   host that edits its settings object in place sees the edit.
 */
export function mergeFormattingSettings(base: FormattingSettings, overrides?: FormattingOverrides | null): FormattingSettings {
  if (overrides === undefined || overrides === null || typeof overrides !== "object" || overrides === base) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const group of SETTINGS_GROUPS) {
    const change = groupOf(overrides, group);
    if (change === undefined) continue;
    const fields: Record<string, unknown> = { ...(base[group] ?? {}) };
    for (const key of Object.keys(change)) {
      if (UNSAFE_KEYS.has(key) || change[key] === undefined) continue;
      fields[key] = change[key];
    }
    merged[group] = fields;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "calendar") && overrides.calendar !== undefined) {
    merged.calendar = overrides.calendar;
  }
  return merged as unknown as FormattingSettings;
}

/**
 * The settings `formatValue` formats with: a complete object as it is, and
 * anything less merged over {@link DEFAULT_FORMATTING_SETTINGS}.
 *
 * @param settings - What the host passed, complete, partial or absent.
 * @returns Complete settings.
 */
export function resolveFormattingSettings(settings?: FormattingOverrides | null): FormattingSettings {
  if (settings === undefined || settings === null || typeof settings !== "object") return DEFAULT_FORMATTING_SETTINGS;
  if (isComplete(settings)) return settings as FormattingSettings;
  return mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, settings);
}

/**
 * The number locale an engine's results are written in, from its `locale`
 * option: the default `en` is the default settings' `en-US`, a tag `Intl`
 * can read is that tag in its canonical spelling (`de-de` is `de-DE`), and a
 * tag `Intl` cannot read or has no number data for (`__proto__`, `xx`, an
 * empty string), which the engine
 * itself reads as English, is `en-US` too, since formatting a number in it
 * would throw.
 *
 * @param engineLocale - The engine's `locale` option.
 * @returns A tag `Intl.NumberFormat` accepts.
 */
export function numberLocaleFor(engineLocale: unknown): string {
  const fallback = DEFAULT_FORMATTING_SETTINGS.numberResult.decimalSeparatorLocale;
  if (typeof engineLocale !== "string" || engineLocale === "" || engineLocale.toLowerCase() === "en") return fallback;
  try {
    const [canonical] = Intl.getCanonicalLocales(engineLocale);
    // A tag with no number data (`xx`) would be written in whatever locale the
    // runtime happens to run in, so a result would change with the machine.
    if (canonical === undefined || Intl.NumberFormat.supportedLocalesOf([canonical]).length === 0) return fallback;
    return canonical;
  } catch {
    return fallback;
  }
}

