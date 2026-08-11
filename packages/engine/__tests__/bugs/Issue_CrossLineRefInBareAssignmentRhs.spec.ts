/**
 * Cross-line references on the right-hand side of a bare assignment.
 *
 * `total = prev`, `x = line2`, `x = prev + 1` are bare (colon-less)
 * assignments. Their RHS is evaluated through the symbolic-tolerant path
 * (`ExpressionEngine.executeSymbolicTolerant`), which used to run the
 * bytecode with no `LineExecutionContext`, so every line-reference plugin
 * function (`prev`, `line<N>`, the range and `above` aggregations) returned
 * `LINE_REF_NO_DOCUMENT` even though the surrounding document was real.
 *
 * A bare expression line (`prev + 1`) never hit that path and always worked,
 * so the failure was specific to a reference sitting on an assignment's RHS.
 * The fix threads the 1-based line number down to `executeSymbolicTolerant`
 * so it builds the same `makeLineContext(lineNumber)` an ordinary line does.
 *
 * Every real-document case goes through the actual ExpressionEngine +
 * DocumentModel + ThreeTierEvaluator trio, the only setup that can represent
 * cross-line state.
 */
import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

function evalDoc(lines: string[]): DocumentModel {
  const engine = newTrackedEngine();
  const doc = new DocumentModel();
  doc.setDocument(lines.join("\n"));
  const evaluator = new ThreeTierEvaluator(doc, engine);
  evaluator.evaluate({ startLine: 1, endLine: lines.length });
  return doc;
}

describe("cross-line reference on a bare assignment's RHS", () => {
  test("total = prev reads the immediately-preceding line's result", () => {
    const doc = evalDoc(["eggs = 100", "fries = 2.02", "total = prev"]);
    expect(doc.getLineAt(3)!.result!.toNumber()).toBeCloseTo(2.02);
  });

  test("x = prev + 1 evaluates prev inside a larger RHS expression", () => {
    const doc = evalDoc(["10", "20", "x = prev + 1"]);
    expect(doc.getLineAt(3)!.result!.toNumber()).toBe(21);
  });

  test("x = line2 reads an arbitrary line by number from an assignment RHS", () => {
    const doc = evalDoc(["10", "20", "x = line2"]);
    expect(doc.getLineAt(3)!.result!.toNumber()).toBe(20);
  });

  test("the assigned variable is usable on a later line", () => {
    const doc = evalDoc(["10", "20", "total = prev", "total + 5"]);
    expect(doc.getLineAt(4)!.result!.toNumber()).toBe(25);
  });

  test("a named-variable RHS keeps working (never went through the broken path)", () => {
    const doc = evalDoc(["eggs = 100", "fries = 2", "total = eggs + fries"]);
    expect(doc.getLineAt(3)!.result!.toNumber()).toBe(102);
  });

  test("outside a document, a reference on an assignment RHS still errors cleanly", () => {
    const engine = newTrackedEngine();
    const [value] = engine.evaluateExpression("total = prev");
    expect(value.type).toBe(ValueType.Error);
  });
});
