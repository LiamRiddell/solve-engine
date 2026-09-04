/**
 * The opt-out: `date.onAmbiguous: 'arithmetic'` restores every value the
 * refusal took away, byte for byte.
 *
 * This is what makes refusing a legitimate minor rather than a major. A host
 * that really did rely on `12/25/2026` being a fraction sets one field and is
 * whole again, so nobody has to wait for a major release for a wrong number to
 * stop being the default.
 *
 * What is pinned here: the ten values measured on the release before this one,
 * asserted against those literal strings rather than recomputed, so a change
 * of formatting or of arithmetic cannot quietly redefine what "restored"
 * means. Each was taken from a run of 2.25.0 on this branch's base.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { DateInputOrder } from "@solve-js/constants/Configuration";

const restored = (expression: string, inputOrder: DateInputOrder): string => {
  const engine = newTrackedEngine({ config: { date: { inputOrder, onAmbiguous: "arithmetic" } } });
  return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
};

const refused = (expression: string, inputOrder: DateInputOrder): string => {
  const engine = newTrackedEngine({ config: { date: { inputOrder } } });
  return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
};

describe("the ten values the refusal replaced", () => {
  test("12/25/2026 is 0.00 again, under auto and DMY", () => {
    expect(restored("12/25/2026", "auto")).toBe("0.00");
    expect(restored("12/25/2026", "DMY")).toBe("0.00");
  });

  test("12-25-2026 under DMY is -2,039 again", () => {
    expect(restored("12-25-2026", "DMY")).toBe("-2,039");
  });

  test("25/12/2023 under MDY is 0.00 again", () => {
    expect(restored("25/12/2023", "MDY")).toBe("0.00");
  });

  test("03/04/2026 under YMD is 0.00 again", () => {
    expect(restored("03/04/2026", "YMD")).toBe("0.00");
  });

  test("31/04/2026 is 0.00 again", () => {
    expect(restored("31/04/2026", "DMY")).toBe("0.00");
  });

  test("29/02/2026 is 0.01 again", () => {
    expect(restored("29/02/2026", "DMY")).toBe("0.01");
  });

  test("13/13/2026 is 0.00 again", () => {
    expect(restored("13/13/2026", "DMY")).toBe("0.00");
  });

  test("2026-02-29 is 1,995 again, under every order", () => {
    for (const order of ["auto", "DMY", "MDY", "YMD"] as const) {
      expect(restored("2026-02-29", order)).toBe("1,995");
    }
  });

  test("2026-13-01 is 2,012 again, under every order", () => {
    for (const order of ["auto", "DMY", "MDY", "YMD"] as const) {
      expect(restored("2026-13-01", order)).toBe("2,012");
    }
  });

  test("31/02/2026 + 1 day is 1.01 day again", () => {
    expect(restored("31/02/2026 + 1 day", "auto")).toBe("1.01 day");
  });
});

describe("what the opt-out does not change", () => {
  test("a date that reads perfectly well still reads the same way", () => {
    expect(restored("03/04/2026", "DMY")).toBe("Friday, April 3, 2026");
    expect(restored("03/04/2026", "MDY")).toBe("Wednesday, March 4, 2026");
    expect(restored("2026-04-03", "MDY")).toBe("Friday, April 3, 2026");
    expect(restored("25/12/23", "auto")).toBe("Monday, December 25, 2023");
  });

  test("and ordinary arithmetic is untouched either way", () => {
    for (const order of ["auto", "DMY", "MDY", "YMD"] as const) {
      expect(restored("2024 - 5 - 3", order)).toBe(refused("2024 - 5 - 3", order));
      expect(restored("1000/10/5", order)).toBe(refused("1000/10/5", order));
      expect(restored("12/13/14", order)).toBe(refused("12/13/14", order));
      expect(restored("100/25/2", order)).toBe(refused("100/25/2", order));
    }
  });
});

describe("the default", () => {
  test("is to refuse, so a host gets the fix without configuring anything", () => {
    expect(newTrackedEngine().getConfig().date.onAmbiguous).toBe("refuse");
    expect(refused("12/25/2026", "DMY")).toMatch(/there is no month 25/);
  });
});
