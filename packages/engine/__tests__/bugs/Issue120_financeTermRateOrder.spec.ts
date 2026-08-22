import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Issue #120: interest and repayment forms accepted only the term before the
 * rate.
 *
 * `interest on 1000 over 3 years at 5%` worked, but the equally natural
 * `interest on 1000 at 5% over 3 years` threw `Expected OVER but got RATE_AT`.
 * The two clauses are independent — `over` names the term, `at` names the rate —
 * so a calculator that reads like a sentence should accept either order.
 *
 * The fix parses the term and rate clauses in either order and swaps the operands
 * only when the term came first, so both orders reach the same builtin.
 */
describe("Issue #120: interest and repayment accept term and rate in either order", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const num = (source: string): number => engine.evaluateExpression(source)[0].toNumber();

  test.each([
    // [term-first (already worked), rate-first (was a parse error)]
    ["interest on 1000 over 3 years at 5%", "interest on 1000 at 5% over 3 years"],
    ["compound interest on 1000 over 3 years at 5%", "compound interest on 1000 at 5% over 3 years"],
    ["monthly repayment on 200000 over 25 years at 4%", "monthly repayment on 200000 at 4% over 25 years"],
    ["total repayment on 200000 over 25 years at 4%", "total repayment on 200000 at 4% over 25 years"],
  ])("`%s` == `%s`", (termFirst, rateFirst) => {
    expect(num(rateFirst)).toBeCloseTo(num(termFirst), 6);
  });

  test("the documented values are reproduced in both orders", () => {
    expect(num("interest on 1000 at 5% over 3 years")).toBeCloseTo(157.63, 2);
    expect(num("monthly repayment on 200000 at 4% over 25 years")).toBeCloseTo(1055.67, 2);
  });

  test("a trailing compounding interval still parses after the rate-first clauses", () => {
    expect(num("interest on 1000 at 5% over 3 years compounding monthly")).toBeCloseTo(
      num("interest on 1000 over 3 years at 5% compounding monthly"),
      6,
    );
  });

  test("a missing clause still errors clearly rather than being silently accepted", () => {
    expect(() => engine.evaluateExpression("interest on 1000 at 5%")).toThrow();
    expect(() => engine.evaluateExpression("interest on 1000 over 3 years")).toThrow();
  });
});
