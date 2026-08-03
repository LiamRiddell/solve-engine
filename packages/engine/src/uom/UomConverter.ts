/**
 * UoM Converter, built on the in-house unit tables in `UnitConversion.ts` and
 * `generated/UnitTable.generated.ts` (ported from the `convert` npm package
 * v7.0.2 so the engine ships with no runtime dependencies).
 *
 * Units are strictly case-sensitive and are looked up without aliasing. No unit
 * remapping, what you type is what you get.
 * e.g. 'C' = Celsius, 'c' = cup; 'MB' = megabytes, 'mb' = millibits.
 *
 * This file owns everything the base tables do not: the workday shim, the
 * extended (custom-measure) units, and the two caches.
 */

import { lookupUnit, convertRaw, convertResolved, convertToBestMetric } from "@solve-js/uom/UnitConversion";
import { MEASURE_KIND_NAMES, MEASURE_SYMBOLS } from "@solve-js/uom/generated/UnitTable.generated";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";

// ── "workday", a synthetic unit with no entry in the base table ───────────
//
// A business day (Mon-Fri) backing the datetime package's `<date> + N
// workdays` arithmetic and `$X/workday` Rate literals
// (packages/datetime/). NOT a real physical unit, a business day has no
// fixed duration, since it depends on which calendar dates are weekends
// so the ported base table has no concept of it and can't be
// taught one without monkey-patching its internal unit table.
//
// For RATE-MATH purposes only (e.g. "$500/workday x 4 weeks" needs a
// workday count to multiply by), a workday is treated as a FIXED 7/5 of a
// calendar day: 5 workdays span exactly 7 calendar days in a whole week,
// so this ratio is exact for whole-week spans and a reasonable linear
// approximation otherwise. This is deliberately NOT the same
// calendar-aware, weekend-skipping logic real "<date> + N workdays" date
// arithmetic needs (see vm/VM.ts's addBusinessDays()), that can't be
// reduced to a fixed ratio, since the exact skip pattern depends on which
// day of the week the calculation actually starts from.
//
// Handled here as a thin pre/post layer in front of the normal
// base-table path (rather than inside the tables themselves) so every
// caller of getMeasure()/convertUnit()/canConvert() automatically gets
// workday support for free.
const WORKDAY_UNIT_NAMES = new Set(["workday", "workdays"]);
const WORKDAY_TO_DAY_FACTOR = 7 / 5; // 1 workday == 1.4 calendar days

/** Whether `unit` is the synthetic "workday" unit (see module note above). */
export function isWorkdayUnit(unit: string | undefined): unit is string {
  return typeof unit === "string" && WORKDAY_UNIT_NAMES.has(unit);
}

/**
 * Validate `unit` against the known unit table.
 *
 * @returns `unit` unchanged in all cases. This does NOT normalize casing
 *   or aliasing (units are strictly case-sensitive, see the module note
 *   above). A unit the table doesn't recognize is still
 *   returned as-is (not thrown), so callers must not assume a returned
 *   string is actually convertible, check with {@link isConvertibleUnit}
 *   or {@link canConvert} first if that matters.
 *
 * Kept as an identity function purely for API compatibility. It used to guard
 * a validity cache, which existed because validating a unit meant a
 * throw/catch round trip through the old dependency. Validation is now a Map
 * lookup, so the cache cost more than it saved: worse, it was capped at 1000
 * entries against a 1456-unit table, so any sweep over the full vocabulary
 * (which is exactly what LanguageService does to build completions) evicted
 * on almost every call. That one change took the full-table sweep from 7.7ms
 * to under 20us.
 */
export function resolveUnit(unit: string): string {
  return unit;
}

// MEASURE_KIND_NAMES now comes from the generated table (it is derived data,
// so the generator emits it rather than it being retyped here). The reason it
// is a module-level constant has not changed: getMeasure() runs at least twice
// per conversion, and this used to be reallocated on every call.

/**
 * Get the measure/dimension kind for `unit` (e.g. `"length"`, `"mass"`,
 * `"temperature"`), used to check whether two units are even in the same
 * dimension before attempting a conversion.
 *
 * @returns `undefined` if `unit` isn't recognized, rather than throwing.
 */
export function getMeasure(unit: string): string | undefined {
  // Workday is a Time-measure unit by convention (see isWorkdayUnit's doc
  // comment) and is not in the base table, so resolve its measure via "day"
  // instead of attempting the real lookup below.
  if (isWorkdayUnit(unit)) return getMeasure("day");

  // Extended (custom) categories the base table has no measure kind for,
  // see ExtendedUnits.ts.
  const extended = EXTENDED_UNITS[unit];
  if (extended) return extended.measure;

  const entry = lookupUnit(unit);
  if (entry === undefined) return undefined;

  return MEASURE_KIND_NAMES[entry[0]];
}

/**
 * Check whether `from` can be converted to `to`. Same unit, or same
 * measure kind (length, mass, ...) and the underlying tables accept the pair.
 * Never throws; returns `false` on any failure.
 */
export function canConvert(from: string, to: string): boolean {
  if (from === to) return true;
  if (isWorkdayUnit(from) || isWorkdayUnit(to)) {
    const fromMeasure = getMeasure(from);
    const toMeasure = getMeasure(to);
    return !!fromMeasure && fromMeasure === toMeasure;
  }
  // One table read per side, comparing numeric kind ids. The old shape called
  // getMeasure() on each side (two more reads) purely to compare the resulting
  // STRINGS, then did a throwaway conversion to confirm what the kind check had
  // already established.
  const fromEntry = lookupUnit(from);
  const toEntry = lookupUnit(to);
  if (fromEntry !== undefined && toEntry !== undefined) {
    return fromEntry[0] === toEntry[0];
  }

  // Extended (custom) categories aren't in the base table at all, so they are
  // compared on their own measure names instead.
  const fromExtended = EXTENDED_UNITS[from];
  const toExtended = EXTENDED_UNITS[to];
  if (fromExtended !== undefined && toExtended !== undefined) {
    return fromExtended.measure === toExtended.measure;
  }

  // Mixed: one side is a base unit and the other is extended or unknown. The
  // measure spaces are disjoint by construction, so this can never convert.
  return false;
}

/**
 * Convert `value` from unit `from` to unit `to`.
 *
 * Does not validate that the conversion is possible, callers should check
 * with {@link canConvert} first if `from`/`to` aren't already known-good.
 *
 * THROWS a RangeError for an unknown unit or a cross-measure pair. `VM.ts`'s
 * `extractDurationMs()` depends on that, see {@link convertRaw}.
 *
 * This used to memoize a per-pair conversion factor in an LFU cache. The cache
 * is gone: computing the factor is now two Map reads, while the cache cost a
 * template-string key allocation on every call plus the LFU's own frequency
 * bookkeeping, so it was slower than the work it avoided. Removing it is
 * bit-exact, not merely close: the cache stored `convertRaw(1, f, t)`, which is
 * exactly `fromRatio / toRatio`, and then multiplied, which is the identical
 * expression `convertRaw(value, f, t)` evaluates. It also deleted the special
 * case that existed only to keep offset-based temperature pairs out of a
 * factor cache.
 */
export function convertUnit(value: number, from: string, to: string): number {
  if (from === to) return value;

  // Fast path first: two ordinary units, which is nearly every call. Resolving
  // both here and handing the entries to convertResolved() avoids looking them
  // up again inside convertRaw(). Neither workdays nor extended units appear in
  // the base table, so they always fall through to the branches below and this
  // ordering cannot steal a case from them. UnitVocabulary.spec.ts pins that
  // the two vocabularies stay disjoint.
  const fromEntry = lookupUnit(from);
  const toEntry = lookupUnit(to);
  if (fromEntry !== undefined && toEntry !== undefined) {
    return convertResolved(value, from, to, fromEntry, toEntry);
  }

  // Workday <-> any other Time-measure unit: pivot through "day" using the
  // fixed 7/5 ratio (see isWorkdayUnit's doc comment above).
  if (isWorkdayUnit(from) && isWorkdayUnit(to)) return value; // "workday" <-> "workdays" alias
  if (isWorkdayUnit(from)) {
    const days = value * WORKDAY_TO_DAY_FACTOR;
    return to === "day" ? days : convertUnit(days, "day", to);
  }
  if (isWorkdayUnit(to)) {
    const days = from === "day" ? value : convertUnit(value, from, "day");
    return days / WORKDAY_TO_DAY_FACTOR;
  }

  // Extended (custom) categories the base table has no measure kind for
  // (see ExtendedUnits.ts), compute the ratio directly from each unit's
  // factor-to-base value instead of calling convertRaw(), which would throw
  // on an unrecognized unit string. Every extended category is a pure linear
  // ratio scale (no Temperature-style offset), so this is always safe.
  const fExt = EXTENDED_UNITS[from];
  const tExt = EXTENDED_UNITS[to];
  if (fExt !== undefined && tExt !== undefined) {
    return value * (fExt.toBase / tExt.toBase);
  }

  // Offsets, cross-measure rejection and the unknown-unit throw all live in
  // convertRaw. Nothing is layered on top here any more.
  return convertRaw(value, from, to);
}

/**
 * List every unit symbol in the same measure/dimension as `unit` (wiki:
 * Units-Of-Measurement, "Conversion Possibilities", `sourceUnit to ?`
 * e.g. `cm to ?"` → every Length unit). Excludes `unit` itself.
 *
 * Reads MEASURE_SYMBOLS, which is a curated symbols-only vocabulary and
 * deliberately NOT the keys of the unit table filtered by kind. The two
 * differ: Volume's symbols include `c` and `pt` but not `cup`/`cups`, and
 * Time's include `wk` and `mo` but not `week`/`month`. Deriving this list
 * from the unit table instead would roughly quadruple every answer.
 *
 * @returns `[]` if `unit` isn't recognized, rather than throwing.
 */
export function getConvertiblePossibilities(unit: string): string[] {
  const resolved = resolveUnit(unit);
  const entry = lookupUnit(resolved);
  if (entry === undefined) return [];
  const symbols = MEASURE_SYMBOLS[entry[0]];
  if (!symbols) return [];
  return symbols.filter((s) => s !== resolved);
}

/** Check whether `unit` is a unit the conversion tables recognize. Never throws. */
export function isConvertibleUnit(unit: string): boolean {
  if (isWorkdayUnit(unit)) return true;
  if (EXTENDED_UNITS[unit]) return true;
  return lookupUnit(resolveUnit(unit)) !== undefined;
}

/**
 * Convert `value` (in `unit`) to whichever unit of the same measure gives
 * the most human-readable magnitude, e.g. 1500 metres becomes 1.5 km. Falls
 * back to returning `value`/`unit` unchanged if `unit` isn't recognized,
 * which is what every extended unit and workday does.
 *
 * Note the chosen unit is drawn from the best-unit lists, which are not
 * restricted to spellings the lexer accepts: 0.5 l reports "mL".
 */
export function getBestUnit(value: number, unit: string): { value: number; unit: string } {
  const u = resolveUnit(unit);
  try {
    const result = convertToBestMetric(value, u);
    return { value: result.quantity, unit: result.unit };
  } catch {
    return { value, unit: u };
  }
}
