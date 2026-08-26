/**
 * The whole-document forms, proven through every entry point that can reach them.
 *
 * Category tags, line references, table columns and goal seek are not ordinary
 * expressions: each reads, or re-runs, other lines, so the answer depends on the
 * entry point the host called. The engine has three, and they do not agree by
 * accident:
 *
 * - `evaluateLine` / `evaluateExpression` — one expression, no document. A
 *   whole-document form has nothing to read here, so the contract is that it
 *   returns a structured Error value that says so, never a wrong number and
 *   never a throw. A reader who types one of these into a single-line box gets a
 *   clear refusal, not a `0` dressed up as an answer.
 * - `parseDocument` — the batch pass. It reads earlier lines' results and skips
 *   markdown, so tags, line references and table columns resolve. What it cannot
 *   do is re-run a line with a variable bound to a trial value, so goal seek
 *   refuses here too, by the same structured Error rather than a guess.
 * - `evaluateDocument` — the incremental pass. It adds the re-run primitive, so
 *   goal seek resolves; and it agrees with `parseDocument`, value for value, on
 *   every form both support.
 *
 * These tests pin all three at once, because a feature that passes through one
 * entry point and silently misbehaves through another is exactly the drift a
 * per-feature test misses. Every new whole-document form should be added here in
 * the same shape: the document result, the cross-path agreement, and the
 * single-line refusal.
 */
import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The formatted result of each line, or `ERROR: <message>` where a line failed, from a document result. */
function readLines(result: ParsingResult): string[] {
  return result.lines.map((line) => {
    if (line.error) return `ERROR: ${line.error}`;
    if (!line.result) return "";
    const formatted = formatValue(line.result).replace(/^=\s*/, "");
    // A returned failure is an error-typed Value in `result` (both document
    // passes report goal seek's refusal this way), marked so a test reads it as
    // a failure rather than mistaking the message for a value.
    return line.result.type === ValueType.Error ? `ERROR: ${formatted}` : formatted;
  });
}

/** Run a document through the batch pass. */
function batch(lines: string[]): string[] {
  const engine = newTrackedEngine();
  return readLines(engine.parseDocument(lines.join("\n"), { inputType: "markdown" }));
}

/** Run a document through the incremental pass. */
function incremental(lines: string[]): string[] {
  const engine = newTrackedEngine();
  return readLines(evaluateDocument(engine, lines.join("\n"), { inputType: "markdown" }));
}

/** Evaluate one line through the single-expression entry point, without ever throwing out. */
function single(expr: string): { threw: boolean; type: ValueType | null; message: string } {
  const engine = newTrackedEngine();
  try {
    const value = engine.evaluateLine(1, expr);
    return { threw: false, type: value.type, message: formatValue(value).replace(/^=\s*/, "") };
  } catch (error) {
    return { threw: true, type: null, message: (error as Error).message };
  }
}

/**
 * The refusal a whole-document reader form gives the single-expression path: a
 * structured Error value (not a throw, not a number) whose message says a
 * document is what is missing.
 */
function expectNeedsDocument(expr: string): void {
  const { threw, type, message } = single(expr);
  expect(threw).toBe(false);
  expect(type).toBe(ValueType.Error);
  expect(message.toLowerCase()).toContain("document");
}

describe("category tags across entry points", () => {
  const totalDoc = ["40 #grocery", "20 #grocery", "total of #grocery"];

  test("total, in both document passes, agree", () => {
    expect(batch(totalDoc)[2]).toBe("60");
    expect(incremental(totalDoc)[2]).toBe("60");
  });

  test("sum is a synonym for total", () => {
    const doc = ["40 #grocery", "20 #grocery", "sum of #grocery"];
    expect(batch(doc)[2]).toBe("60");
    expect(incremental(doc)[2]).toBe("60");
  });

  test("average and count read the same set", () => {
    const avg = ["40 #grocery", "20 #grocery", "average of #grocery"];
    expect(batch(avg)[2]).toBe("30");
    expect(incremental(avg)[2]).toBe("30");
    const count = ["40 #grocery", "12.50 #grocery", "count of #grocery"];
    expect(batch(count)[2]).toBe("2");
    expect(incremental(count)[2]).toBe("2");
  });

  test("a tag gathers across a blank line and past other tags", () => {
    const doc = ["40 + 15 #grocery", "30 #transport", "", "12.50 #grocery", "total of #grocery"];
    expect(batch(doc)[4]).toBe("67.50");
    expect(incremental(doc)[4]).toBe("67.50");
  });

  test("money carries through", () => {
    const doc = ["$40 #food", "$25 #food", "total of #food"];
    expect(batch(doc)[2]).toBe("$65.00");
    expect(incremental(doc)[2]).toBe("$65.00");
  });

  test("a keyword-named tag still aggregates (issue #213)", () => {
    const doc = ["1200 #assuming", "800 #assuming", "total of #assuming"];
    expect(batch(doc)[2]).toBe("2,000");
    expect(incremental(doc)[2]).toBe("2,000");
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("total of #grocery");
    expectNeedsDocument("average of #grocery");
    expectNeedsDocument("count of #grocery");
  });
});

describe("line references across entry points", () => {
  test("prev and line N agree in both passes", () => {
    const doc = ["120", "80", "prev", "line 1"];
    expect(batch(doc).slice(2)).toEqual(["80", "120"]);
    expect(incremental(doc).slice(2)).toEqual(["80", "120"]);
  });

  test("total above sums the current block only, both passes", () => {
    const doc = ["10", "20", "", "100", "total above"];
    expect(batch(doc)[4]).toBe("100");
    expect(incremental(doc)[4]).toBe("100");
  });

  test("an explicit span reaches across a boundary, both passes", () => {
    const doc = ["10", "20", "30", "sum(line 1 : line 3)", "average(line 1 : line 3)"];
    expect(batch(doc).slice(3)).toEqual(["60", "20"]);
    expect(incremental(doc).slice(3)).toEqual(["60", "20"]);
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("prev");
    expectNeedsDocument("line 1");
    expectNeedsDocument("total above");
    expectNeedsDocument("sum(line 1 : line 3)");
  });
});

describe("table columns across entry points", () => {
  const table = ["| item | cost |", "| ---- | ---- |", "| rent | 1200 |", "| food | 300 |", "| taxi | 12 |"];

  test("the batch pass reads the column and skips the rows visually", () => {
    const doc = [...table, "", 'sum of column "cost" in table above', 'average of column "cost" above'];
    const out = batch(doc);
    expect(out[6]).toBe("1,512");
    expect(out[7]).toBe("504");
  });

  test("min, max, count and median read the same column", () => {
    const doc = [
      ...table,
      "",
      'min of column "cost" above',
      'max of column "cost" above',
      'count of column "cost" above',
      'median of column "cost" above',
    ];
    const out = batch(doc);
    expect(out.slice(6)).toEqual(["12", "1,200", "3", "300"]);
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument('sum of column "cost" in table above');
  });

  test("a bare table row is not an expression, so the single-expression path throws", () => {
    // A markdown row reaches the single-expression path as a `|` it cannot start
    // an expression with. In a document it is skipped; alone it is a parse error,
    // which is the honest answer for input that was never an expression.
    expect(single("| item | cost |").threw).toBe(true);
  });
});

describe("goal seek across entry points", () => {
  const closedForm = [":x = 0", "x * 2 + 10", "solve line 2 for x = 30"];

  test("the incremental pass solves it", () => {
    // 2x + 10 = 30 solves to x = 10, closed form, no search.
    expect(incremental(closedForm)[2]).toBe("10");
  });

  test("a numeric search resolves through the incremental pass", () => {
    const doc = [":deposit = 100000", ":rate = 4%", "monthly repayment on deposit over 25 years at rate", "solve line 3 for deposit = 900"];
    expect(incremental(doc)[3]).toBe("170,507.23");
  });

  test("the batch pass refuses goal seek, since it cannot re-run a line", () => {
    // The one form the two document passes disagree on, and deliberately: the
    // batch pass has no document to solve against, so it errors rather than
    // guessing. The lines it can evaluate still evaluate.
    const out = batch(closedForm);
    expect(out[2]).toContain("ERROR:");
    expect(out[2].toLowerCase()).toContain("document");
    // The lines it can evaluate are untouched by the refusal above it.
    expect(out[0]).toBe("0");
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("solve line 1 for x = 5");
  });
});

describe("evaluateDocument leaves the engine as it found it", () => {
  test("the borrowed engine's document model is restored", () => {
    const engine = newTrackedEngine();
    expect(engine.getDocumentModel()).toBeNull();
    evaluateDocument(engine, ["10", "20", "total above"].join("\n"));
    expect(engine.getDocumentModel()).toBeNull();
  });

  test("a second pass on the same engine does not leak the first's lines", () => {
    const engine = newTrackedEngine();
    const first = readLines(evaluateDocument(engine, ["100 #a", "total of #a"].join("\n")));
    expect(first[1]).toBe("100");
    const second = readLines(evaluateDocument(engine, ["5 #a", "total of #a"].join("\n")));
    expect(second[1]).toBe("5");
  });
});
