import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Issue #142: `explainLine` emitted a misleading step for arithmetic followed by
 * an operator it does not model.
 *
 * `2 + 2 == 4` is a comparison; the derivation models arithmetic, not `==`, so it
 * should report the answer with an empty step list (the documented fallback for
 * an unmodelled construct). Instead it emitted `[["2 plus 2 == 4", 1]]`: the
 * greedy operand run stopped only at the operators the derivation modelled, so
 * the unmodelled `== 4` was swallowed into the right operand's leaf and glued
 * into an arithmetic step whose result was actually a Boolean.
 *
 * The fix defines an operand run as a span of value-atom tokens, so any operator
 * the derivation does not model ends the run, is left unconsumed, and drops the
 * whole line to the empty-steps fallback.
 */
describe("Issue #142: an unmodelled operator after arithmetic falls back to no steps", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
  });

  const steps = (line: string): Array<[string, number]> =>
    engine.explainLine(line).steps.map((s) => [s.description, s.value.toNumber()]);

  describe("arithmetic then an unmodelled operator reports the answer alone", () => {
    test.each([
      ["2 + 2 == 4", 1], // equality -> Boolean
      ["100 + 20 in kg", 120], // conversion
      ["3 * 4 > 10", 1], // comparison
      ["1 != 2", 1],
      ["10 >= 5", 1],
      ["2 <= 4", 1],
      ["1 + 2 and 3", 6], // logical conjunction
      ["5 > 3 or 2 < 1", 1], // chained comparisons + logical
      ["1 + 2 xor 3", 0], // bitwise
    ])("`%s` has no steps but still answers %d", (line, expected) => {
      const explanation = engine.explainLine(line);
      expect(explanation.steps).toEqual([]);
      expect(explanation.result.toNumber()).toBe(expected);
    });
  });

  test("the plain comparison baseline is unchanged", () => {
    // `2 == 4` on its own already fell back correctly; it must stay that way.
    const explanation = engine.explainLine("2 == 4");
    expect(explanation.steps).toEqual([]);
    expect(explanation.result.toNumber()).toBe(0);
  });

  describe("arithmetic that the derivation does model is untouched", () => {
    test("a modelled chain still breaks down step by step", () => {
      expect(steps("2 + 3 * 4")).toEqual([
        ["3 times 4", 12],
        ["2 plus 12", 14],
      ]);
    });

    test("money, units and percentages still derive", () => {
      expect(steps("5 km + 300 m")).toEqual([["5 km plus 300 m", 5.3]]);
      expect(steps("80 + 20%")).toEqual([["80 plus 20%", 96]]);
    });
  });
});
