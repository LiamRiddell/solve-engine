import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #161: a chained percentage-of-percentage on money drifted a cent.
 *
 * #151 made `p% of $X` exact, but its handler fired only when an operand was
 * literally a Percentage. A chained `50% of 1% of $3` reduces `50% of 1%` to a
 * bare Number `0.005` first, so the outer `... of $3` multiplied money by a plain
 * Number and fell to the float path, displaying $0.01 while every single-multiply
 * spelling of the same $0.015 displayed $0.02 — the answer became grouping-
 * dependent.
 *
 * The fix scales money by any scalar (a Percentage or a plain/computed Number)
 * through the exact base-ten path, while leaving a rational scalar (`$3 * 2/7`)
 * on its exact-fraction path.
 */
describe("Issue #161: a chained percentage of money stays exact", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const money = (source: string): string => formatValue(engine.evaluateExpression(source)[0]);

  test.each([
    "50% of 1% of $3",
    "25% of 2% of $3",
    "(50% of 1%) of $3",
    "1% of 50% of $3",
  ])("`%s` is $0.02, matching the single-multiply spellings", (source) => {
    expect(money(source)).toBe("= $0.02");
    // Agrees with the right-grouped and literal-factor forms.
    expect(money(source)).toBe(money("50% of (1% of $3)"));
    expect(money(source)).toBe(money("$3 * 0.005"));
  });

  test("the single-percentage case is still exact", () => {
    expect(money("15% of $0.10")).toBe("= $0.02");
    expect(money("$100 * 20%")).toBe("= $20.00");
  });

  test("a rational scalar keeps its exact fraction, not a flattened decimal", () => {
    // $3 * 2/7 = $6/7 = $0.857142..., which must round to $0.86 from the exact
    // fraction, not be pre-flattened to a short decimal.
    expect(money("$3 * 2/7")).toBe("= $0.86");
  });

  test("a non-currency unit keeps its float multiply", () => {
    expect(money("10% of 5 kg")).toBe("= 0.50 kg");
  });
});
