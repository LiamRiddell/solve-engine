import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #151: a percentage times money drifted a cent.
 *
 * #135 made `$X + p%` exact, but the multiply spellings `p% of $X` and
 * `$X * p%` were left on the float path, so `15% of $0.10` answered `$0.01`
 * instead of the `$0.02` the documented half-cent rule gives — disagreeing both
 * with the exact multiply `$0.10 * 0.15` and with the fixed additive `$0.10 + 15%`.
 *
 * The fix routes a Percentage times a currency through the same base-ten scaling
 * (`of` compiles to MUL, so both spellings are covered).
 */
describe("Issue #151: a percentage of money stays exact", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  const money = (source: string): string => formatValue(engine.evaluateExpression(source));

  test.each([
    ["15% of $0.10", "= $0.02"],
    ["$0.10 * 15%", "= $0.02"],
    ["5% of $0.30", "= $0.02"],
    ["$0.30 * 5%", "= $0.02"],
    ["10% of $100", "= $10.00"],
    ["$100 * 20%", "= $20.00"],
  ])("%s => %s", (source, expected) => {
    expect(money(source)).toBe(expected);
  });

  test("the three spellings of the same product agree", () => {
    expect(money("15% of $0.10")).toBe(money("$0.10 * 15%"));
    expect(money("$0.10 * 15%")).toBe(money("$0.10 * 0.15"));
  });

  test("a non-currency unit keeps its float multiply", () => {
    expect(money("10% of 5 kg")).toBe("= 0.50 kg");
  });
});
