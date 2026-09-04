/**
 * Adjacency still decides date-versus-arithmetic, before any shape or order is
 * considered.
 *
 * What was wrong: nothing here, and that is the point. Classifying a run by
 * shape and refusing what no order can read is a change to what a DATE means,
 * and it must not become a change to what a SUBTRACTION means. `2024 - 5 - 3`
 * is 2,016 and no setting makes it anything else: a person who typed the
 * spaces typed an operator.
 *
 * What is pinned here: the spaced chains, padded and unpadded, under every
 * order and both values of `date.onAmbiguous`, including the ones whose
 * unspaced spelling is now refused. Without this, a rule that refused
 * `2024-13-01` could quietly start refusing `2024 - 13 - 01` too, and the
 * failure would look like a date bug rather than an arithmetic one.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { DateAmbiguity, DateInputOrder } from "@solve-js/constants/Configuration";

const ORDERS: DateInputOrder[] = ["auto", "DMY", "MDY", "YMD"];
const POLICIES: DateAmbiguity[] = ["refuse", "arithmetic"];

const read = (expression: string, inputOrder: DateInputOrder, onAmbiguous: DateAmbiguity): string => {
  const engine = newTrackedEngine({ config: { date: { inputOrder, onAmbiguous } } });
  return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
};

describe("a spaced chain is arithmetic", () => {
  test("2024 - 5 - 3 is 2,016 under every order and both policies", () => {
    for (const order of ORDERS) {
      for (const policy of POLICIES) {
        expect(read("2024 - 5 - 3", order, policy)).toBe("2,016");
      }
    }
  });

  test("and so is the padded spelling, 2024 - 05 - 03", () => {
    // Padding is not the distinction: a person subtracting may write "05" for
    // the same reason they write it anywhere else.
    for (const order of ORDERS) {
      for (const policy of POLICIES) {
        expect(read("2024 - 05 - 03", order, policy)).toBe("2,016");
      }
    }
  });

  test("including chains whose unspaced spelling is now refused", () => {
    for (const order of ORDERS) {
      for (const policy of POLICIES) {
        expect(read("2024 - 13 - 01", order, policy)).toBe("2,010");
        expect(read("2024 - 05 - 32", order, policy)).toBe("1,987");
        expect(read("12 / 25 / 2026", order, policy)).toBe("0.00");
        expect(read("31 / 02 / 2026", order, policy)).toBe("0.01");
      }
    }
  });
});

describe("while the same characters written as one run are a date attempt", () => {
  test("which is the whole difference the rule rests on", () => {
    expect(read("2024-5-3", "auto", "refuse")).toBe("Friday, May 3, 2024");
    expect(read("2024 - 5 - 3", "auto", "refuse")).toBe("2,016");
  });
});
