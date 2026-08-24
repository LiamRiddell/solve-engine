import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #178: a per-person bill split.
 *
 * `split <amount> between <N>` and `<amount> split <N> ways` answer "<amount/N>
 * each". A tip written as a percentage composes on one line, since the engine
 * already makes `$120 + 18%` an exact `$141.60` before the split divides it.
 * Money stays exact and the shares add back to the total to the cent: the odd
 * penny is named ("with 1 share paying ..."), not rounded away. A bare number
 * splits to a bare number. `split`, `ways` and `people` are claimed only inside
 * the full split shape, so they stay ordinary words everywhere else.
 */
describe("Issue #178: bill split and tip", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const out = (source: string): string => formatValue(engine.evaluateExpression(source)[0]);

  describe("an even split answers 'X each', both spellings", () => {
    test.each([
      ["split $120 between 3", "= $40.00 each"],
      ["$120 split 3 ways", "= $40.00 each"],
      ["split $100 between 4 people", "= $25.00 each"],
      ["split $90 between 3", "= $30.00 each"],
    ])("%s => %s", (source, expected) => {
      expect(out(source)).toBe(expected);
    });
  });

  describe("the odd penny is named, and the shares add back to the total", () => {
    test.each([
      ["split $100 between 3", "= $33.33 each, with 1 share paying $33.34"],
      ["split $10 between 3", "= $3.33 each, with 1 share paying $3.34"],
      ["split $100 between 7", "= $14.28 each, with 4 shares paying $14.29"],
    ])("%s => %s", (source, expected) => {
      expect(out(source)).toBe(expected);
    });
  });

  describe("a tip written as a percentage composes on one line", () => {
    test("the tip lands on the total, then the split divides it", () => {
      expect(out("$120 + 18% split 3 ways")).toBe("= $47.20 each");
    });

    test("it matches splitting the tipped total directly", () => {
      expect(out("$120 + 18% split 3 ways")).toBe(out("$141.60 split 3 ways"));
    });
  });

  describe("a bare number splits to a bare number", () => {
    test.each([
      ["10 split 3 ways", "= 3.33 each"],
      ["12 split 3 ways", "= 4 each"],
      ["split 10 between 4", "= 2.50 each"],
    ])("%s => %s", (source, expected) => {
      expect(out(source)).toBe(expected);
    });
  });

  describe("the number of shares must be a whole number of at least one", () => {
    test.each([["split $100 between 0"], ["split $100 between 2.5"]])(
      "%s is refused",
      (source) => {
        expect(out(source)).toMatch(/whole number of at least 1/);
      },
    );
  });

  describe("split, ways and people stay ordinary words everywhere else", () => {
    test(":split keeps working as a variable", () => {
      engine.evaluateExpression(":split = 5");
      expect(engine.evaluateExpression("split")[0].toNumber()).toBe(5);
    });

    test("ways and people are usable as variable names", () => {
      engine.evaluateExpression(":ways = 3");
      engine.evaluateExpression(":people = 4");
      expect(engine.evaluateExpression("ways + people")[0].toNumber()).toBe(7);
    });
  });

  describe("a split value in a variable does not break a snapshot", () => {
    test("toJSON skips a split-valued variable rather than aborting the whole snapshot", () => {
      engine.evaluateExpression(":shares = split $120 between 3");
      engine.evaluateExpression(":n = 42");
      // The split value cannot serialise in the v1 snapshot format, but it must
      // be skipped, not throw and lose every other variable and line result.
      expect(() => engine.toJSON()).not.toThrow();
      const snapshot = engine.toJSON();
      expect(snapshot.variables.n).toBeDefined();
      expect(snapshot.variables.shares).toBeUndefined();
    });
  });
});
