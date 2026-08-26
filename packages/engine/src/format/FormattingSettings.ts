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
