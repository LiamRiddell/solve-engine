/**
 * What a refused date literal actually IS: a structured Error value carrying a
 * code and a sentence, on the non-throwing evaluation paths, propagating
 * through the rest of the line.
 *
 * What was wrong: a date-shaped run the order could not read was handed back
 * to the parser and answered as the arithmetic it is spelled like.
 * `31/02/2026 + 1 day` answered "1.01 day", which reads as a date calculation
 * that worked.
 *
 * What is pinned here: one case per code, asserting the code AND the exact
 * message (the sentence is the whole point of the change, so it is not
 * asserted loosely); that the result is a `ValueType.Error` rather than a
 * `Number`; that it is a value rather than a throw; and that the fault
 * propagates through an operation instead of being absorbed by it.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { DateInputOrder } from "@solve-js/constants/Configuration";

const evaluate = (expression: string, inputOrder: DateInputOrder = "auto"): Value =>
  newTrackedEngine({ config: { date: { inputOrder } } }).evaluateExpression(expression);

const format = (expression: string, inputOrder: DateInputOrder = "auto"): string =>
  formatValue(evaluate(expression, inputOrder)).replace(/^=\s*/, "");

describe("DATE_ORDER_MISMATCH", () => {
  test("names the order used, the group that broke, the reading that works, and the way out", () => {
    const value = evaluate("12/25/2026", "DMY");
    expect(value.type).toBe(ValueType.Error);
    expect(value.value).toBe("DATE_ORDER_MISMATCH");
    expect(value.unit).toBe(
      '"12/25/2026" is not a date read day first: there is no month 25. ' +
        "Read month first it is 25 December 2026. " +
        'Set date.inputOrder to "MDY" to read numeric dates month first.',
    );
  });

  test("and says it the other way round on a month-first engine", () => {
    const value = evaluate("25/12/2023", "MDY");
    expect(value.value).toBe("DATE_ORDER_MISMATCH");
    expect(value.unit).toBe(
      '"25/12/2023" is not a date read month first: there is no month 25. ' +
        "Read day first it is 25 December 2023. " +
        'Set date.inputOrder to "DMY" to read numeric dates day first.',
    );
  });

  test("on a year-first engine it names both readings and the ISO spelling", () => {
    const value = evaluate("03/04/2026", "YMD");
    expect(value.value).toBe("DATE_ORDER_MISMATCH");
    expect(value.unit).toBe(
      '"03/04/2026" is not a date read year first. ' +
        "Read day first it is 3 April 2026 and month first 4 March 2026. " +
        'Write it as 2026-04-03, or set date.inputOrder to "DMY" or "MDY".',
    );
  });

  test("and names only the reading that is real when only one is", () => {
    const value = evaluate("12/25/2026", "YMD");
    expect(value.value).toBe("DATE_ORDER_MISMATCH");
    expect(value.unit).toBe(
      '"12/25/2026" is not a date read year first. ' +
        "Read month first it is 25 December 2026. " +
        'Write it as 2026-12-25, or set date.inputOrder to "MDY".',
    );
  });
});

describe("DATE_NOT_A_CALENDAR_DAY", () => {
  test("says how long the month actually is, and suggests no order", () => {
    const value = evaluate("31/04/2026", "DMY");
    expect(value.type).toBe(ValueType.Error);
    expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
    expect(value.unit).toBe('"31/04/2026" is not a real date: April 2026 has 30 days.');
    // No change of order fixes it, so the message must not offer one.
    expect(value.unit).not.toMatch(/inputOrder/);
  });

  test("the leap-year case", () => {
    const value = evaluate("29/02/2026", "DMY");
    expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
    expect(value.unit).toBe('"29/02/2026" is not a real date: February 2026 has 28 days.');
  });

  test("the impossible month", () => {
    const value = evaluate("13/13/2026", "DMY");
    expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
    expect(value.unit).toBe('"13/13/2026" is not a real date: there is no month 13.');
  });

  test("and the ISO shape, which has no second reading to fall to", () => {
    expect(evaluate("2026-02-29").unit).toBe('"2026-02-29" is not a real date: February 2026 has 28 days.');
    expect(evaluate("2026-13-01").unit).toBe('"2026-13-01" is not a real date: there is no month 13.');
    expect(evaluate("2026-02-29").value).toBe("DATE_NOT_A_CALENDAR_DAY");
    expect(evaluate("2026-13-01").value).toBe("DATE_NOT_A_CALENDAR_DAY");
  });
});

describe("a refusal is a value, not a throw", () => {
  test("evaluateExpression returns it rather than raising", () => {
    expect(() => evaluate("31/02/2026")).not.toThrow();
    expect(evaluate("31/02/2026").type).toBe(ValueType.Error);
  });

  test("and it is an Error rather than a Number, so nothing computes with it as zero", () => {
    for (const source of ["12/25/2026", "31/04/2026", "2026-02-29", "13/13/2026"]) {
      expect(evaluate(source).type).not.toBe(ValueType.Number);
      expect(evaluate(source).type).toBe(ValueType.Error);
    }
  });

  test("parseDocument reports it on the line rather than failing the document", () => {
    const engine = newTrackedEngine();
    const result = engine.parseDocument("31/02/2026\n2 + 2");
    expect(result.lines[0].result?.type).toBe(ValueType.Error);
    expect(result.lines[0].error).toBeNull();
    // The rest of the document is unaffected.
    expect(result.lines[1].result?.toNumber()).toBe(4);
  });
});

describe("the fault propagates through the rest of the line", () => {
  test("31/02/2026 + 1 day reports the fault instead of answering 1.01 day", () => {
    const value = evaluate("31/02/2026 + 1 day");
    expect(value.type).toBe(ValueType.Error);
    expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
    expect(value.unit).toBe('"31/02/2026" is not a real date: February 2026 has 28 days.');
  });

  test("and so does a difference between a good date and a refused one", () => {
    const value = evaluate("31/12/2026 - 31/02/2026");
    expect(value.type).toBe(ValueType.Error);
    expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
  });
});

describe("a spelled-out month that names no real day", () => {
  test("29 February 2026 reports the month's real length, instead of 51,327,216,000,000", () => {
    // That number is 29 times the epoch of 1 February 2026: with no reading to
    // fuse, the run fell to implicit multiplication and the line answered a
    // product of a day count and an instant.
    const value = evaluate("29 February 2026");
    expect(value.type).toBe(ValueType.Error);
    expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
    expect(value.unit).toBe('"29 February 2026" is not a real date: February 2026 has 28 days.');
  });

  test("31 April 2026 likewise, instead of 55,024,938,000,000", () => {
    const value = evaluate("31 April 2026");
    expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
    expect(value.unit).toBe('"31 April 2026" is not a real date: April 2026 has 30 days.');
  });

  test("and the comma spelling, quoted back the way it was written", () => {
    const value = evaluate("February 30, 2026");
    expect(value.value).toBe("DATE_NOT_A_CALENDAR_DAY");
    expect(value.unit).toBe('"February 30, 2026" is not a real date: February 2026 has 28 days.');
  });

  test("date.onAmbiguous: 'arithmetic' restores both old numbers exactly", () => {
    // Derived rather than written out: the old answer is a day count times a
    // LOCAL midnight, so the figure is 51,327,216,000,000 in London and a
    // different fourteen digits in New York. Deriving it from the same `Date`
    // the literal would have been built with says the same thing in any zone.
    const engine = newTrackedEngine({ config: { date: { onAmbiguous: "arithmetic" } } });
    const localMidnight = (year: number, month: number, day: number) => new Date(year, month - 1, day).getTime();
    expect(engine.evaluateExpression("29 February 2026").toNumber()).toBe(29 * localMidnight(2026, 2, 1));
    expect(engine.evaluateExpression("31 April 2026").toNumber()).toBe(31 * localMidnight(2026, 4, 1));
    // And both really are the fourteen-digit numbers this replaced.
    expect(formatValue(engine.evaluateExpression("29 February 2026")).replace(/^=\s*/, "")).toMatch(
      /^5[12],\d{3},\d{3},\d{3},\d{3}$/,
    );
  });
});

describe("what the spelled-month refusal leaves alone", () => {
  test("a leap day that exists is still that day", () => {
    expect(evaluate("29 February 2024").type).toBe(ValueType.Datetime);
    expect(format("29 February 2024")).toBe("Thursday, February 29, 2024");
  });

  test("and every ordinary spelling is untouched, under every order", () => {
    for (const order of ["auto", "DMY", "MDY", "YMD"] as const) {
      expect(format("3 April 2026", order)).toBe("Friday, April 3, 2026");
      expect(format("March 9, 2024", order)).toBe("Saturday, March 9, 2024");
      expect(format("Mar 9 2024", order)).toBe("Saturday, March 9, 2024");
      expect(format("February 2020", order)).toBe("Saturday, February 1, 2020");
    }
  });

  test("a group that is out of range for its role at all still declines", () => {
    // `March 99` is neither a year nor a day of any month, so the run is not
    // clearly a date attempt: it keeps today's behaviour and is left to the
    // parser, which reports what it finds.
    const engine = newTrackedEngine();
    expect(engine.parseDocument("March 99").lines[0].error).not.toBeNull();
  });
});

describe("every entry point reports the refusal the same way", () => {
  // A refused literal is a per-line fact rather than a whole-document one, but
  // the three entry points reach a Value by different routes, so the same
  // shape of check applies: an answer that differed between them would be the
  // drift a single-path test cannot see.
  const DOCUMENT = ["12/25/2026", "31/04/2026", "2026-02-29", "29 February 2026"];

  test("evaluateLine returns the Error value", () => {
    const engine = newTrackedEngine({ config: { date: { inputOrder: "DMY" } } });
    DOCUMENT.forEach((source, i) => {
      const value = engine.evaluateLine(i + 1, source);
      expect(value.type).toBe(ValueType.Error);
    });
  });

  test("parseDocument reports it on the line, not as a line error", () => {
    const engine = newTrackedEngine({ config: { date: { inputOrder: "DMY" } } });
    const result = engine.parseDocument(DOCUMENT.join("\n"));
    result.lines.forEach((line) => {
      expect(line.error).toBeNull();
      expect(line.result?.type).toBe(ValueType.Error);
    });
  });

  test("and evaluateDocument agrees with parseDocument, message for message", () => {
    const batch = newTrackedEngine({ config: { date: { inputOrder: "DMY" } } });
    const incremental = newTrackedEngine({ config: { date: { inputOrder: "DMY" } } });
    const source = DOCUMENT.join("\n");
    const fromBatch = batch.parseDocument(source).lines.map((l) => l.result?.unit);
    const fromIncremental = evaluateDocument(incremental, source).lines.map((l) => l.result?.unit);
    expect(fromIncremental).toEqual(fromBatch);
    expect(fromBatch.every((message) => typeof message === "string" && message.length > 0)).toBe(true);
  });

  test("and readDates agrees with all three, without evaluating anything", () => {
    const engine = newTrackedEngine({ config: { date: { inputOrder: "DMY" } } });
    for (const source of DOCUMENT) {
      const [reading] = engine.readDates(source);
      expect(reading.note).toBe(engine.evaluateExpression(source).unit);
    }
  });
});
