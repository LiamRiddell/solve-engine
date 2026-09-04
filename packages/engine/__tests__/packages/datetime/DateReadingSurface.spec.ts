/**
 * `readDates(text)`: how every date literal on a line was read, with the span
 * each occupies and a sentence a host can show.
 *
 * What was wrong: the answer came back as a date and nothing said how it was
 * read. A reader who typed `03/04/2026` and a host that rendered it both had
 * to already know the engine's input order, and a support ticket saying "it
 * rendered 4 March" was unanswerable without a repro.
 *
 * What is pinned here: two literals on one line come back as two records with
 * distinct offsets; the exact note for the contested, short-year, ISO, spelled
 * and refused cases; that `needsNote` is true exactly for the readings worth
 * remarking on; and that `readDates(text)[i].iso` agrees with the day the line
 * actually evaluates to, for every shape in the matrix. That last one is the
 * property that makes the surface worth having: an account that could disagree
 * with the answer would be worse than no account.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { DateConfig } from "@solve-js/constants/Configuration";
import { formatIso8601Local } from "@solve-js/packages/datetime/Iso8601";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

const engineFor = (date: Partial<DateConfig> = {}) => newTrackedEngine({ config: { date } });

describe("spans", () => {
  test("a line with two literals gives two records, each with its own offsets", () => {
    const readings = engineFor({ inputOrder: "DMY" }).readDates("31/12/2026 - 01/01/2026");
    expect(readings).toHaveLength(2);
    expect(readings[0].text).toBe("31/12/2026");
    expect([readings[0].start, readings[0].end]).toEqual([0, 10]);
    expect(readings[1].text).toBe("01/01/2026");
    expect([readings[1].start, readings[1].end]).toEqual([13, 23]);
    expect(readings[0].iso).toBe("2026-12-31");
    expect(readings[1].iso).toBe("2026-01-01");
  });

  test("the span covers the literal as typed, not the fused token's payload", () => {
    // A spelled-out month is several tokens and the fused token's own text is
    // not the source, so this is the case a naive span would get wrong.
    const [reading] = engineFor().readDates("weekday on March 9, 2024");
    expect(reading.text).toBe("March 9, 2024");
    expect("weekday on March 9, 2024".slice(reading.start, reading.end)).toBe("March 9, 2024");
  });

  test("a line with no date literal gives nothing", () => {
    expect(engineFor().readDates("2 + 2")).toEqual([]);
    expect(engineFor().readDates("2024 - 5 - 3")).toEqual([]);
  });

  test("and nothing is evaluated: the document is untouched", () => {
    const engine = engineFor();
    engine.evaluateLine(1, "total = 5");
    engine.readDates("03/04/2026 + total");
    expect(engine.evaluateExpression("total").toNumber()).toBe(5);
  });
});

describe("the note", () => {
  test("a contested reading names the day taken, where the order came from, and the other day", () => {
    const [reading] = engineFor({ inputOrder: "locale", inputLocale: "en-GB" }).readDates("03/04/2026");
    expect(reading.note).toBe(
      "03/04/2026 read as 3 April 2026, day first, from the locale en-GB. Month first would be 4 March 2026.",
    );
    expect(reading.contested).toBe(true);
    expect(reading.alternative).toBe("2026-03-04");
  });

  test("and says it the other way round on a month-first engine", () => {
    const [reading] = engineFor({ inputOrder: "MDY" }).readDates("03/04/2026");
    expect(reading.note).toBe(
      "03/04/2026 read as 4 March 2026, month first, from date.inputOrder. Day first would be 3 April 2026.",
    );
  });

  test("a windowed two-digit year is spelled out", () => {
    const [reading] = engineFor({ inputOrder: "DMY" }).readDates("3/4/26");
    expect(reading.shortYear).toBe(true);
    expect(reading.note).toBe(
      "3/4/26 read as 3 April 2026, day first, from date.inputOrder. " +
        "Month first would be 4 March 2026. The two-digit year 26 was read as 2026.",
    );
  });

  test("an ISO date says so, and names no order and no locale", () => {
    const [reading] = engineFor({ inputOrder: "locale", inputLocale: "en-US" }).readDates("2026-04-03");
    expect(reading.note).toBe("2026-04-03 read as 3 April 2026, ISO.");
    expect(reading.orderSource).toBe("iso");
    // The locale had no part in it, so reporting one would be a false account.
    expect(reading.locale).toBeUndefined();
  });

  test("a spelled-out month says so too", () => {
    const [reading] = engineFor().readDates("3 April 2026");
    expect(reading.note).toBe("3 April 2026 read as 3 April 2026, with the month spelled out.");
    expect(reading.orderSource).toBe("spelled");
  });

  test("a refusal carries the refusal's own sentence, so the two cannot drift", () => {
    const engine = engineFor({ inputOrder: "DMY" });
    const [reading] = engine.readDates("12/25/2026");
    expect(reading.iso).toBeNull();
    expect(reading.problem).toBe("DATE_ORDER_MISMATCH");
    expect(reading.note).toBe(engine.evaluateExpression("12/25/2026").unit);
  });

  test("and the default engine names the separator it read by", () => {
    const [reading] = engineFor().readDates("03/04/2026");
    expect(reading.orderSource).toBe("separator");
    expect(reading.note).toBe(
      "03/04/2026 read as 3 April 2026, day first, the default for a slash date. " +
        "Month first would be 4 March 2026.",
    );
  });
});

describe("needsNote", () => {
  test("is true for a contested reading, a windowed year and a refusal", () => {
    expect(engineFor({ inputOrder: "DMY" }).readDates("03/04/2026")[0].needsNote).toBe(true);
    expect(engineFor({ inputOrder: "DMY" }).readDates("3/4/26")[0].needsNote).toBe(true);
    expect(engineFor({ inputOrder: "DMY" }).readDates("12/25/2026")[0].needsNote).toBe(true);
  });

  test("and false where there was nothing to choose", () => {
    expect(engineFor().readDates("2026-04-03")[0].needsNote).toBe(false);
    expect(engineFor().readDates("3 April 2026")[0].needsNote).toBe(false);
    expect(engineFor({ inputOrder: "DMY" }).readDates("31/12/2026")[0].needsNote).toBe(false);
  });

  test("including a date that reads the same way round either way", () => {
    // `01/01/2026` is the 1st of January under both orders, so there is no
    // choice to report and a note would be wallpaper.
    const [reading] = engineFor({ inputOrder: "DMY" }).readDates("01/01/2026");
    expect(reading.contested).toBe(false);
    expect(reading.needsNote).toBe(false);
  });
});

describe("the account agrees with the answer", () => {
  const CASES: Array<[string, Partial<DateConfig>]> = [
    ["25/12/2023", { inputOrder: "auto" }],
    ["03/04/2026", { inputOrder: "auto" }],
    ["03/04/2026", { inputOrder: "DMY" }],
    ["03/04/2026", { inputOrder: "MDY" }],
    ["12-25-2023", { inputOrder: "auto" }],
    ["25-12-2023", { inputOrder: "DMY" }],
    ["2026-04-03", { inputOrder: "MDY" }],
    ["2024-5-3", { inputOrder: "DMY" }],
    ["2023/12/25", { inputOrder: "YMD" }],
    ["25/12/23", { inputOrder: "auto" }],
    ["12/13/14", { inputOrder: "MDY" }],
    ["25.12.2026", { inputOrder: "DMY" }],
    ["12.25.2026", { inputOrder: "MDY" }],
    ["3 April 2026", { inputOrder: "auto" }],
    ["March 9, 2024", { inputOrder: "MDY" }],
  ];

  test.each(CASES)("%s reads as the day the line evaluates to (%o)", (expression, date) => {
    const engine = engineFor(date);
    const value = engine.evaluateExpression(expression);
    expect(value.type).toBe(ValueType.Datetime);
    const [reading] = engine.readDates(expression);
    expect(reading.iso).toBe(formatIso8601Local(value.toNumber(), DATE_CALENDAR).slice(0, 10));
  });

  test("and a refused literal reports no day, matching an answer that is not one", () => {
    for (const [expression, date] of [
      ["12/25/2026", { inputOrder: "DMY" }],
      ["31/04/2026", { inputOrder: "DMY" }],
      ["2026-02-29", { inputOrder: "auto" }],
      ["29 February 2026", { inputOrder: "auto" }],
    ] as Array<[string, Partial<DateConfig>]>) {
      const engine = engineFor(date);
      expect(engine.evaluateExpression(expression).type).toBe(ValueType.Error);
      expect(engine.readDates(expression)[0].iso).toBeNull();
    }
  });
});
