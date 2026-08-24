import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #135: adding a percentage to money drifted to the wrong cent.
 *
 * `$0.10 + 15%` is `$0.10 * 1.15 = $0.115`, which rounds half-away-from-zero (the
 * documented till rule) to `$0.12`. It answered `$0.11` because the result was a
 * bare double (`0.10 * 1.15 = 0.1149999...`) with no exact-decimal sidecar, so
 * the formatter rounded it down. The equivalent multiply `$0.10 * 1.15` was
 * already exact, which is what made this a self-inconsistent regression.
 */
describe("Issue #135: percentage on money stays exact", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
  });

  const money = (source: string): string => formatValue(engine.evaluateExpression(source)[0]);

  test.each([
    ["$0.10 + 15%", "= $0.12"],
    ["$1.90 + 5%", "= $2.00"],
    ["$4.55 + 10%", "= $5.01"],
    ["$0.70 + 5%", "= $0.74"],
    ["$0.30 + 15%", "= $0.35"],
    ["$300 + 15%", "= $345.00"],
  ])("%s => %s", (source, expected) => {
    expect(money(source)).toBe(expected);
  });

  test("a percentage on the left reads the same way", () => {
    expect(money("15% + $0.10")).toBe("= $0.12");
  });

  test("subtraction is exact too", () => {
    expect(money("$5.005 - 10%")).toBe(money("$5.005 * 0.9"));
  });

  test("matches the mathematically identical exact multiply", () => {
    for (const [pct, factor] of [["15%", "1.15"], ["5%", "1.05"], ["10%", "1.10"]]) {
      expect(money(`$0.10 + ${pct}`)).toBe(money(`$0.10 * ${factor}`));
    }
  });

  test("a fractional percentage still resolves", () => {
    expect(money("$100 + 33.5%")).toBe("= $133.50");
  });

  test("a non-money unit is unaffected", () => {
    expect(money("5 kg + 10%")).toBe("= 5.50 kg");
  });
});
