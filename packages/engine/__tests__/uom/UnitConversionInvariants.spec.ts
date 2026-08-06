/**
 * The invariants the optimized unit-conversion path depends on.
 *
 * Unlike ConvertParity.spec.ts, which proves the tables were ported correctly
 * and is deleted once `convert` is uninstalled, this file is permanent. Each
 * test here guards a specific shortcut the fast path takes, so that removing
 * or breaking the precondition fails loudly rather than silently returning a
 * plausible wrong number.
 *
 * The shortcuts, and what would break them:
 * - convertUnit() resolves both units up front and dispatches on the base
 *   table BEFORE checking workdays and extended units. Only safe while the
 *   vocabularies are disjoint.
 * - canConvert() compares numeric measure kinds instead of measure-name
 *   strings, and no longer performs a throwaway conversion to confirm.
 * - convertUnit() no longer memoizes a conversion factor, so the first and
 *   every subsequent call take the identical arithmetic path.
 * - lookupUnit() reads a Map, so inherited property names cannot resolve.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";
import { lookupUnit, convertRaw, convertResolved, convertToBestMetric } from "@solve-js/uom/UnitConversion";
import { UNIT_TABLE, MEASURE_KIND_NAMES } from "@solve-js/uom/generated/UnitTable.generated";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";
import { canConvert, convertUnit, getMeasure, isWorkdayUnit, resolveUnit } from "@solve-js/uom/UomConverter";

const ALL_UNITS = Object.keys(UNIT_TABLE);
const EXTENDED_NAMES = Object.keys(EXTENDED_UNITS);
const WORKDAY_NAMES = ["workday", "workdays"];

describe("unit vocabularies stay disjoint", () => {
  test("no extended unit is also in the base table", () => {
    // convertUnit() dispatches on the base table first. An extended unit that
    // also appeared there would silently take the wrong ratio.
    const overlap = EXTENDED_NAMES.filter((unit) => lookupUnit(unit) !== undefined);
    expect(overlap).toEqual([]);
  });

  test("workday is not in the base table either", () => {
    for (const name of WORKDAY_NAMES) {
      expect(lookupUnit(name)).toBeUndefined();
      expect(EXTENDED_UNITS[name]).toBeUndefined();
    }
  });

  test("an extended measure that shares a base measure name actually converts", () => {
    // This test used to require the two vocabularies to name disjoint measures,
    // on the grounds that a shared name would look convertible and then fail in
    // the arithmetic. The arithmetic works now: an extended unit declaring
    // `measure: "length"` states its ratio in the same metres the base table
    // does, so the two compose. The requirement is therefore the opposite one,
    // that a shared name is honoured rather than forbidden.
    const baseMeasures = new Set(Object.values(MEASURE_KIND_NAMES));
    const shared = EXTENDED_NAMES.filter((unit) => baseMeasures.has(EXTENDED_UNITS[unit].measure));
    expect(shared.length).toBeGreaterThan(0);

    for (const unit of shared) {
      const { measure, toBase } = EXTENDED_UNITS[unit];
      // Every base table measure states its ratios against one unit, and for
      // the two shared here that unit is the metre and the gram.
      const baseUnit = measure === "length" ? "m" : "g";
      expect(getMeasure(baseUnit)).toBe(measure);
      expect(canConvert(unit, baseUnit)).toBe(true);
      expect(canConvert(baseUnit, unit)).toBe(true);
      expect(convertUnit(1, unit, baseUnit)).toBeCloseTo(toBase, 9);
      // And back, so the bridge is not one-directional.
      expect(convertUnit(toBase, baseUnit, unit)).toBeCloseTo(1, 9);
    }
  });

  test("an extended measure the base table has no concept of still cannot cross", () => {
    // The bridge is by measure name, not by being in the extended table, so
    // pace and speed remain unreachable from a length or a duration.
    expect(canConvert("min_km", "m")).toBe(false);
    expect(canConvert("mph", "km")).toBe(false);
    expect(canConvert("m", "min_km")).toBe(false);
  });
});

describe("lookupUnit cannot be fooled by inherited property names", () => {
  test.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "prototype"])(
    "%s is not a unit",
    (name) => {
      expect(lookupUnit(name)).toBeUndefined();
      expect(getMeasure(name)).toBeUndefined();
      expect(canConvert(name, "m")).toBe(false);
      expect(() => convertUnit(1, name, "m")).toThrow(RangeError);
    }
  );
});

describe("convertResolved is the same arithmetic as convertRaw", () => {
  test("agrees for every unit against its own measure's base, and for a hot sample", () => {
    const mismatches: string[] = [];
    for (const unit of ALL_UNITS) {
      const entry = lookupUnit(unit);
      if (entry === undefined) continue;
      for (const other of ["m", "kg", "s", "l", "C", "B", unit]) {
        const otherEntry = lookupUnit(other);
        if (otherEntry === undefined || otherEntry[0] !== entry[0]) continue;
        for (const value of [0, 1, -7.5, 1234.5678]) {
          const viaRaw = convertRaw(value, unit, other);
          const viaResolved = convertResolved(value, unit, other, entry, otherEntry);
          if (!Object.is(viaRaw, viaResolved)) {
            mismatches.push(`${value} ${unit} to ${other}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("canConvert agrees with comparing measures the slow way", () => {
  test("over every base unit against a representative of each measure", () => {
    const representatives = ["m", "kg", "s", "l", "C", "B", "Hz", "W", "Pa", "rad", "m2", "J", "N", "lx", "cd", "cd/m2"];
    const mismatches: string[] = [];
    for (const unit of ALL_UNITS) {
      for (const other of representatives) {
        // The reference implementation: same measure name, both recognized.
        const a = getMeasure(unit);
        const b = getMeasure(other);
        const expected = unit === other || (a !== undefined && a === b);
        if (canConvert(unit, other) !== expected) {
          mismatches.push(`${unit} to ${other}`);
          if (mismatches.length > 10) break;
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("extended units convert within their own category and nowhere else", () => {
    expect(canConvert("mph", "kph")).toBe(true);
    expect(canConvert("kV", "mV")).toBe(true);
    expect(canConvert("mph", "min_km")).toBe(false); // speed and pace are separate on purpose
    expect(canConvert("mph", "m")).toBe(false);
    expect(canConvert("m", "mph")).toBe(false);
    expect(canConvert("ppm", "ppb")).toBe(true);
  });

  test("workday compares as a time unit", () => {
    expect(canConvert("workday", "day")).toBe(true);
    expect(canConvert("workday", "workdays")).toBe(true);
    expect(canConvert("day", "workday")).toBe(true);
    expect(canConvert("workday", "kg")).toBe(false);
  });
});

describe("removing the conversion-factor cache changed nothing", () => {
  test("repeated calls return the identical double, first call included", () => {
    // The cache used to serve every call after the first from a stored factor,
    // so a first-call/later-call divergence would have been invisible.
    for (const [from, to] of [["cm", "m"], ["C", "F"], ["F", "C"], ["GiB", "GB"], ["mph", "kph"], ["workday", "day"]] as const) {
      const first = convertUnit(3.7, from, to);
      for (let i = 0; i < 5; i++) {
        expect(convertUnit(3.7, from, to)).toBe(first);
      }
    }
  });

  test("a temperature pair is not multiplicative, which is why it could never be cached", () => {
    // Guards against anyone reintroducing a factor cache without re-adding the
    // temperature bypass: if this ratio held, C to F would be a simple factor.
    const oneDegree = convertUnit(1, "C", "F");
    const twoDegrees = convertUnit(2, "C", "F");
    expect(twoDegrees).not.toBeCloseTo(oneDegree * 2, 6);
  });

  test("scaling is exact for multiplicative pairs", () => {
    // The old cache computed convertRaw(1, f, t) and multiplied. Dropping it is
    // only bit-exact because that is the same expression, so assert it.
    for (const [from, to] of [["cm", "m"], ["kg", "g"], ["GiB", "B"], ["day", "s"]] as const) {
      const unitRate = convertRaw(1, from, to);
      expect(convertUnit(12.5, from, to)).toBe(12.5 * unitRate);
    }
  });
});

describe("resolveUnit is an identity function", () => {
  test("returns its argument unchanged, recognized or not", () => {
    for (const unit of ["cm", "USD", "workday", "mph", "not-a-unit", "", "constructor"]) {
      expect(resolveUnit(unit)).toBe(unit);
    }
  });
});

describe("the throw contract VM.ts depends on", () => {
  test("convertUnit throws rather than returning NaN for a non-duration", () => {
    // extractDurationMs() catches this and contributes zero. Returning NaN here
    // turns `<date> + 5 kg` into an Invalid Date.
    for (const unit of ["kg", "l", "C", "mph", "kV", "not-a-unit"]) {
      expect(() => convertUnit(1, unit, "ms")).toThrow();
    }
  });

  test("metres are not minutes, the one deliberate deviation from the ported behaviour", () => {
    // Upstream silently reinterpreted `m` as minutes whenever the other side
    // was a time unit, which made `today + 5 m` add five MINUTES for someone
    // who wrote metres. Removed: guessing is worse than refusing.
    expect(() => convertUnit(1, "m", "ms")).toThrow(RangeError);
    expect(canConvert("m", "ms")).toBe(false);
    // Minutes have always had three unambiguous spellings.
    expect(convertUnit(1, "min", "ms")).toBe(60_000);
    expect(convertUnit(1, "minute", "ms")).toBe(60_000);
    expect(convertUnit(1, "minutes", "ms")).toBe(60_000);
  });

  test("real durations still convert to milliseconds", () => {
    expect(convertUnit(1, "s", "ms")).toBe(1000);
    expect(convertUnit(1, "day", "ms")).toBe(86_400_000);
    expect(isWorkdayUnit("workday")).toBe(true);
    expect(convertUnit(1, "workday", "day")).toBe(1.4);
  });

  test("date arithmetic ignores non-durations instead of guessing at them", () => {
    // The bug this pair of fixes exists for: `today + 5 m` used to equal
    // `today + 5 min`. Asserted through the real engine, because the damage
    // happened two layers above convertUnit.
    //
    // A fixed date literal, not `today`: `today` resolves to the current
    // instant on every evaluation, so comparing two of them races the clock.
    const engine = new ExpressionEngine("en", false);
    const base = engine.evaluateExpression("25/12/2026")[0].toNumber();

    for (const nonDuration of ["5 m", "5 kg", "5 l", "5 C", "5 mph"]) {
      const result = engine.evaluateExpression(`25/12/2026 + ${nonDuration}`)[0];
      expect(result.type).toBe(ValueType.Datetime);
      expect(Number.isNaN(result.toNumber())).toBe(false);
      expect(result.toNumber()).toBe(base);
    }

    // Real durations still move the date.
    expect(engine.evaluateExpression("25/12/2026 + 5 min")[0].toNumber()).toBe(base + 5 * 60_000);
    expect(engine.evaluateExpression("25/12/2026 + 5 minutes")[0].toNumber()).toBe(base + 5 * 60_000);
    expect(engine.evaluateExpression("25/12/2026 + 2 days")[0].toNumber()).toBe(base + 2 * 86_400_000);
  });
});

describe("best-unit selection", () => {
  test("handles zero and negatives without falling off the list", () => {
    expect(convertToBestMetric(0, "m")).toEqual({ quantity: 0, unit: "mm" });
    expect(convertToBestMetric(-5000, "g")).toEqual({ quantity: -5, unit: "kg" });
  });

  test("rejects an unknown unit rather than guessing", () => {
    expect(() => convertToBestMetric(1, "not-a-unit")).toThrow(RangeError);
  });
});
