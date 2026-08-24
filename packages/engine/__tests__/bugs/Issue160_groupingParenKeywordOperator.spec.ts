import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType, type MatrixData } from "@solve-js/vm/Value";

/**
 * Issue #160: a grouping paren after a keyword operator was lexed as a call.
 *
 * The grouping-vs-call fix (#150) handled a symbol operator before `(` but not a
 * keyword operator, so `precededByCallTarget()` treated `mod`/`xor`/`and` (letter
 * runs) as function names, pushed a separator context, and split the thousands
 * number inside the following grouping paren: `100 mod (1,000)` became
 * `100 mod [1, 0]` = `[0, NaN]`.
 *
 * The fix looks the word up in the keyword table: a keyword that is not a
 * function (`FUNC`) is an operator/connective/constant, so the `(...)` after it
 * is a grouping and its comma stays a thousands separator.
 */
describe("Issue #160: a grouping paren after a keyword operator keeps thousands", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  const num = (source: string): number => engine.evaluateExpression(source)[0].toNumber();
  const type = (source: string): ValueType => engine.evaluateExpression(source)[0].type;

  describe("a keyword operator before (1,000) reads it as the scalar 1000", () => {
    // The invariant: the grouped, comma-formatted number must equal the plain
    // one — `X op (1,000)` == `X op 1000` — and stay a scalar, not a vector.
    test.each([
      "100 mod (1,000)",
      "1000 mod (1,000)",
      "255 xor (1,000)",
      "7 xor (1,000)",
      "1 and (1,000)",
    ])("`%s` matches its plain form and is a scalar", (grouped) => {
      const plain = grouped.replace("(1,000)", "1000");
      const r = engine.evaluateExpression(grouped)[0];
      expect(r.type).toBe(ValueType.Number);
      expect(r.toNumber()).toBe(num(plain));
    });
  });

  test("`100 mod (1,000)` is 100, not the vector [0, NaN] it used to be", () => {
    expect(type("100 mod (1,000)")).toBe(ValueType.Number);
    expect(num("100 mod (1,000)")).toBe(100);
  });

  describe("real calls and brackets still separate on the comma", () => {
    test("a function call still splits arguments", () => {
      expect(type("rgb(255,255,255)")).toBe(ValueType.Colour);
      expect(num("max(100,200)")).toBe(200);
      expect(num("sqrt(1000)")).toBeCloseTo(31.6227766, 5);
    });

    test("a bracket vector still splits elements", () => {
      const m = engine.evaluateExpression("[100,200,300]")[0].value as MatrixData;
      expect([m.rows, m.cols]).toEqual([1, 3]);
    });

    test("an identifier ending in a digit is still a call", () => {
      expect(type("vec2(1,2)")).toBe(ValueType.Matrix);
    });
  });

  test("a grouping paren and top-level thousands are unchanged", () => {
    expect(num("(1,000)")).toBe(1000);
    expect(num("2 * (1,000)")).toBe(2000);
    expect(num("1,000,000")).toBe(1000000);
    // `of` is a keyword operator too: `20% of (1,000)` is 20% of 1000.
    expect(num("20% of (1,000)")).toBe(200);
  });
});
