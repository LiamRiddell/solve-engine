/**
 * Bit-exact parity between the ported unit tables and the `convert` npm package
 * they were ported from.
 *
 * TEMPORARY. `convert` stays a devDependency for one release cycle so this can
 * run; when it is uninstalled this file goes with it, and the assertions worth
 * keeping move into a fixtures spec with hardcoded numbers.
 *
 * Comparisons use Object.is, not toBeCloseTo. An epsilon would let a floating
 * point association-order slip through here and resurface somewhere unrelated:
 * the existing C-to-F test is only accurate to the nearest integer, while other
 * suites pin conversions to ten decimal places. The only way to be sure the
 * port is a no-op is to require the exact same doubles.
 */

import { describe, expect, test } from "@jest/globals";
import convert, { getMeasureKind, MeasureKind } from "convert";
import { conversions } from "convert/conversions";
import { lookupUnit, convertRaw, convertToBestMetric } from "@solve-js/uom/UnitConversion";
import { UNIT_TABLE, MEASURE_KIND_NAMES } from "@solve-js/uom/generated/UnitTable.generated";
import { getMeasure, convertUnit, getBestUnit, getConvertiblePossibilities } from "@solve-js/uom/UomConverter";

const ALL_UNITS = Object.keys(UNIT_TABLE);

/** Values chosen to exercise zero, both signs, subnormal-ish and huge magnitudes. */
const SAMPLE_QUANTITIES = [0, 1, -1, 0.1, 3.14159, 1e-9, 1e12, -273.15, Number.MAX_SAFE_INTEGER];

function upstreamConvert(quantity: number, from: string, to: string): number | Error {
  try {
    return convert(quantity, from as never).to(to as never) as unknown as number;
  } catch (error) {
    return error as Error;
  }
}

function portedConvert(quantity: number, from: string, to: string): number | Error {
  try {
    return convertRaw(quantity, from, to);
  } catch (error) {
    return error as Error;
  }
}

describe("ported unit table matches convert v7.0.2", () => {
  test("the table has every spelling upstream has, and no others", () => {
    // Sorted comparison rather than a length check: a dropped key and an
    // invented one would cancel out in a count.
    const upstreamUnits = new Set<string>();
    for (const [, entry] of conversions) {
      for (const unit of entry.units) {
        for (const name of [...unit.names, ...unit.symbols]) upstreamUnits.add(name);
      }
    }
    // The conversions table is a subset of the parse table (it omits nothing
    // reachable, but the parse table is the authority), so assert containment
    // in that direction and rely on the generator's own count check for the rest.
    const missing = [...upstreamUnits].filter((unit) => !(unit in UNIT_TABLE));
    expect(missing).toEqual([]);
  });

  // ── Sweep 1: measure identity ──

  test("every unit reports the same measure kind and the same measure name", () => {
    const mismatches: string[] = [];
    for (const unit of ALL_UNITS) {
      const portedKind = lookupUnit(unit)?.[0];
      const upstreamKind = getMeasureKind(unit as never) as number | undefined;
      if (portedKind !== upstreamKind) {
        mismatches.push(`${unit}: kind ${portedKind} vs ${upstreamKind}`);
        continue;
      }
      // The string is what VM.ts compares, so a correct id with a wrong name
      // would still break conversion for a whole measure.
      const expectedName = MeasureKind[upstreamKind as number] as unknown as string;
      const portedName = MEASURE_KIND_NAMES[portedKind as number];
      const normalized = expectedName[0].toLowerCase() + expectedName.slice(1);
      if (portedName !== normalized) {
        mismatches.push(`${unit}: name ${portedName} vs ${normalized}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("non-units report no measure, including inherited property names", () => {
    for (const notAUnit of ["xyz", "USD", "usd", "%", "var", "V", "fps", "pnt", "", " cm ", "constructor", "toString", "__proto__"]) {
      expect(lookupUnit(notAUnit)).toBeUndefined();
      expect(getMeasure(notAUnit)).toBeUndefined();
    }
  });

  // ── Sweep 2: every in-measure pair, bit-exact ──

  test("every ordered pair within a measure converts identically", () => {
    const byKind = new Map<number, string[]>();
    for (const unit of ALL_UNITS) {
      const kind = UNIT_TABLE[unit][0];
      if (!byKind.has(kind)) byKind.set(kind, []);
      (byKind.get(kind) as string[]).push(unit);
    }

    const mismatches: string[] = [];
    for (const [, units] of byKind) {
      for (const from of units) {
        for (const to of units) {
          for (const quantity of SAMPLE_QUANTITIES) {
            const ported = convertRaw(quantity, from, to);
            const upstream = convert(quantity, from as never).to(to as never) as unknown as number;
            if (!Object.is(ported, upstream)) {
              mismatches.push(`${quantity} ${from} to ${to}: ${ported} vs ${upstream}`);
              if (mismatches.length > 20) break;
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  // ── Sweep 3: the throw contract ──

  test("cross-measure and unknown-unit pairs throw the same way", () => {
    const pairs: [string, string][] = [
      ["kg", "ms"],
      ["kg", "m"],
      ["m", "kg"],
      ["C", "kg"],
      ["l", "kilograms"],
      ["xyz", "m"],
      ["m", "xyz"],
      ["pnt", "l"],
      ["", "m"],
    ];
    for (const [from, to] of pairs) {
      const ported = portedConvert(1, from, to);
      const upstream = upstreamConvert(1, from, to);
      expect(ported).toBeInstanceOf(RangeError);
      expect(upstream).toBeInstanceOf(RangeError);
      expect((ported as Error).message).toBe((upstream as Error).message);
    }
  });

  test("inherited property names still throw a RangeError, with a clearer message", () => {
    // The one deliberate deviation, see lookupUnit's doc comment. Upstream
    // reaches its measure comparison; the port rejects the spelling outright.
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(portedConvert(1, name, "m")).toBeInstanceOf(RangeError);
      expect(upstreamConvert(1, name, "m")).toBeInstanceOf(RangeError);
      expect((portedConvert(1, name, "m") as Error).message).toBe(`${name} is not a valid unit`);
    }
  });

  test("DEVIATION: the time-to-metres guess is not reproduced", () => {
    // Upstream reinterprets `m` as minutes when the other side is a time unit.
    // We refuse instead, because that guess reached `<date> + <duration>` and
    // made `today + 5 m` mean five minutes. See convertRaw's comment.
    expect(convert(1, "h").to("m" as never)).toBe(60);
    expect(() => convertRaw(1, "h", "m")).toThrow(RangeError);
    expect(() => convertRaw(1, "m", "min")).toThrow(RangeError);
  });

  // ── Sweep 4: best-unit selection ──

  test("best-unit selection agrees on both value and unit across magnitudes", () => {
    const magnitudes = [0, 1, -1];
    for (let exponent = -12; exponent <= 15; exponent += 3) {
      magnitudes.push(10 ** exponent, -(10 ** exponent), 1.5 * 10 ** exponent);
    }

    const mismatches: string[] = [];
    for (const unit of ALL_UNITS) {
      for (const quantity of magnitudes) {
        const ported = convertToBestMetric(quantity, unit);
        const upstream = convert(quantity, unit as never).to("best") as { quantity: number; unit: string };
        if (!Object.is(ported.quantity, upstream.quantity) || ported.unit !== upstream.unit) {
          mismatches.push(
            `${quantity} ${unit}: ${ported.quantity} ${ported.unit} vs ${upstream.quantity} ${upstream.unit}`
          );
          if (mismatches.length > 20) break;
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  // ── Sweep 5: the possibilities list ──

  test("possibilities lists match exactly, including order", () => {
    // UOM_POSSIBILITIES joins these with ", " into user-visible output, so a
    // reordering is a visible change even though the set is the same.
    const mismatches: string[] = [];
    for (const unit of ALL_UNITS) {
      const kind = getMeasureKind(unit as never) as number | undefined;
      if (kind === undefined) continue;
      const entry = conversions.get(kind as never);
      const expected = entry ? entry.units.flatMap((u) => u.symbols).filter((s) => s !== unit) : [];
      const actual = getConvertiblePossibilities(unit);
      if (expected.length !== actual.length || expected.some((s, i) => s !== actual[i])) {
        mismatches.push(unit);
        if (mismatches.length > 10) break;
      }
    }
    expect(mismatches).toEqual([]);
  });

  // ── The public API, which is what actually ships ──

  test("convertUnit still throws for a cross-measure pair, which VM.ts depends on", () => {
    // extractDurationMs() calls convertUnit(value, unit, "ms") inside a bare
    // try/catch and treats the throw as "contribute zero". If this ever
    // returns NaN instead, `<date> + 5 kg` becomes an Invalid Date.
    expect(() => convertUnit(1, "kg", "ms")).toThrow(RangeError);
    expect(() => convertUnit(1, "mph", "ms")).toThrow();
    expect(() => convertUnit(1, "pnt", "l")).toThrow();
  });

  test("getBestUnit matches upstream for the units it does not bypass", () => {
    for (const [quantity, unit] of [[0.5, "l"], [1000, "mm"], [0, "m"], [-5000, "g"], [1500, "kg"]] as const) {
      const upstream = convert(quantity, unit as never).to("best") as { quantity: number; unit: string };
      expect(getBestUnit(quantity, unit)).toEqual({ value: upstream.quantity, unit: upstream.unit });
    }
  });
});
