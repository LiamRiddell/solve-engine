import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #138: `tax on $X at R%` rounded a half-cent the wrong way.
 *
 * `tax on $0.10 at 15%` is `$0.10 * 0.15 = $0.015`, which rounds half-away-from-
 * zero (the documented till rule) to `$0.02`. It answered `$0.01` because the tax
 * builtin computed `amount * rate` as a bare double (`0.10 * 0.15 = 0.0149999...`)
 * with no exact-decimal sidecar, so the formatter rounded it down — the exact same
 * class of drift as #135, one builtin over. The identical exact multiply
 * `$0.10 * 0.15` was already correct, which is what made this self-inconsistent.
 *
 * `taxAdd` (the `$X * (1 + R)` tax-inclusive total) shares the mechanism and is
 * covered here too.
 */
describe("Issue #138: tax on money stays exact", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  const money = (source: string): string => formatValue(engine.evaluateExpression(source));

  describe("tax on $X at R% (the tax itself)", () => {
    test.each([
      ["tax on $0.10 at 15%", "= $0.02"],
      ["tax on $10.10 at 15%", "= $1.52"],
      ["tax on $300 at 15%", "= $45.00"],
      ["tax on $19.99 at 20%", "= $4.00"],
    ])("%s => %s", (source, expected) => {
      expect(money(source)).toBe(expected);
    });

    test("matches the mathematically identical exact multiply", () => {
      for (const [rate, factor] of [["15%", "0.15"], ["20%", "0.20"], ["8.5%", "0.085"]]) {
        expect(money(`tax on $0.10 at ${rate}`)).toBe(money(`$0.10 * ${factor}`));
      }
    });
  });

  describe("taxAdd($X, R) (the tax-inclusive total)", () => {
    test.each([
      ["taxAdd($0.10, 0.15)", "= $0.12"],
      ["taxAdd($300, 0.15)", "= $345.00"],
      ["taxAdd($4.55, 0.10)", "= $5.01"],
    ])("%s => %s", (source, expected) => {
      expect(money(source)).toBe(expected);
    });

    test("matches the phrase-form total $X + R%", () => {
      expect(money("taxAdd($0.10, 0.15)")).toBe(money("$0.10 + 15%"));
    });
  });

  test("a bare number keeps its plain value", () => {
    expect(money("tax on 100 at 20%")).toBe("= 20");
  });

  test("a non-currency unit is unaffected", () => {
    expect(money("tax on 5 kg at 10%")).toBe("= 0.50 kg");
  });
});
