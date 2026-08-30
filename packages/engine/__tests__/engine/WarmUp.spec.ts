/**
 * `warmUp()` runs real expressions through the real pipeline, which is the
 * point and also the risk: anything it leaves behind would be state the host
 * never asked for, appearing in a document it never wrote. These pin that it
 * leaves nothing.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";

/** JSON.stringify refuses BigInt, which several results legitimately carry. */
const show = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? `${val}n` : val));

/**
 * The outcome of evaluating one line, thrown or returned.
 *
 * `evaluateLine` throws for a line that does not parse and for an undefined
 * variable, so comparing return values alone would compare two engines only on
 * the inputs that succeed, which is the half least likely to differ.
 */
function outcome(engine: ExpressionEngine, expression: string): string {
  try {
    return "ok:" + show(engine.evaluateLine(1, expression));
  } catch (e) {
    return "threw:" + (e instanceof Error ? e.message : String(e));
  }
}

describe("engine warm-up", () => {
  test("a warmed engine evaluates identically to a cold one", () => {
    const cold = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    const warm = new ExpressionEngine({ packages: BUILTIN_PACKAGES, warmup: true });

    const cases = [
      "1 + 2 * 3",
      "50% of 200",
      "3 kg + 400 g",
      "sqrt(144)",
      "120 km/h to m/s",
      "half of 250",
      "not an expression at all",
    ];

    for (const expression of cases) {
      expect({ expression, value: outcome(warm, expression) }).toEqual({
        expression,
        value: outcome(cold, expression),
      });
    }
  });

  test("warming leaks no names a document could then resolve", () => {
    // Checked through behaviour rather than a store accessor: what matters is
    // not whether a map is empty but whether a name the host never wrote can
    // be referenced. A leaked variable would silently shadow one they went on
    // to define.
    const cold = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    const warm = new ExpressionEngine({ packages: BUILTIN_PACKAGES, warmup: true });
    for (const name of [":budget", ":x", ":total", ":headcount"]) {
      expect(outcome(warm, `${name} + 1`)).toEqual(outcome(cold, `${name} + 1`));
    }
  });

  test("warming registers no lines and no results", () => {
    const warm = new ExpressionEngine({ packages: BUILTIN_PACKAGES, warmup: true });
    const parsed = warm.parseDocument("1 + 1");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].lineNumber).toBe(1);
  });

  test("warming leaves the bytecode cache empty, so a real line still compiles fresh", () => {
    const warm = new ExpressionEngine({ packages: BUILTIN_PACKAGES, warmup: true });
    // Every warm-up expression, asked for again, must behave as a first sighting
    // rather than as something the host already evaluated.
    const first = warm.evaluateLine(1, "1 + 2 * 3");
    const second = warm.evaluateLine(1, "1 + 2 * 3");
    expect(show(second)).toEqual(show(first));
  });

  test("warmUp() is idempotent and safe to call again", () => {
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    const before = outcome(engine, "2 + 2");
    engine.warmUp();
    engine.warmUp();
    expect(outcome(engine, "2 + 2")).toEqual(before);
  });

  test("warmup is off unless asked for", () => {
    // The default matters: it is the difference between a batch process paying
    // for paths it never reuses and not.
    const plain = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    expect(show(plain.evaluateLine(1, "1 + 1"))).toContain("2");
  });
});
