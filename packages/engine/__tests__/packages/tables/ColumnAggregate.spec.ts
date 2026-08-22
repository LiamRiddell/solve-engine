/**
 * Reading a markdown table's column as data: `sum of column "cost" in table
 * above`, `average of column "cost" above`, and the min/max/count/median
 * siblings.
 *
 * A markdown table is the one block the evaluator classifies and then skips, so
 * a note can hold a table of numbers and, until now, none of them could be
 * totalled from where they sat. These are cross-line reads, so every real test
 * goes through the actual ExpressionEngine + DocumentModel + ThreeTierEvaluator
 * trio (the same harness the lines package uses), not the isolated
 * parselet-registry harness, which has no document for `getLineText` to read.
 */
import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a whole document and hand back the model, exactly as a host would. */
function evalDoc(lines: string[]): DocumentModel {
  const engine = newTrackedEngine();
  const doc = new DocumentModel();
  doc.setDocument(lines.join("\n"));
  const evaluator = new ThreeTierEvaluator(doc, engine);
  evaluator.evaluate({ startLine: 1, endLine: lines.length });
  return doc;
}

/** The evaluated result of a given 1-based line. */
function resultAt(doc: DocumentModel, line: number) {
  return doc.getLineAt(line)!.result!;
}

const TABLE = [
  "| item | cost |",
  "| --- | --- |",
  "| rent | 1200 |",
  "| food | 300 |",
  "| travel | 12 |",
];

describe("sum / average of a clean numeric column", () => {
  test('sum of column "cost" in table above totals the column', () => {
    const doc = evalDoc([...TABLE, 'sum of column "cost" in table above']);
    expect(resultAt(doc, 6).toNumber()).toBe(1512);
  });

  test('average of column "cost" above is the mean of the column', () => {
    const doc = evalDoc([...TABLE, 'average of column "cost" above']);
    expect(resultAt(doc, 6).toNumber()).toBe(504);
  });

  test("a bare query with no address word still finds the nearest table", () => {
    const doc = evalDoc([...TABLE, 'sum of column "cost"']);
    expect(resultAt(doc, 6).toNumber()).toBe(1512);
  });

  test("the column name matches case-insensitively", () => {
    const doc = evalDoc([...TABLE, 'sum of column "Cost" above']);
    expect(resultAt(doc, 6).toNumber()).toBe(1512);
  });

  test("total is a synonym for sum, mean for average", () => {
    const summed = evalDoc([...TABLE, 'total of column "cost" above']);
    const meaned = evalDoc([...TABLE, 'mean of column "cost" above']);
    expect(resultAt(summed, 6).toNumber()).toBe(1512);
    expect(resultAt(meaned, 6).toNumber()).toBe(504);
  });

  test("the result participates in further arithmetic", () => {
    const doc = evalDoc([...TABLE, 'sum of column "cost" above + 100']);
    expect(resultAt(doc, 6).toNumber()).toBe(1612);
  });

  test("min, max, count and median read the same column", () => {
    const min = evalDoc([...TABLE, 'min of column "cost" above']);
    const max = evalDoc([...TABLE, 'max of column "cost" above']);
    const count = evalDoc([...TABLE, 'count of column "cost" above']);
    const median = evalDoc([...TABLE, 'median of column "cost" above']);
    expect(resultAt(min, 6).toNumber()).toBe(12);
    expect(resultAt(max, 6).toNumber()).toBe(1200);
    expect(resultAt(count, 6).toNumber()).toBe(3);
    expect(resultAt(median, 6).toNumber()).toBe(300);
  });

  test("the second column is addressable by name too", () => {
    const doc = evalDoc([
      "| qty | price |",
      "| --- | --- |",
      "| 2 | 50 |",
      "| 5 | 20 |",
      'sum of column "price" above',
    ]);
    expect(resultAt(doc, 5).toNumber()).toBe(70);
  });
});

describe("non-numeric cells", () => {
  test("a text cell is skipped, the numeric cells still total", () => {
    const doc = evalDoc([
      "| item | cost |",
      "| --- | --- |",
      "| rent | 1200 |",
      "| note | n/a |",
      "| food | 300 |",
      'sum of column "cost" above',
    ]);
    // 1200 + 300; the "n/a" row contributes nothing rather than erroring.
    expect(resultAt(doc, 6).toNumber()).toBe(1500);
  });

  test("a currency cell is not read yet, so it is skipped", () => {
    const doc = evalDoc([
      "| item | cost |",
      "| --- | --- |",
      "| rent | 1200 |",
      "| fee | $50 |",
      'sum of column "cost" above',
    ]);
    // Currency is deferred: only the plain 1200 counts.
    expect(resultAt(doc, 5).toNumber()).toBe(1200);
  });

  test("count reflects only the numeric cells", () => {
    const doc = evalDoc([
      "| item | cost |",
      "| --- | --- |",
      "| rent | 1200 |",
      "| note | n/a |",
      'count of column "cost" above',
    ]);
    expect(resultAt(doc, 5).toNumber()).toBe(1);
  });

  test("a thousands-separated cell is read as one number", () => {
    const doc = evalDoc([
      "| item | cost |",
      "| --- | --- |",
      "| big | 4,812 |",
      'sum of column "cost" above',
    ]);
    expect(resultAt(doc, 4).toNumber()).toBe(4812);
  });

  test("a column with no numbers at all is a clear error, not zero", () => {
    const doc = evalDoc([
      "| item | note |",
      "| --- | --- |",
      "| rent | due |",
      'sum of column "note" above',
    ]);
    const r = resultAt(doc, 4);
    expect(r.type).toBe(ValueType.Error);
    expect(r.value).toBe("TABLE_COLUMN_NO_NUMERIC_CELLS");
  });
});

describe("addressing and errors", () => {
  test("a missing column name is a clear error naming the real columns", () => {
    const doc = evalDoc([...TABLE, 'sum of column "price" above']);
    const r = resultAt(doc, 6);
    expect(r.type).toBe(ValueType.Error);
    expect(r.value).toBe("TABLE_COLUMN_NOT_FOUND");
  });

  test("no table above the query is a clear error", () => {
    const doc = evalDoc(["just some prose", 'sum of column "cost" above']);
    const r = resultAt(doc, 2);
    expect(r.type).toBe(ValueType.Error);
    expect(r.value).toBe("TABLE_NOT_FOUND");
  });

  test("the nearest table is found even across intervening prose", () => {
    const doc = evalDoc([...TABLE, "", "some notes about the table", 'sum of column "cost" above']);
    expect(resultAt(doc, 8).toNumber()).toBe(1512);
  });

  test("reading a table column outside a document errors cleanly, not a silent zero", () => {
    const engine = newTrackedEngine();
    const [value] = engine.evaluateExpression('sum of column "cost" above');
    expect(value.type).toBe(ValueType.Error);
  });
});

describe("what must keep working", () => {
  test("an ordinary table row with no query is still classified as before", () => {
    // The lexer has always let a data row fall through to `expression`
    // (skip:false); this feature reads tables from source text and does not
    // change that classification, so existing behaviour is untouched.
    const engine = newTrackedEngine();
    const [line] = engine.parseDocument("| a | b |", { inputType: "markdown" }).lines;
    expect(line.isEmpty).toBe(false);
  });

  test("plain `average of` (the math phrase) is not captured by tables", () => {
    // `average of 36, 42, 19 and 81` must still average four numbers, since
    // `average of column` is a strictly longer phrase and only wins when the
    // word "column" actually follows.
    const doc = evalDoc(["average of 36, 42, 19 and 81"]);
    expect(resultAt(doc, 1).toNumber()).toBe(44.5);
  });

  test("existing line references still aggregate", () => {
    const doc = evalDoc(["10", "20", "total above"]);
    expect(resultAt(doc, 3).toNumber()).toBe(30);
  });

  test("a bitwise-or expression between numbers is untouched", () => {
    const engine = newTrackedEngine();
    const [value] = engine.evaluateExpression("6 | 1");
    expect(value.toNumber()).toBe(7);
  });
});
