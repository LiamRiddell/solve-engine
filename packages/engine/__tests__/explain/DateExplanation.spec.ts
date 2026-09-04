/**
 * `explainLine` tells the reader how a date literal was read, ahead of the
 * arithmetic that used it.
 *
 * What was wrong: a date line derived to an empty step list. `explainLine` had
 * nothing to say about `03/04/2026 + 1 day`, and the one fact the answer
 * turned on, which of two days the literal names, was the one fact no surface
 * reported.
 *
 * What is pinned here: the exact step descriptions for each source a reading
 * can come from; that a literal with nothing to choose adds no step, so an ISO
 * date and a spelled month are unchanged; that the reading steps lead rather
 * than displace the arithmetic ones; and that a step's value is the line's own
 * answer, since a reading is a fact about the line rather than an intermediate
 * value of its own.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import type { DateConfig } from "@solve-js/constants/Configuration";

const explain = (expression: string, date: Partial<DateConfig> = {}) =>
  newTrackedEngine({ config: { date } }).explainLine(expression);

const descriptions = (expression: string, date: Partial<DateConfig> = {}) =>
  explain(expression, date).steps.map((step) => step.description);

describe("the reading step, by where the order came from", () => {
  test("'config': the host named the order", () => {
    expect(descriptions("03/04/2026", { inputOrder: "MDY" })).toEqual([
      "03/04/2026 read as 4 March 2026, month first, from date.inputOrder. Day first would be 3 April 2026.",
    ]);
  });

  test("'host-locale': the order came from the machine", () => {
    const [step] = descriptions("03/04/2026", { inputOrder: "locale" });
    // The tag is this machine's, so the sentence is asserted by shape rather
    // than by a fixed locale: the point is that it names where the order came
    // from, not that the test runs in Britain.
    expect(step).toMatch(/^03\/04\/2026 read as .+, (day|month|year) first, from the host locale [\w-]+\./);
  });

  test("'locale': the host named the reader", () => {
    expect(descriptions("03/04/2026", { inputOrder: "locale", inputLocale: "en-US" })).toEqual([
      "03/04/2026 read as 4 March 2026, month first, from the locale en-US. Day first would be 3 April 2026.",
    ]);
  });

  test("'separator': the default reading", () => {
    expect(descriptions("03/04/2026")).toEqual([
      "03/04/2026 read as 3 April 2026, day first, the default for a slash date. Month first would be 4 March 2026.",
    ]);
  });

  test("'fallback': inference was asked for and could not be made", () => {
    // `und` is a well-formed tag this runtime carries no data for, so the
    // engine reads dates as `'auto'` does and says why.
    expect(descriptions("03/04/2026", { inputOrder: "locale", inputLocale: "und" })).toEqual([
      "03/04/2026 read as 3 April 2026, day first, the default for a slash date, " +
        "because the host locale could not be read. Month first would be 4 March 2026.",
    ]);
  });
});

describe("what gets no step", () => {
  test("an ISO date, which has one reading whatever the order", () => {
    expect(descriptions("2026-04-03", { inputOrder: "MDY" })).toEqual([]);
    expect(descriptions("2024-5-3", { inputOrder: "DMY" })).toEqual([]);
  });

  test("a spelled-out month, which is never ambiguous", () => {
    expect(descriptions("3 April 2026")).toEqual([]);
    expect(descriptions("March 9, 2024", { inputOrder: "MDY" })).toEqual([]);
  });

  test("a date that reads the same way round either way", () => {
    expect(descriptions("01/01/2026", { inputOrder: "DMY" })).toEqual([]);
  });

  test("and a line with no date literal at all is unchanged", () => {
    expect(descriptions("2 + 2")).toEqual(["2 plus 2"]);
    expect(descriptions("2024 - 5 - 3")).toEqual(["2024 minus 5", "2,019 minus 3"]);
  });
});

describe("how a reading step sits among the others", () => {
  test("it leads, and the arithmetic steps follow unchanged", () => {
    const steps = descriptions("20% off 80");
    expect(steps).toEqual(["80 less 20%"]);
  });

  test("a refused literal reports the refusal as its step", () => {
    expect(descriptions("12/25/2026", { inputOrder: "DMY" })).toEqual([
      '"12/25/2026" is not a date read day first: there is no month 25. ' +
        "Read month first it is 25 December 2026. " +
        'Set date.inputOrder to "MDY" to read numeric dates month first.',
    ]);
  });

  test("and two literals on one line give two steps, in the order they appear", () => {
    const steps = descriptions("03/04/2026 - 05/06/2026", { inputOrder: "DMY" });
    expect(steps[0]).toMatch(/^03\/04\/2026 read as 3 April 2026/);
    expect(steps[1]).toMatch(/^05\/06\/2026 read as 5 June 2026/);
  });
});

describe("the step's value", () => {
  test("is the line's own answer", () => {
    const explanation = explain("03/04/2026", { inputOrder: "DMY" });
    expect(explanation.steps).toHaveLength(1);
    expect(explanation.steps[0].value.toNumber()).toBe(explanation.result.toNumber());
  });

  test("including when the line is a date used in arithmetic", () => {
    const explanation = explain("03/04/2026 + 1 day", { inputOrder: "DMY" });
    expect(explanation.steps[0].description).toMatch(/^03\/04\/2026 read as 3 April 2026/);
    expect(explanation.steps[0].value.toNumber()).toBe(explanation.result.toNumber());
  });
});
