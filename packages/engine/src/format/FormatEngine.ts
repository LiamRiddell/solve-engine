import { Value, ValueType, type MatrixData, type MatrixEntry, type RangeData, type ColourData, type SplitData, type SplitShare, type ChartData, type IpCidrData } from "@solve-js/vm/Value";
import { formatColour } from "@solve-js/packages/colour/ColourMath";
import { formatIp } from "@solve-js/packages/ip/IpMath";
import { decimalToFixed, type DecimalData } from "@solve-js/decimal";
import { getLocale, type ILocale } from "@solve-js/constants/locales";
import { autoFormatIntegerOrFloat } from "@solve-js/utilities/Number";
import { FormattingSettings, DEFAULT_FORMATTING_SETTINGS } from "./FormattingSettings";
import { CURRENCY_DISPLAY } from "@solve-js/uom/CurrencyAliases";
import { columnMajorToRowMajor } from "@solve-js/vm/MatrixOps";
import { formatSymbolic, type SymbolicNode } from "@solve-js/symbolic";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

function formatNumber(value: number, locale: ILocale, settings: FormattingSettings, decimalPlaces?: number): string {
  const sep = settings.floatResult.enableSeperator;
  const loc = settings.numberResult.decimalSeparatorLocale;
  // An explicit precision (`3.14159 to 4 dp`, `round(1.5, 2)`) shows EXACTLY that
  // many places with trailing zeros kept, where the default trims them and shows
  // an integer with none. The value was already rounded to this precision when
  // it was set (see VMBuiltins' roundToPlaces, exact where an exact decimal was
  // there), so rendering it to the same place count reproduces that rounding.
  if (decimalPlaces !== undefined && Number.isFinite(value)) {
    const formatted = value.toLocaleString(loc || "en-US", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
      useGrouping: sep,
    });
    return `${locale.display.resultPrefix}${formatted}`;
  }
  const dp = settings.floatResult.decimalPlaces;
  const formatted = autoFormatIntegerOrFloat(value, dp, sep, loc);
  return `${locale.display.resultPrefix}${formatted}`;
}

/**
 * Renders a measurement that carries a one-sigma uncertainty as
 * `center ± spread`, e.g. `49.2 ± 2.0`.
 *
 * The center is shown the way any number is, whole numbers as integers and
 * trailing zeros trimmed, so a tolerance-free-looking center still reads
 * cleanly ("30 ± 2.24", not "30.00 ± 2.24"). The spread is shown to the same
 * decimal-place budget but always keeps at least one fractional digit, which is
 * what distinguishes it as a tolerance and gives "± 2.0" rather than "± 2".
 * Both use `Intl` with `maximumFractionDigits`, so the trailing-zero trimming is
 * locale-correct (a comma-decimal locale is not string-sliced on ".").
 *
 * The symbol is always the `±` glyph on output, even when the input was the
 * ASCII `+/-`, since the glyph is the conventional notation and unambiguous to
 * read back.
 */
function formatUncertain(center: number, uncertainty: number, locale: ILocale, settings: FormattingSettings): string {
  const dp = settings.floatResult.decimalPlaces;
  const useGrouping = settings.floatResult.enableSeperator;
  const loc = settings.numberResult.decimalSeparatorLocale || "en-US";
  // The spread needs room for at least one fractional digit, so a zero-decimal
  // budget cannot leave minimumFractionDigits above maximumFractionDigits.
  const spreadMax = Math.max(dp, 1);
  const centerText = center.toLocaleString(loc, { useGrouping, minimumFractionDigits: 0, maximumFractionDigits: dp });
  const spreadText = Math.abs(uncertainty).toLocaleString(loc, { useGrouping, minimumFractionDigits: 1, maximumFractionDigits: spreadMax });
  return `${locale.display.resultPrefix}${centerText} ± ${spreadText}`;
}

/**
 * Renders a number in whichever base it is tagged with.
 *
 * The zero padding is a hexadecimal setting and stays one. Applying it to a
 * binary rendering would pad `0b101` out to the same digit count as a hex
 * value, which is a different quantity of zeros and not what the setting asks
 * for.
 */
function formatHex(value: number | bigint, settings: FormattingSettings, base?: string): string {
  // An infinity or a NaN has no digits in any base, and asking for them
  // produced `0xINFINITY`, a literal that reads back as nothing at all. Render
  // the value itself, which is what every other non-finite result shows.
  if (typeof value === "number" && !Number.isFinite(value)) return `= ${value}`;

  // Truncate and take the sign off before converting. `Number.toString(radix)`
  // does neither: it renders -255 as "-ff", which lands the minus inside the
  // literal as `0x-FF`, and it renders 255.7 as "ff.b3333333333", inventing
  // fractional hex digits for a notation that has no use for them. Both were
  // visible on `as hex` until the builtins started sharing this path.
  //
  // A bigint needs neither truncation nor a Math call, and must not be routed
  // through one: passing it to Math.trunc() throws, and converting it to a
  // double first is exactly the precision loss it is carried as a bigint to
  // avoid.
  const negative = typeof value === "bigint" ? value < 0n : value < 0;
  const sign = negative ? "-" : "";
  const digits = (radix: number): string =>
    typeof value === "bigint"
      ? (negative ? -value : value).toString(radix)
      : Math.abs(Math.trunc(value)).toString(radix);

  if (base === "bin") return `= ${sign}0b${digits(2)}`;
  if (base === "oct") return `= ${sign}0o${digits(8)}`;
  const padding = settings.hexResult.enablePadding ? settings.hexResult.paddingZeros : 0;
  const hex = digits(16).toUpperCase().padStart(padding, "0");
  return `= ${sign}0x${hex}`;
}

/**
 * How many decimal digits of an exact integer this will render in full.
 *
 * A little above the ~19,729 digits of the largest bigint the VM will build
 * (`vm/VM.ts`'s MAX_EXACT_POW_BITS / MAX_EXACT_SHIFT_BITS, 65,536 bits), so
 * every value the engine can produce through `^` or `<<` still prints exactly
 * and this ceiling only ever meets a value that came from somewhere else.
 */
const MAX_DISPLAYED_BIGINT_DIGITS = 20000;

/**
 * Renders an exact integer, or describes it when writing it out is itself the
 * expensive operation.
 *
 * This used to be a bare `= ${value}` template, which renders whatever it is
 * handed: `1n << 100000000` took 8.5 seconds here turning a 12.5MB integer
 * into a thirty-million-character string, and a host has no way to opt out,
 * since displaying the answer is what it asked the engine for. The VM's own
 * ceiling on `<<` and `^` now stops that value existing, so this is the
 * backstop for every other way a large bigint can arrive (repeated `x * x`,
 * a Value a host built itself), and it costs one comparison for every value
 * that is not absurd.
 *
 * The digit count is estimated from the bit length rather than measured, since
 * measuring means doing the conversion this exists to avoid. Bit length comes
 * off the hexadecimal form, which is linear in the size of the value where the
 * decimal form is not.
 */
function formatBigInt(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  // Every bigint a person actually reads takes this line and nothing else:
  // anything a double can hold is at most 309 digits, so it is printable
  // without measuring it at all.
  if (Number.isFinite(Number(magnitude))) return `= ${value}`;
  const bits = magnitude.toString(16).length * 4;
  if (bits * Math.LN2 / Math.LN10 <= MAX_DISPLAYED_BIGINT_DIGITS) return `= ${value}`;
  const log10 = bits * Math.LN2 / Math.LN10;
  const exponent = Math.floor(log10);
  const mantissa = Math.pow(10, log10 - exponent);
  const sign = value < 0n ? "-" : "";
  return `= ${sign}~${mantissa.toFixed(3)}e+${exponent} (an exact integer of about ${(exponent + 1).toLocaleString("en-US")} digits, too large to print)`;
}

function formatString(value: string): string {
  return `= ${value}`;
}

function formatBoolean(value: boolean): string {
  return `= ${value}`;
}

/**
 * Renders a Datetime value locale-aware, the previous implementation
 * called `d.toLocaleString()` with no arguments, which always uses the JS
 * runtime's own default locale and never actually consulted `locale.code`
 * despite receiving it as a parameter (both branches of its old
 * `dateFormat === "default"` check were byte-for-byte identical, dead
 * groundwork for a distinction that was never implemented). Concretely,
 * this meant every configured locale (including the shipped German one)
 * always displayed weekday/month names in English. See GitHub issue #77.
 *
 * Uses `weekday`/`month`: "long" for a spelled-out date ("Monday,
 * November 17, 2025" / "lundi 17 novembre 2025") since that's what a
 * literal weekday name is for; a bare numeric date doesn't need
 * localizing beyond the decimal/thousands separators `formatNumber()`
 * already handles. The time-of-day portion is only appended when it's
 * not exactly local midnight, bare date literals ("today", "17/11/2025")
 * always anchor to local midnight, and showing "00:00:00" on every one of
 * those would be noise, not information.
 *
 * Reads the built-in `Date` calendar backend rather than an engine's:
 * `formatValue` is a free function a host calls with a value and settings,
 * with no engine in hand, and the `Date` backend is what every engine
 * computes with by default. A backend carrying its own zone would need the
 * display to read that zone too, which is the display's half of that change.
 */
function formatDatetime(value: number, locale: ILocale, settings: FormattingSettings): string {
  const d = DATE_CALENDAR.fields(value);
  const format = settings.dateResult?.format ?? "long";
  const isMidnight = d.hour === 0 && d.minute === 0 && d.second === 0 && d.millisecond === 0;

  // The spelled-out default, localised through the locale's own names.
  if (format === "long") {
    const dateStr = DATE_CALENDAR.formatLongDate(value, locale.code);
    if (isMidnight) return `= ${dateStr}`;
    return `= ${dateStr}, ${DATE_CALENDAR.formatTimeOfDay(value, locale.code)}`;
  }

  // The numeric forms, built from the local calendar fields so they read the
  // same regardless of the JS runtime's own default locale.
  const p2 = (n: number) => String(n).padStart(2, "0");
  const year = d.year;
  const month = p2(d.month0 + 1);
  const day = p2(d.day);
  let datePart: string;
  if (format === "iso") datePart = `${year}-${month}-${day}`;
  else if (format === "dmy") datePart = `${day}/${month}/${year}`;
  else datePart = `${month}/${day}/${year}`; // mdy

  if (isMidnight) return `= ${datePart}`;
  const time = `${p2(d.hour)}:${p2(d.minute)}:${p2(d.second)}`;
  // ISO joins date and time with `T`; the slash forms with a space.
  return format === "iso" ? `= ${datePart}T${time}` : `= ${datePart} ${time}`;
}

/**
 * Renders a millisecond duration as clock-style `H:MM` (or `H:MM:SS` when
 * there's a non-zero seconds component). `ms` is never a user-typeable
 * unit (confirmed: it appears nowhere in `lexer/units.ts`), it's only
 * ever produced by subtracting two clock times/datetimes (`9:30 - 8:30`,
 * `VM.ts`'s Datetime SUB case), so this is a safe, narrow special case,
 * not a general change to how durations display.
 */
function formatMsDuration(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const totalSeconds = Math.round(Math.abs(ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  if (seconds === 0) return `${sign}${hours}:${mm}`;
  const ss = String(seconds).padStart(2, "0");
  return `${sign}${hours}:${mm}:${ss}`;
}

/** The decimal mark each locale writes, looked up once per locale rather than on every value. */
const decimalMarkByLocale = new Map<string, string>();

function decimalMark(loc: string): string {
  let mark = decimalMarkByLocale.get(loc);
  if (mark === undefined) {
    mark = new Intl.NumberFormat(loc).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
    decimalMarkByLocale.set(loc, mark);
  }
  return mark;
}

/**
 * Write a fixed-decimal string (`"1234567.50"`) the way `loc` writes numbers:
 * its decimal mark, and its digit grouping when `useGrouping` is on.
 *
 * Every quantity and every money amount used to be rendered with a bare
 * `toFixed`, so a plain `52000` showed as `52,000` while `£52000` showed as
 * `£52000.00`, and the `enableSeperator` setting had no effect on the one
 * value type people most want grouped. The digits are taken from the string
 * rather than re-rendered from the double, because an exact money amount has
 * already been rounded from its decimal (see {@link formatUom}) and
 * re-rendering would undo that. `BigInt` carries the integer part through
 * `Intl` so grouping follows the locale's own rule (Indian lakhs included)
 * rather than a hand-written every-three-digits. Anything that is not plain
 * digits, an `Infinity` or an exponent form, is returned as it came.
 */
function localiseFixedDecimal(fixed: string, loc: string, useGrouping: boolean): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(fixed);
  if (!match) return fixed;
  const [, sign, integer, fraction] = match;
  const integerText = useGrouping ? BigInt(integer).toLocaleString(loc, { useGrouping: true }) : integer;
  if (fraction === undefined) return `${sign}${integerText}`;
  return `${sign}${integerText}${decimalMark(loc)}${fraction}`;
}

function formatUom(value: number, unit: string | undefined, locale: ILocale, settings: FormattingSettings, exact?: DecimalData): string {
  if (unit === "ms") return `= ${formatMsDuration(value)}`;
  // A fuel-consumption unit is stored slash-free (so it is not read as a rate)
  // but shown the way it is written.
  if (unit === "l100km") unit = "l/100km";
  if (unit === "mps2") unit = "m/s²";

  const dp = settings.unitOfMeasurementResult.decimalPlaces;
  const useGrouping = settings.floatResult.enableSeperator;
  const loc = settings.numberResult.decimalSeparatorLocale || "en-US";

  // For TimeSpan values (days, weeks, hours, etc.), format as integer if the value is a whole number
  const timeSpanUnits = ["days", "weeks", "months", "years", "hours", "minutes", "seconds", "day", "week", "month", "year", "hour", "minute", "second"];
  const isTimeSpan = unit && timeSpanUnits.includes(unit);

  let formatted: string;
  if (isTimeSpan && value === Math.floor(value)) {
    // For whole number TimeSpan values, format as integer
    formatted = localiseFixedDecimal(value.toString(), loc, useGrouping);
  } else {
    // For other values, use the configured decimal places
    formatted = localiseFixedDecimal(value.toFixed(dp), loc, useGrouping);
  }

  // Currency display: symbol + culturally-conventional placement (e.g.
  // "$100.00" prefix vs "100.00 kr" suffix) instead of the generic
  // "amount CODE" fallback below. See uom/CurrencyAliases.ts's
  // CURRENCY_DISPLAY table for the exact set covered and the reasoning
  // behind each placement choice. Any currency code NOT in that table
  // (most of the ~150 `CurrencyExchange.isCurrency()` recognizes) falls
  // through to the unchanged "amount CODE" format below.
  const currencyDisplay = unit ? CURRENCY_DISPLAY[unit.toUpperCase()] : undefined;
  if (currencyDisplay) {
    // An exact money amount rounds from its decimal, not from the double: a
    // half-cent like "$1.005" reads as "$1.01" here, where "(1.005).toFixed(2)"
    // answers "1.00" because the double it is handed already sits below the
    // value the user typed. Amounts with no exact decimal (a currency
    // conversion, whose rate is a double) keep the toFixed rendering above.
    const moneyText = exact ? localiseFixedDecimal(decimalToFixed(exact, dp), loc, useGrouping) : formatted;
    const sep = currencyDisplay.spaced ? " " : "";
    const withSymbol = currencyDisplay.position === "prefix"
      ? `${currencyDisplay.symbol}${sep}${moneyText}`
      : `${moneyText}${sep}${currencyDisplay.symbol}`;
    return `= ${withSymbol}`;
  }

  // The unit is written as the symbol the value carries. There used to be a
  // `unitOfMeasurementResult.unitNames` setting here whose two branches were
  // the same expression, so it never changed anything, and it was removed
  // rather than implemented: the engine has no unit-name data to render from.
  // The generated unit table maps a spelling to [measure, ratio] only, and
  // names cannot be recovered from it, because units that differ by an OFFSET
  // share a ratio, so "20 C" would come back as "20 kelvins". A real
  // implementation needs a hand-authored name per unit plus pluralization and
  // per-locale spelling (metre against meter), which is a feature rather than
  // the repair of a dead ternary.
  //
  // An exact currency with no symbol in the display table above (one of the
  // less common ISO codes) still rounds from its decimal here, so "1.005 UYW"
  // reads the same way "$1.005" does. Non-currency Uoms never carry an exact,
  // so this leaves "1.50 kg" exactly as it was.
  const genericText = exact ? localiseFixedDecimal(decimalToFixed(exact, dp), loc, useGrouping) : formatted;
  return `= ${genericText} ${unit || ""}`.trim();
}

function formatMatrixEntry(entry: MatrixEntry, settings: FormattingSettings): string {
  if (typeof entry === "boolean") return entry ? "true" : "false";
  if (typeof entry === "object" && entry !== null) return formatSymbolic(entry);
  const dp = settings.floatResult.decimalPlaces;
  const sep = settings.floatResult.enableSeperator;
  const loc = settings.numberResult.decimalSeparatorLocale;
  return autoFormatIntegerOrFloat(entry, dp, sep, loc);
}

/**
 * Renders a Matrix matching its own literal syntax: a single row (1xN,
 * including plain vectors) as `[a, b, c]`, a single column (Nx1) as
 * `[a; b; c]`, and a general shape as `[r0c0, r0c1; r1c0, r1c1]`, row-major
 * textual output read back out of the column-major storage
 * (`columnMajorToRowMajor()`), matching how `[1,2;3,4]` is written.
 */
function formatMatrix(m: MatrixData, locale: ILocale, settings: FormattingSettings): string {
  const rowMajor = columnMajorToRowMajor(m);
  const rows: string[] = [];
  for (let r = 0; r < m.rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < m.cols; c++) {
      cells.push(formatMatrixEntry(rowMajor[r * m.cols + c], settings));
    }
    rows.push(cells.join(", "));
  }
  return `${locale.display.resultPrefix}[${rows.join("; ")}]`;
}

/**
 * Render a matrix as a multi-line, column-aligned block: one row per line (the
 * newline is where {@link formatValue}'s compact form writes `;`), each column
 * right-padded to its widest cell, and every row wrapped in `[ ... ]`. For
 * display where a grid reads better than a line, e.g. a docs notepad or a REPL:
 *
 * ```text
 * [  1   2 ]
 * [ 30   4 ]
 * ```
 *
 * This is deliberately separate from {@link formatValue}, whose single-line
 * matrix form stays the stable, assertable text the API and the worker DTO use.
 * A 1xN row vector is one line; an Nx1 column vector is N lines.
 */
export function formatMatrixAligned(m: MatrixData, settings?: FormattingSettings): string {
  const us = settings || DEFAULT_FORMATTING_SETTINGS;
  const rowMajor = columnMajorToRowMajor(m);
  const cells: string[][] = [];
  for (let r = 0; r < m.rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < m.cols; c++) {
      row.push(formatMatrixEntry(rowMajor[r * m.cols + c], us));
    }
    cells.push(row);
  }
  const colWidth: number[] = [];
  for (let c = 0; c < m.cols; c++) {
    let width = 0;
    for (let r = 0; r < m.rows; r++) width = Math.max(width, cells[r][c].length);
    colWidth.push(width);
  }
  return cells
    .map((row) => `[ ${row.map((cell, c) => cell.padStart(colWidth[c])).join("  ")} ]`)
    .join("\n");
}

function formatRange(min: number, max: number, locale: ILocale): string {
  return `${locale.display.resultPrefix}${min}:${max}`;
}

function formatPercentage(value: number, locale: ILocale, settings: FormattingSettings): string {
  // ValueType.Percentage stores a fraction (0.25 for 25%). See Value.ts's
  // documented contract and the sole producer, VM.ts's TO_PERCENTAGE opcode
  // (`right/left - 1`, e.g. 0.25 for "800 to 1000"). Multiply by 100 before
  // formatting; without this every percentage-change result displayed as
  // e.g. "0.25%" instead of "25.00%".
  const dp = settings.percentageResult.decimalPlaces;
  const formatted = (value * 100).toFixed(dp);
  return `= ${formatted}${locale.display.percentageSuffix}`;
}

function formatUnit(value: number, unit: string | undefined): string {
  return `= ${value} ${unit || ""}`.trim();
}

/**
 * Renders a per-person bill split: "= $45.00 each", or, when the division is
 * uneven, "= $33.33 each, with 1 share paying $33.34". Each share's amount is
 * rendered through the ordinary value formatter (a throwaway {@link Value}), so
 * a currency share honours the same symbol placement, decimal places and locale
 * as any other money and a bare share trims trailing zeros the way a plain
 * number does; the "= " prefix is added once, around the whole sentence, not
 * per share.
 */
/**
 * An IP/CIDR as text: the dotted quad, plus `/prefix` when present, or a bare
 * `/prefix` when there is no address (`netmask of /24` before it resolves).
 */
function formatIpCidr(data: IpCidrData): string {
	if (data.addr === undefined) return `/${data.prefix}`;
	const dotted = formatIp(data.addr);
	return data.prefix === undefined ? dotted : `${dotted}/${data.prefix}`;
}

function formatSplit(data: SplitData, locale: ILocale, settings: FormattingSettings): string {
  const prefix = locale.display.resultPrefix;
  const render = (share: SplitShare): string => {
    const v = data.unit !== undefined
      ? new Value(ValueType.Uom, share.value, data.unit)
      : new Value(ValueType.Number, share.value);
    v.exact = share.exact;
    const text = formatValue(v, settings);
    return text.startsWith(prefix) ? text.slice(prefix.length) : text;
  };

  const [base, high] = data.shares;
  const each = `${render(base)} each`;
  if (high === undefined) return `${prefix}${each}`;
  const shareWord = high.count === 1 ? "share" : "shares";
  return `${prefix}${each}, with ${high.count} ${shareWord} paying ${render(high)}`;
}

/**
 * Render an evaluated {@link Value} as a display string, dispatching on
 * `value.type` to the type-specific formatter (number, hex, datetime, unit
 * of measurement, matrix, range, percentage, ...).
 *
 * Most branches produce a `"= "`-prefixed result string (matching the
 * plugin's inline-result convention); `ValueType.Error` is the one
 * exception, it returns the human-readable error message directly
 * (stored in `value.unit`), not an `"= "`-prefixed string.
 *
 * @param value - The evaluated value to format.
 * @param settings - Locale/precision/separator options; defaults to
 *   {@link DEFAULT_FORMATTING_SETTINGS} when omitted.
 * @example
 * ```typescript
 * const value = engine.evaluateExpression("10 USD to GBP");
 * formatValue(value); // "= £7.85" (exact output depends on live exchange rates)
 * ```
 */
export function formatValue(value: Value, settings?: FormattingSettings): string {
  const us = settings || DEFAULT_FORMATTING_SETTINGS;
  const localeCode = us.numberResult.decimalSeparatorLocale || "en";
  const locale = getLocale(localeCode);

  switch (value.type) {
    case ValueType.Number:
      // A measurement with a tolerance renders as "center ± spread"; every
      // other number is unchanged, so a plain value is byte-for-byte what it was.
      if (value.uncertainty !== undefined) {
        return formatUncertain(value.value as number, value.uncertainty, locale, us);
      }
      return formatNumber(value.value as number, locale, us, value.decimalPlaces);
    case ValueType.Hex:
      return formatHex(value.value as number | bigint, us, value.unit);
    case ValueType.BigInt:
      return formatBigInt(value.value as bigint);
    case ValueType.String:
      return formatString(value.value as string);
    case ValueType.Boolean:
      return formatBoolean(value.value as boolean);
    case ValueType.Datetime:
      return formatDatetime(value.value as number, locale, us);
    case ValueType.Uom:
      return formatUom(value.value as number, value.unit, locale, us, value.exact);
    case ValueType.Matrix:
      return formatMatrix(value.value as MatrixData, locale, us);
    case ValueType.Range: {
      const r = value.value as RangeData;
      return formatRange(r.min, r.max, locale);
    }
    case ValueType.Colour:
      return `${locale.display.resultPrefix}${formatColour(value.value as ColourData)}`;
    case ValueType.Split:
      return formatSplit(value.value as SplitData, locale, us);
    case ValueType.Chart:
      // A chart is drawn from its data by the host; the text answer is its label
      // (`sin(x) over [0, 6.28]`, or the series a sparkline came from).
      return `${locale.display.resultPrefix}${(value.value as ChartData).label}`;
    case ValueType.IpCidr:
      return `${locale.display.resultPrefix}${formatIpCidr(value.value as IpCidrData)}`;
    case ValueType.Symbolic:
      return formatSymbolic(value.value as SymbolicNode);
    case ValueType.Percentage:
      return formatPercentage(value.value as number, locale, us);
    case ValueType.Unit:
      return formatUnit(value.value as number, value.unit);
    case ValueType.Error:
      // errorValue(code, message) stores the human-readable message in
      // `.unit` (code goes in `.value`), falling through to the default
      // case here previously displayed the raw code (e.g.
      // "CURRENCY_RATE_UNAVAILABLE") instead of the actual message.
      return value.unit ?? String(value.value);
    default:
      return `= ${String(value.value)}`;
  }
}
