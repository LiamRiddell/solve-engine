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
 *
 * Five of them changed at 2.34.4, and the arithmetic did not. A quantity too
 * small to survive two decimal places is now shown to three significant digits
 * instead of as a `0.00` nobody could tell from a real zero, so `12/25/2026`
 * read as division reads `0.000237` rather than `0.00`. That is a display
 * change across the whole engine, not something this opt-out does: the value it
 * restores is the same division it always was, and it is now legible. The
 * strings below are re-measured to match, and each name says what it is now.
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
  test("12/25/2026 is the division again, under auto and DMY", () => {
    expect(restored("12/25/2026", "auto")).toBe("0.000237");
    expect(restored("12/25/2026", "DMY")).toBe("0.000237");
  });

  test("12-25-2026 under DMY is -2,039 again", () => {
    expect(restored("12-25-2026", "DMY")).toBe("-2,039");
  });

  test("25/12/2023 under MDY is the division again", () => {
    expect(restored("25/12/2023", "MDY")).toBe("0.00103");
  });

  test("03/04/2026 under YMD is the division again", () => {
    expect(restored("03/04/2026", "YMD")).toBe("0.00037");
  });

  test("31/04/2026 is the division again", () => {
    expect(restored("31/04/2026", "DMY")).toBe("0.00383");
  });

  test("29/02/2026 is 0.01 again", () => {
    expect(restored("29/02/2026", "DMY")).toBe("0.01");
  });

  test("13/13/2026 is the division again", () => {
    expect(restored("13/13/2026", "DMY")).toBe("0.000494");
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

describe("the one refusal the opt-out does not restore", () => {
  test("a dot run no order reads refuses under 'arithmetic' too", () => {
    // Named at the top of the changeset because it is the single behaviour
    // this minor removes without an escape. The escape cannot exist: a dot run
    // that is not a date was never a number, it was the parse error
    // `Unexpected token after expression: ".2026"`, and the house rule forbids
    // an error as an answer.
    expect(restored("25.12.2026", "MDY")).toMatch(/is not a date read month first/);
    expect(restored("31.02.2026", "DMY")).toMatch(/is not a real date/);
    expect(restored("12.13.14", "DMY")).toMatch(/is not a date read day first/);
  });

  test("while the slash spelling of the same digits is restored as usual", () => {
    // The two differ because one of them really is arithmetic: `12/13/14` is a
    // fraction chain and `12.13.14` is a parse error.
    expect(restored("12/13/14", "DMY")).toBe("0.07");
    expect(restored("31/02/2026", "DMY")).toBe("0.01");
  });

  test("and a dot date that reads perfectly well is untouched by either setting", () => {
    expect(restored("25.12.2026", "DMY")).toBe("Friday, December 25, 2026");
    expect(refused("25.12.2026", "DMY")).toBe("Friday, December 25, 2026");
  });
});
