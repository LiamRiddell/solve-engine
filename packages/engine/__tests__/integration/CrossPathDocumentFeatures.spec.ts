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
import { createLinkedTransports, createWorkerEngine, serializeParsingResult, startWorkerRuntime, type WorkerEngine } from "@solve-js/worker";

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

describe("ans and prev inside a stored equation across entry points", () => {
  // The equation's sides are run as the line that stored it, so ans and prev
  // read the answer above the equation, not the line above the arrow
  // (FoundBug_lineReadInAnEquation).
  const doc = ["5", "x + ans = 7", "100", "x =>"];
  const stored = 'x stored as an equation: solve with "x =>"';

  test("both document passes solve with the line above the equation, and agree", () => {
    expect(batch(doc)).toEqual(["5", stored, "100", "2"]);
    expect(incremental(doc)).toEqual(batch(doc));
    const withPrev = ["5", "x + prev = 7", "x =>"];
    expect(batch(withPrev)).toEqual(["5", stored, "2"]);
    expect(incremental(withPrev)).toEqual(batch(withPrev));
  });

  test("an edit to the line above the equation re-solves it, and a fresh batch pass agrees", () => {
    const { shown, edited } = editThenEvaluate(["5", "x + ans = 7", "x =>"], [[1, "6"]]);
    expect(shown).toEqual(["6", stored, "1"]);
    expect(batch(edited)).toEqual(shown);
  });

  test("the single-line path refuses the equation as needing a document", () => {
    expectNeedsDocument("x + ans = 7");
    expectNeedsDocument("x + prev = 7");
  });
});

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

  test("ans is the line above when nothing is named ans, both passes (#668)", () => {
    expect(batch(["10", "ans * 2"])).toEqual(["10", "20"]);
    expect(incremental(["10", "ans * 2"])).toEqual(batch(["10", "ans * 2"]));
    // A defined ans is the variable, as it always was.
    const named = ["ans = 5", "ans * 2", ":ans = 3", "ans"];
    expect(batch(named)).toEqual(["5", "10", "3", "3"]);
    expect(incremental(named)).toEqual(batch(named));
    // Where prev has nothing to read, ans says the same.
    for (const doc of [["ans"], ["10", "", "ans"], ["10", "# h", "ans"], ["this is prose", "ans"]]) {
      const withPrev = doc.map((text) => (text === "ans" ? "prev" : text));
      expect(batch(doc)).toEqual(batch(withPrev));
      expect(incremental(doc)).toEqual(batch(doc));
    }
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

  test("a number written in a base is a figure in a column, through every span form, both passes (FoundBug_baseValueInAColumn)", () => {
    const doc = ["255 in hex", "0b1010 as binary", "5", "total above", "average(line 1 : line 3)", "sum(line 1 : line 3) in hex", "max above"];
    const expected = ["0xFF", "0b1010", "5", "270", "90", "0x10E", "255"];
    expect(batch(doc)).toEqual(expected);
    expect(incremental(doc)).toEqual(batch(doc));
    const big = ["(2^100 + 1) in hex", "1", "total above"];
    // A column total reads a whole number past 2^53 as the plain number's own column does.
    expect(batch(big)[2]).toBe(batch(["2^100 + 1", "1", "total above"])[2]);
    expect(incremental(big)).toEqual(batch(big));
    const tagged = ["255 in hex #dev", "10 #dev", "total of #dev"];
    expect(batch(tagged)[2]).toBe("265");
    expect(incremental(tagged)).toEqual(batch(tagged));
    expectNeedsDocument("255 in hex + total above");
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("prev");
    expectNeedsDocument("ans * 2");
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

  // The answer carries the unit the unknown has in the note (#835): a price in
  // pounds is solved as pounds, through either mechanism, and a target in
  // another unit of the line's measure is read in the line's unit first.
  test("an unknown in money or a unit is answered in it, through the incremental pass only (#835)", () => {
    const money = [":price = £200", ":qty = 3", "price * qty", "solve line 3 for price = £1,500"];
    expect(incremental(money)[3]).toBe("£500.00");
    const searched = [":deposit = £100000", ":rate = 4%", "monthly repayment on deposit over 25 years at rate", "solve line 3 for deposit = £900"];
    expect(incremental(searched)[3]).toBe("£170,507.23");
    const length = [":d = 5 km", "d * 2", "solve line 2 for d = 3000 m"];
    expect(incremental(length)[2]).toBe("1.50 km");
    // The lines both passes evaluate agree; the seek itself is refused by the
    // batch pass, and by the single line, as every goal seek is.
    expect(batch(money).slice(0, 3)).toEqual(incremental(money).slice(0, 3));
    expect(batch(money)[3].toLowerCase()).toContain("document");
    expectNeedsDocument("solve line 3 for price = £1,500");
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

  // Both signs, a sample that is not finite as a gap, every crossing, and a
  // stated range (#739). The incremental pass solves each; the batch pass and
  // the single line refuse, as every goal seek is refused there.
  test("both signs and a stated range, through the incremental pass only (#739)", () => {
    const negative = ["x = 1", "x + sin(x)", "solve line 2 for x = -2"];
    expect(incremental(negative)[2]).toBe("-1.11");
    const power = ["x = 1", "2^x", "solve line 2 for x = 4", "solve line 2 for x = 0.25"];
    expect(incremental(power).slice(2)).toEqual(["2", "-2"]);
    const both = ["x = 1", "x^2", "solve line 2 for x = 4", "solve line 2 for x = 4 between 0 and 10"];
    expect(incremental(both).slice(2)).toEqual(["[-2, 2]", "2"]);
    for (const doc of [negative, power, both]) {
      expect(batch(doc).slice(0, 2)).toEqual(incremental(doc).slice(0, 2));
      for (const line of batch(doc).slice(2)) expect(line.toLowerCase()).toContain("document");
    }
    expectNeedsDocument("solve line 2 for x = 4 between 0 and 10");
  });

  // A rate held as a percentage is solved as one, and a goal seek on a line a
  // what-if re-runs names the what-if as the reason it cannot answer there,
  // through both document passes alike (FoundBug_goalSeekLoanRefusals,
  // FoundBug_goalSeekRefusalNamesWhereItIs).
  test("a percentage unknown, and a goal seek inside a what-if, across entry points", () => {
    const rate = [":deposit = 100000", ":rate = 4%", "monthly repayment on deposit over 25 years at rate", "solve line 3 for rate = 600"];
    expect(incremental(rate)[3]).toBe("5.26%");
    expect(batch(rate).slice(0, 3)).toEqual(incremental(rate).slice(0, 3));
    expect(batch(rate)[3].toLowerCase()).toContain("batch pass");
    expectNeedsDocument("solve line 3 for rate = 600");
    const whatIf = ["x = 5", "x * 2", "y = solve line 2 for x = 3", "line 3 with x = 4"];
    const refusal = "ERROR: Goal seek cannot run inside a what-if: the what-if works each line of its scenario out once, and a goal seek re-runs another line many times. Solve the line outside the what-if.";
    expect(incremental(whatIf)[3]).toBe(refusal);
    expect(batch(whatIf)[3]).toBe(refusal);
    expectNeedsDocument("line 3 with x = 4");
  });
});

describe("a formula stored before its unknown had a value, across entry points (#732)", () => {
  // `y = x + 1` above `x = 5` stores the formula; a line below both reads it
  // with the value x now has. Both document passes agree value for value. A
  // single line has no later definition to read, so it keeps the formula.
  test("both document passes read the formula with the later value", () => {
    const doc = ["y = x + 1", "x = 5", "y + x", "z = y * 2", "z"];
    expect(batch(doc)).toEqual(["x+1", "5", "11", "12", "12"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("a value the formula cannot take is refused by name in both passes", () => {
    const doc = ["y = x + 1", "x = $5", "y + x"];
    expect(batch(doc)[2]).toBe("ERROR: y was written as a formula in x before x had a value, and x now holds money, which the formula cannot take. Define x above the line that defines y.");
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("the single-expression path keeps the formula, with no later line to read", () => {
    const { threw, type, message } = single("y = x + 1");
    expect(threw).toBe(false);
    expect(type).toBe(ValueType.Symbolic);
    expect(message).toBe("x+1");
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
    expect(batch(doc)).toEqual(["2", "3", 'x stored as an equation: solve with "x =>"', "5", "4", "x^2+4x+4"]);
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

describe("named scenarios and date sweeps across entry points (#744)", () => {
  const shop = ["price = $100", "qty = 3", "price * qty", "scenario bull with price = $120, qty = 5", "line 3 under bull"];
  const dates = ["start = 2026-01-01", "finish = 2026-12-31", "working days between start and finish", "line 3 for start from 2026-01-01 to 2026-04-01 step 1 month"];

  test("both document passes read the scenario and step the dates, and agree value for value", () => {
    const fromBatch = batch(shop);
    expect(fromBatch.slice(3)).toEqual(["bull: price = $120.00, qty = 5", "$600.00"]);
    expect(incremental(shop)).toEqual(fromBatch);
    expect(batch(dates)[3]).toBe("[261, 239, 219, 197]");
    expect(incremental(dates)).toEqual(batch(dates));
  });

  test("an edit to the declaration reaches the reader in a live editor", () => {
    const { shown, edited } = editThenEvaluate(shop, [[4, "scenario bull with price = $150, qty = 5"]]);
    expect(shown[4]).toBe("$750.00");
    expect(shown).toEqual(batch(edited));
  });

  test("an inserted line moves the scenario's target with the line it meant", () => {
    const service = new LanguageService(newTrackedEngine());
    const changed = ["", ...shop];
    const result = service.shiftLineReferences(changed.join("\n"), { kind: "insert", line: 1, count: 1 });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const after = applyTextEdits(changed.join("\n"), result.edits).split("\n");
    expect(after[5]).toBe("line 4 under bull");
    expect(batch(after)[5]).toBe("$600.00");
  });

  test("a refusal is the same named error through both passes", () => {
    const refused = [...shop.slice(0, 3), "line 3 under nope", "line 3 for price from 2026-01-01 to 2026-02-01 step 1 day"];
    const fromBatch = batch(refused);
    expect(fromBatch[3]).toMatch(/^ERROR: No line above this one declares a scenario named nope/);
    expect(fromBatch[4]).toMatch(/^ERROR: /);
    expect(incremental(refused)).toEqual(fromBatch);
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("line 3 under bull");
    expectNeedsDocument("line 3 for start from 2026-01-01 to 2026-04-01 step 1 month");
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

describe("a variable named like a unit, after a slash (#642)", () => {
  // `t` is a tonne and a common variable name. After a slash with nothing
  // measured before it, a defined `t` is divided by; an undefined one keeps
  // the rate. The answer now depends on another line, so the live evaluator
  // must follow an edit that adds, changes or deletes the definition.

  test("both passes divide by a defined name and agree", () => {
    const doc = ["t = 5", "100 / t", "100/t", "distance = 120", "t2 = 2", "speed = distance / t", "100 / (t)"];
    expect(batch(doc)).toEqual(["5", "20", "20", "120", "2", "24", "20"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("an undefined name, or one defined below, keeps the rate on both passes", () => {
    const doc = ["100 / t", "t = 5"];
    expect(batch(doc)).toEqual(["100.00 /t", "5"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("a unit written before the slash keeps the rate, both passes", () => {
    const doc = ["h = 4", "$15 / h", "60 km / h", "100 per h"];
    expect(batch(doc)).toEqual(["4", "$15.00/h", "60.00 km/h", "100.00 /h"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("typing the definition above the line changes its answer", () => {
    const { shown, edited } = editThenEvaluate(["x = 1", "100 / t"], [[1, "t = 5"]]);
    expect(shown[1]).toBe("20");
    expect(shown).toEqual(batch(edited));
  });

  test("changing the definition's value changes the answer", () => {
    const { shown, edited } = editThenEvaluate(["t = 5", "100 / t"], [[1, "t = 4"]]);
    expect(shown[1]).toBe("25");
    expect(shown).toEqual(batch(edited));
  });

  test("renaming the definition away turns the line back into a rate", () => {
    const { shown, edited } = editThenEvaluate(["t = 5", "100 / t"], [[1, "x = 5"]]);
    expect(shown[1]).toBe("100.00 /t");
    expect(shown).toEqual(batch(edited));
  });

  test("deleting the definition turns the line back into a rate", () => {
    const { shown, edited } = deleteThenEvaluate(["t = 5", "100 / t"], 1);
    expect(shown[0]).toBe("100.00 /t");
    expect(shown).toEqual(batch(edited));
  });

  test("a rename through the language service carries the denominator with it", () => {
    const text = ["t = 5", "100 / t"].join("\n");
    const service = new LanguageService(newTrackedEngine());
    const result = service.rename(text, { line: 1, character: 0 }, "time");
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const after = applyTextEdits(text, result.edits).split("\n");
    expect(after).toEqual(["time = 5", "100 / time"]);
    expect(batch(after)).toEqual(["5", "20"]);
  });

  test("the single-expression path has no variables, so it reads the rate", () => {
    expect(single("100 / t")).toEqual({ threw: false, type: ValueType.Uom, message: "100.00 /t" });
  });
});

describe("renaming a variable a rate denominator above it spells (#642)", () => {
  test("a denominator above the definition is the unit, so the rename leaves it", () => {
    const text = ["100 / t", "t = 5", "100 / t"].join("\n");
    const service = new LanguageService(newTrackedEngine());
    const result = service.rename(text, { line: 2, character: 0 }, "time");
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const after = applyTextEdits(text, result.edits).split("\n");
    expect(after).toEqual(["100 / t", "time = 5", "100 / time"]);
    expect(batch(after)).toEqual(batch(text.split("\n")));
    expect(batch(after)).toEqual(["100.00 /t", "5", "20"]);
  });
});

describe("a pass's work budget across entry points (#711)", () => {
  // Sweeps, what-ifs and span aggregates share one count per pass; the line
  // whose work would cross vm.maxLineRunsPerPass is refused. Both document
  // passes walk the note in order and charge alike, so they refuse the same line.
  const header = ["x = 1", "a = x + 1", "b = a + 1", "c = b + 1", "c * 2"];
  const sweep = "line 5 for x from 1 to 20 step 1";
  const doc = [...header, ...Array(7).fill(sweep)];

  function run(lines: string[], limit: number, pass: "batch" | "incremental"): string[] {
    const engine = newTrackedEngine({ config: { vm: { maxLineRunsPerPass: limit } } });
    const text = lines.join("\n");
    const result = pass === "batch" ? engine.parseDocument(text, { inputType: "markdown" }) : evaluateDocument(engine, text, { inputType: "markdown" });
    return readLines(result);
  }

  test("both passes refuse the same line, and the lines above keep their answers", () => {
    const batchLines = run(doc, 500, "batch");
    expect(batchLines.slice(0, 5)).toEqual(["1", "2", "3", "4", "8"]);
    expect(batchLines[9]).toMatch(/^\[8, 10, 12/);
    expect(batchLines[10]).toMatch(/^ERROR: This sweep would take this pass over the note past 500 line runs/);
    expect(run(doc, 500, "incremental")).toEqual(batchLines);
  });

  test("the single-expression path has no document to spend on", () => {
    const answer = single(sweep);
    expect(answer.message).not.toMatch(/line runs/);
  });
});

describe("what a note keeps across entry points (#694)", () => {
  // Every answer a pass keeps counts toward vm.maxRetainedElements: a list its
  // cells, anything else one. The line whose answer would cross it is refused
  // and its name let go. Both document passes count in order, so they refuse
  // the same line.
  const heavy = "map(x + 1, 0:99)";
  const doc = [`:a = ${heavy}`, `:b = ${heavy}`, `:c = ${heavy}`, "7"];

  function run(lines: string[], limit: number, pass: "batch" | "incremental"): string[] {
    const engine = newTrackedEngine({ config: { vm: { maxRetainedElements: limit } } });
    const text = lines.join("\n");
    const result = pass === "batch" ? engine.parseDocument(text, { inputType: "markdown" }) : evaluateDocument(engine, text, { inputType: "markdown" });
    return readLines(result);
  }

  test("both passes refuse the same line, and the lines above keep their answers", () => {
    const batchLines = run(doc, 250, "batch");
    expect(batchLines[0]).toMatch(/^\[1, 2, 3/);
    expect(batchLines[1]).toMatch(/^\[1, 2, 3/);
    expect(batchLines[2]).toMatch(/^ERROR: Line 3's answer holds 100 elements, which would take what this note keeps past 250/);
    expect(batchLines[3]).toBe("7");
    expect(run(doc, 250, "incremental")).toEqual(batchLines);
  });

  test("the single-expression path keeps no note, so its answer is kept", () => {
    const engine = newTrackedEngine({ config: { vm: { maxRetainedElements: 1 } } });
    const value = engine.evaluateLine(1, heavy);
    expect(value.type).toBe(ValueType.Matrix);
  });
});

describe("the other questions of the block above, across entry points (#703)", () => {
  // `count`, `min`, `max` and `median above`, and `avg` and `mean above` for
  // the average, walk the block as `total above` does: the batch pass and the
  // incremental one agree, and the single-expression path has no block.
  const forms = ["avg above", "mean above", "count above", "min above", "max above", "median above"];

  test("each reads the current block, and both passes agree", () => {
    const doc = ["10", "20", "", "5", "15", "25", ...forms];
    const expected = ["10", "20", "", "5", "15", "25", "15", "15", "3", "5", "25", "15"];
    expect(batch(doc)).toEqual(expected);
    expect(incremental(doc)).toEqual(expected);
  });

  test("an edit inside the block reaches every one of them in a live editor", () => {
    const { shown, edited } = editThenEvaluate(["5", "15", "25", ...forms], [[2, "100"]]);
    expect(shown).toEqual(batch(edited));
    expect(shown.slice(3)).toEqual(["43.33", "43.33", "3", "5", "100", "25"]);
  });

  test("the single-expression path has no block, and says so", () => {
    for (const form of forms) expectNeedsDocument(form);
  });
});

describe("a failed line's shape across entry points (#709)", () => {
  // `readLines` above folds a thrown failure and a returned one into the same
  // `ERROR:` text, which is why the two passes could disagree about where a
  // failure goes without this file noticing. This reader keeps them apart, and
  // reads the code, the span, the inline solves and the flat `errors` list.
  type Shape = {
    error: string | null;
    code: string | null;
    span: unknown;
    result: string | null;
    solves: { error: string | null; code: string | null; span: unknown; result: string | null }[];
  };
  const valueOf = (value: { type: ValueType; value: unknown } | null | undefined): string | null =>
    value ? (value.type === ValueType.Error ? `error value ${String(value.value)}` : "value") : null;
  function shapes(result: ParsingResult): { lines: Shape[]; errors: string[] } {
    return {
      lines: result.lines.map((line) => ({
        error: line.error,
        code: line.errorCode ?? null,
        span: line.errorSpan ?? null,
        result: valueOf(line.result),
        solves: line.inlineSolves.map((solve) => ({
          error: solve.error ?? null,
          code: solve.errorCode ?? null,
          span: solve.errorSpan ?? null,
          result: valueOf(solve.result),
        })),
      })),
      errors: result.errors,
    };
  }
  const both = (doc: string[]) => {
    const text = doc.join("\n");
    const batchShape = shapes(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
    const incrementalShape = shapes(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));
    return { batchShape, incrementalShape };
  };

  const DOC = ["3 + * 4", "5 kg + 3 m", "price * 2", "sqrt(-1 m)", "total is s`2 +` and s`5 kg + 3 m`"];

  test("both passes give every line the same shape, value for value", () => {
    const { batchShape, incrementalShape } = both(DOC);
    expect(incrementalShape).toEqual(batchShape);
  });

  test("a thrown failure keeps its code and its span in the line, with no result", () => {
    const { batchShape } = both(DOC);
    expect(batchShape.lines[0]).toEqual({
      error: 'Expected a value after "+", but found "*"',
      code: "NO_PREFIX_PARSELET",
      span: { start: 4, end: 5, line: 1, col: 5 },
      result: null,
      solves: [],
    });
    // Raised with no position even through evaluateExpression, so none is invented.
    expect(batchShape.lines[2]).toMatchObject({ error: "Undefined variable: price", code: "UNDEFINED_VARIABLE", span: null, result: null });
  });

  test("a returned failure stays an error value in result, with no error", () => {
    const { batchShape } = both(DOC);
    expect(batchShape.lines[1]).toMatchObject({ error: null, code: null, result: "error value INCOMPATIBLE_UNITS" });
    expect(batchShape.lines[3]).toMatchObject({ error: null, code: null, result: "error value UNIT_ROOT_UNSUPPORTED" });
  });

  test("an inline solve that throws, beside one that returns an error, each in its own place", () => {
    const { batchShape } = both(DOC);
    expect(batchShape.lines[4].solves).toEqual([
      // The span is in the line's own terms: `2 +` starts at offset 11.
      { error: 'The line ends after "+", where a value was expected', code: "UNEXPECTED_END_OF_INPUT", span: { start: 14, end: 14, line: 5, col: 15 }, result: null },
      { error: null, code: null, span: null, result: "error value INCOMPATIBLE_UNITS" },
    ]);
  });

  test("the flat errors list names every failure, thrown and returned, in both passes", () => {
    const { batchShape } = both(DOC);
    expect(batchShape.errors).toEqual([
      'Line 1: Expected a value after "+", but found "*"',
      "Line 2: mass and length cannot be added",
      "Line 3: Undefined variable: price",
      "Line 4: sqrt: a quantity in m has no square root with a unit; only an area has a length as its root.",
      'Line 5: The line ends after "+", where a value was expected',
      "Line 5: mass and length cannot be added",
    ]);
  });

  test("a line the tokeniser refuses carries its code and span through both passes", () => {
    const { batchShape, incrementalShape } = both(["1 + 1", 'x = "unterminated']);
    expect(incrementalShape).toEqual(batchShape);
    expect(batchShape.lines[1]).toMatchObject({ code: "UNTERMINATED_STRING", result: null });
    expect(batchShape.lines[1].error).toMatch(/^Unterminated string literal/);
  });

  test("a live editor's line result carries the same code and span", () => {
    const engine = newTrackedEngine();
    const doc = new DocumentModel();
    doc.setDocument(DOC.join("\n"));
    const evaluator = new ThreeTierEvaluator(doc, engine);
    try {
      const lines = evaluator.evaluate({ startLine: 1, endLine: DOC.length }).lines;
      const first = lines.find((line) => line.lineNumber === 1)!;
      expect({ code: first.errorCode, span: first.errorSpan }).toEqual({ code: "NO_PREFIX_PARSELET", span: { start: 4, end: 5, line: 1, col: 5 } });
      const third = lines.find((line) => line.lineNumber === 3)!;
      expect({ code: third.errorCode, span: third.errorSpan }).toEqual({ code: "UNDEFINED_VARIABLE", span: null });
    } finally {
      evaluator.terminateWorker();
    }
  });

  test("the single-expression path throws the same code and span the document line carries", () => {
    try {
      newTrackedEngine().evaluateExpression("3 + * 4");
      throw new Error("expected a throw");
    } catch (error) {
      expect({ code: (error as { code?: string }).code, span: (error as { span?: unknown }).span }).toEqual({ code: "NO_PREFIX_PARSELET", span: { start: 4, end: 5, line: 1, col: 5 } });
    }
  });
});

/** A live evaluator's answers after `passes` passes over the text, as an editor settles it. */
function afterPasses(lines: string[], passes: number): string[] {
  const doc = new DocumentModel();
  doc.setDocument(lines.join("\n"));
  const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
  try {
    let shown: string[] = [];
    for (let pass = 0; pass < passes; pass++) shown = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(readEvalLine);
    return shown;
  } finally {
    evaluator.terminateWorker();
  }
}

describe("a reference to a line further down, across entry points and passes", () => {
  // A note is read from the top, so a line below has not been evaluated from
  // where the reader stands. The batch pass refused it, and so did the first
  // incremental pass; from the second on, the incremental path read the answer
  // the previous pass had left the line below, so a live editor showed 10 and
  // 11 where parseDocument refused both lines. It is refused on every pass now.
  const reported = ["a = line 3 * 2", "a + 1", "5"];
  const refusal = "ERROR: Line 3 has not been evaluated yet (forward reference, or out of range)";

  test("the reported document: the forward reference and the line reading it are refused", () => {
    expect(batch(reported)).toEqual([refusal, refusal, "5"]);
  });

  test("the incremental pass agrees, on the first pass and on every later one", () => {
    expect(incremental(reported)).toEqual(batch(reported));
    for (const passes of [1, 2, 3, 5]) expect(afterPasses(reported, passes)).toEqual(batch(reported));
  });

  test.each([
    [["line 2 + 1", "7"]],
    [["sum(line 2 : line 3)", "1", "2"]],
    [["total of #a", "1 #a", "2 #a"]],
    [["total by tag", "1 #a", "2 #b"]],
    [['total of section "Costs"', "# Costs", "1", "2"]],
    [["x = 3", "solve line 3 for x = 10", "x * 2"]],
    [["inputs of line 2", "5"]],
  ])("every form that reads a line below refuses it through every path: %j", (lines) => {
    const settled = afterPasses(lines, 3);
    expect(afterPasses(lines, 1)).toEqual(settled);
    expect(incremental(lines)).toEqual(settled);
    // The batch pass refuses goal seek outright; every other form it answers the same.
    if (!lines.some((line) => line.startsWith("solve"))) expect(batch(lines)).toEqual(settled);
  });

  test("the single-expression path refuses with a document error", () => {
    expectNeedsDocument("line 3 * 2");
    expectNeedsDocument("a = line 3 * 2");
  });
});

describe("a name defined below the line that reads it, across entry points and passes", () => {
  // The name form of the forward reference above: a note read from the top has
  // not defined `x` where `x * 2` stands above `x = 5`. The batch pass and the
  // first incremental pass said so; from the second pass on a live editor read
  // the value the last pass left in the VM and answered 10. Each line now reads
  // the VM as a pass from the top leaves it at that line.
  test.each([
    [["x * 2", "x = 5"]],
    [["x + 1", ":x = 5"]],
    [["f(2)", "f(x) = x + 1"]],
    [["y = x + 1", "x = 5", "y + x"]],
    [[":x = 1", "x + 100", ":x = 99", "x + 100"]],
  ])("%j: every pass of a live editor agrees with both document passes", (lines) => {
    const settled = batch(lines);
    expect(incremental(lines)).toEqual(settled);
    for (const passes of [1, 2, 3]) expect(afterPasses(lines, passes)).toEqual(settled);
  });

  test("the single-expression path reads only the names it was given", () => {
    const { threw, message } = single("x * 2");
    expect(threw).toBe(true);
    expect(message).toBe("Undefined variable: x");
  });
});

describe("a viewport starting below line 1, across entry points", () => {
  // The dirty lines above such a viewport were compiled without running, so a
  // positional reader in view had nothing to read: `prev + 1` answered "Line 2
  // has not been evaluated yet" where parseDocument answers 21. They run now.
  const note = ["10", "20", "prev + 1", "line 1 * 3", "total above"];

  test("the batch pass, the incremental pass and a first evaluate of lines 3 to 5 agree", () => {
    const settled = batch(note);
    expect(settled).toEqual(["10", "20", "21", "30", "81"]);
    expect(incremental(note)).toEqual(settled);
    const doc = new DocumentModel();
    doc.setDocument(note.join("\n"));
    const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
    try {
      const view = evaluator.evaluate({ startLine: 3, endLine: 5 });
      expect(view.lines.slice(2).map(readEvalLine)).toEqual(settled.slice(2));
      const scroll = new ThreeTierEvaluator(doc, newTrackedEngine());
      expect(scroll.setViewport({ startLine: 4, endLine: 5 }).lines.filter((l) => l.lineNumber >= 4).map(readEvalLine)).toEqual(settled.slice(3));
      scroll.dispose();
    } finally {
      evaluator.dispose();
    }
  });

  test("the single-expression path refuses the positional forms with a document error", () => {
    expectNeedsDocument("prev + 1");
    expectNeedsDocument("line 1 * 3");
  });
});

describe("a lone carriage return across entry points", () => {
  // The batch pass's scan ends a line at a lone "\r" as it does at "\n" and
  // "\r\n"; the document model split on "\n" alone, so `5\r6` was two lines to
  // parseDocument and one to evaluateDocument and a live editor. The model now
  // splits where the scan does, the way #613 made the trailing newline agree.
  test.each([
    ["5\r"],
    ["5\r6"],
    ["1\r2\rtotal above"],
    ["1\r\n2\rtotal above\r\n"],
    ["\r\r\r"],
    ["10 #a\r20 #a\rtotal of #a"],
  ])("%j has the same lines through both passes", (text) => {
    const batchLines = readLines(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
    const incrementalLines = readLines(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));
    expect(incrementalLines).toEqual(batchLines);
    const doc = new DocumentModel();
    doc.setDocument(text);
    expect(doc.lineCount).toBe(batchLines.length);
  });

  test("the offsets each line reports are the batch pass's", () => {
    const text = "1\r22\r\n333\n4444\r";
    const shape = (result: ParsingResult) => result.lines.map((line) => [line.text, line.startPosition, line.endPosition]);
    expect(shape(evaluateDocument(newTrackedEngine(), text))).toEqual(shape(newTrackedEngine().parseDocument(text)));
  });

  test("the single-expression path reads a trailing carriage return as the end of the line", () => {
    const { threw, message } = single("5\r");
    expect(threw).toBe(false);
    expect(message).toBe("5");
  });
});

describe("converting into a document's own unit across entry points (#762)", () => {
  // A defined unit reads a definition from another line, so it is a
  // document form: `84 days in sprints` needs `1 sprint = 2 weeks` above it.
  const doc = ["1 sprint = 2 weeks", "84 days in sprints", "3 weeks in sprints to 1 dp", "1 click = 1 km", "3 clicks", "5 km in clicks", "6 sprints in kg"];
  const expected = ["sprint defined", "6 sprints", "1.5 sprints", "click defined", "3.00 clicks", "5.00 clicks", "ERROR: a duration cannot be converted to a mass"];

  test("the document result, and the two passes agree", () => {
    expect(batch(doc)).toEqual(expected);
    expect(incremental(doc)).toEqual(expected);
  });

  test("an edit to the definition re-answers the target in a live editor, as a fresh pass does", () => {
    const { shown, edited } = editThenEvaluate(doc, [[1, "1 sprint = 3 weeks"]]);
    expect(shown[1]).toBe("4 sprints");
    expect(shown).toEqual(batch(edited));
  });

  test("deleting the definition refuses the target, as a fresh pass does", () => {
    const { shown, edited } = deleteThenEvaluate(doc.slice(0, 2), 1);
    expect(shown[0]).toMatch(/^ERROR: /);
    expect(shown).toEqual(batch(edited));
  });

  test("the single-expression path has no definition to read and refuses the word by name", () => {
    const { threw, type, message } = single("84 days in sprints");
    expect(threw).toBe(false);
    expect(type).toBe(ValueType.Error);
    expect(message).toContain('"sprints" is not a unit');
  });
});

describe("a lone sum or total, and a label without its colon, across entry points (#742)", () => {
  // `Rent $1200` is the label `Rent` and the amount, as `Rent: $1200` is, and a
  // line that is only `sum` or `total` totals the block above it unless the
  // note defines a variable of that name.
  const doc = ["Rent $1200", "Food $300", "sum", "Extra $5", "total", "", "total = 7", "total"];

  test("the block is totalled, a subtotal passed over, and a variable read, in both passes", () => {
    const expected = ["$1,200.00", "$300.00", "$1,500.00", "$5.00", "$1,505.00", "", "7", "7"];
    expect(batch(doc)).toEqual(expected);
    expect(incremental(doc)).toEqual(expected);
  });

  test("an edit inside the block, and one that defines the variable, reach it in a live editor", () => {
    const inBlock = editThenEvaluate(["Rent $1200", "Food $300", "sum"], [[2, "Food $400"]]);
    expect(inBlock.shown).toEqual(batch(inBlock.edited));
    expect(inBlock.shown[2]).toBe("$1,600.00");
    const defines = editThenEvaluate(["x = 3", "Rent $5", "total"], [[1, "total = 9"]]);
    expect(defines.shown).toEqual(batch(defines.edited));
    expect(defines.shown[2]).toBe("9");
  });

  test("the single-expression path has no block, and says so", () => {
    expectNeedsDocument("sum");
    expectNeedsDocument("total");
  });

  test("a label reads the same on every path", () => {
    expect(single("Rent $1200")).toEqual({ threw: false, type: ValueType.Uom, message: "$1,200.00" });
    expect(batch(["Rent $1200"])).toEqual(incremental(["Rent $1200"]));
  });
});

describe("names of several words across entry points (#743)", () => {
  // A run of words before a definition's `=` is one name, and a later line
  // reads the same words as it. The table of names is the document's, filled
  // top to bottom, so both passes read a name only below its definition.
  const doc = ["hourly rate * 2", "hourly rate = $50", "hours = 8", "hourly rate * hours", "rate = 3", "hourly rate * rate"];

  test("each line reads the name below its definition, and both passes agree", () => {
    const answers = batch(doc);
    expect(answers[0]).toMatch(/^ERROR: /);
    expect(answers.slice(1)).toEqual(["$50.00", "8", "$400.00", "3", "$150.00"]);
    expect(incremental(doc)).toEqual(answers);
  });

  // The line above the definition is in the live-editor comparisons too: a
  // live editor used to read a name defined further down with the value the
  // last pass left, from its second pass on, and now reads the note from the
  // top on every pass (see the forward-reads block below).
  const below = ["hourly rate = $50", "hours = 8", "hourly rate * hours", "rate = 3", "hourly rate * rate"];

  test("the line above the definition is two words in a live editor, on every pass", () => {
    expect(afterPasses(doc, 3)).toEqual(batch(doc));
    const edited = editThenEvaluate(doc, [[2, "hourly rate = $60"]]);
    expect(edited.shown).toEqual(batch(edited.edited));
    expect(edited.shown[0]).toMatch(/^ERROR: /);
  });

  test("editing the definition re-keys every reader in a live editor, as a fresh pass reads it", () => {
    const renamed = editThenEvaluate(below, [[1, "hourly wage = $50"]]);
    expect(renamed.shown).toEqual(batch(renamed.edited));
    expect(renamed.shown[2]).toMatch(/^ERROR: /);
    const valued = editThenEvaluate(below, [[1, "hourly rate = $60"]]);
    expect(valued.shown).toEqual(batch(valued.edited));
    expect(valued.shown[2]).toBe("$480.00");
  });

  test("deleting the definition takes the name away in a live editor, as a fresh pass reads it", () => {
    const { shown, edited } = deleteThenEvaluate(below, 1);
    expect(shown).toEqual(batch(edited));
    expect(shown[1]).toMatch(/^ERROR: /);
  });

  test("the single-expression path: a definition needs no document, and a read of words nothing defined is the parse error it was", () => {
    // The definition line is self-contained, so it answers on its own. A read
    // has nothing that says its words are one name: it is the parse error it
    // always was, and never a number.
    expect(single("hourly rate = $50")).toEqual({ threw: false, type: ValueType.Uom, message: "$50.00" });
    const read = single("hourly rate * 2");
    expect(read.threw).toBe(true);
    expect(read.message).toBe('Expected an operator or the end of the line, but found "rate"');
  });
});

describe("the document's names in the language service, across entry points", () => {
  // Completions and the lone-word highlight read the names the whole document
  // defines, so they are a whole-document read. The language service's default
  // source knew none after the batch pass, since it read the dependency graph,
  // which only the incremental pass fills for a plain assignment.
  const doc = ["rent = 1200", "rate = 5", "hourly rate = $50", "f(x) = x * 2", "rent * missing", "re"];

  /** The completion labels and categories for `prefix`, and whether a lone `word` line is highlighted, over `engine`. */
  function readNames(engine: ExpressionEngine, prefix: string, word: string): { offered: string[]; highlighted: boolean } {
    const ls = new LanguageService(engine);
    return {
      offered: ls.getCompletions(prefix, prefix.length).map((c) => `${c.label}:${c.category}`),
      highlighted: ls.getSemanticTokens(word, 1).length > 0,
    };
  }

  /** The same reading with only the document's own variables kept. */
  function variablesOf(read: { offered: string[]; highlighted: boolean }): { offered: string[]; highlighted: boolean } {
    return { offered: read.offered.filter((item) => item.endsWith(":variable")), highlighted: read.highlighted };
  }

  test.each([["re", "rent"], ["r", "rate"], ["h", "hourly"], ["f", "f"], ["mis", "missing"]])("%j: both document passes give the same completions and the same lone-word answer", (prefix, word) => {
    const batchEngine = newTrackedEngine();
    batchEngine.parseDocument(doc.join("\n"));
    const incrementalEngine = newTrackedEngine();
    evaluateDocument(incrementalEngine, doc.join("\n"));
    expect(readNames(incrementalEngine, prefix, word)).toEqual(readNames(batchEngine, prefix, word));
  });

  test("the batch pass offers each defined name, and neither a name only read nor the half-typed word", () => {
    const engine = newTrackedEngine();
    engine.parseDocument(doc.join("\n"));
    expect([...engine.documentVariableNames()]).toEqual(["rent", "rate", "hourly rate", "f"]);
    expect(variablesOf(readNames(engine, "re", "rent"))).toEqual({ offered: ["rent:variable"], highlighted: true });
    expect(readNames(engine, "mis", "missing").highlighted).toBe(false);
  });

  test("a rename in a live editor offers the new name and drops the old, as a fresh pass of the edited text does", () => {
    const live = new DocumentModel();
    live.setDocument(doc.join("\n"));
    const engine = newTrackedEngine();
    const evaluator = new ThreeTierEvaluator(live, engine);
    try {
      evaluator.evaluate({ startLine: 1, endLine: live.lineCount });
      live.editLine(1, "rental = 1200");
      evaluator.evaluate({ startLine: 1, endLine: live.lineCount });
      const fresh = newTrackedEngine();
      fresh.parseDocument(["rental = 1200", ...doc.slice(1)].join("\n"));
      expect(readNames(engine, "ren", "rent")).toEqual(readNames(fresh, "ren", "rent"));
      expect(variablesOf(readNames(engine, "ren", "rent"))).toEqual({ offered: ["rental:variable"], highlighted: false });
    } finally {
      evaluator.terminateWorker();
    }
  });

  test("the single-expression path: a name set outside a document is not offered, and nothing throws", () => {
    // Not an Error value: completions are a list, so the honest answer for a
    // path with no document is an empty one, and the name still evaluates.
    const engine = newTrackedEngine();
    engine.evaluateExpression("rent = 1200");
    expect(variablesOf(readNames(engine, "re", "rent"))).toEqual({ offered: [], highlighted: false });
    expect(engine.evaluateNumber("rent")).toBe(1200);
  });

  test("the worker's completions after its parseDocument offer the document's names, as after its evaluateDocument", async () => {
    const { client, host } = createLinkedTransports();
    const stopRuntime = startWorkerRuntime(host);
    const worker = await createWorkerEngine({ transport: client });
    try {
      await worker.parseDocument(doc.join("\n"));
      const afterBatch = (await worker.getCompletions("re", 2)).filter((c) => c.category === "variable").map((c) => c.label);
      await worker.evaluateDocument(doc.join("\n"));
      const afterIncremental = (await worker.getCompletions("re", 2)).filter((c) => c.category === "variable").map((c) => c.label);
      expect(afterBatch).toEqual(["rent"]);
      expect(afterIncremental).toEqual(afterBatch);
    } finally {
      worker.terminate();
      stopRuntime();
    }
  });
});

describe("a possessive name of several words across entry points", () => {
  // The straight apostrophe after a letter is part of its word, as the curly
  // one always was, and a name's value reads either as the straight one. The
  // name is the document's, as every name of several words is (#743).
  const doc = ["Alice's food = £30", "Bob’s food = £20", "Alice’s food + Bob's food", "the Smiths' rent = £900", "the Smiths' rent / 3"];

  test("each line reads the name, and both passes agree", () => {
    expect(batch(doc)).toEqual(["£30.00", "£20.00", "£50.00", "£900.00", "£300.00"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("an edit to the definition re-keys the reader in a live editor, as a fresh pass reads it", () => {
    const { shown, edited } = editThenEvaluate(doc, [[1, "Alice’s food = £35"]]);
    expect(shown).toEqual(batch(edited));
    expect(shown[2]).toBe("£55.00");
  });

  test("the single-expression path: the definition answers, a read is the parse error it was, and a look-alike mark is refused by name", () => {
    expect(single("Alice's food = £30")).toEqual({ threw: false, type: ValueType.Uom, message: "£30.00" });
    const read = single("Alice's food * 2");
    expect(read.threw).toBe(true);
    expect(read.message).toBe('Expected an operator or the end of the line, but found "food"');
    const look = single("Alice‘s food = 3");
    expect(look.message).toMatch(/is a quotation mark, not an apostrophe/);
    expect(batch(["Alice‘s food = 3"])[0]).toBe(`ERROR: ${look.message}`);
  });
});

describe("an equation line with several unknowns across entry points", () => {
  // Refused by name on every path, since an equation line is solved for its
  // one unknown; with the others given values above it, it is stored and
  // solved as a one-unknown equation is (see FoundBug_equationWithSeveralUnknowns).
  const equation = "(salary / 12) * rate / 100 = net";

  test("the single-expression path and both passes give the same refusal", () => {
    const line = single(equation);
    expect(line.message).toMatch(/^This equation has 3 unknowns, salary, rate and net,/);
    expect(batch([equation])).toEqual([`ERROR: ${line.message}`]);
    expect(incremental([equation])).toEqual(batch([equation]));
  });

  test("with values above it, both passes solve it and agree", () => {
    const doc = ["salary = 60000", "net = 1000", equation, "rate =>"];
    expect(batch(doc)).toEqual(["60,000", "1,000", 'rate stored as an equation: solve with "rate =>"', "20"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("an edit that gives an unknown its value turns the refusal into a stored equation in a live editor", () => {
    const { shown, edited } = editThenEvaluate(["salary = 60000", "x = 1", equation, "rate =>"], [[2, "net = 1000"]]);
    expect(shown).toEqual(batch(edited));
    expect(shown[3]).toBe("20");
  });
});

describe("an unknown under the arrow across entry points", () => {
  // A unit or a percentage on an unknown is refused with the error the line
  // gives without the arrow, on every path (FoundBug_unknownUnderTheArrow).
  test("the single-expression path and both passes refuse it alike, and answer once the name has a value", () => {
    expect(single("foo percent =>").message).toBe("Undefined variable: foo");
    expect(batch(["foo percent =>", "foo km =>"])).toEqual(["ERROR: Undefined variable: foo", "ERROR: Undefined variable: foo"]);
    expect(incremental(["foo percent =>", "foo km =>"])).toEqual(batch(["foo percent =>", "foo km =>"]));
    const { shown, edited } = editThenEvaluate(["x = 1", "foo percent =>"], [[1, "foo = 12"]]);
    expect(shown).toEqual(batch(edited));
    expect(shown[1]).toBe("12.00%");
  });
});

describe("a product equation and the line above under the arrow, across entry points", () => {
  // `a*x = b` with `a` unknown points at `solve`, which answers `b/a`
  // (FoundBug_productEquationUndefinedFactor); `ans` under the arrow is the
  // line above, as it is without the arrow (FoundBug_constantUnderTheArrow).
  const solveHint = 'Cannot solve for "x": "a" is not yet defined. Give "a" a value on a line above, or solve for "x" in terms of it with solve(a*x = b, x).';

  test("both passes give the refusal, and the solve it names answers", () => {
    const doc = ["a*x = b", "x =>", "solve(a*x = b, x)"];
    expect(batch(doc)).toEqual(['x stored as an equation: solve with "x =>"', `ERROR: ${solveHint}`, "b/a"]);
    expect(incremental(doc)).toEqual(batch(doc));
  });

  test("an edit that gives the factor a value solves it in a live editor, as a fresh pass does", () => {
    const { shown, edited } = editThenEvaluate(["b = 1", "a*x = 10", "x =>"], [[1, "a = 4"]]);
    expect(shown).toEqual(batch(edited));
    expect(shown[2]).toBe("2.5");
  });

  test("the single-expression path: the equation has no document to keep it, and the solve answers", () => {
    expect(single("solve(a*x = b, x)").message).toBe("b/a");
    expect(single("x =>").message).toBe("x");
  });

  test("ans under the arrow reads the line above on both passes, and needs a document on its own", () => {
    const doc = ["2 + 3", "ans km =>", "3", "ans * x =>"];
    expect(batch(doc)).toEqual(["5", "5.00 km", "3", "3x"]);
    expect(incremental(doc)).toEqual(batch(doc));
    expectNeedsDocument("ans km =>");
  });
});

// The worker is a further entry point (#770): `evaluateDocument` through the
// worker client must agree with the main thread's `evaluateDocument` value for
// value on every whole-document form, and its `parseDocument` with the main
// thread's batch pass, goal seek's refusal included.
describe("the worker as a further path (#770)", () => {
  const forms: Record<string, string[]> = {
    "line references": ["10", "20", "line 1 + line 2", "prev * 2", "total above"],
    "category tags": ["40 #grocery", "20 #grocery", "total of #grocery", "average of #grocery"],
    "table columns": ["| item | cost |", "| ---- | ---- |", "| rent | 1200 |", "| food | 300 |", "", 'sum of column "cost" in table above'],
    "goal seek": [":deposit = 100000", ":rate = 4%", "monthly repayment on deposit over 25 years at rate", "solve line 3 for deposit = 900"],
  };

  /** A worker client and runtime linked on one thread, torn down by the returned function. */
  async function linkedWorker(): Promise<{ worker: WorkerEngine; stop: () => void }> {
    const { client, host } = createLinkedTransports();
    const stopRuntime = startWorkerRuntime(host);
    const worker = await createWorkerEngine({ transport: client });
    return { worker, stop: () => { worker.terminate(); stopRuntime(); } };
  }

  for (const [form, lines] of Object.entries(forms)) {
    test(`${form}: the worker's evaluateDocument agrees with the main thread's`, async () => {
      const { worker, stop } = await linkedWorker();
      try {
        const text = lines.join("\n");
        const engine = newTrackedEngine();
        const main = serializeParsingResult(evaluateDocument(engine, text), engine.getFormattingSettings());
        expect(await worker.evaluateDocument(text)).toEqual(main);
        // And its batch pass agrees with the main thread's batch pass.
        const batchEngine = newTrackedEngine();
        expect(await worker.parseDocument(text)).toEqual(serializeParsingResult(batchEngine.parseDocument(text), batchEngine.getFormattingSettings()));
      } finally {
        stop();
      }
    });
  }

  test("goal seek resolves through the worker's evaluateDocument and refuses through its parseDocument and a lone line", async () => {
    const { worker, stop } = await linkedWorker();
    try {
      const text = forms["goal seek"].join("\n");
      expect((await worker.evaluateDocument(text)).lines[3].result?.text).toBe("= 170,507.23");
      expect((await worker.parseDocument(text)).lines[3].result?.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
      const lone = await worker.evaluateExpression("solve line 3 for deposit = 900");
      expect(lone.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
    } finally {
      stop();
    }
  });
});
