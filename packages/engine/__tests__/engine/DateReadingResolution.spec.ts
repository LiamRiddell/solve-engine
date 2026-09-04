/**
 * The precedence that turns `date.inputOrder` into the order an engine
 * actually reads a numeric date literal in, and reports through
 * `getDateReading()`.
 *
 * What was wrong: the engine read `03/04/2026` in an order the reader could
 * not see and the host could not discover. There was no answer to "how does
 * this engine read dates", so a support ticket saying "it rendered 4 March"
 * could not be answered without a repro.
 *
 * What is pinned here: the five precedence steps, each naming the source it
 * reports; that `date.inputLocale` is inert while `inputOrder` is anything but
 * `'locale'`; that a malformed tag is refused at construction rather than
 * ignored; and that the resolved order, never the word `'locale'`, is what the
 * engine carries.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import type { DateConfig } from "@solve-js/constants/Configuration";
import { formatValue } from "@solve-js/format/FormatEngine";

const reading = (date: Partial<DateConfig>) => newTrackedEngine({ config: { date } }).getDateReading();

const read = (expression: string, date: Partial<DateConfig>): string =>
  formatValue(newTrackedEngine({ config: { date } }).evaluateExpression(expression)).replace(/^=\s*/, "");

describe("the order an engine resolves", () => {
  test("1. a named order is taken outright, and reports 'config'", () => {
    expect(reading({ inputOrder: "MDY" })).toEqual({ order: "MDY", orderSource: "config" });
    expect(reading({ inputOrder: "DMY" })).toEqual({ order: "DMY", orderSource: "config" });
    expect(reading({ inputOrder: "YMD" })).toEqual({ order: "YMD", orderSource: "config" });
  });

  test("2. 'locale' with a tag reads that tag, and reports 'locale'", () => {
    expect(reading({ inputOrder: "locale", inputLocale: "en-US" })).toEqual({
      order: "MDY",
      orderSource: "locale",
      locale: "en-US",
    });
    expect(reading({ inputOrder: "locale", inputLocale: "de-DE" })).toEqual({
      order: "DMY",
      orderSource: "locale",
      locale: "de-DE",
    });
    expect(reading({ inputOrder: "locale", inputLocale: "ja-JP" })).toEqual({
      order: "YMD",
      orderSource: "locale",
      locale: "ja-JP",
    });
  });

  test("3. 'locale' with no tag asks the host, and reports 'host-locale'", () => {
    const resolved = reading({ inputOrder: "locale" });
    expect(resolved.orderSource).toBe("host-locale");
    expect(typeof resolved.locale).toBe("string");
    expect(["DMY", "MDY", "YMD"]).toContain(resolved.order);
  });

  test("4. a tag this runtime has no data for falls back to today's behaviour, and says so", () => {
    // `und` names an undetermined language and `zz-ZZ` a region that does not
    // exist. Both are well formed, so neither is a configuration error, and
    // both are tags `Intl` would happily answer this host's own `en-GB` order
    // for. Refusing them is the difference between a decision and a guess.
    expect(reading({ inputOrder: "locale", inputLocale: "und" })).toEqual({
      order: "auto",
      orderSource: "fallback",
    });
    expect(reading({ inputOrder: "locale", inputLocale: "zz-ZZ" })).toEqual({
      order: "auto",
      orderSource: "fallback",
    });
  });

  test("and a fallback reads dates exactly as an 'auto' engine does", () => {
    expect(read("03/04/2026", { inputOrder: "locale", inputLocale: "und" })).toBe(
      read("03/04/2026", { inputOrder: "auto" }),
    );
  });

  test("5. 'auto' is the historic per-separator reading, and reports 'separator'", () => {
    expect(reading({ inputOrder: "auto" })).toEqual({ order: "auto", orderSource: "separator" });
  });

  test("and an engine configured with nothing at all is that same reading", () => {
    expect(newTrackedEngine().getDateReading()).toEqual({ order: "auto", orderSource: "separator" });
  });
});

describe("inputLocale is inert unless inputOrder selects it", () => {
  test("it changes no reading beside 'auto'", () => {
    expect(reading({ inputOrder: "auto", inputLocale: "en-US" })).toEqual({
      order: "auto",
      orderSource: "separator",
    });
  });

  test("it changes no result beside 'auto'", () => {
    // The predictable host mistake: setting the tag and expecting inference.
    // It must be no change rather than a wrong change, so a slash date stays
    // day-first exactly as an unconfigured engine reads it.
    expect(read("03/04/2026", { inputOrder: "auto", inputLocale: "en-US" })).toBe("Friday, April 3, 2026");
    expect(read("03/04/2026", { inputOrder: "auto" })).toBe("Friday, April 3, 2026");
  });

  test("and it is not consulted beside a named order either", () => {
    expect(reading({ inputOrder: "DMY", inputLocale: "en-US" })).toEqual({ order: "DMY", orderSource: "config" });
    expect(read("03/04/2026", { inputOrder: "DMY", inputLocale: "en-US" })).toBe("Friday, April 3, 2026");
  });
});

describe("a malformed inputLocale", () => {
  test("is refused at construction, by name", () => {
    // A locale silently ignored is a date order silently wrong, so this is a
    // boundary check rather than a fallback.
    expect(() => newTrackedEngine({ config: { date: { inputOrder: "locale", inputLocale: "en_US" } } })).toThrow(
      /DATE_INPUT_LOCALE_INVALID|not a BCP-47 locale tag/,
    );
  });

  test("wherever it is set, since a typo is a typo under any order", () => {
    expect(() => newTrackedEngine({ config: { date: { inputOrder: "auto", inputLocale: "en_US" } } })).toThrow(
      /not a BCP-47 locale tag/,
    );
  });

  test("while a well-formed tag this runtime has no data for is not an error", () => {
    // It is a fallback, not a refusal: the tag is a reader the engine cannot
    // describe, which is a different thing from a typo in the host's code.
    expect(() => newTrackedEngine({ config: { date: { inputOrder: "locale", inputLocale: "zz-ZZ" } } })).not.toThrow();
  });
});

describe("what the resolved order does to a literal", () => {
  test("'locale' reads the same day a named order does", () => {
    expect(read("03/04/2026", { inputOrder: "locale", inputLocale: "en-US" })).toBe("Wednesday, March 4, 2026");
    expect(read("03/04/2026", { inputOrder: "MDY" })).toBe("Wednesday, March 4, 2026");
    expect(read("03/04/2026", { inputOrder: "locale", inputLocale: "en-GB" })).toBe("Friday, April 3, 2026");
    expect(read("03/04/2026", { inputOrder: "DMY" })).toBe("Friday, April 3, 2026");
  });

  test("and the word 'locale' never reaches the reading itself", () => {
    // The order is resolved once and carried, so nothing downstream (the
    // normaliser, a worker, a snapshot) can re-infer a different answer.
    const resolved = reading({ inputOrder: "locale", inputLocale: "ja-JP" });
    expect(resolved.order).not.toBe("locale");
    expect(resolved.order).toBe("YMD");
  });
});
