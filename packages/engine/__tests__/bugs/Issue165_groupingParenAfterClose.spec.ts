import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #165: a grouping paren after `)` or `]` was lexed as a call.
 *
 * `precededByCallTarget()` treated a `(` right after `)`/`]` as a call, so the
 * thousands number inside the following grouping paren was split on its comma:
 * `(2)(1,000)` became `2 * (1, 0)` = the vector `[2, 0]`. But this grammar has no
 * curried/first-class calls (`f(1000)(2000)` errors) and no index-application
 * (`[1,2,3](0)` errors), so `)(` is implicit multiplication over a grouping.
 *
 * The fix drops the `)`/`]`-is-a-call branch: only an identifier or a `FUNC`
 * keyword opens a call, so `)(` keeps its thousands comma and multiplies.
 */
describe("Issue #165: `)(` is implicit multiplication over a grouping, not a call", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const num = (source: string): number => engine.evaluateExpression(source)[0].toNumber();

  describe("a grouped thousands number after a closing paren keeps its value", () => {
    // Invariant: `(a)(1,000)` == `(a)(1000)` == a * 1000, a scalar.
    test.each([
      ["(2)(1,000)", 2000],
      ["(1+1)(1,000)", 2000],
      ["(5)(2,500)", 12500],
      ["(3)(1,000)(1)", 3000],
    ])("`%s` is the scalar %d", (source, expected) => {
      const r = engine.evaluateExpression(source)[0];
      expect(r.type).toBe(ValueType.Number);
      expect(r.toNumber()).toBe(expected);
      expect(r.toNumber()).toBe(num(source.replace(/,/g, "")));
    });
  });

  test("plain implicit multiplication is unchanged", () => {
    expect(num("(2)(3)")).toBe(6);
    expect(num("(2)(1000)")).toBe(2000);
  });

  test("calls, brackets and groupings elsewhere still behave", () => {
    expect(engine.evaluateExpression("rgb(255,255,255)")[0].type).toBe(ValueType.Colour);
    expect(num("max(100,200)")).toBe(200);
    expect(num("(1,000)")).toBe(1000);
    expect(num("2 * (1,000)")).toBe(2000);
  });
});
