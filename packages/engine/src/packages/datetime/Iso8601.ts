/**
 * ISO8601 string <-> epoch-ms helpers backing the datetime package's
 * `<ISO8601 string> to date` and `<date/time> as iso8601` features.
 *
 * SCOPE, revised in 1.0.0: {@link parseIso8601} is now reached by BOTH input
 * shapes. A quoted string literal (`"2019-04-01T15:30:00+11:00" to date`)
 * always came here; the bare, unquoted form now does too, fused into one
 * DATETIME_LITERAL by `normalizer/DateLiteralNormalizerRule.ts` before the
 * parser sees it.
 *
 * This file used to record that the bare form was out of scope because it is
 * ambiguous with arithmetic (`2019 - 04 - 01` reads as two subtractions) and
 * would need a dedicated lexer change. The date half of that ambiguity was
 * already settled by the normalizer rule, and the differential run against
 * 1.0.0-beta.6 showed what leaving the other half cost: a bare
 * `2019-04-01T15:30:00+11:00` read its `+11:00` as a clock time being ADDED to
 * the date, and answered TODAY at 11:00. Not the instant, not an error, and
 * formatted as a date, which is the most convincing way to be wrong. The two
 * spellings now answer identically, which is the only defensible arrangement
 * when one of them was always right.
 */

/**
 * Matches a (reasonably) well-formed ISO8601 date or date-time string:
 * `YYYY-MM-DD` optionally followed by `THH:MM[:SS[.fff]][Z|+HH:MM|-HH:MM]`.
 * Deliberately stricter than the native `Date` constructor's very lenient
 * parsing (which also accepts things like `"April 1, 2019"`), only a
 * string actually ISO8601-shaped is accepted here, so `"not a date" to
 * date` fails loudly instead of silently parsing as `Invalid Date` (or,
 * worse, something the native parser guesses at).
 */
const ISO8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Parse an ISO8601-shaped string into epoch milliseconds.
 *
 * Delegates the actual parsing to the native `Date` constructor, which
 * fully implements the ISO8601 extended format (including "Z"/"+HH:MM"
 * offsets and a fractional-seconds component) per the ECMA-262 Date Time
 * String Format spec, no custom parsing logic needed, just a stricter
 * shape gate in front of it (see {@link ISO8601_PATTERN}'s doc comment).
 *
 * A date-only string (`"2019-04-01"`) parses as UTC midnight; a date-time
 * with no offset and no "Z" (`"2019-04-01T15:30:00"`) parses in the HOST
 * SYSTEM's local timezone, both are the native `Date` constructor's own
 * spec-mandated behavior, not something this function adds.
 *
 * @returns epoch ms, or `null` if `s` isn't ISO8601-shaped or doesn't
 *   parse to a valid instant.
 */
export function parseIso8601(s: string): number | null {
  // A `ValueType.String` Value's `.value` used to retain its original
  // surrounding double-quotes, because `tokenizeString()` set the token's
  // value to the raw source slice and `OpCode.PUSH_STRING` pushed that
  // verbatim. It no longer does: the token's `value` is the payload and its
  // `text` is the quoted slice. The strip below stays because this function
  // is also reachable with text that came from somewhere other than a
  // literal, and stripping a pair that is not there is a no-op.
  let trimmed = s.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(1, -1);
  }
  if (!ISO8601_PATTERN.test(trimmed)) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Format epoch milliseconds as an ISO8601 string with an explicit
 * `+HH:MM`/`-HH:MM` offset, e.g. `"2019-04-01T15:30:00+11:00"`.
 *
 * DESIGN NOTE: uses the HOST SYSTEM's local timezone offset for the
 * offset component. This engine's `Datetime` representation is a bare
 * epoch-ms number with no zone tag (see `packages/time/TimePackage.ts`'s
 * doc comment for the same limitation affecting timezone conversion), so
 * there is no per-expression timezone context to draw on otherwise, the
 * process's own local offset (`Date.getTimezoneOffset()`) is the only
 * notion of "local" available. No milliseconds component is emitted,
 * matching the precision of the task's own worked example.
 */
export function formatIso8601Local(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  // getTimezoneOffset() is (UTC - local) in minutes, i.e. the SIGN is
  // inverted relative to a "+HH:MM ahead of UTC" display offset.
  const offsetMinutesTotal = -d.getTimezoneOffset();
  const sign = offsetMinutesTotal >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutesTotal);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMinutes = pad(absOffset % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
}

/**
 * Magnitude threshold distinguishing a millisecond Unix timestamp from a
 * second Unix timestamp: values at or above this are treated as
 * milliseconds, below it as seconds.
 *
 * Chosen so that "now" in EITHER unit sits comfortably on its own side:
 * seconds-since-epoch for the foreseeable future stays in the ~1.7-2.5
 * billion range (1e9-1e10-ish), nowhere near 1e12, while the SAME
 * instant in milliseconds is ~1000x larger, comfortably past 1e12
 * (e.g. "2024-12-10" is ~1.73e9 seconds or ~1.73e12 ms). 1e12 sits well
 * clear of both real-world ranges for at least the next few centuries of
 * second-timestamps, so this is a safe, simple magnitude gate rather than
 * a fragile exact boundary.
 */
const MS_TIMESTAMP_THRESHOLD = 1e12;

/**
 * Interpret a bare numeric Unix timestamp as epoch milliseconds, applying
 * the magnitude-based seconds-vs-milliseconds disambiguation described by
 * {@link MS_TIMESTAMP_THRESHOLD}.
 */
export function unixTimestampToEpochMs(n: number): number {
  return Math.abs(n) >= MS_TIMESTAMP_THRESHOLD ? n : n * 1000;
}
