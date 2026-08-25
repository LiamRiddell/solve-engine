import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Issue #162: a percentage divided by an uncertain number dropped the tolerance.
 *
 * #152 carried divide-by-percentage uncertainty only when the percentage was the
 * DIVISOR (`(100 +/- 5) / 10%`). The reverse — a Percentage over an uncertain
 * Number (`10% / (2 +/- 0.1)`) — silently dropped the tolerance, even though the
 * numerically identical `0.1 / (2 +/- 0.1)` carried it and the result is a plain
 * Number with no unit.
 *
 * The fix handles both arrangements: `p% / (b ± e)` = `a/b` with spread
 * `|a·e / b²|`.
 */
describe("Issue #162: a percentage over an uncertain number carries the uncertainty", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  const val = (source: string) => engine.evaluateExpression(source);

  test("`10% / (2 +/- 0.1)` is 0.05 ± 0.0025, like its bare-number twin", () => {
    const r = val("10% / (2 +/- 0.1)");
    expect(r.toNumber()).toBeCloseTo(0.05, 12);
    expect(r.uncertainty).toBeCloseTo(0.0025, 12);
    // Numerically identical to 0.1 / (2 +/- 0.1).
    expect(r.uncertainty).toBeCloseTo(val("0.1 / (2 +/- 0.1)").uncertainty as number, 12);
  });

  test.each([
    ["20% / (4 +/- 0.2)", 0.05, 0.0025],
    ["50% / (5 +/- 0.5)", 0.1, 0.01],
  ])("%s is %d ± %d", (source, center, tol) => {
    const r = val(source);
    expect(r.toNumber()).toBeCloseTo(center, 12);
    expect(r.uncertainty).toBeCloseTo(tol, 12);
  });

  test("the divisor-percentage direction still works (regression guard)", () => {
    const r = val("(100 +/- 5) / 10%");
    expect(r.toNumber()).toBeCloseTo(1000, 10);
    expect(r.uncertainty).toBeCloseTo(50, 10);
  });

  test("a percentage over a zero-centred uncertain number surfaces divide-by-zero, no bogus tolerance", () => {
    const r = val("10% / (0 +/- 0.1)");
    expect(r.toNumber()).toBe(Infinity);
    expect(r.uncertainty).toBeUndefined();
  });
});
