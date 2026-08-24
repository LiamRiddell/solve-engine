import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * `createEngine` is the batteries-included convenience: an engine with every
 * built-in package registered. The `ExpressionEngine` constructor registers
 * only what it is given (so a consumer can tree-shake unused packages), so this
 * factory exists for the common "I want everything" case.
 */
describe("createEngine", () => {
  test("registers the full built-in vocabulary", () => {
    const engine = createEngine();
    // Arithmetic, units, and finance are all built-ins, so all three resolve.
    expect(engine.evaluateExpression("2 + 2 * 10")[0].toNumber()).toBe(22);
    expect(engine.evaluateExpression("1 km + 500 m")[0].toNumber()).toBe(1.5);
    expect(engine.evaluateExpression("split $120 between 3")[0].toNumber()).toBeCloseTo(40);
  });

  test("a bare-constructor engine registers nothing unless given packages", () => {
    // The tree-shaking contract: no packages passed means no vocabulary.
    const bare = new ExpressionEngine("en", false);
    expect(() => bare.evaluateExpression("sin(0)")).toThrow();
  });

  test("accepts a locale and extra packages on top of the built-ins", () => {
    const engine = createEngine("en", false, undefined, []);
    expect(engine.evaluateExpression("10 dollars")[0].toNumber()).toBe(10);
  });
});
