import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #139: relative-percentage arithmetic dropped the uncertainty tolerance.
 *
 * `X + N%` means `X * (1 + N%)`, a scalar multiply, and a scalar multiply scales
 * a one-sigma spread by the same factor. So `(100 +/- 5) + 10%` is `110 ± 5.5`,
 * exactly what `(100 +/- 5) * 1.1` gives. The tolerance was silently lost across
 * all four spellings: `+`, `-`, `*` and `of`.
 */
describe("Issue #139: percentage arithmetic carries the uncertainty", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  function measured(source: string): { center: number; spread: number } {
    const v = engine.evaluateExpression(source)[0];
    expect(v.type).toBe(ValueType.Number);
    expect(v.uncertainty).toBeDefined();
    return { center: v.toNumber(), spread: v.uncertainty as number };
  }

  test.each([
    ["(100 +/- 5) + 10%", 110, 5.5],
    ["(100 +/- 5) - 10%", 90, 4.5],
    ["(100 +/- 5) * 10%", 10, 0.5],
    ["10% of (100 +/- 5)", 10, 0.5],
  ])("%s => %d ± %d", (source, center, spread) => {
    const m = measured(source);
    expect(m.center).toBeCloseTo(center, 6);
    expect(m.spread).toBeCloseTo(spread, 6);
  });

  test("matches the equivalent explicit scalar multiply", () => {
    const viaPercent = measured("(100 +/- 5) + 10%");
    const viaMultiply = measured("(100 +/- 5) * 1.1");
    expect(viaPercent.center).toBeCloseTo(viaMultiply.center, 6);
    expect(viaPercent.spread).toBeCloseTo(viaMultiply.spread, 6);
  });

  test("a plain number without a tolerance is unchanged", () => {
    const v = engine.evaluateExpression("200 + 10%")[0];
    expect(v.uncertainty).toBeUndefined();
    expect(v.toNumber()).toBeCloseTo(220, 6);
  });

  test("a non-uncertain percentage multiply is unchanged", () => {
    const v = engine.evaluateExpression("100 * 10%")[0];
    expect(v.uncertainty).toBeUndefined();
    expect(v.toNumber()).toBeCloseTo(10, 6);
  });
});
