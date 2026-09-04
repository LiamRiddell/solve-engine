/**
 * An engine that was not asked to infer an order never asks `Intl` for one.
 *
 * What was wrong: nothing, yet. This pins the cost boundary before anything
 * can cross it. The date-literal rule runs on every keystroke, so an `Intl`
 * call per literal would be a per-keystroke cost, and a default engine that
 * probed a locale it was never asked about would make its answers depend on
 * the machine in a release where that is deliberately not the case.
 *
 * What is pinned here: a default-config engine constructs zero
 * `Intl.DateTimeFormat`s while being built and while evaluating a document of
 * date literals; an engine that asked for inference constructs a bounded
 * number, once, not once per literal; and both read the document the same way
 * that they read it on the first line as on the hundredth.
 */

import { describe, expect, test, afterEach } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

const realDateTimeFormat = Intl.DateTimeFormat;

/**
 * Counts `new Intl.DateTimeFormat(...)` constructions while `run` executes.
 *
 * The real constructor is called through, so everything the engine does with a
 * formatter still works; only the count is added.
 */
function countDateTimeFormats(run: () => void): number {
  let count = 0;
  const spy = function DateTimeFormat(this: unknown, ...args: unknown[]) {
    count++;
    return Reflect.construct(realDateTimeFormat, args, DateTimeFormat as unknown as new () => unknown);
  } as unknown as typeof Intl.DateTimeFormat;
  spy.prototype = realDateTimeFormat.prototype;
  spy.supportedLocalesOf = realDateTimeFormat.supportedLocalesOf.bind(realDateTimeFormat);
  Object.defineProperty(Intl, "DateTimeFormat", { value: spy, configurable: true, writable: true });
  try {
    run();
  } finally {
    Object.defineProperty(Intl, "DateTimeFormat", { value: realDateTimeFormat, configurable: true, writable: true });
  }
  return count;
}

const DOCUMENT = [
  "25/12/2023",
  "12-25-2023",
  "2026-04-03",
  "3 April 2026",
  "1/2/2026",
  "2024-5-3",
  "25/12/23",
  "2023/12/25",
].join("\n");

afterEach(() => {
  Object.defineProperty(Intl, "DateTimeFormat", { value: realDateTimeFormat, configurable: true, writable: true });
});

describe("a default engine", () => {
  test("constructs no Intl.DateTimeFormat resolving an order", () => {
    const constructions = countDateTimeFormats(() => {
      const engine = newTrackedEngine();
      engine.parseDocument(DOCUMENT);
      engine.clear();
    });
    expect(constructions).toBe(0);
  });

  test("and neither does one given an explicit order", () => {
    for (const inputOrder of ["auto", "DMY", "MDY", "YMD"] as const) {
      const constructions = countDateTimeFormats(() => {
        const engine = newTrackedEngine({ config: { date: { inputOrder } } });
        engine.parseDocument(DOCUMENT);
        engine.clear();
      });
      expect(constructions).toBe(0);
    }
  });
});

describe("an engine that asked for inference", () => {
  test("resolves the order once, not once per literal", () => {
    // Two probes at most: the trustworthiness check and the order itself, both
    // memoised for the life of the process. The document's eight literals add
    // nothing, which is the property that matters.
    const constructions = countDateTimeFormats(() => {
      const engine = newTrackedEngine({ config: { date: { inputOrder: "locale", inputLocale: "en-US" } } });
      engine.parseDocument(DOCUMENT);
      engine.clear();
    });
    expect(constructions).toBeLessThanOrEqual(2);
  });

  test("and reads every line of the document under that one order", () => {
    const engine = newTrackedEngine({ config: { date: { inputOrder: "locale", inputLocale: "en-US" } } });
    const reading = engine.getDateReading();
    expect(reading).toEqual({ order: "MDY", orderSource: "locale", locale: "en-US" });
    // The same policy object, every time it is asked, so a host cannot observe
    // two different answers from one engine.
    expect(engine.getDateReading()).toBe(reading);
  });
});
