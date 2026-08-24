import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

describe("Issue #81: Percentage calculation error", () => {
  let engine: ExpressionEngine;

  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  // Releases the engine's query client and async batcher. Without it the
  // engine outlives the test file and its pending work lands in whatever
  // runs next, which under --runInBand is the same process.
  afterEach(() => {
  	engine.clear();
  });

  test("15% should resolve to 0.15", () => {
    const result = engine.evaluateLine(1, "15%");
    expect(result.toNumber()).toBeCloseTo(0.15, 10);
  });

  test("50% should resolve to 0.5", () => {
    const result = engine.evaluateLine(1, "50%");
    expect(result.toNumber()).toBeCloseTo(0.5, 10);
  });

  // Changed 2026-08-06, deliberately. This used to assert 1.4, on the reading
  // that `15%` is the number 0.15 and addition is addition. A percentage added
  // to a quantity is now relative to that quantity, which is what Soulver does
  // and what `200 + 10%` has to mean for the answer to be 220 rather than
  // 200.10. So the chain compounds: 1 + 15% = 1.15, and 1.15 + 25% = 1.4375.
  //
  // The rest of this file is untouched and still passes, which is the useful
  // part: issue #81 was reported because `15%` did not resolve to 0.15 at all,
  // and it still does.
  test("1+15%+25% compounds, each percentage applying to the running total", () => {
    const result = engine.evaluateLine(1, "1+15%+25%");
    // 1 × 1.15 = 1.15, then 1.15 × 1.25 = 1.4375
    expect(result.toNumber()).toBeCloseTo(1.4375, 10);
  });

  test("percentage as multiplication operand: 200*10%", () => {
    const result = engine.evaluateLine(1, "200*10%");
    // 200 * 0.10 = 20
    expect(result.toNumber()).toBeCloseTo(20, 10);
  });

  test("percentage with addition: 100+10% is a 10% increase", () => {
    const result = engine.evaluateLine(1, "100+10%");
    // 100 × 1.10 = 110. Was 100.1, see the note above.
    expect(result.toNumber()).toBeCloseTo(110, 10);
  });

  test("chained percentage: 50%+25%", () => {
    const result = engine.evaluateLine(1, "50%+25%");
    // 0.50 + 0.25 = 0.75
    expect(result.toNumber()).toBeCloseTo(0.75, 10);
  });

  test("percentage precedence with multiplication: 10+20%*2", () => {
    // % has bp=60 (Prefix), * has bp=40 (Product)
    // So % binds tighter: 10 + (20%) * 2 = 10 + 0.20 * 2 = 10.40
    const result = engine.evaluateLine(1, "10+20%*2");
    expect(result.toNumber()).toBeCloseTo(10.4, 10);
  });
});