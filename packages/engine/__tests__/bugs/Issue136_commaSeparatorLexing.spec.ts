import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type MatrixData, type ColourData } from "@solve-js/vm/Value";

/**
 * Issue #136: a comma with no following space was lexed as a thousands group.
 *
 * `rgb(255,255,255)` errored and `[100,200,300]` became a 1x1 matrix holding the
 * single number `100200300`, because the number scanner coalesced a comma
 * followed by exactly three digits into the number as a thousands group with no
 * awareness of call/bracket context — `255,255,255` reads identically to the
 * thousands-grouped `255255255`. The space form (`rgb(255, 255, 255)`) worked
 * only because the space stopped the number before the comma.
 *
 * The fix tracks `(`/`[` nesting in the lexer: a comma inside a call or bracket
 * is an argument/element separator, so it is not coalesced there; a top-level
 * comma still groups thousands.
 */
describe("Issue #136: a comma in a call or bracket is a separator, not a thousands group", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const evalOne = (source: string) => engine.evaluateExpression(source)[0];

  describe("bracketed vectors split on the comma", () => {
    test("`[100,200,300]` is a 1x3 row vector, not the number 100200300", () => {
      const result = evalOne("[100,200,300]");
      expect(result.type).toBe(ValueType.Matrix);
      const m = result.value as MatrixData;
      expect(m.rows).toBe(1);
      expect(m.cols).toBe(3);
      expect(m.data).toEqual([100, 200, 300]);
    });

    test("the no-space form matches the space form exactly", () => {
      expect(formatValue(evalOne("[100,200,300]"))).toBe(formatValue(evalOne("[100, 200, 300]")));
    });

    test("a 2x2 matrix with grouped-looking cells keeps its shape", () => {
      const m = evalOne("[100,200;300,400]").value as MatrixData;
      expect(m.rows).toBe(2);
      expect(m.cols).toBe(2);
      expect(m.data).toEqual([100, 300, 200, 400]);
    });

    test("decimal cells are unaffected", () => {
      expect((evalOne("[1.5,2.5]").value as MatrixData).data).toEqual([1.5, 2.5]);
    });
  });

  describe("function arguments split on the comma", () => {
    test("`rgb(255,255,255)` is the colour white", () => {
      const result = evalOne("rgb(255,255,255)");
      expect(result.type).toBe(ValueType.Colour);
      const c = result.value as ColourData;
      expect([c.r, c.g, c.b]).toEqual([255, 255, 255]);
    });

    test("the no-space colour form matches the space form", () => {
      expect(formatValue(evalOne("rgb(255,255,255)"))).toBe(formatValue(evalOne("rgb(255, 255, 255)")));
      expect(formatValue(evalOne("hsl(0,100,50)"))).toBe(formatValue(evalOne("hsl(0, 100, 50)")));
    });

    test("`max`/`min` receive separate arguments", () => {
      expect(evalOne("max(100,200)").toNumber()).toBe(200);
      expect(evalOne("min(300,100)").toNumber()).toBe(100);
    });

    test("a four-argument rgba splits on every comma", () => {
      const c = evalOne("rgba(255,128,0,0.5)").value as ColourData;
      expect([c.r, c.g, c.b]).toEqual([255, 128, 0]);
      expect(c.a).toBeCloseTo(0.5);
    });
  });

  describe("top-level thousands grouping is preserved", () => {
    test.each([
      ["1,000", 1000],
      ["1,000,000", 1000000],
      ["255,255,255", 255255255],
      ["1,234 + 1", 1235],
    ])("`%s` is %d", (source, expected) => {
      expect(evalOne(source).toNumber()).toBe(expected);
    });

    test("two grouped numbers still add", () => {
      expect(evalOne("1,000 + 2,000").toNumber()).toBe(3000);
    });
  });
});
