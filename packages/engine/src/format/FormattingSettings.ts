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
   * wall-clock time an instant shows as. Pass the same backend the engine
   * was given as its `calendar` option, so a date displays in the zone it
   * was computed in. Absent means the built-in `Date` backend, the process's
   * own zone, which is what every engine computes with by default.
   *
   * A backend is an object of functions, so it cannot cross a `postMessage`
   * boundary: a worker runtime takes its backend from `WorkerRuntimeOptions`
   * and applies it to the formatting it receives.
   */
  calendar?: CalendarBackend;
  floatResult: {
    decimalPlaces: number;
    enableSeperator: boolean;
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
