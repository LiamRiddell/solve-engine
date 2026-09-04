/**
 * The four shapes a three-group numeric run can have, and what each of the
 * five configurable orders does with them.
 *
 * What was wrong: a run the configured order could not read fell straight
 * through to the arithmetic it is spelled like, whatever its shape. So
 * `12/25/2026` on a day-first engine answered 0.00, `31/04/2026` answered
 * 0.00, and `2026-02-29` answered 1,995. None of those is a number anybody
 * typed that expression to get.
 *
 * What is pinned here: the whole matrix, written out rather than looped, so
 * the asymmetry between the two four-digit shapes is visible as data. A
 * four-digit trailing group refuses when no reading works, because a two-step
 * division ending in one is not something anybody writes. A four-digit LEADING
 * group with slashes is ordinary arithmetic and is never refused, because
 * `1000/10/5` is 20 and people write that constantly.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { DateInputOrder } from "@solve-js/constants/Configuration";

const read = (expression: string, inputOrder: DateInputOrder, inputLocale?: string): string => {
  const engine = newTrackedEngine({ config: { date: { inputOrder, inputLocale } } });
  return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
};

const MISMATCH = /is not a date read/;
const NOT_A_DAY = /is not a real date/;

describe("shape: iso, a hyphen run with a four-digit leading group", () => {
  test("reads year-month-day under every order", () => {
    expect(read("2026-04-03", "auto")).toBe("Friday, April 3, 2026");
    expect(read("2026-04-03", "DMY")).toBe("Friday, April 3, 2026");
    expect(read("2026-04-03", "MDY")).toBe("Friday, April 3, 2026");
    expect(read("2026-04-03", "YMD")).toBe("Friday, April 3, 2026");
    expect(read("2026-04-03", "locale", "en-US")).toBe("Friday, April 3, 2026");
  });

  test("unpadded groups included", () => {
    expect(read("2024-5-3", "auto")).toBe("Friday, May 3, 2024");
    expect(read("2024-5-3", "DMY")).toBe("Friday, May 3, 2024");
    expect(read("2024-5-3", "MDY")).toBe("Friday, May 3, 2024");
    expect(read("2024-5-3", "YMD")).toBe("Friday, May 3, 2024");
  });

  test("and refuses when it names no real day, under every order", () => {
    expect(read("2026-02-29", "auto")).toMatch(NOT_A_DAY);
    expect(read("2026-02-29", "DMY")).toMatch(NOT_A_DAY);
    expect(read("2026-02-29", "MDY")).toMatch(NOT_A_DAY);
    expect(read("2026-02-29", "YMD")).toMatch(NOT_A_DAY);
    expect(read("2026-13-01", "auto")).toMatch(NOT_A_DAY);
    expect(read("2026-13-01", "DMY")).toMatch(NOT_A_DAY);
    expect(read("2026-13-01", "MDY")).toMatch(NOT_A_DAY);
    expect(read("2026-13-01", "YMD")).toMatch(NOT_A_DAY);
  });
});

describe("shape: year-last-4, one or two digits then a four-digit year", () => {
  test("under 'auto' a slash run is day first and a hyphen run month first", () => {
    expect(read("03/04/2026", "auto")).toBe("Friday, April 3, 2026");
    expect(read("12-25-2026", "auto")).toBe("Friday, December 25, 2026");
  });

  test("under 'DMY' both separators are day first", () => {
    expect(read("03/04/2026", "DMY")).toBe("Friday, April 3, 2026");
    expect(read("25-12-2026", "DMY")).toBe("Friday, December 25, 2026");
  });

  test("under 'MDY' both separators are month first", () => {
    expect(read("03/04/2026", "MDY")).toBe("Wednesday, March 4, 2026");
    expect(read("12-25-2026", "MDY")).toBe("Friday, December 25, 2026");
  });

  test("under 'locale' the tag's order decides, exactly as naming it does", () => {
    expect(read("03/04/2026", "locale", "en-GB")).toBe("Friday, April 3, 2026");
    expect(read("03/04/2026", "locale", "en-US")).toBe("Wednesday, March 4, 2026");
  });

  test("a run the order cannot read, which the other order can, is an order mismatch", () => {
    expect(read("12/25/2026", "auto")).toMatch(MISMATCH);
    expect(read("12/25/2026", "DMY")).toMatch(MISMATCH);
    expect(read("25/12/2023", "MDY")).toMatch(MISMATCH);
    expect(read("25-12-2026", "auto")).toMatch(MISMATCH);
    expect(read("12-25-2026", "DMY")).toMatch(MISMATCH);
  });

  test("a run no order can read is not a calendar day", () => {
    expect(read("31/04/2026", "auto")).toMatch(NOT_A_DAY);
    expect(read("31/04/2026", "DMY")).toMatch(NOT_A_DAY);
    expect(read("29/02/2026", "DMY")).toMatch(NOT_A_DAY);
    expect(read("13/13/2026", "DMY")).toMatch(NOT_A_DAY);
    expect(read("13/13/2026", "MDY")).toMatch(NOT_A_DAY);
  });

  test("under 'YMD' there are no day and month roles to apply, so it refuses too", () => {
    // The hole a shape-blind rule leaves: the probe reads en-CA, ja-JP, sv-SE
    // and zh-CN as year-first, so under the coming 'locale' default a Canadian
    // reader typing the commonest ambiguous date would otherwise get a
    // plausible number back.
    expect(read("03/04/2026", "YMD")).toMatch(MISMATCH);
    expect(read("25/12/2023", "YMD")).toMatch(MISMATCH);
    expect(read("12/25/2026", "YMD")).toMatch(MISMATCH);
    expect(read("31/02/2026", "YMD")).toMatch(NOT_A_DAY);
  });

  test("and this shape never falls through to arithmetic", () => {
    // Every cell above is either a date or a refusal. As division, the whole
    // shape is a number nobody writes: 03/04/2026 is 0.0004.
    for (const order of ["auto", "DMY", "MDY", "YMD"] as const) {
      expect(read("12/25/2026", order)).not.toMatch(/^[\d,.]+$/);
    }
  });
});

describe("shape: year-first-4, a four-digit leading group with slashes", () => {
  test("is a date under 'YMD' alone", () => {
    expect(read("2026/04/03", "YMD")).toBe("Friday, April 3, 2026");
    expect(read("2023/12/25", "YMD")).toBe("Monday, December 25, 2023");
  });

  test("and is ordinary division under every other order, which is the point", () => {
    expect(read("2026/04/03", "auto")).toBe("168.83");
    expect(read("2026/04/03", "DMY")).toBe("168.83");
    expect(read("2026/04/03", "MDY")).toBe("168.83");
    expect(read("1000/10/5", "DMY")).toBe("20");
    expect(read("1024/8/2", "DMY")).toBe("64");
    expect(read("1000/12/4", "DMY")).toBe("20.83");
    expect(read("2000/12/25", "DMY")).toBe("6.67");
  });

  test("including when it names no real day: a four-digit numerator is arithmetic", () => {
    // The cost this design names out loud. Refusing here would claim
    // `1024/8/2 = 64` from arithmetic, which would be a worse bug than the one
    // being fixed.
    expect(read("2026/02/29", "DMY")).toBe("34.93");
    expect(read("2026/13/01", "YMD")).toBe("155.85");
  });
});

describe("shape: short, every group one or two digits", () => {
  test("keeps today's reading exactly", () => {
    expect(read("25/12/23", "auto")).toBe("Monday, December 25, 2023");
    expect(read("25/12/23", "DMY")).toBe("Monday, December 25, 2023");
    expect(read("12/13/14", "MDY")).toBe("Saturday, December 13, 2014");
    expect(read("12-25-23", "auto")).toBe("Monday, December 25, 2023");
  });

  test("and falls through to arithmetic when it does not resolve, never refusing", () => {
    // A two-digit year is too weak a signal to hang a refusal on, so this
    // whole class of ordinary fraction chains is protected.
    expect(read("12/13/14", "DMY")).toBe("0.07");
    expect(read("12/13/14", "auto")).toBe("0.07");
    expect(read("12/13/14", "YMD")).toBe("0.07");
    expect(read("1/2/3", "DMY")).toBe("0.17");
    expect(read("25/25/23", "DMY")).toBe("0.04");
  });
});

describe("shape: none, a run that is not date-shaped at all", () => {
  test("is arithmetic under every order", () => {
    for (const order of ["auto", "DMY", "MDY", "YMD"] as const) {
      expect(read("100/25/2", order)).toBe("2");
      expect(read("1000-500-200", order)).toBe("300");
      expect(read("16/9", order)).toBe("1.78");
    }
  });
});
