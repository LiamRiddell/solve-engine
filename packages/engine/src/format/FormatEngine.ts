import { Value, ValueType, type MatrixData, type MatrixEntry, type RangeData, type ColourData, type SplitData, type SplitShare, type ChartData, type IpCidrData, type UnitLabel } from "@solve-js/vm/Value";
import { formatColour } from "@solve-js/packages/colour/ColourMath";
import { formatIp } from "@solve-js/packages/ip/IpMath";
import { decimalToFixed, type DecimalData } from "@solve-js/decimal";
import { getLocale, type ILocale } from "@solve-js/constants/locales";
import { autoFormatIntegerOrFloat, compactParts, tooSmallToPrintText } from "@solve-js/utilities/Number";
import { localCalendarName, localCurrencyPlacement, withLocalUnitName } from "./LocaleWords";
import { getMeasure } from "@solve-js/uom/UomConverter";
import { FormattingSettings, DEFAULT_FORMATTING_SETTINGS, resolveFormattingSettings, type FormattingOverrides } from "./FormattingSettings";
import { CURRENCY_DISPLAY } from "@solve-js/uom/CurrencyAliases";
import { isIso4217 } from "@solve-js/uom/Iso4217";
import { isCryptoCurrency, moneyDisplayPlaces, trimFractionZeros, type MoneyPlaces } from "@solve-js/uom/CurrencyMinorUnits";
import { matAt } from "@solve-js/vm/MatrixOps";
import { formatSymbolic, type SymbolicNode } from "@solve-js/symbolic";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { decodeFixedOffsetMinutes, isFixedOffset, isNamedOffset, longDateInZone, timeOfDayInZone } from "@solve-js/calendar/IntlZone";

function formatNumber(value: number, locale: ILocale, settings: FormattingSettings, decimalPlaces?: number, exact?: DecimalData): string {
  // A zero is written without a sign. IEEE's negative zero is kept on the value,
  // where `1 / (0 * -1)` can tell it apart, but `-0` is no use to a reader (#585).
  if (value === 0) value = 0;
  const sep = settings.floatResult.enableSeperator;
  const loc = settings.numberResult.decimalSeparatorLocale;
  // An explicit precision (`3.14159 to 4 dp`, `round(1.5, 2)`) shows EXACTLY that
  // many places with trailing zeros kept, where the default trims them and shows
  // an integer with none. The value was already rounded to this precision when
  // it was set (see VMBuiltins' roundToPlaces, exact where an exact decimal was
  // there), so rendering it to the same place count reproduces that rounding.
  //
  // Where that rounding was exact, the digits come from the decimal rather than
  // the double, the way money's do: `(0.1 + 0.2) to 17 dp` is 0.3 to seventeen
  // places, and the double nearest 0.3 would print as 0.29999999999999999.
  if (decimalPlaces !== undefined && exact !== undefined && Number.isFinite(value)) {
    return `${locale.display.resultPrefix}${localiseFixedDecimal(decimalToFixed(exact, decimalPlaces), loc || "en-US", sep)}`;
  }
  if (decimalPlaces !== undefined && Number.isFinite(value)) {
    const formatted = value.toLocaleString(loc || "en-US", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
      useGrouping: sep,
    });
    return `${locale.display.resultPrefix}${formatted}`;
  }
  const compact = compactText(value, settings);
  if (compact !== undefined) return `${locale.display.resultPrefix}${compact}`;
  const dp = settings.floatResult.decimalPlaces;
  // A value below the decimal budget is shown to three significant digits
  // rather than as a zero it cannot be told apart from. Only when the budget is
  // the default one: an explicit `to N dp` above asked for those places and is
  // given them, zeros included.
  const tooSmall = tooSmallToPrintText(value, dp, loc || "en-US");
  const formatted = tooSmall ?? autoFormatIntegerOrFloat(value, dp, sep, loc, settings.floatResult.trimTrailingZeros === true);
  return `${locale.display.resultPrefix}${formatted}`;
}

/**
 * A number in the compact form `as compact` writes (`1.5M`, `-2.3k`), in the
 * locale's digits and decimal mark, when `floatResult.compactFrom` asks for it
 * and the number reaches it (#750). Undefined otherwise: the setting is off,
 * the number is below the threshold or below a thousand, it has reached a
 * thousand trillion, or it is not finite. A threshold that is not a finite
 * number is off rather than thrown on, since it is a host's setting and not a
 * reader's line.
 *
 * A number past the largest suffix keeps its ordinary form, as one below the
 * smallest does: there is no suffix left to shorten it with, and `as compact`'s
 * exponent form there (`1e+308`) would turn an exact `2^64` into
 * `1.84e+19` on a line that never asked for a rounding.
 *
 * @param value - The number, or a quantity's number.
 * @param settings - The settings in force.
 * @returns The compact text without a unit, or undefined for the ordinary form.
 */
export function compactText(value: number, settings: FormattingSettings): string | undefined {
  const from = settings.floatResult.compactFrom;
  if (typeof from !== "number" || !Number.isFinite(from) || !Number.isFinite(value)) return undefined;
  const magnitude = Math.abs(value);
  if (magnitude < Math.max(from, 1000)) return undefined;
  const parts = compactParts(value);
  if (parts === undefined || parts.suffix === "") return undefined;
  const loc = settings.numberResult.decimalSeparatorLocale || "en-US";
  return `${parts.sign}${localiseFixedDecimal(parts.figure, loc, false)}${parts.suffix}`;
}

/**
 * The locale an answer's words are written in, or undefined for the engine's
 * own: `wordsResult.spelling` set to `"engine"` keeps them (#754, #755, #757).
 * Whether the locale has words of its own is the caller's lookup to make.
 */
function wordsLocale(settings: FormattingSettings): string | undefined {
  if (settings.wordsResult?.spelling === "engine") return undefined;
  return settings.numberResult.decimalSeparatorLocale || "en-US";
}

/**
 * Renders a whole number past the safe range from the exact integer it carries.
 *
 * A double past 9,007,199,254,740,991 prints its shortest round-trip form, 17
 * significant digits and zeros after them, so `2^64` read
 * 18,446,744,073,709,552,000 though the answer is 18,446,744,073,709,551,616.
 * A result the VM kept exact (see vm/ExactIntegers.ts) now shows every digit,
 * grouped and localised the way {@link formatNumber} groups a double, with an
 * explicit place count still honoured. `Intl.NumberFormat` formats a bigint
 * without converting it, so no digit is lost on the way out.
 */
function formatExactInteger(n: bigint, locale: ILocale, settings: FormattingSettings, decimalPlaces?: number): string {
  const places = decimalPlaces ?? 0;
  const formatted = new Intl.NumberFormat(settings.numberResult.decimalSeparatorLocale || "en-US", {
    useGrouping: settings.floatResult.enableSeperator,
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(n);
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

/** The locale a date's names are written in, per host tag; see {@link dateNamesLocale}. */
const dateNamesByTag = new Map<string, string>();

/** Past this length a tag is not remembered: no real tag is this long, and a host string of any size should not be kept. */
const MAX_REMEMBERED_TAG = 64;

/**
 * The locale a spelled-out date's weekday and month names come from: the
 * host's full tag, the one its digits are written in, wherever Intl has data
 * for it, so `de-DE` gets German names and `en-GB` its own day-first order.
 *
 * It used to be the language pack's code, which is `en` for every tag without
 * a pack of its own, so `de-DE` showed German digits beside English month
 * names (#655). A tag Intl has no data for (`xx`), or cannot read at all
 * (`__proto__`), keeps the pack's names, English for both, as it always did:
 * Intl would otherwise answer an unknown tag in whatever locale the runtime
 * happens to run in. That is the guard `calendar/HostLocale.ts` uses for the
 * same reason.
 *
 * @param tag - `numberResult.decimalSeparatorLocale`, or `en-US` when it is empty.
 * @param pack - The language pack the tag chose.
 */
function dateNamesLocale(tag: string, pack: ILocale): string {
  const remembered = dateNamesByTag.get(tag);
  if (remembered !== undefined) return remembered;
  let chosen = pack.code;
  try {
    if (Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0) chosen = tag;
  } catch {
    // A tag Intl cannot parse keeps the pack's names.
  }
  if (tag.length <= MAX_REMEMBERED_TAG) dateNamesByTag.set(tag, chosen);
  return chosen;
}

function formatString(value: string): string {
  return `= ${value}`;
}

/**
 * A weekday or month name answered from a date, in the reader's language
 * where the locale has its own (`= Dienstag` under `de`, #757), and the
 * engine's English text otherwise.
 */
function formatCalendarName(value: Value, settings: FormattingSettings): string {
  const name = value.calendarName;
  const words = wordsLocale(settings);
  const local = name === undefined || words === undefined ? undefined : localCalendarName(name.kind, name.index, words);
  return formatString(local ?? (value.value as string));
}

function formatBoolean(value: boolean): string {
  return `= ${value}`;
}

/**
 * A year as ISO 8601 writes it (#823): four digits from year 0 to 9999
 * (`0975`, not `975`, which no ISO reader takes as a year), and outside them
 * a sign and six digits, the expanded form `Date` and `Temporal` both write
 * and read. The year counts astronomically, so 1 BC is `0000` and 975 BC is
 * `-000974`, which is the numbering ISO 8601 itself uses.
 *
 * @param year - The astronomical year, as a backend's fields give it.
 * @returns The year's ISO spelling.
 */
export function isoYear(year: number): string {
  if (!Number.isInteger(year)) return String(year);
  if (year >= 0 && year <= 9999) return String(year).padStart(4, "0");
  return `${year < 0 ? "-" : "+"}${String(Math.abs(year)).padStart(6, "0")}`;
}

/**
 * A year as the day-first and month-first forms write it (#823): as it always
 * was from year 1, and before it with `BC` after the year, counted as a reader counts, so the
 * astronomical year -974 is `975 BC`. Without the era a date before year 1
 * read as one in the common era.
 *
 * @param year - The astronomical year, as a backend's fields give it.
 * @returns The year for a `dmy` or `mdy` date.
 */
export function slashYear(year: number): string {
  if (!Number.isInteger(year) || year >= 1) return String(year);
  return `${1 - year} BC`;
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
 * Reads the calendar backend on the settings, or the built-in `Date` one
 * when the settings name none: `formatValue` is a free function a host calls
 * with a value and settings, with no engine in hand, so the host passes the
 * backend its engine computes with (`FormattingSettings.calendar`) and a
 * date shows the day it was computed on, in that backend's zone.
 */
function formatDatetime(instant: number, locale: ILocale, settings: FormattingSettings, valueZone?: string): string {
  const calendar = settings.calendar ?? DATE_CALENDAR;
  const format = settings.dateResult?.format ?? "long";

  // A date that names a zone is read in it. `3 April 2026 in Tokyo` is Tokyo's
  // 3 April, and rendering the instant behind it in the reader's own zone
  // showed them 2 April: the right moment, answering a question nobody asked.
  //
  // Only a named zone, deliberately. An ISO literal carrying `Z` or an offset
  // records the synthetic fixed-offset form, and how those display is a
  // separate question this does not answer: they keep reading in the zone the
  // engine computes in, as they always have.
  //
  // An offset the reader named (`in UTC-5`) is the clock they asked to see, so
  // it displays as a named zone does: the instant moved by the offset and read
  // in UTC, which needs no zone data and so reads the same on every runtime.
  const namedOffset = valueZone !== undefined && isNamedOffset(valueZone);
  const value = namedOffset ? instant + decodeFixedOffsetMinutes(valueZone) * 60000 : instant;
  const zone = namedOffset ? "UTC" : valueZone;
  const named = zone !== undefined && !isFixedOffset(zone);
  const d = named ? calendar.fieldsInZone(zone, value) : calendar.fields(value);
  const millisecond = named ? 0 : calendar.fields(value).millisecond;
  const isMidnight = d.hour === 0 && d.minute === 0 && d.second === 0 && millisecond === 0;

  // The spelled-out default, localised through the host's own tag where Intl
  // has names for it; see dateNamesLocale.
  if (format === "long") {
    const tag = dateNamesLocale(settings.numberResult.decimalSeparatorLocale || "en-US", locale);
    const dateStr = named ? longDateInZone(zone, value, tag) : calendar.formatLongDate(value, tag);
    if (isMidnight) return `= ${dateStr}`;
    const timeStr = named ? timeOfDayInZone(zone, value, tag) : calendar.formatTimeOfDay(value, tag);
    return `= ${dateStr}, ${timeStr}`;
  }

  // The numeric forms, built from the local calendar fields so they read the
  // same regardless of the JS runtime's own default locale.
  const p2 = (n: number) => String(n).padStart(2, "0");
  const month = p2(d.month0 + 1);
  const day = p2(d.day);
  let datePart: string;
  if (format === "iso") datePart = `${isoYear(d.year)}-${month}-${day}`;
  else if (format === "dmy") datePart = `${day}/${month}/${slashYear(d.year)}`;
  else datePart = `${month}/${day}/${slashYear(d.year)}`; // mdy

  if (isMidnight) return `= ${datePart}`;
  const time = `${p2(d.hour)}:${p2(d.minute)}:${p2(d.second)}`;
  // ISO joins date and time with `T`; the slash forms with a space.
  return format === "iso" ? `= ${datePart}T${time}` : `= ${datePart} ${time}`;
}

/**
 * Renders a millisecond duration as clock-style `H:MM` (or `H:MM:SS` when
 * there's a non-zero seconds component), rounded to the whole second.
 *
 * Only for a value marked as a span (`datetimeSpan`), which subtracting two
 * clock times or datetimes produces (`9:30 - 8:30`, VM.ts's Datetime SUB), and
 * which keeps through adding spans, scaling one, or adding or taking away a
 * length of time (see binaryOp in vm/VMConversion.ts). A reader can type `ms`
 * (`40ms + 120ms` is 160 ms), and such a quantity carries no mark, so it keeps
 * its milliseconds rather than being rounded onto a clock.
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

/**
 * The time units a pace can be written in, and what one of each is in seconds.
 *
 * A short list rather than a measure lookup, because a pace is minutes and
 * seconds by convention and nobody writes a pace in weeks.
 */
const PACE_TIME_UNITS: Readonly<Record<string, number>> = {
	s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
	min: 60, mins: 60, minute: 60, minutes: 60,
	h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
};

/**
 * Below this many seconds per unit, a pace keeps its ordinary rendering.
 *
 * A clock shows whole seconds, and rounding to one is immaterial at a runner's
 * pace and a real loss below a minute: `0.90 seconds/m` would read `0:01 /m`,
 * which is a different number. A minute per unit is where the rounding stops
 * mattering.
 */
const PACE_CLOCK_FLOOR_SECONDS = 60;

/**
 * A time over a distance, written the way a runner writes it.
 *
 * `4:30/km` is four and a half minutes to cover a kilometre, and `270.00
 * seconds/km` is the same number in a spelling nobody uses. So a quantity whose
 * unit is a time over a length is shown on a clock, matching what the `pace`
 * function has always printed.
 *
 * Returns undefined for everything else, which is every other unit the engine
 * carries: a speed (`90 km/h`) is a length over a time and reads as a number, a
 * rate of pay is money over a time, and a pace faster than a minute per unit
 * keeps its digits. Callers keep the rendering they had.
 */
function formatPace(value: number, unit: string): string | undefined {
	const slash = unit.indexOf("/");
	if (slash <= 0) return undefined;
	const perSecond = PACE_TIME_UNITS[unit.slice(0, slash).toLowerCase()];
	if (perSecond === undefined) return undefined;
	const distance = unit.slice(slash + 1);
	if (getMeasure(distance) !== "length") return undefined;

	const seconds = value * perSecond;
	if (!Number.isFinite(seconds) || Math.abs(seconds) < PACE_CLOCK_FLOOR_SECONDS) return undefined;
	// The same shape `formatMsDuration` writes, so a pace and a stretch of time
	// read alike, with the hours dropped when there are none.
	const sign = seconds < 0 ? "-" : "";
	const whole = Math.round(Math.abs(seconds));
	const hours = Math.floor(whole / 3600);
	const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
	const ss = String(whole % 60).padStart(2, "0");
	const clock = hours === 0 ? `${Math.floor(whole / 60)}:${ss}` : `${hours}:${mm}:${ss}`;
	return `${sign}${clock} /${distance}`;
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

/** The ten digits each locale writes, looked up once per locale; null where they are the ASCII ones. */
const nativeDigitsByLocale = new Map<string, readonly string[] | null>();

/**
 * The digits 0 to 9 as `loc` writes them, from Intl's own rendering, so they
 * follow whatever numbering system Intl picks for the tag: Arabic-Indic for
 * `ar-EG`, Bengali for `bn`, and ASCII again for `ar-EG-u-nu-latn`.
 *
 * @param loc - An Intl locale tag.
 * @returns The ten digits, or null when they are `0` to `9` already.
 */
function nativeDigits(loc: string): readonly string[] | null {
  let digits = nativeDigitsByLocale.get(loc);
  if (digits === undefined) {
    const format = new Intl.NumberFormat(loc, { useGrouping: false });
    const written = Array.from({ length: 10 }, (_, d) => format.format(d));
    digits = written.every((text, d) => text === String(d)) ? null : written;
    nativeDigitsByLocale.set(loc, digits);
  }
  return digits;
}

/**
 * ASCII digits rewritten one for one in `loc`'s numbering system, leading
 * zeros kept, which is what a fraction needs: `05` stays two digits.
 *
 * @param ascii - A run of the digits `0` to `9` and nothing else.
 * @param loc - An Intl locale tag.
 */
function localiseDigits(ascii: string, loc: string): string {
  const digits = nativeDigits(loc);
  if (digits === null) return ascii;
  let out = "";
  for (let i = 0; i < ascii.length; i++) out += digits[ascii.charCodeAt(i) - 48];
  return out;
}

/**
 * Write a fixed-decimal string (`"1234567.50"`) the way `loc` writes numbers:
 * its digits, its decimal mark, and its digit grouping when `useGrouping` is on.
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
 *
 * The fraction's digits, and the integer's when it is not grouped, are mapped
 * into the locale's numbering system too. They used to be appended as the ASCII
 * they arrived in, so under `ar-EG` `3.5 days` showed `٣٫50 days`, native
 * digits stopping at the decimal mark, while a plain `1234.5` was native
 * throughout (#656).
 */
export function localiseFixedDecimal(fixed: string, loc: string, useGrouping: boolean): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(fixed);
  if (!match) return fixed;
  const [, sign, integer, fraction] = match;
  const integerText = useGrouping ? BigInt(integer).toLocaleString(loc, { useGrouping: true }) : localiseDigits(integer, loc);
  if (fraction === undefined) return `${sign}${integerText}`;
  return `${sign}${integerText}${decimalMark(loc)}${localiseDigits(fraction, loc)}`;
}

function formatUom(value: number, unit: string | undefined, locale: ILocale, settings: FormattingSettings, exact?: DecimalData, isDatetimeSpan?: boolean, explicitPlaces?: number, label?: UnitLabel): string {
  // A quantity with a name of its own is written under that name, counted in
  // it (`= 6 sprints` for twelve weeks); money keeps its symbol. See
  // Value.unitLabel.
  if (label !== undefined && unit !== undefined && moneyUnitOf(unit) === undefined) {
    return formatLabelledUom(value, unit, label, settings, explicitPlaces);
  }
  // A time over a distance is a pace, and a runner reads a pace on a clock.
  // Not when the line named its own place count, which asked for digits.
  if (unit !== undefined && explicitPlaces === undefined) {
    const pace = formatPace(value, unit);
    if (pace !== undefined) return `= ${pace}`;
  }
  // A clock only for the gap between two datetimes, which is marked as such.
  // A quantity in milliseconds is a quantity: `40ms + 120ms` is 190 ms, not
  // 0:00, and every neighbouring spelling already agreed (`40 milliseconds`).
  if (unit === "ms" && isDatetimeSpan) return `= ${formatMsDuration(value)}`;
  // A fuel-consumption unit is stored slash-free (so it is not read as a rate)
  // but shown the way it is written.
  if (unit === "l100km") unit = "l/100km";
  if (unit === "mps2") unit = "m/s²";

  // `1.23456 km to 4 dp` asked for four places and used to be given the
  // setting's two, because a quantity's own place count was never read here the
  // way a plain number's already was.
  const dp = explicitPlaces ?? settings.unitOfMeasurementResult.decimalPlaces;
  const useGrouping = settings.floatResult.enableSeperator;
  const loc = settings.numberResult.decimalSeparatorLocale || "en-US";

  // Money, and a price per unit of something, is shown to the currency's own
  // places (#731) and with its symbol (#753). See formatMoney.
  const money = unit === undefined ? undefined : moneyUnitOf(unit);
  if (money !== undefined) {
    const places = explicitPlaces !== undefined
      ? { min: explicitPlaces, max: explicitPlaces }
      : settings.unitOfMeasurementResult.currencyPlaces === "setting"
        ? { min: dp, max: dp }
        : moneyDisplayPlaces(money.code, dp, money.per !== undefined);
    const compact = explicitPlaces === undefined ? compactText(value, settings) : undefined;
    return `= ${formatMoney(value, money, places, exact, explicitPlaces !== undefined, loc, useGrouping, wordsLocale(settings), compact)}`;
  }

  // For TimeSpan values (days, weeks, hours, etc.), format as integer if the value is a whole number
  const isTimeSpan = unit !== undefined && TIME_SPAN_UNITS.has(unit);

  // A conversion can land far below the decimal budget, and `1 Hz in MHz`
  // printing `0.00 MHz` is indistinguishable from a real zero. Three
  // significant digits instead, in exponent form once the zeros stop being
  // countable. Not for an explicit `to N dp`, which asked for those places.
  // Money has its own rule, in formatMoney.
  const tooSmall = explicitPlaces === undefined ? tooSmallToPrintText(value, dp, loc) : undefined;
  const compact = explicitPlaces === undefined ? compactText(value, settings) : undefined;

  let formatted: string;
  // The places the text shows, for the grammatical form of a localised unit
  // name; undefined when the text is not a plain decimal.
  let shownPlaces: number | undefined;
  if (compact !== undefined) {
    formatted = compact;
  } else if (tooSmall !== undefined) {
    formatted = tooSmall;
  } else if (isTimeSpan && value === Math.floor(value)) {
    // For whole number TimeSpan values, format as integer
    formatted = localiseFixedDecimal(value.toString(), loc, useGrouping);
    shownPlaces = 0;
  } else {
    // For other values, use the configured decimal places, less the zeros
    // that only pad them when the host asked for that (#750). An explicit
    // `to N dp` keeps every place it asked for.
    const fixed = value.toFixed(dp);
    const shown = explicitPlaces === undefined && settings.floatResult.trimTrailingZeros === true ? trimFractionZeros(fixed, 0) : fixed;
    formatted = localiseFixedDecimal(shown, loc, useGrouping);
    const point = shown.indexOf(".");
    shownPlaces = /e/i.test(shown) ? undefined : point < 0 ? 0 : shown.length - point - 1;
  }

  // A unit's long name in the reader's language where Intl has one (#754):
  // `3,11 Meilen` under `de`. A symbol (`km`) is written as it is, and an
  // English locale keeps the engine's own names.
  const words = unit === undefined ? undefined : wordsLocale(settings);
  if (unit !== undefined && words !== undefined) {
    // The count as shown, so `1.00` takes the form a count with places takes.
    const count = shownPlaces === undefined ? value : Number(value.toFixed(shownPlaces));
    const local = withLocalUnitName(formatted, unit, count, shownPlaces, words);
    if (local !== undefined) return `= ${local}`;
  }

  // Otherwise the unit is written as the spelling the value carries. Names
  // cannot be recovered from the generated unit table, which maps a spelling
  // to [measure, ratio] only (units that differ by an OFFSET share a ratio, so
  // "20 C" would come back as "20 kelvins"), which is why a localised name
  // above starts from the long spelling the value already carries and a
  // symbol is never turned into a name. The time words come in pairs and
  // agree with their count in English: see timeWordForCount.
  const shownUnit = unit !== undefined && isTimeSpan ? timeWordForCount(unit, value) : unit;
  return `= ${formatted} ${shownUnit || ""}`.trim();
}

/**
 * A quantity written under the name the reader gave its unit (#762): the
 * count in that name, then the name as written. The count is `value / per`,
 * and it follows the places rule its own unit follows, so a whole number of
 * days renamed `Tage` is `= 3 Tage`, as `= 3 days` would be, and a distance
 * keeps the setting's places.
 *
 * @param value - The quantity, in its own unit.
 * @param unit - Its own unit, which decides the places rule.
 * @param label - The name and how many of `unit` one of it is.
 * @param settings - The formatting settings.
 * @param explicitPlaces - A place count the line asked for, if any.
 */
function formatLabelledUom(value: number, unit: string, label: UnitLabel, settings: FormattingSettings, explicitPlaces: number | undefined): string {
  const count = label.per === 1 ? value : value / label.per;
  const dp = explicitPlaces ?? settings.unitOfMeasurementResult.decimalPlaces;
  const useGrouping = settings.floatResult.enableSeperator;
  const loc = settings.numberResult.decimalSeparatorLocale || "en-US";
  const tooSmall = explicitPlaces === undefined ? tooSmallToPrintText(count, dp, loc) : undefined;
  let formatted: string;
  if (tooSmall !== undefined) formatted = tooSmall;
  else if (explicitPlaces === undefined && TIME_SPAN_UNITS.has(unit) && Number.isInteger(count)) formatted = localiseFixedDecimal(count.toString(), loc, useGrouping);
  else formatted = localiseFixedDecimal(count.toFixed(dp), loc, useGrouping);
  return `= ${formatted} ${label.name}`;
}

/**
 * The time words a value can carry, singular and plural, each paired with its
 * other form. A whole number of them is shown without places (`= 3 days`).
 */
const TIME_WORD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["second", "seconds"], ["minute", "minutes"], ["hour", "hours"], ["day", "days"],
  ["week", "weeks"], ["month", "months"], ["year", "years"],
];
const TIME_SPAN_UNITS: ReadonlySet<string> = new Set(TIME_WORD_PAIRS.flat());
const SINGULAR_OF: ReadonlyMap<string, string> = new Map(TIME_WORD_PAIRS.map(([one, many]) => [many, one]));
const PLURAL_OF: ReadonlyMap<string, string> = new Map(TIME_WORD_PAIRS.map(([one, many]) => [one, many]));

/**
 * The time word that agrees with its count (#753): the singular for exactly
 * one (`= 1 hour`, and `= -1 hour`), the plural for every other count (`= 2
 * hours`, `= 0 hours`, `= 1.50 hours`). The value keeps whichever spelling it
 * was typed or converted into, so `3600 seconds in hours` used to show `= 1
 * hours`, and `2 hour` showed `= 2 hour`.
 *
 * A value a little off one is plural, and is shown with places (`1.00 hours`),
 * since it is a measurement and not a count. A word that is not one of the
 * time words, and every symbol (`h`, `min`), is returned as it came.
 *
 * @param unit - The unit the value carries.
 * @param value - The value.
 */
export function timeWordForCount(unit: string, value: number): string {
  if (Math.abs(value) === 1) return SINGULAR_OF.get(unit) ?? unit;
  if (SINGULAR_OF.has(unit)) return unit;
  return PLURAL_OF.get(unit) ?? unit;
}

/** A currency, and the unit it is priced per when the amount is a rate (`USD/hour`). */
export interface MoneyUnit {
  readonly code: string;
  readonly per?: string;
}

/**
 * Whether `unit` is money: a currency code as the engine stores one, upper case
 * (`USD`, `BTC`), or such a code over something else (`USD/hour`, `JPY/kWh`).
 * A code with a symbol in the display table is matched in any case, as the
 * display lookup always was (`usd` is shown `$`). Any other code must be in
 * upper case, since `cup` is the cooking unit although `CUP` is the Cuban peso.
 *
 * @param unit - The unit a value carries.
 * @returns The currency, upper case, and what it is per, or undefined for anything else.
 */
export function moneyUnitOf(unit: string): MoneyUnit | undefined {
  const slash = unit.indexOf("/");
  const written = slash < 0 ? unit : unit.slice(0, slash);
  if (written.length < 3 || written.length > 4) return undefined;
  const code = written.toUpperCase();
  const hasSymbol = Object.prototype.hasOwnProperty.call(CURRENCY_DISPLAY, code);
  if (!hasSymbol && (written !== code || (!isIso4217(code) && !isCryptoCurrency(code)))) return undefined;
  if (slash < 0) return { code };
  const per = unit.slice(slash + 1);
  return per === "" ? undefined : { code, per };
}

/**
 * An amount of money as it is written: its symbol where the display table has
 * one (`$33.33`, `12.00 kr`, `-€5.00`), its code otherwise (`33.333 KWD`), and
 * a price per unit with the unit after a slash (`$15.00/hour`, `12.00 kr/hour`).
 * A rate used to fall through to the code (`15.00 USD/hour`), because only a
 * bare code was looked up in the display table (#753).
 *
 * The places come from `places`: exactly the currency's minor unit for an
 * amount, a range for a price per unit or a cryptocurrency, trailing zeros past
 * the minimum dropped (see uom/CurrencyMinorUnits.ts).
 *
 * An exact money amount rounds from its decimal, not from the double: a
 * half-cent like "$1.005" reads as "$1.01" here, where "(1.005).toFixed(2)"
 * answers "1.00" because the double it is handed already sits below the value
 * the user typed. An amount with no exact decimal (a currency conversion, whose
 * rate is a double) rounds from the double, and one that lands below the places
 * keeps three significant digits (`$100 in BTC` at a high rate), since a
 * conversion's fraction of a cent is still an answer. A typed amount below them
 * rounds to zero (`$0.001` is `$0.00`, a tenth of a penny is not payable),
 * except a price per unit: a tenth of a cent a kilowatt-hour is a real price,
 * so `$0.001/kWh` keeps its digits.
 *
 * A prefix symbol goes after the sign, as money is written: -$5.00, not
 * $-5.00 (#554). A suffix symbol follows the amount either way.
 *
 * Under a locale that is not English the symbol takes the place that locale
 * gives it (#755): after the amount with a space under `de` (`5,00 €`), before
 * it under `ja`. The symbol itself, the places and the sign rule stay the
 * engine's, so `$` stays `$` for every dollar and the amount rounds as it
 * always did. The space is a plain one, where `Intl` writes a no-break space,
 * so the answer reads back in as typed text.
 *
 * @param words - The locale the symbol is placed for, or undefined for the engine's own placement.
 * @param compact - The amount already written compactly (`3.3M`), or undefined for the ordinary form.
 */
function formatMoney(value: number, money: MoneyUnit, places: MoneyPlaces, exact: DecimalData | undefined, placesAsked: boolean, loc: string, useGrouping: boolean, words?: string, compact?: string): string {
  const tooSmall = compact !== undefined || placesAsked || (exact !== undefined && money.per === undefined)
    ? undefined
    : tooSmallToPrintText(value, places.max, loc);
  let text: string;
  if (compact !== undefined) {
    text = compact;
  } else if (tooSmall !== undefined) {
    text = tooSmall;
  } else {
    const fixed = exact !== undefined ? decimalToFixed(exact, places.max) : value.toFixed(places.max);
    text = localiseFixedDecimal(trimFractionZeros(fixed, places.min), loc, useGrouping);
  }
  const per = money.per === undefined ? "" : `/${money.per}`;
  // An own-property read: the code has passed the ISO check, but the table is
  // a plain object and a lookup must never find an inherited name.
  const display = Object.prototype.hasOwnProperty.call(CURRENCY_DISPLAY, money.code) ? CURRENCY_DISPLAY[money.code] : undefined;
  if (display === undefined) return `${text} ${money.code}${per}`;
  const placed = words === undefined ? undefined : localCurrencyPlacement(money.code, words);
  const position = placed?.position ?? display.position;
  const sep = (placed?.spaced ?? display.spaced) ? " " : "";
  const negative = text.startsWith("-");
  const amount = position === "prefix"
    ? `${negative ? "-" : ""}${display.symbol}${sep}${negative ? text.slice(1) : text}`
    : `${text}${sep}${display.symbol}`;
  return `${amount}${per}`;
}

function formatMatrixEntry(entry: MatrixEntry, settings: FormattingSettings, unit?: string, locale?: ILocale): string {
  if (typeof entry === "boolean") return entry ? "true" : "false";
  // A cell of a list with a unit is written as the quantity it stands for, so
  // `[1 km, 500 m]` shows as `[1.00 km, 0.50 km]` and money as money (#745).
  if (unit !== undefined && locale !== undefined && typeof entry === "number") {
    const quantity = formatUom(entry, unit, locale, settings);
    return quantity.startsWith(locale.display.resultPrefix) ? quantity.slice(locale.display.resultPrefix.length) : quantity;
  }
  if (typeof entry === "object" && entry !== null) return formatSymbolic(entry);
  const dp = settings.floatResult.decimalPlaces;
  const sep = settings.floatResult.enableSeperator;
  const loc = settings.numberResult.decimalSeparatorLocale;
  // A zero entry is written without a sign, as a zero result is (#585), and an
  // entry drops its padding zeros when a plain number does (#750).
  return autoFormatIntegerOrFloat(entry === 0 ? 0 : entry, dp, sep, loc, settings.floatResult.trimTrailingZeros === true);
}

/**
 * The element ceiling a settings object asks for, or undefined for none: a
 * number of at least 1, rounded down. Anything else (absent, zero, negative,
 * `NaN`, infinite, not a number at all) is no ceiling, since the setting is
 * opt-in and an unusable one must not hide a result.
 */
export function matrixElementCeiling(settings: FormattingSettings): number | undefined {
  const group = settings.matrixResult;
  if (typeof group !== "object" || group === null) return undefined;
  const max = group.maxElements;
  if (typeof max !== "number" || !Number.isFinite(max) || max < 1) return undefined;
  return Math.floor(max);
}

/**
 * How much of `m` is written under a ceiling of `max` elements.
 *
 * - `whole`: all of it, the matrix is within the ceiling (or there is none).
 * - `elements`: a list (one row or one column) past the ceiling: its first
 *   `shown` elements, and `leftOut` more.
 * - `rows`: a matrix past the ceiling: its first `shown` whole rows, and
 *   `leftOut` rows more.
 * - `shape`: a matrix one of whose rows is already past the ceiling, so not
 *   one row fits and only its shape is written.
 */
export type MatrixPreview =
  | { kind: "whole" }
  | { kind: "elements" | "rows"; shown: number; leftOut: number }
  | { kind: "shape" };

/** What {@link formatMatrix} and {@link formatMatrixAligned} write of `m` under `max`; see {@link MatrixPreview}. */
export function matrixPreview(m: MatrixData, max: number | undefined): MatrixPreview {
  const cells = m.rows * m.cols;
  if (max === undefined || cells <= max) return { kind: "whole" };
  if (m.rows === 1 || m.cols === 1) return { kind: "elements", shown: max, leftOut: cells - max };
  const rows = Math.floor(max / m.cols);
  if (rows === 0) return { kind: "shape" };
  return { kind: "rows", shown: rows, leftOut: m.rows - rows };
}

/**
 * How many more there are, as the short form writes it: `and 99,997 more`, or
 * `and 3 more rows`. The count is grouped the English way whatever the number
 * locale, as the trace's short form writes it, so the two read alike.
 */
function leftOutText(preview: { kind: "elements" | "rows"; leftOut: number }): string {
  const count = autoFormatIntegerOrFloat(preview.leftOut, 0, true, "en-US");
  return preview.kind === "rows" ? `and ${count} more ${preview.leftOut === 1 ? "row" : "rows"}` : `and ${count} more`;
}

/**
 * Renders a Matrix matching its own literal syntax: a single row (1xN,
 * including plain vectors) as `[a, b, c]`, a single column (Nx1) as
 * `[a; b; c]`, and a general shape as `[r0c0, r0c1; r1c0, r1c1]`, row-major
 * textual output read back out of the column-major storage, matching how
 * `[1,2;3,4]` is written.
 *
 * Under `matrixResult.maxElements` a larger one is written short (see
 * {@link matrixPreview}): `[0, 10, 20, and 99,997 more]`, `[1, 2; 3, 4; and 8
 * more rows]`, or `[2x5000 matrix]`. Only what is shown is formatted.
 */
function formatMatrix(m: MatrixData, locale: ILocale, settings: FormattingSettings): string {
  const preview = matrixPreview(m, matrixElementCeiling(settings));
  if (preview.kind === "shape") return `${locale.display.resultPrefix}[${m.rows}x${m.cols} matrix]`;
  const shownRows = preview.kind === "rows" ? preview.shown : preview.kind === "elements" && m.cols === 1 ? preview.shown : m.rows;
  const shownCols = preview.kind === "elements" && m.rows === 1 ? preview.shown : m.cols;
  const rows: string[] = [];
  for (let r = 0; r < shownRows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < shownCols; c++) {
      cells.push(formatMatrixEntry(matAt(m, r, c), settings, m.unit, locale));
    }
    rows.push(cells.join(", "));
  }
  if (preview.kind === "whole") return `${locale.display.resultPrefix}[${rows.join("; ")}]`;
  // A row list continues with a comma, a column or a matrix with a semicolon,
  // the separator the next element would have had.
  const joiner = preview.kind === "elements" && m.rows === 1 ? ", " : "; ";
  return `${locale.display.resultPrefix}[${rows.join("; ")}${joiner}${leftOutText(preview)}]`;
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
 *
 * Under `matrixResult.maxElements` a larger one shows what fits (see
 * {@link matrixPreview}) and ends with a line saying how much was left out,
 * `and 99,997 more` or `and 8 more rows`; a matrix none of whose rows fits
 * is written as its shape, `[2x5000 matrix]`.
 */
export function formatMatrixAligned(m: MatrixData, settings?: FormattingOverrides): string {
  const us = resolveFormattingSettings(settings);
  const preview = matrixPreview(m, matrixElementCeiling(us));
  if (preview.kind === "shape") return `[${m.rows}x${m.cols} matrix]`;
  const shownRows = preview.kind === "rows" ? preview.shown : preview.kind === "elements" && m.cols === 1 ? preview.shown : m.rows;
  const shownCols = preview.kind === "elements" && m.rows === 1 ? preview.shown : m.cols;
  const locale = getLocale(us.numberResult.decimalSeparatorLocale || "en");
  const cells: string[][] = [];
  for (let r = 0; r < shownRows; r++) {
    const row: string[] = [];
    for (let c = 0; c < shownCols; c++) {
      row.push(formatMatrixEntry(matAt(m, r, c), us, m.unit, locale));
    }
    cells.push(row);
  }
  const colWidth: number[] = [];
  for (let c = 0; c < shownCols; c++) {
    let width = 0;
    for (let r = 0; r < shownRows; r++) width = Math.max(width, cells[r][c].length);
    colWidth.push(width);
  }
  const grid = cells
    .map((row) => `[ ${row.map((cell, c) => cell.padStart(colWidth[c])).join("  ")} ]`)
    .join("\n");
  // Past the ceiling, one more line says how much was left out.
  return preview.kind === "whole" ? grid : `${grid}\n${leftOutText(preview)}`;
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
  const loc = settings.numberResult.decimalSeparatorLocale || "en-US";
  const percent = value * 100;
  // A percentage follows the rules every other number does (#637): one that is
  // not zero is never shown as one (`0.001%` was 0.00%), and it takes the
  // locale's grouping and decimal mark (`1234567%` was 1234567.00%, and 25%
  // under de-DE was 25.00%), as formatUom's figures do.
  const tooSmall = tooSmallToPrintText(percent, dp, loc);
  // Less the zeros that only pad the places, when the host asked for that (#750).
  const fixed = settings.floatResult.trimTrailingZeros === true ? trimFractionZeros(percent.toFixed(dp), 0) : percent.toFixed(dp);
  let formatted = tooSmall ?? localiseFixedDecimal(fixed, loc, settings.floatResult.enableSeperator);
  // A proportion that is zero at these places is written without a sign, as a
  // zero is (#585): never -0.00%.
  if (tooSmall === undefined && Number(fixed) === 0) formatted = formatted.replace("-", "");
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
 *   {@link DEFAULT_FORMATTING_SETTINGS} when omitted. A partial object names
 *   only what it changes and is merged over the defaults group by group
 *   (`{ calendar }`, `{ numberResult: { decimalSeparatorLocale: "de-DE" } }`);
 *   a complete one is used as it is. To format with an engine's own calendar
 *   and locale, `ExpressionEngine.formatValue` is the shorter call.
 * @example
 * ```typescript
 * const value = engine.evaluateExpression("10 USD to GBP");
 * formatValue(value); // "= £7.85" (exact output depends on live exchange rates)
 * ```
 */
export function formatValue(value: Value, settings?: FormattingOverrides): string {
  const us = resolveFormattingSettings(settings);
  const localeCode = us.numberResult.decimalSeparatorLocale || "en";
  const locale = getLocale(localeCode);

  switch (value.type) {
    case ValueType.Number:
      // A measurement with a tolerance renders as "center ± spread"; every
      // other number is unchanged, so a plain value is byte-for-byte what it was.
      if (value.uncertainty !== undefined) {
        return formatUncertain(value.value as number, value.uncertainty, locale, us);
      }
      // An exact integer past the safe range shows its own digits. Within the
      // range the double is already exact and renders as it always has.
      if (value.rational !== undefined && value.rational.d === 1n && !Number.isSafeInteger(value.value as number)) {
        // Compact is a display rounding, so an exact integer takes it as a double does.
        const compact = value.decimalPlaces === undefined ? compactText(value.value as number, us) : undefined;
        if (compact !== undefined) return `${locale.display.resultPrefix}${compact}`;
        return formatExactInteger(value.rational.n, locale, us, value.decimalPlaces);
      }
      return formatNumber(value.value as number, locale, us, value.decimalPlaces, value.exact);
    case ValueType.Hex:
      return formatHex(value.value as number | bigint, us, value.unit);
    case ValueType.BigInt:
      return formatBigInt(value.value as bigint);
    case ValueType.String:
      if (value.calendarName !== undefined) return formatCalendarName(value, us);
      return formatString(value.value as string);
    case ValueType.Boolean:
      return formatBoolean(value.value as boolean);
    case ValueType.Datetime:
      return formatDatetime(value.value as number, locale, us, value.zone);
    case ValueType.Uom:
      return formatUom(value.value as number, value.unit, locale, us, value.exact, value.datetimeSpan, value.decimalPlaces, value.unitLabel);
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
    case ValueType.Pending:
      // Same leak as the Error case above, one type along. pendingValue()
      // stores the dedup query key in `.value`, so the default case rendered
      // an internal key as the answer: a line awaiting a global read showed
      // "= global:total", and one awaiting a rate showed "= currency:USD:GBP".
      // No prefix, because a pending line has no answer yet and must not be
      // dressed as one. "…" is what the formatting guide already teaches a
      // host to render, so the built-in formatter agrees with the example
      // rather than contradicting it.
      return "…";
    default:
      return `= ${String(value.value)}`;
  }
}
