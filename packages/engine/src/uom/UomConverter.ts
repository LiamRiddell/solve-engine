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
import { MEASURE_KIND_NAMES, MEASURE_SYMBOLS, UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
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

  // Mixed: one side is in the base table and the other is extended. That used
  // to be refused outright, on the grounds that the two measure spaces are
  // disjoint. They are not, once an extended unit names a measure the base
  // table also has: `furlong` is a length and so is `m`, and the ratio between
  // them is exactly what both tables already record.
  return bridgesToBaseMeasure(from, to) || bridgesToBaseMeasure(to, from);
}

/**
 * Whether `extendedUnit` extends a measure the base table also knows, so a
 * value in it can reach `baseUnit`.
 *
 * The bridge works because both tables express a unit as a ratio to the same
 * physical base: the generated table's length ratios are metres and its mass
 * ratios are grams, and an extended unit declaring `measure: "length"` states
 * its `toBase` in the same metres. Composing the two ratios is then ordinary
 * arithmetic rather than a second conversion system.
 *
 * A measure the base table has no concept of, such as pace, still fails here,
 * which is the behaviour this replaced and the reason the check is by measure
 * name rather than by presence in the extended table.
 */
function bridgesToBaseMeasure(extendedUnit: string, baseUnit: string): boolean {
  const extended = EXTENDED_UNITS[extendedUnit];
  if (extended === undefined) return false;

  const base = lookupUnit(resolveUnit(baseUnit));
  if (base === undefined) return false;

  return MEASURE_KIND_NAMES[base[0]] === extended.measure;
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
  // ratio scale (no Temperature-style offset), so the ratio itself is safe.
  //
  // The measures still have to match, and this is the one place that used to
  // forget it. `mpg` is distance over volume and `l100km` is volume over
  // distance, so they are different measures and `canConvert` says false, but
  // both are extended units, so this branch happily multiplied their ratios
  // and answered 1,488 for 35 mpg. A number with no meaning is worse than a
  // refusal: a first version of the travel package's trip arithmetic was built
  // on that one and had a 300-mile drive burning seven thousand litres.
  // Reciprocal pairs like those two are what `convertRate` is for.
  const fExt = EXTENDED_UNITS[from];
  const tExt = EXTENDED_UNITS[to];
  if (fExt !== undefined && tExt !== undefined) {
    if (fExt.measure !== tExt.measure) {
      throw new RangeError(`Cannot convert between different measures: ${from} and ${to}`);
    }
    return value * (fExt.toBase / tExt.toBase);
  }

  // One side extended, the other in the base table, sharing a measure. Convert
  // through the measure's base unit, which both tables state their ratios
  // against: an extended length declares its `toBase` in metres, and the
  // generated table's length ratios are metres too.
  if (fExt !== undefined && bridgesToBaseMeasure(from, to)) {
    return convertRaw(value * fExt.toBase, baseUnitFor(to), to);
  }
  if (tExt !== undefined && bridgesToBaseMeasure(to, from)) {
    return convertRaw(value, from, baseUnitFor(from)) / tExt.toBase;
  }

  // Offsets, cross-measure rejection and the unknown-unit throw all live in
  // convertRaw. Nothing is layered on top here any more.
  return convertRaw(value, from, to);
}

/**
 * The unit a measure states its ratios against, found from any unit in it.
 *
 * Read out of the table rather than hard-coded, so it cannot drift from the
 * ratios it has to agree with: the base is whichever unit of that measure has
 * a ratio of exactly one.
 */
function baseUnitFor(unit: string): string {
  const entry = lookupUnit(resolveUnit(unit));
  if (entry === undefined) return unit;

  for (const symbol of Object.keys(UNIT_TABLE)) {
    const candidate = UNIT_TABLE[symbol];
    if (candidate[0] === entry[0] && candidate[1] === 1) return symbol;
  }
  return unit;
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

// ── Rate and derived-unit conversion ───────────────────────────────────────
//
// A rate value carries a compound unit spelled "numerator/denominator" (e.g.
// "km/h", "m/s"), see vm/Value.ts's rateValue(). Plain convertUnit() cannot
// touch one, because neither half is the whole unit and getMeasure("km/h") is
// undefined. This section converts a rate to another rate, and bridges a rate
// to the single-token speed spellings (mph, kph, mps, ...) that ExtendedUnits.ts
// already carries, so "100 km/h in mph" and "60 mph in km/h" resolve instead of
// reporting incompatible units.

/** A rate reduced to a numerator unit over a denominator unit. */
interface RateForm {
  /** Magnitude, scaled so `value numerator/denominator` is the physical quantity. */
  value: number;
  /** Numerator unit spelling, or `""` for a countless rate such as `30/week`. */
  numerator: string;
  /** Denominator unit spelling. */
  denominator: string;
}

/**
 * Express `value unit` as a numerator/denominator rate, or `null` when `unit`
 * is neither a compound rate spelling nor a single-token speed alias.
 *
 * A speed alias (mph, kph, ...) is one unit standing for a length/time rate, so
 * it expands to the base pair `m`/`s` with its value scaled by the alias's
 * metres-per-second factor. That collapses both inputs to one shape, so a
 * single routine handles rate/rate and rate/alias without a second code path.
 */
/**
 * The single-token fuel-economy units, each as the `numerator/denominator` rate
 * it stands for and the factor that turns one of it into that rate's base. `mpg`
 * is `km/l` scaled, `l/100km` is `l/km` scaled by a hundredth (issue #190).
 */
const FUEL_RATE_UNITS: Record<string, { numerator: string; denominator: string; factor: number }> = {
  mpg: { numerator: "km", denominator: "l", factor: 1.609344 / 3.785411784 },
  kmpl: { numerator: "km", denominator: "l", factor: 1 },
  l100km: { numerator: "l", denominator: "km", factor: 0.01 },
};

function expandUnitToRate(value: number, unit: string): RateForm | null {
  const fuel = FUEL_RATE_UNITS[unit];
  if (fuel !== undefined) {
    return { value: value * fuel.factor, numerator: fuel.numerator, denominator: fuel.denominator };
  }
  const slash = unit.indexOf("/");
  if (slash >= 0) {
    return { value, numerator: unit.slice(0, slash), denominator: unit.slice(slash + 1) };
  }
  const ext = EXTENDED_UNITS[unit];
  if (ext !== undefined && ext.measure === "speed") {
    // 1 alias == ext.toBase m/s, so `value alias` is `value * toBase` m/s.
    return { value: value * ext.toBase, numerator: "m", denominator: "s" };
  }
  if (ext !== undefined && ext.measure === "dataRate") {
    // 1 alias == ext.toBase bits/s, so `value alias` is `value * toBase` b/s.
    return { value: value * ext.toBase, numerator: "b", denominator: "s" };
  }
  return null;
}

/**
 * Whether `unit` is a *physical* rate over time, one whose numerator is a length
 * or a data size, so `<quantity> at <unit>` means dividing that quantity by the
 * rate to get a duration: `250 miles at 60 mph`, `4 GB at 50 Mbps`.
 *
 * Deliberately NOT true for a price rate like `$/hour`: those are handled by the
 * existing at-rate builtin, which multiplies or divides against the currency,
 * and must keep their own answer (`$500 at $20/hour` is `25 hours`, formatted
 * that way). The numerator-measure check is what tells the two apart.
 */
export function isPhysicalTimeRate(unit: string | undefined): boolean {
  if (unit === undefined) return false;
  const rate = expandUnitToRate(1, unit);
  if (rate === null || getMeasure(rate.denominator) !== "time") return false;
  const numeratorMeasure = getMeasure(rate.numerator);
  return numeratorMeasure === "length" || numeratorMeasure === "data";
}

/**
 * `<quantity> at <rate>` where `rate` is a {@link isPhysicalTimeRate}, in
 * seconds. The quantity's measure must match the rate's numerator (a distance at
 * a speed, a data size at a bandwidth); otherwise the pair does not line up and
 * this returns null for the caller to report.
 */
export function quantityAtRateSeconds(
  quantity: number,
  quantityUnit: string,
  rateValue: number,
  rateUnit: string,
): number | null {
  const rate = expandUnitToRate(rateValue, rateUnit);
  if (rate === null || getMeasure(rate.denominator) !== "time") return null;
  if (getMeasure(quantityUnit) !== getMeasure(rate.numerator)) return null;
  const quantityInNumerator = convertUnit(quantity, quantityUnit, rate.numerator);
  const timeInDenominator = quantityInNumerator / rate.value;
  return convertUnit(timeInDenominator, rate.denominator, "s");
}

/**
 * The factor that turns one `from` into `to` along a single rate axis, or
 * `null` when the two cannot line up.
 *
 * Same spelling needs no conversion. A countless axis (`""`) only lines up with
 * another countless one, never with a real unit. Otherwise both sides must name
 * the same measure, which is what keeps a length numerator from pairing with a
 * mass one.
 */
function rateAxisFactor(from: string, to: string): number | null {
  if (from === to) return 1;
  if (from === "" || to === "") return null;
  const fromMeasure = getMeasure(from);
  const toMeasure = getMeasure(to);
  if (fromMeasure === undefined || toMeasure === undefined || fromMeasure !== toMeasure) {
    return null;
  }
  return convertUnit(1, from, to);
}

/**
 * Convert `value` from a rate/speed unit `from` to a rate/speed unit `to`,
 * returning the converted magnitude, or `null` when the pair is not
 * rate-convertible (so the caller falls back to its own incompatible-units
 * handling).
 *
 * Handles rate to rate (`10 m/s in km/h`), rate to speed alias
 * (`100 km/h in mph`) and speed alias to rate (`60 mph in km/h`). Plain
 * same-measure pairs (`kph in mph`, `km in miles`) never reach here, they are
 * resolved by {@link convertUnit} first.
 *
 * The rule is the ordinary one for a quotient of quantities: convert the
 * numerator and the denominator each on their own, so `A/B -> C/D` scales by
 * `(A->C) / (B->D)`.
 */
export function convertRate(value: number, from: string, to: string): number | null {
  const source = expandUnitToRate(value, from);
  if (source === null) return null;

  // The target is either a rate spelling or a single-token speed alias. An
  // alias expands to the base m/s pair, and `targetScale` is what the base-form
  // magnitude is divided by to read out in the alias itself.
  let targetNumerator: string;
  let targetDenominator: string;
  let targetScale: number;
  const fuelTarget = FUEL_RATE_UNITS[to];
  const slash = to.indexOf("/");
  if (fuelTarget !== undefined) {
    // The base-pair magnitude divided by the fuel unit's own factor reads out in
    // that unit (so a l/km magnitude becomes a l/100km figure).
    targetNumerator = fuelTarget.numerator;
    targetDenominator = fuelTarget.denominator;
    targetScale = fuelTarget.factor;
  } else if (slash >= 0) {
    targetNumerator = to.slice(0, slash);
    targetDenominator = to.slice(slash + 1);
    targetScale = 1;
  } else {
    const ext = EXTENDED_UNITS[to];
    if (ext === undefined || ext.measure !== "speed") return null;
    targetNumerator = "m";
    targetDenominator = "s";
    targetScale = ext.toBase;
  }

  const numeratorFactor = rateAxisFactor(source.numerator, targetNumerator);
  const denominatorFactor = rateAxisFactor(source.denominator, targetDenominator);
  if (numeratorFactor !== null && denominatorFactor !== null) {
    return (source.value * numeratorFactor) / denominatorFactor / targetScale;
  }

  // A reciprocal pairing: distance-per-volume against volume-per-distance, the
  // fuel-economy case (miles per gallon to litres per kilometre). The two rates
  // measure the same thing upside down, so the source's numerator lines up with
  // the target's denominator and its denominator with the target's numerator,
  // and the magnitude is inverted. `40 miles/gallon` becomes `0.0588 l/km`:
  // one over forty, scaled gallon-to-litre over mile-to-kilometre. See issue
  // #190; this is why fuel economy needs its own route and is not a rescale of
  // each axis like `mph` to `km/h`.
  const crossNumerator = rateAxisFactor(source.denominator, targetNumerator);
  const crossDenominator = rateAxisFactor(source.numerator, targetDenominator);
  if (crossNumerator !== null && crossDenominator !== null && source.value !== 0) {
    return (crossNumerator / crossDenominator / source.value) / targetScale;
  }

  return null;
}
