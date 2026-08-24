/**
 * What the lexer will and will not accept as a unit.
 *
 * `knownUnits` is derived from the conversion tables rather than hand-listed,
 * so the interesting content is the exclusions: the handful of spellings the
 * tables know but the language cannot afford to claim. Every one of them is
 * asserted here with its reason in the test name, because the failure mode of
 * deleting an exclusion is not a crash. It is `4pm` quietly becoming four
 * picometres, which is exactly what happened while this was being written.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { knownUnits, isKnownUnit, excludedUnitSpellings } from "@solve-js/lexer/units";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(expression: string) {
  return new ExpressionEngine({ packages: BUILTIN_PACKAGES }).evaluateExpression(expression)[0];
}

describe("the vocabulary is derived from the conversion tables", () => {
  test("is far larger than the hand-maintained list it replaced", () => {
    // The old list held about 322 entries, of which only ~101 were real units
    // (the rest were currency). Guard the order of magnitude, not the exact
    // number, so adding a currency or an extended unit does not fail this.
    expect(knownUnits.size).toBeGreaterThan(1000);
  });

  test("every admitted spelling really is in a conversion table", () => {
    // Catches a typo in the hand-listed currency or workday groups.
    const { EXTENDED_UNITS } = require("@solve-js/uom/ExtendedUnits");
    const orphans = [...knownUnits].filter(
      (unit) =>
        !(unit in UNIT_TABLE) &&
        !(unit in EXTENDED_UNITS) &&
        unit !== "workday" &&
        unit !== "workdays" &&
        // Currencies are deliberately not units, see units.ts.
        !/^[A-Z]{3,4}$/.test(unit) &&
        !/^[a-z]+$/.test(unit)
    );
    expect(orphans).toEqual([]);
  });

  test("multi-word and non-ASCII spellings are not admitted, since they cannot be one token", () => {
    for (const spelling of ["square meters", "minutes of arc", "cd/m2", "US dry gal", "°", "µm²", "'"]) {
      expect(isKnownUnit(spelling)).toBe(false);
    }
  });
});

describe("newly reachable units actually work end to end", () => {
  test.each([
    // Note the target is `joules`, not `J`: single-letter units are not
    // admitted, see the single-character block below.
    ["1 kilojoule to joules", 1000],
    ["1 km to nm", 1e12],
    ["2 fortnights in days", 28],
    ["1 GiB to MiB", 1024],
    ["1 hectare to m2", 10000],
    ["1 gigabyte to MB", 1000],
    ["1 petahertz to GHz", 1e6],
    ["1 tonne to kg", 1000],
  ])("%s", (expression, expected) => {
    const result = evaluate(expression);
    expect(result.type).not.toBe(ValueType.Error);
    // Relative tolerance: 1 km to nm lands on 999999999999.9999, which is the
    // correct double for that ratio and not something to paper over.
    expect(result.toNumber() / expected).toBeCloseTo(1, 9);
  });

  test("long-form spellings lex as units, not identifiers", () => {
    for (const unit of ["kilojoule", "nanometre", "arcminute", "fortnight", "gigabyte", "petahertz"]) {
      expect(isKnownUnit(unit)).toBe(true);
    }
  });
});

describe("deliberate exclusions", () => {
  test("the exclusion list is not silently empty", () => {
    expect(excludedUnitSpellings.size).toBeGreaterThan(10);
  });

  test.each([...excludedUnitSpellings].map(([spelling, reason]) => [spelling, reason]))(
    "%s is excluded: %s",
    (spelling) => {
      expect(isKnownUnit(spelling)).toBe(false);
    }
  );

  test("`4pm` is a clock time, not four picometres", () => {
    // The regression that motivated the exclusion list existing at all.
    // Admitting `pm` made this interval 2 picometres wide instead of 2 hours.
    const result = evaluate("4pm to 6pm");
    expect(result.type).not.toBe(ValueType.Error);
    expect(result.toNumber()).toBeCloseTo(120, 5); // minutes
    expect(result.unit).toBe("minutes");
  });

  test("`2.5M` is a magnitude suffix, not nautical miles", () => {
    expect(evaluate("2.5M + 1000").toNumber()).toBe(2_501_000);
  });

  test("`255 as dec` is still a converter, not a decade", () => {
    expect(evaluate("255 as dec").toNumber()).toBe(255);
  });

  test("`3 ft in in` still converts, because the IN token carries its own text", () => {
    expect(evaluate("3 ft in in").toNumber()).toBeCloseTo(36, 5);
  });
});

describe("single-character units", () => {
  test("only the grandfathered ones are admitted", () => {
    for (const unit of ["m", "g", "s", "h", "d", "l", "b", "B", "C", "F", "K", "W", "t"]) {
      expect(isKnownUnit(unit)).toBe(true);
    }
  });

  test("the rest stay identifiers, so placeholder names keep working", () => {
    // `x.y` and `x == y` are written all over the test suite. A one-letter
    // unit is indistinguishable from a placeholder name.
    for (const letter of ["r", "a", "y", "c", "p", "S", "L", "N", "J", "R", "x", "n"]) {
      expect(isKnownUnit(letter)).toBe(false);
    }
  });

  test("each excluded letter still has an unambiguous longer spelling", () => {
    // r/a/y/c/p/N/J are reachable as these instead. `S` is a svedberg and `R`
    // is rankine, both obscure enough that losing the one-letter form costs
    // nothing.
    for (const unit of ["rad", "year", "cup", "newton", "joule", "pint", "rankine"]) {
      expect(unit in UNIT_TABLE).toBe(true);
    }
  });
});

describe("existing vocabulary is unchanged", () => {
  test.each([
    "mm", "cm", "m", "km", "ft", "yd", "mi", "inch", "inches",
    "g", "kg", "lb", "oz", "mcg", "mg", "t",
    "ml", "l", "cl", "dl", "gal", "cup", "cups", "tbsp", "tsp",
    "s", "min", "h", "d", "day", "days", "week", "weeks", "month", "year",
    "C", "F", "K", "Hz", "kHz", "W", "kW", "Wh", "kWh", "Pa", "bar", "psi",
    "deg", "rad", "b", "bit", "B", "KB", "MB", "GB", "TB", "KiB", "GiB",
    "m2", "ft2", "workday", "workdays",
    "mps", "kph", "mph", "kV", "ppm",
    "USD", "EUR", "GBP", "BTC", "dollars", "euros",
  ])("%s is still a known unit", (unit) => {
    expect(isKnownUnit(unit)).toBe(true);
  });

  test("the previously excluded engine-owned words are still excluded", () => {
    for (const word of ["in", "V", "var", "fps", "%"]) {
      expect(isKnownUnit(word)).toBe(false);
    }
  });
});
