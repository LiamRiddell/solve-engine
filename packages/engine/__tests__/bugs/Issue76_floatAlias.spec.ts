import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

describe("Feature #76: float() as alias for vec()", () => {
  let engine: ExpressionEngine;

  beforeEach(() => {
    engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
  });

  // Releases the engine's query client and async batcher. Without it the
  // engine outlives the test file and its pending work lands in whatever
  // runs next, which under --runInBand is the same process.
  afterEach(() => {
  	engine.clear();
  });

  test("float(5) creates a 1D vector", () => {
    // Use colon prefix so LOAD_VAR doesn't throw on undefined 'x'.
    const result = engine.parseDocument(":x = float(5)");
    expect(result.lines[0].error).toBeNull();
  });

  test("float(3.14) evaluates correctly", () => {
    const result = engine.evaluateNumber("float(3.14)");
    expect(result).toBeCloseTo(3.14, 5);
  });

  test("float(2) + 3 works", () => {
    const result = engine.evaluateNumber("float(2) + 3");
    expect(result).toBeCloseTo(5, 5);
  });
});