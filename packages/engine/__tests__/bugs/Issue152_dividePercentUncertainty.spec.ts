import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Issue #152: dividing a measurement by a percentage dropped the uncertainty.
 *
 * #139 added percentage-uncertainty handling for `*` but not `/`, so
 * `(100 +/- 5) / 10%` returned a bare `1000` with no tolerance. `X / 10%` is
 * `X / 0.1 = X * 10`, a scalar multiply, so the 5% relative spread is preserved:
 * `1000 ± 50`. The docs promise `+ - * /` all propagate uncertainty.
 *
 * The fix adds a DIV counterpart to the MUL percentage-uncertainty handler.
 */
describe("Issue #152: divide-by-percentage carries the uncertainty", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const val = (source: string) => engine.evaluateExpression(source)[0];

  test.each([
    ["(100 +/- 5) / 10%", 1000, 50],
    ["(50 +/- 2) / 25%", 200, 8],
    ["(200 +/- 10) / 50%", 400, 20],
  ])("%s is %d ± %d", (source, center, tol) => {
    const r = val(source);
    expect(r.toNumber()).toBeCloseTo(center, 10);
    expect(r.uncertainty).toBeCloseTo(tol, 10);
  });

  test("the * sibling still carries it (regression guard)", () => {
    const r = val("(100 +/- 5) * 10%");
    expect(r.toNumber()).toBeCloseTo(10, 10);
    expect(r.uncertainty).toBeCloseTo(0.5, 10);
  });

  test("plain division still carries it", () => {
    expect(val("(100 +/- 5) / 2").uncertainty).toBeCloseTo(2.5, 10);
  });

  test("dividing a certain number by a percentage is unchanged (no tolerance)", () => {
    const r = val("100 / 10%");
    expect(r.toNumber()).toBeCloseTo(1000, 10);
    expect(r.uncertainty).toBeUndefined();
  });
});
