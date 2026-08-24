import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #153: `tax off` / `tax in` on money drifted a half-cent.
 *
 * #138 made the multiply tax forms (`tax on`, `taxAdd`) exact, but the divide
 * forms `tax off` (taxRemove) and `tax in` (taxIn) still computed `amount /
 * (1 + rate)` as a bare double, so `tax off $0.09 at 20%` (true net $0.075)
 * displayed $0.07 while the same $0.075 via the multiply path (`tax on $0.50 at
 * 15%`) correctly displayed $0.08.
 *
 * The fix routes the divide forms through exact decimal division
 * (`removeTaxExact`/`taxInExact`), exact where the quotient terminates — the
 * cases that land on a half-cent — and falling back to the float only where no
 * exact value exists.
 */
describe("Issue #153: tax off / tax in on money round the half-cent exactly", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
  });

  const money = (source: string): string => formatValue(engine.evaluateExpression(source)[0]);
  const num = (source: string): number => engine.evaluateExpression(source)[0].toNumber();

  describe("tax off $X at R% (the pre-tax amount)", () => {
    test.each([
      ["tax off $0.09 at 20%", "= $0.08"],
      ["tax off $0.21 at 20%", "= $0.18"],
      ["tax off $0.57 at 20%", "= $0.48"],
      ["tax off $120 at 20%", "= $100.00"],
      ["vat off $0.09 at 20%", "= $0.08"],
    ])("%s => %s", (source, expected) => {
      expect(money(source)).toBe(expected);
    });
  });

  describe("tax in $X at R% (the tax already inside)", () => {
    test.each([
      ["tax in $0.09 at 20%", "= $0.02"],
      ["tax in $0.57 at 20%", "= $0.10"],
      ["tax in $120 at 20%", "= $20.00"],
    ])("%s => %s", (source, expected) => {
      expect(money(source)).toBe(expected);
    });
  });

  test("tax off and tax in still sum back to the gross amount", () => {
    // $0.08 + $0.02 = $0.09, the invariant the float path broke ($0.07 + $0.01).
    expect(num("tax off $0.09 at 20%") + num("tax in $0.09 at 20%")).toBeCloseTo(0.09, 10);
  });

  test("a bare number and a non-currency unit keep their float result", () => {
    expect(num("tax off 120 at 20%")).toBeCloseTo(100, 10);
    expect(money("tax off 5 kg at 20%")).toBe("= 4.17 kg");
  });

  test("a non-terminating quotient still rounds correctly", () => {
    // $10.00 / 1.15 = $8.6956..., displays $8.70; exactness holds where it
    // exists and the far-below-cent rounding is right where it does not.
    expect(money("tax off $10.00 at 15%")).toBe("= $8.70");
  });
});
