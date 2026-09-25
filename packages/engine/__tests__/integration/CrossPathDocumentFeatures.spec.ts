/**
 * The whole-document forms, proven through every entry point that can reach them.
 *
 * Category tags, line references, sections, table columns, table lookups and
 * bands, goal seek, and what-if and sweeps are not ordinary expressions: each
 * reads, or re-runs, other lines, so the answer depends on the entry point the
 * host called. The engine has three, and they do not agree by accident:
 *
 * - `evaluateLine` / `evaluateExpression` — one expression, no document. A
 *   whole-document form has nothing to read here, so the contract is that it
 *   returns a structured Error value that says so, never a wrong number and
 *   never a throw. A reader who types one of these into a single-line box gets a
 *   clear refusal, not a `0` dressed up as an answer.
 * - `parseDocument` — the batch pass. It reads earlier lines' results and skips
 *   markdown, so tags, line references and table columns resolve. What it cannot
 *   do is re-run a line with a variable bound to a trial value, so goal seek
 *   refuses here too, by the same structured Error rather than a guess. A
 *   what-if and a sweep are different: they re-run the lines above their
 *   target from the lines' text, in a scratch engine of their own, so they
 *   need nothing this pass lacks and resolve here too.
 * - `evaluateDocument` — the incremental pass. It adds the re-run primitive, so
 *   goal seek resolves; and it agrees with `parseDocument`, value for value, on
 *   every form both support, the what-if forms included.
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
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import { applyTextEdits, type LineShift } from "@solve-js/language/DocumentReferences";
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

/** One line of a live evaluator's pass, in the same form {@link readLines} gives a document result. */
function readEvalLine(line: EvalLineResult): string {
  if (line.error) return `ERROR: ${line.error}`;
  if (!line.result) return "";
  const formatted = formatValue(line.result).replace(/^=\s*/, "");
  return line.result.type === ValueType.Error ? `ERROR: ${formatted}` : formatted;
}

/**
 * Evaluate a document in a live evaluator, edit it, and evaluate it again, the
 * way an editor does on each keystroke.
 *
 * @returns What the evaluator shows after the edit, and the edited text, which
 * a fresh `parseDocument` of must agree with.
 */
function editThenEvaluate(lines: string[], edits: ReadonlyArray<readonly [number, string]>): { shown: string[]; edited: string[] } {
  const doc = new DocumentModel();
  doc.setDocument(lines.join("\n"));
  const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
  try {
    evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
    const edited = [...lines];
    for (const [lineNumber, text] of edits) {
      doc.editLine(lineNumber, text);
      edited[lineNumber - 1] = text;
    }
    const pass = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
    return { shown: pass.lines.map(readEvalLine), edited };
  } finally {
    evaluator.terminateWorker();
  }
}

/**
 * Evaluate a document in a live evaluator, delete one line the way an editor
 * does (a structural change), and evaluate it again.
 *
 * @returns What the evaluator shows after the deletion, and the remaining text.
 */
function deleteThenEvaluate(lines: string[], lineNumber: number): { shown: string[]; edited: string[] } {
  const doc = new DocumentModel();
  doc.setDocument(lines.join("\n"));
  const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
  try {
    evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
    evaluator.applyTransaction([{ startLine: lineNumber, deleteCount: 1, insertLines: [] }]);
    const pass = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
    return { shown: pass.lines.map(readEvalLine), edited: lines.filter((_, i) => i !== lineNumber - 1) };
  } finally {
    evaluator.terminateWorker();
  }
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

  test("tagged decimals total exactly, in both passes (#511)", () => {
    const doc = ["0.1 #tip", "0.2 #tip", "total of #tip", "total of #tip == 0.3", "average of #tip == 0.15"];
    expect(batch(doc).slice(2)).toEqual(["0.30", "true", "true"]);
    expect(incremental(doc).slice(2)).toEqual(["0.30", "true", "true"]);
  });

  test("a keyword-named tag still aggregates (issue #213)", () => {
    const doc = ["1200 #assuming", "800 #assuming", "total of #assuming"];
    expect(batch(doc)[2]).toBe("2,000");
    expect(incremental(doc)[2]).toBe("2,000");
  });

  test("the breakdown by tag, in both document passes, agrees", () => {
    const doc = ["$40 #food", "$25 #food", "$30 #transport", "total by tag"];
    expect(batch(doc)[3]).toBe("food $65.00 (68%) · transport $30.00 (32%)");
    expect(incremental(doc)).toEqual(batch(doc));
    const sum = ["$40 #food", "$25 #food", "$30 #transport", "sum by tag"];
    expect(incremental(sum)).toEqual(batch(sum));
  });

  test("a breakdown's refusals agree too", () => {
    const untagged = ["10", "20", "total by tag"];
    expect(batch(untagged)[2]).toContain("ERROR:");
    expect(incremental(untagged)).toEqual(batch(untagged));
    const mixed = ["$40 #food", "5 km #run", "total by tag"];
    expect(batch(mixed)[2]).toContain("ERROR:");
    expect(incremental(mixed)).toEqual(batch(mixed));
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("total of #grocery");
    expectNeedsDocument("average of #grocery");
    expectNeedsDocument("count of #grocery");
    expectNeedsDocument("total by tag");
    expectNeedsDocument("sum by tag");
  });
});

describe("sections across entry points", () => {
  const budget = [
    "# Travel",
    "## Flights",
    "Outbound: $300",
    "Return: $150",
    "## Hotels",
    "Rome: $220",
    "Subtotal: total above",
    "",
    "# Food",
    "Groceries: $40",
    "",
    "# Summary",
  ];

  test("total, sum, average and count, in both document passes, agree", () => {
    const doc = [
      ...budget,
      'total of section "Travel"',
      'sum of section "Flights"',
      'average of section "Travel"',
      'count of section "Travel"',
      'total of section "food"',
    ];
    expect(batch(doc).slice(12)).toEqual(["$670.00", "$450.00", "$223.33", "3", "$40.00"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("the refusals agree too: not found, ambiguous, empty, non-numeric, a failed line", () => {
    const docs = [
      [...budget, 'total of section "Travle"'],
      ["## Travel", "$1", "# 2026", "## Travel", "$2", 'total of section "Travel"'],
      ["# Travel", "# Summary", 'total of section "Travel"'],
      ["# Travel", "$450", '"booked"', "# Summary", 'total of section "Travel"'],
      ["# Travel", "Flights are booked for May", "$450", "# Summary", 'total of section "Travel"'],
    ];
    for (const doc of docs) {
      const last = doc.length - 1;
      expect(batch(doc)[last]).toContain("ERROR:");
      expect(incremental(doc)).toEqual(batch(doc));
    }
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument('total of section "Travel"');
    expectNeedsDocument('sum of section "Travel"');
    expectNeedsDocument('average of section "Travel"');
    expectNeedsDocument('count of section "Travel"');
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

  test("total above leaves a subtotal out, both passes (#551)", () => {
    // The second total adds 10 and 5; it used to count the first total as a
    // third figure and answer 25.
    const doc = ["10", "total above", "5", "total above", "Subtotal: total above", "average above"];
    const expected = ["10", "10", "5", "15", "15", "7.50"];
    expect(batch(doc)).toEqual(expected);
    expect(incremental(doc)).toEqual(expected);
  });

  test("total above passes over a comment or a blockquote in its column, both passes (#652)", () => {
    // Both used to end the block, so the total read only the line below them.
    const comment = ["rent: $500", "// remember to check", "food: $200", "total above", "average above"];
    expect(batch(comment).slice(3)).toEqual(["$700.00", "$350.00"]);
    expect(incremental(comment)).toEqual(batch(comment));
    const quote = ["rent: $500", "> quoted note", "food: $200", "total above"];
    expect(batch(quote)[3]).toBe("$700.00");
    expect(incremental(quote)).toEqual(batch(quote));
  });

  test("a blank line, a heading, a rule, a fence and a table still end the block, both passes (#652)", () => {
    const enders: Array<[string, string[]]> = [
      ["a blank line", [""]],
      ["a heading", ["# Next"]],
      ["a rule", ["---"]],
      ["a code fence", ["```", "```"]],
      ["a table", ["| a | b |", "|---|---|", "| x | 1 |"]],
    ];
    for (const [, lines] of enders) {
      const doc = ["10", ...lines, "20", "total above"];
      expect(batch(doc)[doc.length - 1]).toBe("20");
      expect(incremental(doc)).toEqual(batch(doc));
    }
    // A pipe row with no separator is an expression, and counts.
    const or = ["10", "5 | 3", "20", "total above"];
    expect(batch(or)[3]).toBe("37");
    expect(incremental(or)).toEqual(batch(or));
  });

  test("the trace of a total names the figures it passed a comment for, both passes (#652)", () => {
    const doc = ["rent: $500", "// remember to check", "food: $200", "total above", "inputs of line 4"];
    expect(batch(doc)[4]).toBe("$700.00 (line 4) <- $500.00 (line 1), $200.00 (line 3)");
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("a comment typed into a live column keeps the total, and a blank line typed there ends it (#652)", () => {
    const { shown } = editThenEvaluate(["rent: $500", "x", "food: $200", "total above"], [[2, "// remember to check"]]);
    expect(shown[3]).toBe("$700.00");
    const blank = editThenEvaluate(["rent: $500", "x", "food: $200", "total above"], [[2, ""]]);
    expect(blank.shown[3]).toBe("$200.00");
    expect(blank.shown).toEqual(batch(blank.edited));
  });

  test("a form that reads a comment or a table row below it gets one answer on both passes (#803)", () => {
    // The incremental pass read a line below the reader as a figure still to
    // come until the evaluator reached it; the batch pass knew it was a comment.
    const section = ['count of section "Home"', "# Home", "// note 5"];
    expect(batch(section)[0]).toBe("0");
    expect(incremental(section)).toEqual(batch(section));
    const empty = ['total of section "Trip"', "## Trip", "// note 4"];
    expect(batch(empty)[0]).toBe('ERROR: The section "Trip" has no figures to add up.');
    expect(incremental(empty)).toEqual(batch(empty));
    const range = ["sum(line 2 : line 4)", "sum(line 5 : line 4)", "spent += prev", "", "| ---- | ---- |"];
    expect(incremental(range)).toEqual(batch(range));
    const table = ["sum(line 3 : line 5)", "", "| a | b |", "|---|---|", "| x | 1 |", "10"];
    expect(incremental(table)).toEqual(batch(table));
  });

  test("a reference to a line that failed says so, the same in both passes (#552)", () => {
    // The batch pass used to call the failed line "not evaluated yet".
    const doc = ["this is prose", "line 1 + 1", "prev"];
    const expected = [batch(doc)[0], "ERROR: Line 1 has an error", "ERROR: Line 2 has an error"];
    expect(batch(doc).slice(1)).toEqual(expected.slice(1));
    expect(incremental(doc).slice(1)).toEqual(expected.slice(1));
  });

  test("a blank line or a heading inside a span is passed over, both passes (#562)", () => {
    // A blank line used to read as a forward reference and fail the sum.
    const doc = ["10", "", "30", "# Mid", "20", "sum(line 1 : line 5)", "average(line 1 : line 5)"];
    expect(batch(doc).slice(5)).toEqual(["60", "20"]);
    expect(incremental(doc).slice(5)).toEqual(["60", "20"]);
    // A span with no figures at all says so, and a span past the end is still refused.
    const empty = ["", "", "sum(line 1 : line 2)"];
    expect(batch(empty)[2]).toMatch(/^ERROR: Lines 1 to 2 hold no figures/);
    expect(incremental(empty)[2]).toBe(batch(empty)[2]);
    const past = ["10", "sum(line 1 : line 9)"];
    expect(batch(past)[1]).toMatch(/Line 2 has not been evaluated yet/);
    expect(incremental(past)[1]).toBe(batch(past)[1]);
  });

  test("an explicit span reaches across a boundary, both passes", () => {
    const doc = ["10", "20", "30", "sum(line 1 : line 3)", "average(line 1 : line 3)"];
    expect(batch(doc).slice(3)).toEqual(["60", "20"]);
    expect(incremental(doc).slice(3)).toEqual(["60", "20"]);
  });

  test("a column of decimals totals exactly, both passes (#511)", () => {
    const doc = ["0.1", "0.2", "total above", "line 3 == 0.3", "sum(line 1 : line 2) == 0.3", "average(line 1 : line 2) == 0.15"];
    expect(batch(doc).slice(2)).toEqual(["0.30", "true", "true", "true"]);
    expect(incremental(doc).slice(2)).toEqual(["0.30", "true", "true", "true"]);
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("prev");
    expectNeedsDocument("line 1");
    expectNeedsDocument("total above");
    expectNeedsDocument("sum(line 1 : line 3)");
  });
});

describe("line references kept on their lines across an insertion or a deletion (#524)", () => {
  // A host keeps `line N` on the line it meant by applying the edits the
  // language service returns. The contract is that the answers survive it:
  // every line that was there before answers the same afterwards, through both
  // document passes, and the two passes still agree value for value.

  /** The document after `change`, with the service's edits applied. */
  function keptInStep(changed: string[], change: LineShift): string[] {
    const service = new LanguageService(newTrackedEngine());
    const result = service.shiftLineReferences(changed.join("\n"), change);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return applyTextEdits(changed.join("\n"), result.edits).split("\n");
  }

  test("a line inserted at the top: `line 1 + line 2` becomes `line 2 + line 3`, same answer", () => {
    const before = ["10", "20", "line 1 + line 2"];
    const after = keptInStep(["", ...before], { kind: "insert", line: 1, count: 1 });
    expect(after[3]).toBe("line 2 + line 3");
    expect(batch(before)[2]).toBe("30");
    expect(batch(after)[3]).toBe("30");
    expect(incremental(after)[3]).toBe("30");
  });

  test("an insertion in the middle keeps every earlier answer, both passes", () => {
    const before = ["10", "20", "line 1 + line 2", "sum(line 1 : line 2)", "line3 * 2", "average(line 4 : line 3)"];
    const after = keptInStep(["10", "20", "a note inserted here", ...before.slice(2)], { kind: "insert", line: 3, count: 1 });
    expect(after).toEqual(["10", "20", "a note inserted here", "line 1 + line 2", "sum(line 1 : line 2)", "line4 * 2", "average(line 5 : line 4)"]);
    // Old line i is new line i + 1 from line 3 down.
    const moved = (answers: string[]) => [...answers.slice(0, 2), ...answers.slice(3)];
    expect(moved(batch(after))).toEqual(batch(before));
    expect(moved(incremental(after))).toEqual(incremental(before));
    expect(incremental(after)).toEqual(batch(after));
  });

  test("goal seek's target moves with its line, and still solves through the incremental pass", () => {
    const before = [":x = 0", "x * 2 + 10", "solve line 2 for x = 30"];
    const after = keptInStep(["# Working", ...before], { kind: "insert", line: 1, count: 1 });
    expect(after[3]).toBe("solve line 3 for x = 30");
    expect(incremental(before)[2]).toBe("10");
    expect(incremental(after)[3]).toBe("10");
    // The batch pass refuses goal seek before and after alike.
    expect(batch(after)[3]).toBe(batch(before)[2]);
  });

  test("a deletion: what moved is renumbered, a range shrinks, a reference into the gone line is a named error", () => {
    const before = ["10", "20", "30", "line 3 - line 1", "sum(line 1 : line 3)", "line 2 * 2"];
    const after = keptInStep(["10", "30", "line 3 - line 1", "sum(line 1 : line 3)", "line 2 * 2"], { kind: "delete", line: 2, count: 1 });
    expect(after).toEqual(["10", "30", "line 2 - line 1", "sum(line 1 : line 2)", "line deleted * 2"]);
    expect(batch(before)[3]).toBe("20");
    const deleted = "ERROR: This reference pointed at a line that has been deleted";
    expect(batch(after).slice(2)).toEqual(["20", "40", deleted]);
    expect(incremental(after)).toEqual(batch(after));
  });

  test("`line deleted` is the same named error through every entry point", () => {
    const doc = ["10", "line deleted + 5", "sum(line deleted : line deleted)", "solve line deleted for x = 3"];
    const deleted = "ERROR: This reference pointed at a line that has been deleted";
    expect(batch(doc).slice(1)).toEqual([deleted, deleted, deleted]);
    expect(incremental(doc)).toEqual(batch(doc));
    // No document to read either way: a structured error, never a throw or a number.
    const { threw, type, message } = single("line deleted + 5");
    expect(threw).toBe(false);
    expect(type).toBe(ValueType.Error);
    expect(message).toBe("This reference pointed at a line that has been deleted");
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

  test("a column of decimal cells sums and averages exactly (#511)", () => {
    const decimals = ["| item | tip |", "| ---- | --- |", "| a | 0.1 |", "| b | 0.2 |"];
    const doc = [...decimals, "", 'sum of column "tip" above', 'sum of column "tip" above == 0.3', 'average of column "tip" above == 0.15'];
    expect(batch(doc).slice(5)).toEqual(["0.30", "true", "true"]);
  });

  test("a money column totals in its currency, the way total above does, both passes (#651)", () => {
    const money = ["| item | cost |", "|---|---|", "| rent | 500 |", "| food | $200 |", "| car | 1,200 |", ""];
    const doc = [...money, 'total of column "cost" above', 'count of column "cost" above', 'max of column "cost" above'];
    expect(batch(doc).slice(6)).toEqual(["$1,900.00", "3", "$1,200.00"]);
    expect(incremental(doc)).toEqual(batch(doc));
    // The same figures typed as lines give the same total.
    expect(batch(["500", "$200", "1,200", "total above"])[3]).toBe("$1,900.00");
  });

  test("two currencies, a percentage and misplaced grouping, both passes (#651)", () => {
    const two = ["| item | cost |", "|---|---|", "| a | $500 |", "| b | £200 |", "", 'total of column "cost" above'];
    expect(batch(two)[5]).toBe("ERROR: Cannot combine incompatible units: USD and GBP");
    expect(incremental(two)).toEqual(batch(two));
    const percent = ["| item | cost |", "|---|---|", "| a | 20% |", "| b | 1 |", "", 'total of column "cost" above', 'count of column "cost" above'];
    expect(batch(percent)[5]).toMatch(/^ERROR: The "cost" cell on line 3 is a percentage, 20%/);
    expect(batch(percent)[6]).toBe("2");
    expect(incremental(percent)).toEqual(batch(percent));
    // `12,57` is not grouped as a thousand, so it is text and skipped.
    const grouped = ["| item | cost |", "|---|---|", "| a | 12,57 |", "| b | 1 |", "", 'total of column "cost" above'];
    expect(batch(grouped)[5]).toBe("1");
    expect(incremental(grouped)).toEqual(batch(grouped));
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

  // Every row of a table is markup on both passes, not only its separator
  // (#616): no result, no error, and a line under the table is not blamed on
  // one of its rows.
  test("every row is skipped, with no error, through both passes (#616)", () => {
    const doc = [...table, "", 'sum of column "cost" above'];
    const out = batch(doc);
    expect(out.slice(0, 5)).toEqual(["", "", "", "", ""]);
    expect(out[6]).toBe("1,512");
    expect(incremental(doc)).toEqual(out);
    const engine = newTrackedEngine();
    expect(engine.parseDocument(doc.join("\n")).errors).toEqual([]);
  });

  test("a table ends the block for total above, as a heading does, through both passes (#616)", () => {
    const doc = ["10", ...table, "total above"];
    const out = batch(doc);
    expect(out[6]).toMatch(/^ERROR: No lines above to aggregate/);
    expect(incremental(doc)).toEqual(out);
  });

  test("pipe rows with no separator stay expressions: `|` is bitwise or", () => {
    const doc = ["| 5", "5 | 3"];
    expect(batch(doc)).toEqual(incremental(doc));
    expect(batch(doc)[1]).toBe("7");
  });

  test("a live edit that adds the separator skips the rows typed before it (#616)", () => {
    const typing = ["| item | cost |", "| rent | 1200 |", "", "1 + 1"];
    const { shown, edited } = editThenEvaluate([typing[0], "x", typing[1], "", "1 + 1"], [[2, "| ---- | ---- |"]]);
    expect(shown.slice(0, 3)).toEqual(["", "", ""]);
    expect(shown).toEqual(batch(edited));
  });

  test("a live edit that removes the separator makes the rows expressions again (#616)", () => {
    const { shown, edited } = editThenEvaluate([...table, "", "1 + 1"], [[2, "plain text"]]);
    expect(shown).toEqual(batch(edited));
    expect(shown[0]).toMatch(/^ERROR:/);
  });

  test("a live deletion of the line splitting two pipe blocks reclassifies both (#616)", () => {
    const lines = ["| item | cost |", "note", "| ---- | ---- |", "| rent | 1200 |"];
    const { shown, edited } = deleteThenEvaluate(lines, 2);
    expect(shown).toEqual(batch(edited));
    expect(shown).toEqual(["", "", ""]);
  });
});

describe("table lookups and bands across entry points", () => {
  const budget = ["| item | cost |", "| ---- | ---- |", "| rent | 1200 |", "| food | 300 |", "| taxi | 12 |", ""];
  const bands = ["| from | rate |", "| ---- | ---- |", "| 0 | 0% |", "| 10,000 | 20% |", "| 40,000 | 40% |", ""];

  test("an exact lookup reads the same cell through both passes", () => {
    const doc = [...budget, 'column "cost" for "food"', 'column "cost" for "rent" in table above * 2'];
    expect(batch(doc).slice(6)).toEqual(["300", "2,400"]);
    expect(incremental(doc).slice(6)).toEqual(["300", "2,400"]);
  });

  test("a band lookup and a progressive total agree through both passes", () => {
    const doc = [...bands, 'column "rate" for 45,000 in bands above', "45,000 through bands above", "$45,000 through bands above"];
    const expected = ["40.00%", "8,000", "$8,000.00"];
    expect(batch(doc).slice(6)).toEqual(expected);
    expect(incremental(doc).slice(6)).toEqual(expected);
  });

  test("money stays exact to the penny through both passes", () => {
    // $10.10 at 15% is $1.515, a half-cent the till rounds up; a double rounds it down.
    const doc = ["| from | rate |", "| ---- | ---- |", "| 0 | 15% |", "", "$10.10 through bands above"];
    expect(batch(doc)[4]).toBe("$1.52");
    expect(incremental(doc)[4]).toBe("$1.52");
  });

  test("a refusal is the same refusal through both passes", () => {
    const missing = [...budget, 'column "cost" for "fuel"'];
    expect(batch(missing)[6]).toContain("ERROR:");
    expect(incremental(missing)[6]).toBe(batch(missing)[6]);
    const notFromZero = ["| from | rate |", "| ---- | ---- |", "| 10 | 5% |", "", "100 through bands above"];
    expect(batch(notFromZero)[4]).toContain("ERROR:");
    expect(incremental(notFromZero)[4]).toBe(batch(notFromZero)[4]);
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument('column "cost" for "food"');
    expectNeedsDocument('column "rate" for 45,000 in bands above');
    expectNeedsDocument("45,000 through bands above");
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

  // A target holding a what-if or a sweep would re-run the document on every
  // probe (#604). The incremental pass refuses it by name; the batch pass
  // refuses goal seek as it always does; the single line has no document.
  test("a target that holds a sweep is refused by name through the incremental pass (#604)", () => {
    const doc = [":k = 1", ":x = 1", "x * 2", "round(sum(x, line 3 for x from 1 to 1000 step 1) * k)", "solve line 4 for k = 3000.5"];
    const started = Date.now();
    const out = incremental(doc);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(out[3]).toBe("1,001,000");
    expect(out[4]).toBe("ERROR: Goal seek cannot target a line that holds a what-if or a sweep, since every one of its probes would re-run the document again. Target a line without one.");
    const refused = batch(doc);
    expect(refused[3]).toBe(out[3]);
    expect(refused[4].toLowerCase()).toContain("document");
    expectNeedsDocument("solve line 1 for k = 5");
  });
});

describe("bare assignments across entry points (#555)", () => {
  // A bare assignment (`payment = deposit * 40`) is carried out while it
  // compiles and leaves no program behind, so the live evaluator had nothing to
  // re-run once the line was clean, and it recorded neither what the line read
  // nor what it wrote. An edit above it left its old answer on screen while the
  // colon form beside it updated.

  test("the reported case: an edit above a bare assignment reaches it", () => {
    const { shown, edited } = editThenEvaluate(
      ["deposit = 100", "payment = deposit * 40", ":colon = deposit * 40"],
      [[1, "deposit = 150"]],
    );
    expect(shown).toEqual(["150", "6,000", "6,000"]);
    expect(shown).toEqual(batch(edited));
  });

  test("a chain of bare assignments follows an edit at its root", () => {
    const { shown, edited } = editThenEvaluate(
      ["price = 20", "qty = 3", "cost = price * qty", "cost * 2"],
      [[1, "price = 25"]],
    );
    expect(shown).toEqual(["25", "3", "75", "150"]);
    expect(shown).toEqual(batch(edited));
  });

  test("a name assigned twice holds the earlier value at the earlier line", () => {
    // The line between the two used to read 7, the value the second
    // assignment left in the VM on the previous pass.
    const { shown, edited } = editThenEvaluate(["x = 5", "x + 1", "x = 7"], [[2, "x + 2"]]);
    expect(shown).toEqual(["5", "7", "7"]);
    expect(shown).toEqual(batch(edited));
  });

  test("an assignment that reads its own name does not climb on a re-run", () => {
    const { shown, edited } = editThenEvaluate(["x = 5", "x = x + 1", "x * 10"], [[1, "x = 6"]]);
    expect(shown).toEqual(["6", "7", "70"]);
    expect(shown).toEqual(batch(edited));
  });

  test("a bare assignment edited away no longer defines its name", () => {
    const { shown, edited } = editThenEvaluate(["x = 5", "x + 1"], [[1, "# heading"]]);
    expect(shown).toEqual(["", "ERROR: Undefined variable: x"]);
    expect(shown).toEqual(batch(edited));
  });

  test("both document passes agree on a document of bare assignments", () => {
    const doc = ["deposit = 100", "payment = deposit * 40", "deposit = 150", "payment", "payment = deposit * 40", "payment"];
    expect(batch(doc)).toEqual(["100", "4,000", "150", "4,000", "6,000", "6,000"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });
});

describe("line endings and a trailing line break across entry points (#613)", () => {
  // `batch` and `incremental` join lines with "\n", so a CRLF document is
  // written with "\r" at the end of each line, and a trailing line break as a
  // final empty line.
  test.each([
    ["a line reference", ["1\r", "2\r", "total above\r", ""]],
    ["a category tag", ["40 #food\r", "20 #food\r", "total of #food\r", ""]],
    ["a section", ["# Travel\r", "100\r", "250\r", "\r", "total of section \"Travel\"\r", ""]],
    ["a what-if", ["x = 5\r", "x * 2\r", "line 2 with x = 1\r", ""]],
  ])("%s reads the same through both passes, with the empty last line", (_form, doc) => {
    const out = batch(doc);
    expect(out).toHaveLength(doc.length);
    expect(out[out.length - 1]).toBe("");
    expect(incremental(doc)).toEqual(out);
  });

  test("the answers are the ones the same document gives without the \\r", () => {
    expect(batch(["1\r", "2\r", "total above\r", ""])).toEqual(batch(["1", "2", "total above", ""]));
    expect(batch(["1", "2", "total above", ""])).toEqual(["1", "2", "3", ""]);
  });
});

describe("list markers across entry points (#560)", () => {
  // A list marker is markup: `- 100 * 2` is a bullet holding `100 * 2`. The
  // batch pass set the marker aside and the incremental pass read the `-` as a
  // minus, so the same note showed opposite signs depending on the entry point,
  // and the other markers did not evaluate there at all.

  test("the reported case: a bullet holding a line reference and one holding arithmetic", () => {
    const doc = ["20", "- line 1 + 1", "- 100 * 2"];
    expect(batch(doc)).toEqual(["20", "21", "200"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("every marker, and a task item, is set aside the same way by both passes", () => {
    const doc = ["1. 3 * 3", "* 5 + 5", "+ 2 + 2", "- [ ] 4 + 4", "- [x] 4 * 4", "  - 100 + 20"];
    expect(batch(doc)).toEqual(["9", "10", "4", "8", "16", "120"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("a minus with no space after it is still arithmetic in both passes", () => {
    const doc = ["-100 + 20", "- -5 * 2"];
    expect(batch(doc)).toEqual(["-80", "-10"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("an edited bullet is read the same way by the live evaluator", () => {
    const { shown, edited } = editThenEvaluate(["20", "- line 1 + 1"], [[1, "30"], [2, "- line 1 * 2"]]);
    expect(shown).toEqual(["30", "60"]);
    expect(shown).toEqual(batch(edited));
  });

  test("the single-expression path reads its text as an expression, not markdown", () => {
    // No document, so no markdown: the line reference inside is refused with
    // the same structured error it gets anywhere else on this path.
    expectNeedsDocument("- line 1 + 1");
  });
});

describe("=> lines and equation solves across entry points (#565)", () => {
  // A `=>` line, a stored equation and its solve are carried out while they
  // compile and leave no program behind, and they recorded nothing they read,
  // so once clean the live evaluator ran nothing for them: an edit above left
  // the old answer on screen, where a fresh pass of the edited text gives the
  // new one.

  test("the reported case: a => line follows an edit above it", () => {
    const { shown, edited } = editThenEvaluate([":a = 2", "a + 1 =>"], [[1, ":a = 3"]]);
    expect(shown).toEqual(["3", "4"]);
    expect(shown).toEqual(batch(edited));
  });

  test("the reported case: an equation's solve reads the edited factor", () => {
    const { shown, edited } = editThenEvaluate([":a = 2", "a * x = 10", "x =>"], [[1, ":a = 5"]]);
    expect(shown[2]).toBe("2");
    expect(shown).toEqual(batch(edited));
  });

  test("a scalar equation's solve follows an edit too", () => {
    const { shown, edited } = editThenEvaluate([":a = 4", "x^2 - a = 0", "x =>"], [[1, ":a = 9"]]);
    expect(shown[2]).toBe("[-3, 3]");
    expect(shown).toEqual(batch(edited));
  });

  test("a => line reading a bare assignment follows it", () => {
    const { shown, edited } = editThenEvaluate(["a = 2", "a * 10 =>"], [[1, "a = 3"]]);
    expect(shown).toEqual(["3", "30"]);
    expect(shown).toEqual(batch(edited));
  });

  test("a => line reading a position follows the line it reads", () => {
    const { shown, edited } = editThenEvaluate(["2", "line 1 * 2 =>"], [[1, "5"]]);
    expect(shown).toEqual(["5", "10"]);
    expect(shown).toEqual(batch(edited));
  });

  test("an algebra verb follows an edit above it", () => {
    const { shown, edited } = editThenEvaluate([":a = 1", "expand((x + a)^2)"], [[1, ":a = 2"]]);
    expect(shown).toEqual(["2", "x^2+4x+4"]);
    expect(shown).toEqual(batch(edited));
  });

  test("both document passes agree on a document of => lines and solves", () => {
    const doc = [":a = 2", "a + 1 =>", "a * x = 10", "x =>", "line 1 * 2 =>", "expand((x + a)^2)"];
    expect(batch(doc)).toEqual(["2", "3", 'x stored as an equation — solve with "x =>"', "5", "4", "x^2+4x+4"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("the single-expression path refuses a position read inside a => line", () => {
    expectNeedsDocument("line 1 * 2 =>");
  });
});

describe("a stored equation goes with its line (#569)", () => {
  // The VM keeps an equation by its unknown, and nothing removed it when the
  // line that stored it changed, so the live evaluator went on solving an
  // equation the note no longer held.
  const note = [":a = 2", "a * x = 10", "x =>"];

  test("the reported case: the equation's line edited away", () => {
    const { shown, edited } = editThenEvaluate(note, [[2, "# heading"]]);
    expect(shown).toEqual(["2", "", "x"]);
    expect(shown).toEqual(batch(edited));
  });

  test("the equation's line deleted", () => {
    const { shown, edited } = deleteThenEvaluate(note, 2);
    expect(shown).toEqual(["2", "x"]);
    expect(shown).toEqual(batch(edited));
  });

  test("a scalar equation's line edited into an ordinary expression, and deleted", () => {
    const scalar = [":a = 4", "x^2 - a = 0", "x =>"];
    const edit = editThenEvaluate(scalar, [[2, "a + 1"]]);
    expect(edit.shown).toEqual(["4", "5", "x"]);
    expect(edit.shown).toEqual(batch(edit.edited));
    const deletion = deleteThenEvaluate(scalar, 2);
    expect(deletion.shown).toEqual(["4", "x"]);
    expect(deletion.shown).toEqual(batch(deletion.edited));
  });

  test("an equation edited to another unknown leaves the first unknown unsolved", () => {
    const { shown, edited } = editThenEvaluate([...note, "y =>"], [[2, "a * y = 10"]]);
    expect(shown.slice(2)).toEqual(["x", "5"]);
    expect(shown).toEqual(batch(edited));
  });

  test("with two lines storing one, editing the later away keeps the earlier", () => {
    // The equation belongs to whichever line stored it last, so dropping the
    // other line's leaves it in place.
    const { shown, edited } = editThenEvaluate([...note, "a * x = 20", "x =>"], [[4, "# gone"]]);
    expect(shown[2]).toBe("5");
    expect(shown[4]).toBe("5");
    expect(shown).toEqual(batch(edited));
  });
});

describe("what-if and sweeps across entry points", () => {
  // Line 4 reads payment, which line 3 computes from deposit: the input
  // reaches the target only through the line between.
  const mortgage = [
    "deposit = 100000",
    "rate = 4%",
    "payment = monthly repayment on deposit over 25 years at rate",
    "payment * 12",
  ];
  const doc = [...mortgage, "line 4 with deposit = 150000", "line 4 for rate from 3% to 6% step 1%"];

  test("both document passes re-run the lines between, and agree value for value", () => {
    const fromBatch = batch(doc);
    expect(fromBatch.slice(4)).toEqual(["9,501.06", "[5,690.54, 6,334.04, 7,015.08, 7,731.62]"]);
    expect(incremental(doc)).toEqual(fromBatch);
  });

  test("the lines they re-run answer as they do without them, both passes", () => {
    const plain = [...mortgage, "line 3", "deposit"];
    const withForms = [...doc, "line 3", "deposit"];
    const expected = batch(plain);
    for (const out of [batch(withForms), incremental(withForms)]) {
      expect([...out.slice(0, 4), ...out.slice(6)]).toEqual(expected);
    }
  });

  test("a refusal is the same named error through both passes", () => {
    const refused = [...mortgage, "line 4 with depsoit = 150000", "line 4 for rate from 3% to 6% step 0"];
    const fromBatch = batch(refused);
    expect(fromBatch[4]).toContain("ERROR:");
    expect(fromBatch[5]).toContain("ERROR:");
    expect(incremental(refused)).toEqual(fromBatch);
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("line 4 with deposit = 150000");
    expectNeedsDocument("line 4 for rate from 3% to 6% step 1%");
  });
});

describe("inputs of line N across entry points", () => {
  // Issue #522. The trace is built from each line's text and answer, which
  // both document passes hold alike, so the two agree value for value.
  const mortgage = [":rate = 4%", ":deposit = 100000", "", ":payment = monthly repayment on deposit over 25 years at rate", "inputs of line 4"];

  test("the issue's example, in both document passes, agree", () => {
    const expected = "payment 527.84 (line 4) <- deposit 100,000 (line 2), rate 4.00% (line 1)";
    expect(batch(mortgage)[4]).toBe(expected);
    expect(incremental(mortgage)[4]).toBe(expected);
  });

  test("followed upwards through positions, above and tags, value for value", () => {
    const doc = ["10", "20", "total above", "line 3 * 2 #kept", "5 #kept", "total of #kept", "inputs of line 6"];
    const expected = "65 (line 6) <- 60 (line 4) <- [30 (line 3) <- [10 (line 1), 20 (line 2)]], 5 (line 5)";
    expect(batch(doc)[6]).toBe(expected);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  // #597: a trace reads the spans the forms read. A section total and a table
  // read list the lines behind them, and `total above` leaves out the check it
  // stepped over, value for value through both passes.
  test("a section total lists its section's lines, both passes", () => {
    const doc = ["# Travel", "train = 12", "taxi = 7", "# Food", "t = total of section \"Travel\"", "inputs of line 5"];
    expect(batch(doc)[5]).toBe("t 19 (line 5) <- train 12 (line 2), taxi 7 (line 3)");
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("a table read lists the table's rows by their labels, both passes", () => {
    const doc = ["| item | cost |", "| --- | --- |", "| food | 10 |", "| rent | 20 |", "", "c = column \"cost\" for \"food\"", "inputs of line 6"];
    expect(batch(doc)[6]).toBe("c 10 (line 6) <- food (line 3), rent (line 4)");
    expect(incremental(doc)[6]).toBe(batch(doc)[6]);
  });

  test("total above leaves out the check line it stepped over, both passes", () => {
    const doc = ["10", "check 10 == 10", "5", "total above", "inputs of line 4"];
    expect(batch(doc)[4]).toBe("15 (line 4) <- 10 (line 1), 5 (line 3)");
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("a cycle is a named error, the same in both passes", () => {
    const doc = ["line 2 + 5", "prev + 5", "inputs of line 2"];
    const out = batch(doc);
    expect(out[2]).toBe("ERROR: Line 1 reads line 2, which leads back to line 1: lines that read each other have no answer to trace");
    expect(incremental(doc)).toEqual(out);
  });

  test("a forward reference is a named error, the same in both passes", () => {
    const below = ["120", "inputs of line 3", "prev * 2"];
    expect(batch(below)[1]).toBe(
      "ERROR: Line 3 is not above this line, so its answer has not been worked out yet: a trace reads the lines above it",
    );
    expect(incremental(below)).toEqual(batch(below));
    const within = ["line 2 + 1", "7", "inputs of line 1"];
    expect(batch(within)[2]).toBe(
      "ERROR: Line 1 reads line 2, which is below it, so the order its answer was worked out in cannot be traced",
    );
    expect(incremental(within)).toEqual(batch(within));
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("inputs of line 1");
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
