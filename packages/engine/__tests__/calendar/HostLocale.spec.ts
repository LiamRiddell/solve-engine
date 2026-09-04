/**
 * The order probe: what a locale tag says about day/month/year order, and what
 * happens where the runtime cannot answer.
 *
 * What was wrong: nothing asked. `date.inputOrder` made the host state the
 * order, and a host that IS the reader had no way to answer from the machine,
 * so a British notepad and an American one shipped the same default and one of
 * them read every `03/04/2026` as the wrong day.
 *
 * What is pinned here: the probe's answers for eight tags, taken from a real
 * run on this machine, with the Gregorian calendar and Latin digits pinned so
 * a non-Gregorian locale contributes its field ORDER and nothing else; and the
 * four ways the probe declines, each of which must answer `null` (meaning
 * "keep today's behaviour") rather than a fabricated order.
 */

import { describe, expect, test, afterEach } from "@jest/globals";
import { hostLocale, isTrustworthyIntl, orderFromLocale } from "@solve-js/calendar/HostLocale";

const realIntl = globalThis.Intl;

/** Swaps `globalThis.Intl` for the run of one test. The memo table keys on it, so it re-probes. */
function withIntl(replacement: unknown, run: () => void): void {
  Object.defineProperty(globalThis, "Intl", { value: replacement, configurable: true, writable: true });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, "Intl", { value: realIntl, configurable: true, writable: true });
  }
}

afterEach(() => {
  Object.defineProperty(globalThis, "Intl", { value: realIntl, configurable: true, writable: true });
});

describe("the order a locale writes a numeric date in", () => {
  test("is read from Intl, tag by tag", () => {
    expect(orderFromLocale("en-GB")).toBe("DMY");
    expect(orderFromLocale("en-US")).toBe("MDY");
    expect(orderFromLocale("de-DE")).toBe("DMY");
    expect(orderFromLocale("fr-FR")).toBe("DMY");
    expect(orderFromLocale("ja-JP")).toBe("YMD");
    expect(orderFromLocale("hu-HU")).toBe("YMD");
    expect(orderFromLocale("en-CA")).toBe("YMD");
    // A locale whose default calendar is not Gregorian. The probe pins
    // `calendar: "gregory"`, so what comes back is its field order and never
    // its calendar system or its digits.
    expect(orderFromLocale("fa-IR")).toBe("YMD");
  });

  test("is a region question, not a language one", () => {
    // The reason `date.inputLocale` is not wired to the engine's own `locale`
    // option: that option is a language with no region, and a bare `en` probes
    // month-first while this host's `en-GB` probes day-first.
    expect(orderFromLocale("en")).toBe("MDY");
    expect(orderFromLocale("en-GB")).toBe("DMY");
  });

  test("and the host's own tag is readable", () => {
    const tag = hostLocale();
    expect(typeof tag).toBe("string");
    expect(orderFromLocale(tag as string)).not.toBeNull();
  });
});

describe("where the runtime cannot answer", () => {
  test("no Intl at all declines", () => {
    withIntl(undefined, () => {
      expect(orderFromLocale("en-GB")).toBeNull();
      expect(hostLocale()).toBeNull();
    });
  });

  test("a throwing resolvedOptions declines", () => {
    withIntl(
      {
        DateTimeFormat: function DateTimeFormat() {
          return {
            resolvedOptions() {
              throw new Error("no locale data");
            },
          };
        },
      },
      () => {
        expect(isTrustworthyIntl()).toBe(false);
        expect(orderFromLocale("en-GB")).toBeNull();
        expect(hostLocale()).toBeNull();
      },
    );
  });

  test("a parts list missing one of the three fields declines", () => {
    withIntl(
      {
        DateTimeFormat: function DateTimeFormat() {
          return {
            resolvedOptions: () => ({ locale: "ja-JP" }),
            // Year and month only: no reading can be built from two fields, so
            // the probe must not guess the third from the two it has.
            formatToParts: () => [
              { type: "year", value: "2026" },
              { type: "literal", value: "/" },
              { type: "month", value: "4" },
            ],
          };
        },
      },
      () => {
        expect(isTrustworthyIntl()).toBe(true);
        expect(orderFromLocale("ja-JP")).toBeNull();
      },
    );
  });

  test("a small-ICU runtime, which answers en-US for every locale, declines", () => {
    // The case `supportedLocalesOf` cannot catch: on the host path the tag came
    // from `resolvedOptions().locale` and is supported by construction, so the
    // only way to see the substitution is to ask for a locale that is certainly
    // not English and read what comes back.
    withIntl(
      {
        DateTimeFormat: function DateTimeFormat() {
          return {
            resolvedOptions: () => ({ locale: "en-US" }),
            formatToParts: () => [
              { type: "month", value: "4" },
              { type: "literal", value: "/" },
              { type: "day", value: "3" },
              { type: "literal", value: "/" },
              { type: "year", value: "2026" },
            ],
          };
        },
      },
      () => {
        expect(isTrustworthyIntl()).toBe(false);
        // Month-first is exactly what this runtime would have said, and it is
        // refused: a fabricated order is worse than no inference.
        expect(orderFromLocale("ja-JP")).toBeNull();
        expect(orderFromLocale("en-GB")).toBeNull();
      },
    );
  });

  test("and the real Intl is trusted again afterwards", () => {
    expect(isTrustworthyIntl()).toBe(true);
    expect(orderFromLocale("en-GB")).toBe("DMY");
  });
});
