import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #137: a markdown table-column aggregate resolved through the incremental
 * evaluator but returned TABLE_NO_DOCUMENT through the batch library APIs
 * (parseDocument / evaluateLines).
 *
 * The per-line context wired `getLineText` only for the DocumentModel branch, so
 * in the batch path (which has no DocumentModel) the tables handler could not read
 * the rows above and reported "needs a real document". It now reads from the batch
 * scan the same way the other cross-line closures do.
 */
describe("Issue #137: table-column aggregates work through the batch APIs", () => {
  const TABLE = ["| item | cost |", "| --- | --- |", "| rent | 1200 |", "| food | 300 |", "| travel | 12 |"];

  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  test("parseDocument resolves a column sum", () => {
    const result = engine.parseDocument([...TABLE, 'sum of column "cost" above'].join("\n"));
    const answer = result.lines[TABLE.length].result;
    expect(answer?.type).toBe(ValueType.Number);
    expect(answer?.toNumber()).toBe(1512);
  });

  test("evaluateLines resolves a column sum", () => {
    const lines = engine.evaluateLines([...TABLE, 'sum of column "cost" above']);
    expect(lines[TABLE.length].result?.toNumber()).toBe(1512);
  });

  test.each([
    ['sum of column "cost" above', 1512],
    ['average of column "cost" above', 504],
    ['max of column "cost" above', 1200],
    ['min of column "cost" above', 12],
    ['count of column "cost" above', 3],
  ])("parseDocument: %s => %d", (query, expected) => {
    const result = engine.parseDocument([...TABLE, query].join("\n"));
    expect(result.lines[TABLE.length].result?.toNumber()).toBe(expected);
  });

  test("a missing column still reports a clear error, not a silent zero", () => {
    const result = engine.parseDocument([...TABLE, 'sum of column "nope" above'].join("\n"));
    expect(result.lines[TABLE.length].result?.type).toBe(ValueType.Error);
  });
});
