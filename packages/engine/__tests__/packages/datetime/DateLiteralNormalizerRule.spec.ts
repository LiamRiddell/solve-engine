import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Local midnight epoch-ms for (year, month 1-12, day) — mirrors the
 * production code's Date construction so tests aren't timezone-brittle. */
function localMidnight(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime();
}

describe("Date literal parsing (DateLiteralNormalizerRule + DateLiteralParselet)", () => {
  describe("European format: DD/MM/YYYY", () => {
    test("25/12/2023 is a Datetime at local midnight on 2023-12-25", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("25/12/2023");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 12, 25));
    });

    test("01/01/2000 is a Datetime", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("01/01/2000");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2000, 1, 1));
    });

    test("29/02/2024 (leap year) is a Datetime", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("29/02/2024");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2024, 2, 29));
    });

    test("2-digit year 00-68 windows to 2000s: 5/1/23 -> 2023", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("5/1/23");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 1, 5));
    });

    test("2-digit year 69-99 windows to 1900s: 5/1/99 -> 1999", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("5/1/99");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(1999, 1, 5));
    });

    // These two used to fall back to chained division and answer 0.01 and
    // 0.00. A four-digit trailing group ends nothing anybody writes as
    // arithmetic, so the run now reports what is wrong with it instead. The
    // old numbers are still available, and are asserted below.
    test("29/02/2023 (not a leap year) is NOT a date — it reports that February 2023 has 28 days", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("29/02/2023");
      expect(result.type).toBe(ValueType.Error);
      expect(result.value).toBe("DATE_NOT_A_CALENDAR_DAY");
      expect(result.unit).toBe('"29/02/2023" is not a real date: February 2023 has 28 days.');
    });

    test("and answers the old 29 / 2 / 2023 under date.onAmbiguous: 'arithmetic'", () => {
      const engine = newTrackedEngine({ config: { date: { onAmbiguous: "arithmetic" } } });
      const result = engine.evaluateExpression("29/02/2023");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBeCloseTo(29 / 2 / 2023, 10);
    });

    test("25/13/2023 (invalid month) is NOT a date — it reports that there is no month 13", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("25/13/2023");
      expect(result.type).toBe(ValueType.Error);
      expect(result.value).toBe("DATE_NOT_A_CALENDAR_DAY");
      expect(result.unit).toBe('"25/13/2023" is not a real date: there is no month 13.');
    });

    test("and answers the old 25 / 13 / 2023 under date.onAmbiguous: 'arithmetic'", () => {
      const engine = newTrackedEngine({ config: { date: { onAmbiguous: "arithmetic" } } });
      const result = engine.evaluateExpression("25/13/2023");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBeCloseTo(25 / 13 / 2023, 10);
    });

    test("genuine division with a 1-digit trailing group is unaffected: 100/12/2", () => {
      // "100" isn't a valid day, so this must never be reinterpreted as a date.
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("100/12/2");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBeCloseTo(100 / 12 / 2, 10);
    });
  });

  describe("ISO 8601 date-only format: YYYY-MM-DD", () => {
    test("2023-12-25 is a Datetime", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("2023-12-25");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 12, 25));
    });

    test("1999-06-15 is a Datetime", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("1999-06-15");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(1999, 6, 15));
    });

    test("month/day are not swapped: 2023-01-31 is Jan 31, not Nov 3 or an error", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("2023-01-31");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 1, 31));
    });

    test.each([
      ["2024-5-3", "neither group padded"],
      ["2024-5-03", "month unpadded, day padded"],
      ["2024-05-3", "month padded, day unpadded"],
      ["2024-05-03", "both padded"],
    ])("%s is May 3 2024 (%s)", (source) => {
      // Zero-padding is what ISO 8601 requires of a serialized date and not
      // what people type. The US ordering in this same rule has always taken
      // unpadded groups ("1-1-2020" below), so refusing them here was an
      // inconsistency rather than a policy.
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression(source);
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2024, 5, 3));
    });

    test("an unpadded date literal still takes a duration: 2024-5-3 + 1 day", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("2024-5-3 + 1 day");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2024, 5, 4));
    });

    test("a group of three or more digits is not a date group: 2024-05-030", () => {
      // The calendar check would not catch this on its own, since "030" reads
      // back as day 30. Left as arithmetic: 2024 - 5 - 30.
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("2024-05-030");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBe(2024 - 5 - 30);
    });
  });

  describe("spacing is what separates a date from the arithmetic it is spelled like", () => {
    /*
     * A date literal is written as one uninterrupted run of characters; a
     * chain of operators is written with spaces around them. That difference
     * survives only in the token offsets, since the tokens themselves are the
     * same five either way, and it is the only signal that works for every
     * ordering. See `writtenAsOneRun` in the rule.
     *
     * Zero-padding is deliberately NOT the signal, in either direction. It is
     * absent from plenty of real dates and present in plenty of real
     * arithmetic, so "2024 - 05 - 03" below is subtraction: reading it as a
     * date would leave that subtraction with no spelling at all.
     */

    test.each([
      ["2024 - 5 - 3", 2016],
      ["2024 - 05 - 03", 2016],
      ["1999 - 2 - 3", 1994],
      ["2024 - 1 - 1 - 1", 2021],
      ["12 - 25 - 2023", -2036],
      ["1 - 1 - 2020", -2020],
    ])("%s is subtraction, not a date", (source, expected) => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression(source);
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBe(expected);
    });

    test.each([
      ["25 / 12 / 2023", 25 / 12 / 2023],
      ["5 / 1 / 23", 5 / 1 / 23],
    ])("%s is division, not a date", (source, expected) => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression(source);
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBeCloseTo(expected, 12);
    });

    test("one space anywhere in the run is enough: 2023- 12-25", () => {
      // Adjacency is checked across the whole five-token run rather than at
      // the first separator only, so a chain cannot be half a date.
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("2023- 12-25");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBe(2023 - 12 - 25);
    });
  });

  describe("US format: MM-DD-YYYY", () => {
    test("12-25-2023 is a Datetime (Christmas)", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("12-25-2023");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 12, 25));
    });

    test("month/day are not swapped: 01-31-2023 is Jan 31", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("01-31-2023");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 1, 31));
    });

    test("unpadded groups are accepted, and always have been: 1-1-2020 is Jan 1", () => {
      // This row is the precedent the ISO ordering above now matches.
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("1-1-2020");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2020, 1, 1));
    });

    test("2-digit year: 12-25-23 -> 2023", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("12-25-23");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 12, 25));
    });

    // The hyphen spelling of the same change: these used to answer -2,051 and
    // -2,011, and now say what is wrong. The second is the interesting one,
    // because the other order reads it perfectly well, so it is an order
    // mismatch rather than an impossible day.
    test("02-30-2023 (Feb 30 doesn't exist) is NOT a date — it reports that February 2023 has 28 days", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("02-30-2023");
      expect(result.type).toBe(ValueType.Error);
      expect(result.value).toBe("DATE_NOT_A_CALENDAR_DAY");
      expect(result.unit).toBe('"02-30-2023" is not a real date: February 2023 has 28 days.');
    });

    test("and answers the old 2 - 30 - 2023 under date.onAmbiguous: 'arithmetic'", () => {
      const engine = newTrackedEngine({ config: { date: { onAmbiguous: "arithmetic" } } });
      const result = engine.evaluateExpression("02-30-2023");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBe(2 - 30 - 2023);
    });

    test("13-01-2023 (invalid month first) names the order that would read it", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("13-01-2023");
      expect(result.type).toBe(ValueType.Error);
      expect(result.value).toBe("DATE_ORDER_MISMATCH");
      expect(result.unit).toBe(
        '"13-01-2023" is not a date read month first: there is no month 13. ' +
          "Read day first it is 13 January 2023. " +
          'Set date.inputOrder to "DMY" to read numeric dates day first.',
      );
    });

    test("and answers the old 13 - 1 - 2023 under date.onAmbiguous: 'arithmetic'", () => {
      const engine = newTrackedEngine({ config: { date: { onAmbiguous: "arithmetic" } } });
      const result = engine.evaluateExpression("13-01-2023");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBe(13 - 1 - 2023);
    });

    test("genuine chained subtraction with non-date-shaped operands is unaffected: 100-50-25", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("100-50-25");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBe(100 - 50 - 25);
    });
  });

  describe("Dot format: DD.MM.YYYY", () => {
    test("25.12.2023 is a Datetime", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("25.12.2023");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 12, 25));
    });

    test("leading-zero day and month: 05.01.2023 is Jan 5", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("05.01.2023");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 1, 5));
    });

    test("2-digit year: 31.12.99 -> 1999", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("31.12.99");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(1999, 12, 31));
    });

    test("30.02.2023 (Feb 30 doesn't exist) is NOT a date — it says so, instead of throwing", () => {
      // This used to throw `Unexpected token after expression: ".2023"`, the
      // parser reporting the leftover half of a literal the rule declined. A
      // dot run has nothing to fall through to, so a refusal is the only
      // answer available and an error message about a dot is not one.
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("30.02.2023");
      expect(result.type).toBe(ValueType.Error);
      expect(result.value).toBe("DATE_NOT_A_CALENDAR_DAY");
      expect(result.unit).toBe('"30.02.2023" is not a real date: February 2023 has 28 days.');
    });

    test("and the refusal stands even under date.onAmbiguous: 'arithmetic'", () => {
      // The one refusal the opt-out cannot restore: there is no old number to
      // restore, only the old parse error.
      const engine = newTrackedEngine({ config: { date: { onAmbiguous: "arithmetic" } } });
      expect(engine.evaluateExpression("30.02.2023").value).toBe("DATE_NOT_A_CALENDAR_DAY");
    });

    test("a genuine decimal number is unaffected when nothing follows it: 25.12 alone", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("25.12");
      expect(result.type).toBe(ValueType.Number);
      expect(result.toNumber()).toBeCloseTo(25.12, 10);
    });
  });

  describe("Integration with existing datetime arithmetic", () => {
    test("a date literal plus a duration still works: 25/12/2023 + 1 day", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("25/12/2023 + 1 day");
      expect(result.type).toBe(ValueType.Datetime);
      expect(result.toNumber()).toBe(localMidnight(2023, 12, 26));
    });

    test("subtracting two date literals yields a duration in ms: 2023-12-25 - 2023-12-24", () => {
      const engine = newTrackedEngine();
      const result = engine.evaluateExpression("2023-12-25 - 2023-12-24");
      expect(result.type).toBe(ValueType.Uom);
      expect(result.unit).toBe("ms");
      expect(result.toNumber()).toBe(localMidnight(2023, 12, 25) - localMidnight(2023, 12, 24));
    });
  });
});
