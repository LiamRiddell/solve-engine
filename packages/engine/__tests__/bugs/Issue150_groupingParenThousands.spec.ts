import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType, type MatrixData, type ColourData } from "@solve-js/vm/Value";

/**
 * Issue #150: a bare grouping paren regressed a thousands number to a vector.
 *
 * The #136 comma fix suppressed the thousands-comma inside ALL parens, so a
 * parenthesised thousands number `(1,000)` became the two-element vector `[1, 0]`
 * instead of the scalar `1000` — silently corrupting any arithmetic around it.
 *
 * A `(` is used for two things: a function CALL (`rgb(...)`, where commas are
 * argument separators) and a bare GROUPING (`(1,000)`, where a comma still groups
 * thousands). The fix distinguishes them by what precedes the `(` — an identifier
 * or a closing bracket makes it a call, an operator or the line start makes it a
 * grouping — while `[...]` is always a separator context.
 */
describe("Issue #150: a grouping paren keeps thousands; a call paren stays a separator", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  const val = (s: string) => engine.evaluateExpression(s);

  describe("bare grouping parens group thousands (the regression)", () => {
    test.each([
      ["(1,000)", 1000],
      ["(1,000 + 500)", 1500],
      ["2 * (1,000)", 2000],
      ["(1,000,000)", 1000000],
      ["-(1,000)", -1000],
      ["(1,000) + 1", 1001],
    ])("`%s` is the scalar %d", (source, expected) => {
      const r = val(source);
      expect(r.type).toBe(ValueType.Number);
      expect(r.toNumber()).toBe(expected);
    });

    test("a digit before the paren is implicit multiplication over a grouping", () => {
      // `2(1,000)` is `2 * (1000)`, not a call — the run before `(` is a bare
      // number, so the comma still groups thousands inside.
      expect(val("2(1,000)").toNumber()).toBe(2000);
    });
  });

  describe("calls and brackets remain separator contexts (the #136 fix holds)", () => {
    test("`rgb(255,255,255)` is still white", () => {
      const c = val("rgb(255,255,255)");
      expect(c.type).toBe(ValueType.Colour);
      expect([(c.value as ColourData).r, (c.value as ColourData).g, (c.value as ColourData).b]).toEqual([255, 255, 255]);
    });

    test("`[100,200,300]` is still a 1x3 vector", () => {
      const m = val("[100,200,300]").value as MatrixData;
      expect([m.rows, m.cols]).toEqual([1, 3]);
      expect(m.data).toEqual([100, 200, 300]);
    });

    test("an identifier ending in a digit is a call, not a grouping", () => {
      // `vec2(` is a call (the run before `(` contains letters), so its comma
      // splits arguments even though the name ends in a digit.
      expect(val("vec2(1,2)").type).toBe(ValueType.Matrix);
    });

    test("`max`/`min` still receive separate arguments", () => {
      expect(val("max(100,200)").toNumber()).toBe(200);
      expect(val("min(300,100)").toNumber()).toBe(100);
    });
  });

  test("top-level thousands are unchanged", () => {
    expect(val("1,000,000").toNumber()).toBe(1000000);
    expect(val("1,000 + 2,000").toNumber()).toBe(3000);
  });
});
