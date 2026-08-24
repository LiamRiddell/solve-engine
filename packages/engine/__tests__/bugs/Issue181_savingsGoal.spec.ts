import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #181: savings goals, the inverse of the saving maths the engine runs
 * forwards. `how long to save <target> at <amount> <period> [at <rate>]` answers
 * a duration; `how much per month to save|reach <target> in <duration> [at
 * <rate>]` answers a level monthly contribution.
 *
 * Worked numbers (hand-derived, monthly compounding, annuity future value):
 *  - $10,000 at $500 monthly, no rate: 10000 / 500 = 20 months.
 *  - $10,000 at $500 monthly at 12%: n = ln(1 + 10000·0.01/500) / ln(1.01)
 *    = ln(1.2)/ln(1.01) = 18.32, ceil -> 19 months (a part period has not
 *    reached the goal, so the count rounds up).
 *  - $12,000 in 2 years, no rate: 12000 / 24 = $500.00 a month.
 *  - $12,000 in 2 years at 6%: PMT = 12000·0.005 / ((1.005)^24 - 1) = $471.85.
 */
describe("Issue #181: savings goals", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
  });

  const value = (s: string) => engine.evaluateExpression(s)[0];
  const num = (s: string): number => value(s).toNumber();
  const out = (s: string): string => formatValue(value(s));

  describe("how long to save, a duration in the contribution's own unit", () => {
    test("interest-free is an exact division, in months", () => {
      expect(out("how long to save $10,000 at $500 monthly")).toBe("= 20 months");
      expect(value("how long to save $10,000 at $500 monthly").type).toBe(ValueType.Uom);
    });
    test("a rate reaches the goal sooner, and the count rounds up", () => {
      expect(out("how long to save $10,000 at $500 monthly at 12%")).toBe("= 19 months");
    });
    test("the period word sets the unit (weekly)", () => {
      expect(out("how long to save $10,000 at $500 weekly")).toBe("= 20 weeks");
    });
  });

  describe("how much per month, a level contribution", () => {
    test("interest-free is an exact division", () => {
      expect(out("how much per month to save $12,000 in 2 years")).toBe("= $500.00");
    });
    test("reach is accepted wherever save is", () => {
      expect(out("how much per month to reach $12,000 in 2 years")).toBe("= $500.00");
    });
    test("a duration in months works too", () => {
      expect(out("how much per month to save $12,000 in 24 months")).toBe("= $500.00");
    });
    test("a rate lowers the contribution needed, since interest helps", () => {
      expect(out("how much per month to save $12,000 in 2 years at 6%")).toBe("= $471.85");
    });
    test("a bare-number target answers a bare number", () => {
      const v = value("how much per month to save 12000 in 24 months");
      expect(v.type).toBe(ValueType.Number);
      expect(v.toNumber()).toBe(500);
    });
  });

  describe("boundaries and errors", () => {
    test("an unknown period names the accepted set", () => {
      expect(() => engine.evaluateExpression("how long to save $10,000 at $500 fortnightly")).toThrow(/period/i);
    });
    test("a per-month plan rejects a duration that is not months or years", () => {
      expect(out("how much per month to save $12,000 in 30 weeks")).toMatch(/months or years/i);
    });
    test("a non-positive target is refused", () => {
      expect(out("how long to save 0 at $500 monthly")).toMatch(/positive/i);
    });
  });

  describe("the phrase words stay ordinary names", () => {
    test("save, reach and how are usable as variables", () => {
      engine.evaluateExpression(":save = 3");
      engine.evaluateExpression(":reach = 4");
      expect(num("save + reach")).toBe(7);
    });
  });
});
