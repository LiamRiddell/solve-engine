import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #108: explicit decimal-place precision for bare numbers.
 *
 * A number is shown to two places by default, and `<x> to N dp` rounded the
 * value but the display still used the default, so `3.14159 to 4 dp` showed
 * `3.14` and `100 to 2 dp` showed `100`. The value carries a `decimalPlaces`
 * display precision now, set by `<x> to N dp` and the two-argument `round(x, N)`,
 * so it shows exactly that many places with trailing zeros kept, and the rounding
 * is exact where the number has an exact decimal (`1.005 to 2 dp` is `1.01`).
 */
describe("Issue #108: decimal-place precision on a number", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const out = (source: string): string => formatValue(engine.evaluateExpression(source)[0]);
  const val = (source: string) => engine.evaluateExpression(source)[0];

  describe("`to N dp` shows exactly N places, trailing zeros kept", () => {
    test.each([
      ["3.14159 to 4 dp", "= 3.1416"],
      ["1.5 to 2 dp", "= 1.50"],
      ["100 to 2 dp", "= 100.00"],
      ["1/3 to 5 dp", "= 0.33333"],
      ["0 to 2 dp", "= 0.00"],
      ["1234.5678 to 2 dp", "= 1,234.57"],
      ["1/3 to 0 dp", "= 0"],
    ])("%s => %s", (source, expected) => {
      expect(out(source)).toBe(expected);
    });
  });

  describe("the two-argument round(x, N) is the same idea as a function", () => {
    test.each([
      ["round(3.14159, 2)", "= 3.14"],
      ["round(1.5, 2)", "= 1.50"],
      ["round(1234.5678, 2)", "= 1,234.57"],
    ])("%s => %s", (source, expected) => {
      expect(out(source)).toBe(expected);
    });

    test("round(x) with one argument is still nearest-whole", () => {
      expect(out("round(3.7)")).toBe("= 4");
      expect(out("round(2)")).toBe("= 2");
    });

    test("`round(x, N)` and `x to N dp` agree", () => {
      expect(out("round(1.005, 2)")).toBe(out("1.005 to 2 dp"));
    });
  });

  describe("rounding is exact where the number has an exact decimal", () => {
    test.each([
      ["1.005 to 2 dp", "= 1.01"],
      ["2.675 to 2 dp", "= 2.68"],
      ["0.125 to 2 dp", "= 0.13"],
    ])("%s => %s (half at the last place goes up)", (source, expected) => {
      expect(out(source)).toBe(expected);
    });
  });

  test("the value carries the display precision as metadata", () => {
    const r = val("3.14159 to 4 dp");
    expect(r.type).toBe(ValueType.Number);
    expect(r.toNumber()).toBeCloseTo(3.1416, 10);
    expect(r.decimalPlaces).toBe(4);
  });

  test("the precision is not propagated through later arithmetic", () => {
    // `(3.14159 to 4 dp) + 0` re-decides precision, back to the default.
    expect(val("(3.14159 to 4 dp) + 0").decimalPlaces).toBeUndefined();
    expect(out("3.14159 to 4 dp")).toBe("= 3.1416");
    expect(out("(3.14159 to 4 dp) + 0")).toBe("= 3.14");
  });

  test("a bare number with no precision request is unchanged", () => {
    expect(out("0.1 + 0.2")).toBe("= 0.30");
    expect(out("19.99 * 3")).toBe("= 59.97");
    expect(val("1.5").decimalPlaces).toBeUndefined();
  });
});
