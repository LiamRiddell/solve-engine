/**
 * The unit conversion algorithm, ported from the `convert` npm package v7.0.2
 * alongside its tables (see `generated/UnitTable.generated.ts` and
 * THIRD-PARTY-NOTICES.md).
 *
 * Transliterated expression for expression rather than rewritten. Floating
 * point is not associative, so `(q + d) * (a / b) - d2` and any algebraically
 * equal rearrangement disagree in the last bits. Those bits are observable:
 * `0.5 l` best-converts to `500.00000000000006 mL` today, and the test suite
 * pins several conversions to ten decimal places.
 *
 * This module is deliberately unaware of the engine's own additions. Workdays,
 * extended units, currency and the caches all live in `UomConverter.ts`, which
 * layers them on top of these three functions.
 */

import {
  UNIT_TABLE,
  UNIT_DIFFERENCES,
  BEST_UNITS_METRIC,
  type UnitEntry,
} from "./generated/UnitTable.generated";

/**
 * The generated tables re-keyed into Maps once at module load.
 *
 * Not a micro-optimization. A 1456-key object literal lands in V8's dictionary
 * mode, and guarding a read on it against inherited names (`constructor`,
 * `toString`) costs about 123ns per call with either `hasOwnProperty.call` or
 * `Object.hasOwn`, measured. `Map.get` is about 6ns and needs no guard at all,
 * because a Map has no prototype chain to fall through to. That is a 20x
 * difference on the single hottest operation in the unit system: `convertRaw`
 * performs two of these per call, and `LanguageService` sweeps all 1456 keys
 * to build completions.
 */
const UNIT_LOOKUP: ReadonlyMap<string, UnitEntry> = new Map(Object.entries(UNIT_TABLE));

/**
 * Temperature offsets, as a Map for the same reason.
 *
 * Also removes a latent hazard: the upstream code tests membership with `in`,
 * and `"toString" in UNIT_DIFFERENCES` is true, so an inherited name reaching
 * that branch would add a function to a number.
 */
const DIFFERENCE_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(UNIT_DIFFERENCES));

/**
 * Looks up a unit spelling.
 *
 * @returns its `[kind, ratio]` entry, or `undefined` if the spelling is not a
 * unit. Case-sensitive: no normalization or aliasing happens anywhere in this
 * module.
 *
 * The one deliberate deviation from upstream. `convert` tests membership with
 * `in` and reads the property directly, so inherited names like "constructor"
 * and "toString" reach its measure comparison and fail there with "Cannot
 * convert between different measures" instead of "is not a valid unit". Both
 * throw a RangeError and both report no measure, so nothing downstream can
 * tell the difference, and naming the real problem is the better message.
 */
export function lookupUnit(unit: string): UnitEntry | undefined {
  return UNIT_LOOKUP.get(unit);
}

/**
 * Converts `quantity` from one unit to another.
 *
 * THROWS a `RangeError` for an unknown unit or a pair in different measures.
 * Callers depend on that: `VM.ts`'s `extractDurationMs()` calls this with an
 * arbitrary unit inside a bare try/catch and treats the throw as "not a
 * duration, contribute zero". Returning NaN or the input unchanged instead
 * would turn `<date> + 5 kg` into an Invalid Date rather than a no-op.
 */
export function convertRaw(quantity: number, from: string, to: string): number {
  const parsedFrom = UNIT_LOOKUP.get(from);
  if (parsedFrom === undefined) {
    throw new RangeError(`${from} is not a valid unit`);
  }

  const parsedTo = UNIT_LOOKUP.get(to);
  if (parsedTo === undefined) {
    throw new RangeError(`${to} is not a valid unit`);
  }

  return convertResolved(quantity, from, to, parsedFrom, parsedTo);
}

/**
 * The conversion arithmetic, for callers that have already looked both units
 * up and want to skip doing it twice.
 *
 * Split out for `UomConverter.convertUnit()`, which has to check whether
 * either side is a workday or an extended unit before it can dispatch, and
 * would otherwise resolve each unit once to decide and again to convert. The
 * entries MUST be the ones this module returned for these exact spellings.
 */
export function convertResolved(
  quantity: number,
  from: string,
  to: string,
  fromEntry: UnitEntry,
  toEntry: UnitEntry
): number {
  const parsedFrom = fromEntry;
  const parsedTo = toEntry;

  if (parsedFrom[0] !== parsedTo[0]) {
    // DELIBERATE DEVIATION from the ported original, which silently reinterpreted
    // "m" as minutes whenever the other side was a time unit. That is a guess,
    // and this project's stated position is that refusing to guess is the safer
    // default for a tool doing arithmetic on someone's real numbers (see
    // docs/architecture/design-decisions.md). The guess was not harmless: it
    // reached `<date> + <duration>` through VM.ts's extractDurationMs(), where
    // `today + 5 m` silently added five MINUTES for someone who wrote metres.
    //
    // Minutes are spelled "min", "minute" or "minutes", all of which the table
    // has always accepted.
    throw new RangeError(`Cannot convert between different measures: ${from} and ${to}`);
  }

  const fromRatio = parsedFrom[1];
  const toRatio = parsedTo[1];

  // Only six units in the whole table carry an offset, so the common path is
  // both misses. Reading the Map once per side and reusing the value beats
  // testing membership and then reading it again.
  const fromDifference = DIFFERENCE_LOOKUP.get(from);
  const toDifference = DIFFERENCE_LOOKUP.get(to);

  // Scales that do not share an origin (temperature) need the offset applied
  // around the ratio. Do not refactor the four branches into one expression:
  // the grouping is what makes the result bit-identical to the original.
  if (fromDifference !== undefined) {
    if (toDifference !== undefined) {
      return (quantity + fromDifference) * (fromRatio / toRatio) - toDifference;
    }
    return (quantity + fromDifference) * (fromRatio / toRatio);
  }

  if (toDifference !== undefined) {
    return quantity * (fromRatio / toRatio) - toDifference;
  }

  return quantity * (fromRatio / toRatio);
}

/**
 * Picks the most readable metric unit for a magnitude and converts to it.
 *
 * Only the metric lists are ported; nothing has ever requested the imperial
 * ones. Note the final conversion goes from the ORIGINAL unit to the chosen
 * one directly rather than via the smallest unit, which is what keeps the
 * result exact.
 */
export function convertToBestMetric(
  quantity: number,
  from: string
): { quantity: number; unit: string } {
  const parsedFrom = UNIT_LOOKUP.get(from);
  if (parsedFrom === undefined) {
    throw new RangeError(`${from} is not a valid unit`);
  }

  const best = BEST_UNITS_METRIC[parsedFrom[0]];
  const smallestUnit = best[0][0];
  let bestUnit = smallestUnit;

  const baseQuantity = convertRaw(quantity, from, smallestUnit);
  const absQuantity = baseQuantity < 0 ? -baseQuantity : baseQuantity;

  // Thresholds are expressed in the smallest unit and ascend, so the last one
  // the magnitude reaches wins. Breaking early rather than scanning the whole
  // list matters for zero and for negatives, which stay on the smallest unit.
  for (let i = 0; i < best.length; i++) {
    const bestEntry = best[i];
    if (absQuantity >= bestEntry[1]) {
      bestUnit = bestEntry[0];
    } else {
      break;
    }
  }

  return { quantity: convertRaw(quantity, from, bestUnit), unit: bestUnit };
}
