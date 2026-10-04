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

import { CURRENCY_LETTER_SYMBOLS } from "@solve-js/uom/CurrencyAliases";
import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { knownUnits, isKnownUnit, excludedUnitSpellings } from "@solve-js/lexer/units";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(expression: string) {
  return new ExpressionEngine({ packages: BUILTIN_PACKAGES }).evaluateExpression(expression);
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
        // Currencies are deliberately not units, see units.ts: the codes, the
        // words, and the letters written after an amount (`12 zł`, #693).
        !Object.prototype.hasOwnProperty.call(CURRENCY_LETTER_SYMBOLS, unit) &&
        !/^[A-Z]{3,4}$/.test(unit) &&
        !/^[a-z]+$/.test(unit)
    );
    expect(orphans).toEqual([]);
  });

  test("multi-word and non-ASCII spellings are not admitted, since they cannot be one token", () => {
    for (const spelling of ["square meters", "minutes of arc", "cd/m2", "US dry gal", "°", "'", "W⋅h", "mǔ"]) {
      expect(isKnownUnit(spelling)).toBe(false);
    }
  });

  test("a leading micro sign is admitted, in both of the characters keyboards give", () => {
    // U+00B5 MICRO SIGN and U+03BC GREEK SMALL LETTER MU. The table spells every
    // micro unit both ways (#666).
    for (const spelling of ["\u00B5s", "\u03BCs", "\u00B5m", "\u03BCm", "\u00B5g", "\u00B5L", "\u00B5m\u00B2"]) {
      expect(isKnownUnit(spelling)).toBe(true);
    }
    // Only as a prefix, and only on a spelling the table has.
    for (const spelling of ["\u00B5", "\u03BC", "\u00B5x", "s\u00B5", "\u00B5\u00B5s"]) {
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

describe("the everyday units (#706)", () => {
  /** Every spelling #706 added, and one line each that proves it converts. */
  const EVERYDAY: readonly (readonly [string, string, number])[] = [
    ["cal", "1 cal in J", 4.184],
    ["calorie", "1 calorie in J", 4.184],
    ["calories", "2 calories in J", 8.368],
    ["kcal", "1 kcal in kJ", 4.184],
    ["kilocalorie", "1 kilocalorie in cal", 1000],
    ["kilocalories", "2 kilocalories in cal", 2000],
    ["Cal", "1 Cal in kcal", 1],
    ["Calorie", "1 Calorie in kcal", 1],
    ["Calories", "2 Calories in kcal", 2],
    ["BTU", "1 BTU in J", 1055.05585262],
    ["Btu", "1 Btu in BTU", 1],
    ["therm", "1 therm in BTU", 100_000],
    ["therms", "2 therms in BTU", 200_000],
    ["eV", "1 eV in J", 1.602176634e-19],
    ["keV", "1 keV in eV", 1000],
    ["MeV", "1 MeV in keV", 1000],
    ["GeV", "1 GeV in MeV", 1000],
    ["ohm", "1 ohm in k\u03A9", 0.001],
    ["ohms", "1000 ohms in k\u03A9", 1],
    ["\u03A9", "1 \u03A9 in ohm", 1],
    ["k\u03A9", "1 k\u03A9 in ohm", 1000],
    ["M\u03A9", "1 M\u03A9 in ohm", 1_000_000],
    ["\u2126", "1 \u2126 in ohm", 1],
    ["k\u2126", "1 k\u2126 in ohm", 1000],
    ["M\u2126", "1 M\u2126 in ohm", 1_000_000],
    ["coulomb", "3600 coulomb in Ah", 1],
    ["coulombs", "1 Ah in coulombs", 3600],
    ["Ah", "1 Ah in mAh", 1000],
    ["mAh", "3000 mAh in Ah", 3],
    ["rpm", "3000 rpm in Hz", 50],
    ["RPM", "60 RPM in Hz", 1],
    ["revolution", "1 revolution in deg", 360],
    ["revolutions", "2 revolutions in deg", 720],
    ["knot", "1 knot in kn", 1],
    ["knots", "20 knots in km/h", 37.04],
    ["AU", "1 AU in km", 149_597_870.7],
    ["mmHg", "760 mmHg in Pa", 101_325.0144354],
    ["volt", "1 volt in mV", 1000],
    ["volts", "12 volts in V", 12],
    ["amp", "1 amp in mA", 1000],
    ["amps", "5 amps in A", 5],
    ["ampere", "1 ampere in mA", 1000],
    ["amperes", "2 amperes in A", 2],
    ["L", "2 L in ml", 2000],
    ["mol", "1 mol in mmol", 1000],
    ["mmol", "500 mmol in mol", 0.5],
  ];

  test.each(EVERYDAY.map(([spelling]) => spelling))("%s is a known unit", (spelling) => {
    expect(isKnownUnit(spelling)).toBe(true);
  });

  test.each(EVERYDAY.map(([, line, expected]) => [line, expected] as const))("%s", (line, expected) => {
    const result = evaluate(line);
    expect(result.type).toBe(ValueType.Uom);
    expect(result.toNumber() / expected).toBeCloseTo(1, 9);
  });

  test("the lower-case au, the word mole and the knot's kt are not the new units", () => {
    // `au` starts `au pair`, `mole` is an animal, and `kt` stays the kilotonne.
    expect(isKnownUnit("au")).toBe(false);
    expect(isKnownUnit("mole")).toBe(false);
    expect(isKnownUnit("moles")).toBe(false);
    expect(evaluate("1 kt in kg").toNumber()).toBe(1_000_000);
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
    // `N` (newton) and `J` (joule) joined the set for dimensional arithmetic
    // (`50 N`, `200 J`); see issue #191. `L`, the litre's capital, joined for
    // #706, so `2 L` is two litres as `2 l` always was.
    for (const unit of ["m", "g", "s", "h", "d", "l", "b", "B", "C", "F", "K", "W", "t", "N", "J", "L"]) {
      expect(isKnownUnit(unit)).toBe(true);
    }
  });

  test("the rest stay identifiers, so placeholder names keep working", () => {
    // `x.y` and `x == y` are written all over the test suite. A one-letter
    // unit is indistinguishable from a placeholder name.
    for (const letter of ["r", "a", "y", "c", "p", "S", "R", "x", "n"]) {
      expect(isKnownUnit(letter)).toBe(false);
    }
  });

  test("the ohm's symbol is the one single character outside the base table, in both code points", () => {
    // U+03A9 GREEK CAPITAL LETTER OMEGA and U+2126 OHM SIGN (#706). It comes
    // from ExtendedUnits.ts, which the single-letter rule does not govern, and
    // it is no placeholder anybody writes.
    expect(isKnownUnit("\u03A9")).toBe(true);
    expect(isKnownUnit("\u2126")).toBe(true);
    expect(isKnownUnit("\u03C9")).toBe(false);
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
    // `V` is now the volt (issue #191); the rest stay excluded.
    for (const word of ["in", "var", "fps", "%"]) {
      expect(isKnownUnit(word)).toBe(false);
    }
  });
});
