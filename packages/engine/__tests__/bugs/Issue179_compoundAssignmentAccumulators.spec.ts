import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #179: named-bucket accumulators, `name += expr` and `name -= expr`.
 *
 * A bare accumulator reads its current value, adds or subtracts the right-hand
 * side, stores the result, and answers with the new value, so a note becomes a
 * live ledger. A first `+=`/`-=` on an unknown name seeds 0 rather than raising
 * UNDEFINED_VARIABLE. The accumulation runs through the VM's own arithmetic, so
 * money stays money; the right-hand side keeps its own precedence; a real typo
 * on the right is still a genuine error; and the colon (`:name`) grammar is
 * untouched.
 */
describe("Issue #179: named-bucket accumulators (+= / -=)", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const num = (s: string): number => engine.evaluateExpression(s)[0].toNumber();
  const out = (s: string): string => formatValue(engine.evaluateExpression(s)[0]);

  describe("a first += or -= on an unknown name seeds 0", () => {
    test("x += 5 answers 5", () => {
      expect(num("x += 5")).toBe(5);
    });
    test("y -= 5 answers -5", () => {
      expect(num("y -= 5")).toBe(-5);
    });
  });

  describe("a running balance carries down a document", () => {
    test("each line adjusts the balance and it reads back", () => {
      const { lines } = engine.parseDocument("balance += 100\nbalance -= 40\nbalance -= 30\nbalance");
      expect(lines[0].result?.toNumber()).toBe(100);
      expect(lines[1].result?.toNumber()).toBe(60);
      expect(lines[2].result?.toNumber()).toBe(30);
      expect(lines[3].result?.toNumber()).toBe(30);
    });
  });

  describe("the right-hand side keeps its own precedence", () => {
    test("bal += 3 * 4 adds 12", () => {
      expect(num("bal += 3 * 4")).toBe(12);
    });
    test("bal -= 1 + 2 subtracts 3 from the running value", () => {
      expect(num("bal += 10")).toBe(10);
      expect(num("bal -= 1 + 2")).toBe(7);
    });
  });

  describe("typed accumulation goes through the VM", () => {
    test("money stays money", () => {
      expect(out("wallet += $100")).toBe("= $100.00");
      expect(out("wallet += $16.67")).toBe("= $116.67");
    });
  });

  describe("a genuine right-hand-side error is not swallowed", () => {
    test("total += nope reports the undefined name", () => {
      expect(() => engine.evaluateExpression("total += nope")).toThrow(/nope/i);
    });
    test("a half-typed z += reports that it needs an expression", () => {
      expect(() => engine.evaluateExpression("z +=")).toThrow(/needs an expression/i);
    });
  });

  describe("ordinary syntax is undisturbed", () => {
    test("the colon grammar still works and is not a compound assign", () => {
      engine.evaluateExpression(":total = 100");
      expect(num(":total + 5")).toBe(105);
    });
    test("a bare negative assignment is unchanged", () => {
      engine.evaluateExpression(":a = -5");
      expect(num("a")).toBe(-5);
    });
    test("plain addition is unchanged", () => {
      expect(num("2 + 3")).toBe(5);
    });
  });
});
