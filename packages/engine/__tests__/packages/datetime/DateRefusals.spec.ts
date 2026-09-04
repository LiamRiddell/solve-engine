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
import { ValueType, type Value } from "@solve-js/vm/Value";
import type { DateInputOrder } from "@solve-js/constants/Configuration";

const evaluate = (expression: string, inputOrder: DateInputOrder = "auto"): Value =>
  newTrackedEngine({ config: { date: { inputOrder } } }).evaluateExpression(expression);

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
