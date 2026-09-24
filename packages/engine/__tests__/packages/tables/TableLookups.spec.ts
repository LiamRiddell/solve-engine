/**
 * Table lookups and banded rates (issue #507).
 *
 * - `column "cost" for "food"` reads one cell by its row's label.
 * - `column "rate" for 45,000 in bands above` reads the cell of the band an
 *   amount falls in.
 * - `45,000 through bands above` charges each part of an amount at the rate of
 *   its band, and totals it.
 *
 * All three read the nearest markdown table above, so every document here goes
 * through both document passes and the two are held to the same answer, line
 * for line: `parseDocument` (batch) and `evaluateDocument` (incremental). The
 * single-expression refusal and the cross-path shape live in
 * `CrossPathDocumentFeatures.spec.ts`; the cell reader is tested directly at the
 * bottom, since it is pure.
 */
import { describe, expect, test } from "@jest/globals";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { readCell } from "@solve-js/packages/tables/TableCells";
import { newTrackedEngine } from "@tools/trackedEngine";

/** One line's outcome: its formatted value, or its error code and message. */
interface LineOutcome {
  text: string;
  code?: string;
}

function readLines(result: ParsingResult): LineOutcome[] {
  return result.lines.map((line) => {
    if (line.error) return { text: `ERROR: ${line.error}` };
    if (!line.result) return { text: "" };
    if (line.result.type === ValueType.Error) {
      return { text: `ERROR: ${formatValue(line.result)}`, code: String(line.result.value) };
    }
    return { text: formatValue(line.result).replace(/^=\s*/, "") };
  });
}

/**
 * Evaluate a document through both passes, assert they agree on every line
 * that is not a table row, and hand back the batch outcomes.
 *
 * A table row is not an expression. The two passes report a line that does not
 * parse differently (an error on the line against an error-typed result coded
 * `eval_failed`), which is their own business and not what these tests are
 * about, so the rows are left out and a parse failure is compared by its text.
 */
function run(lines: string[]): LineOutcome[] {
  const text = lines.join("\n");
  const batch = readLines(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
  const incremental = readLines(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));
  const comparable = (out: LineOutcome[]): LineOutcome[] =>
    out
      .filter((_, i) => !lines[i].trimStart().startsWith("|"))
      .map((o) => (o.code === "eval_failed" ? { text: o.text } : o));
  expect(comparable(incremental)).toEqual(comparable(batch));
  return batch;
}

/** The outcome of the last line of a document. */
function last(lines: string[]): LineOutcome {
  const out = run(lines);
  return out[out.length - 1];
}

/** The formatted value of the last line, failing the test if it errored. */
function valueOf(lines: string[]): string {
  const outcome = last(lines);
  expect(outcome.code).toBeUndefined();
  return outcome.text;
}

/** The error code of the last line, failing the test if it answered. */
function codeOf(lines: string[]): string | undefined {
  const outcome = last(lines);
  expect(outcome.text.startsWith("ERROR:")).toBe(true);
  return outcome.code;
}

const BUDGET = ["| item | cost |", "| ---- | ---- |", "| rent | 1200 |", "| food |  300 |", "| taxi |   12 |", ""];

const BANDS = ["| from   | rate |", "| ------ | ---- |", "| 0      | 0%   |", "| 10,000 | 20%  |", "| 40,000 | 40%  |", ""];

describe("an exact lookup reads one cell by its row's label", () => {
  test("the issue's example: the cost on the food row", () => {
    expect(valueOf([...BUDGET, 'column "cost" for "food"'])).toBe("300");
  });

  test("every address reads the same nearest table", () => {
    const out = run([
      ...BUDGET,
      'column "cost" for "food"',
      'column "cost" for "food" above',
      'column "cost" for "food" in table above',
      'column "cost" for "food" in the table above',
    ]);
    expect(out.slice(6).map((o) => o.text)).toEqual(["300", "300", "300", "300"]);
  });

  test("the label and the column name match regardless of case", () => {
    expect(valueOf([...BUDGET, 'column "COST" for "Food"'])).toBe("300");
  });

  test("arithmetic after the lookup applies to the looked-up value", () => {
    expect(valueOf([...BUDGET, 'column "cost" for "food" * 2'])).toBe("600");
    expect(valueOf([...BUDGET, 'column "cost" for "food" above + 100'])).toBe("400");
    expect(valueOf([...BUDGET, 'column "cost" for "rent" - column "cost" for "food"'])).toBe("900");
  });

  test("a conversion after the lookup is not taken for the address", () => {
    expect(valueOf([...BUDGET, 'column "cost" for "food" in hex'])).toBe("0x12C");
  });

  test("a number labels a row too, and a bare `above` after it is the address, not a multiplication", () => {
    const table = ["| size | price |", "| ---- | ----- |", "| 1    | 4     |", "| 3    | 9     |", ""];
    expect(valueOf([...table, 'column "price" for 3'])).toBe("9");
    expect(valueOf([...table, 'column "price" for 3 above'])).toBe("9");
    expect(valueOf([...table, 'column "price" for 3 * 2'])).toBe("18");
  });

  test("the key can be a variable, a line reference or a bracketed sum", () => {
    const table = ["| size | price |", "| ---- | ----- |", "| 1    | 4     |", "| 3    | 9     |", ""];
    expect(valueOf([':which = "3"', ...table, 'column "price" for which'])).toBe("9");
    expect(valueOf([...table, "3", 'column "price" for line 6'])).toBe("9");
    expect(valueOf([...table, 'column "price" for (1 + 2)'])).toBe("9");
  });

  test("money and percentage cells answer as money and percentages", () => {
    const table = [
      "| item | price     | discount |",
      "| ---- | --------- | -------- |",
      "| tea  | $4.20     | 10%      |",
      "| cake | £12.50    | 12.5%    |",
      "| wine | 1,200 EUR | 0        |",
      "",
    ];
    expect(valueOf([...table, 'column "price" for "tea"'])).toBe("$4.20");
    expect(valueOf([...table, 'column "price" for "cake"'])).toBe("£12.50");
    expect(valueOf([...table, 'column "price" for "wine"'])).toBe("€1,200.00");
    expect(valueOf([...table, 'column "discount" for "tea"'])).toBe("10.00%");
    expect(valueOf([...table, 'column "price" for "tea" - column "discount" for "tea"'])).toBe("$3.78");
  });

  test("a looked-up price stays exact in money arithmetic", () => {
    const table = ["| item | price |", "| ---- | ----- |", "| tea  | $0.10 |", ""];
    // $0.10 * 1.15 is $0.115, which a till rounds to $0.12; a double would round down.
    expect(valueOf([...table, 'column "price" for "tea" + 15%'])).toBe("$0.12");
    expect(valueOf([...table, 'column "price" for "tea" * 3'])).toBe("$0.30");
  });
});

describe("an exact lookup refuses by name rather than guessing", () => {
  test("a label that is not in the table names the rows it does have", () => {
    const outcome = last([...BUDGET, 'column "cost" for "fuel"']);
    expect(outcome.code).toBe("TABLE_ROW_NOT_FOUND");
    expect(outcome.text).toContain('"rent", "food", "taxi"');
  });

  test("a number that labels no row points at the band form", () => {
    const outcome = last([...BANDS, 'column "rate" for 45,000']);
    expect(outcome.code).toBe("TABLE_ROW_NOT_FOUND");
    expect(outcome.text).toContain("in bands above");
  });

  test("two rows with the same label are ambiguous, and both lines are named", () => {
    const outcome = last(["| item | cost |", "| --- | --- |", "| food | 300 |", "| rent | 1200 |", "| food | 40 |", 'column "cost" for "food"']);
    expect(outcome.code).toBe("TABLE_ROW_AMBIGUOUS");
    expect(outcome.text).toContain("lines 3 and 5");
  });

  test("a column the header does not carry names the ones it does", () => {
    const outcome = last([...BUDGET, 'column "price" for "food"']);
    expect(outcome.code).toBe("TABLE_COLUMN_NOT_FOUND");
    expect(outcome.text).toContain('"item", "cost"');
  });

  test("a column named twice is ambiguous", () => {
    expect(codeOf(["| item | cost | cost |", "| --- | --- | --- |", "| food | 3 | 4 |", 'column "cost" for "food"'])).toBe("TABLE_COLUMN_AMBIGUOUS");
  });

  test("an empty cell, a text cell and a short row are refused, never read as zero", () => {
    const table = ["| item | cost | note |", "| --- | --- | --- |", "| food |  | fresh |", "| rent | 12 |", ""];
    expect(codeOf([...table, 'column "cost" for "food"'])).toBe("TABLE_CELL_EMPTY");
    expect(codeOf([...table, 'column "note" for "food"'])).toBe("TABLE_CELL_NOT_A_VALUE");
    expect(codeOf([...table, 'column "note" for "rent"'])).toBe("TABLE_CELL_EMPTY");
    expect(codeOf([...table, 'column "note" for "food" * 2'])).toBe("TABLE_CELL_NOT_A_VALUE");
  });

  test("a key that is neither text nor a plain number is refused", () => {
    expect(codeOf([...BUDGET, 'column "cost" for $5'])).toBe("TABLE_LOOKUP_KEY_INVALID");
  });

  test("a key that is itself an error passes that error on", () => {
    const outcome = last([...BUDGET, 'column "cost" for line 99']);
    expect(outcome.text.startsWith("ERROR:")).toBe(true);
    expect(outcome.code).not.toBe("TABLE_ROW_NOT_FOUND");
  });

  test("no table above is a clear error", () => {
    expect(codeOf(["just prose", 'column "cost" for "food"'])).toBe("TABLE_NOT_FOUND");
  });

  test("a lookup without `for` is a parse error that says what to write", () => {
    const outcome = last([...BUDGET, 'column "cost"']);
    expect(outcome.text).toContain('column "cost" for "food"');
  });
});

describe("`column` stays an ordinary word", () => {
  test("a variable named column still defines and reads", () => {
    const out = run([":column = 5", "column * 2"]);
    expect(out.map((o) => o.text)).toEqual(["5", "10"]);
  });

  test("the column aggregates are unchanged, and still skip a money cell", () => {
    const table = ["| item | cost |", "| --- | --- |", "| rent | 1200 |", "| fee | $50 |", ""];
    expect(valueOf([...table, 'sum of column "cost" above'])).toBe("1,200");
    expect(valueOf([...table, 'average of column "cost" above'])).toBe("1,200");
  });
});

describe("a band lookup reads the cell of the band an amount falls in", () => {
  test("a band runs from its start up to the next band's start", () => {
    const out = run([
      ...BANDS,
      'column "rate" for 45,000 in bands above',
      'column "rate" for 10,000 in bands above',
      'column "rate" for 9,999.99 in bands above',
      'column "rate" for 0 in bands above',
      'column "rate" for 1,000,000 in bands above',
    ]);
    expect(out.slice(6).map((o) => o.text)).toEqual(["40.00%", "20.00%", "0.00%", "0.00%", "40.00%"]);
  });

  test("`in the bands`, `in bands` and `bands above` all read as bands", () => {
    const out = run([
      ...BANDS,
      'column "rate" for 45,000 in the bands above',
      'column "rate" for 45,000 in bands',
      'column "rate" for 45,000 bands above',
    ]);
    expect(out.slice(6).map((o) => o.text)).toEqual(["40.00%", "40.00%", "40.00%"]);
  });

  test("any column can be read, and money reads against plain starts", () => {
    const table = [
      "| from (kg) | price | service  |",
      "| --------- | ----- | -------- |",
      "| 0         | $5    | letter   |",
      "| 2         | $8.50 | parcel   |",
      "| 10        | $15   | freight  |",
      "",
    ];
    expect(valueOf([...table, 'column "price" for 3.5 in bands above'])).toBe("$8.50");
    expect(valueOf([...table, 'column "price" for 12 in bands above'])).toBe("$15.00");
    expect(codeOf([...table, 'column "service" for 12 in bands above'])).toBe("TABLE_CELL_NOT_A_VALUE");
  });

  test("the amount can be money, a variable or a sum in brackets", () => {
    expect(valueOf([...BANDS, 'column "rate" for $45,000 in bands above'])).toBe("40.00%");
    expect(valueOf([":salary = 25,000", ...BANDS, 'column "rate" for salary in bands above'])).toBe("20.00%");
    expect(valueOf([...BANDS, 'column "rate" for (5,000 + 6,000) in bands above'])).toBe("20.00%");
  });

  test("an amount below the first band is refused", () => {
    const table = ["| from | rate |", "| --- | --- |", "| 10 | 1% |", "| 20 | 2% |", ""];
    const outcome = last([...table, 'column "rate" for 5 in bands above']);
    expect(outcome.code).toBe("TABLE_BAND_BELOW_FIRST");
    expect(outcome.text).toContain("starts at 10");
  });

  test("an amount in another currency than the bands is refused", () => {
    const table = ["| from | rate |", "| --- | --- |", "| £0 | 0% |", "| £100 | 5% |", ""];
    expect(valueOf([...table, 'column "rate" for £150 in bands above'])).toBe("5.00%");
    expect(valueOf([...table, 'column "rate" for 150 in bands above'])).toBe("5.00%");
    expect(codeOf([...table, 'column "rate" for $150 in bands above'])).toBe("TABLE_BAND_UNIT_MISMATCH");
  });

  test("an amount with a unit the table does not state is refused", () => {
    expect(codeOf([...BANDS, 'column "rate" for 3 kg in bands above'])).toBe("TABLE_BAND_AMOUNT_INVALID");
  });
});

describe("a band table that does not say what a band is is refused", () => {
  const withRows = (rows: string[], query: string): string[] => ["| from | rate |", "| --- | --- |", ...rows, "", query];

  test("a first column headed as where bands end", () => {
    const doc = ["| up to | rate |", "| --- | --- |", "| 10,000 | 0% |", "| 40,000 | 20% |", "", "45,000 through bands above"];
    const outcome = last(doc);
    expect(outcome.code).toBe("TABLE_BANDS_MALFORMED");
    expect(outcome.text).toContain('"up to"');
  });

  test("starts that do not rise down the table", () => {
    const outcome = last(withRows(["| 0 | 0% |", "| 100 | 20% |", "| 50 | 30% |"], "1,000 through bands above"));
    expect(outcome.code).toBe("TABLE_BANDS_MALFORMED");
    expect(outcome.text).toContain("Line 5");
  });

  test("two bands that start at the same point", () => {
    expect(codeOf(withRows(["| 0 | 0% |", "| 100 | 20% |", "| 100 | 30% |"], "1,000 through bands above"))).toBe("TABLE_BANDS_MALFORMED");
  });

  test("a start that is not a number, or is missing", () => {
    expect(codeOf(withRows(["| 0 | 0% |", "| basic | 20% |"], "1,000 through bands above"))).toBe("TABLE_BANDS_MALFORMED");
    expect(codeOf(withRows(["| 0 | 0% |", "|  | 20% |"], 'column "rate" for 5 in bands above'))).toBe("TABLE_BANDS_MALFORMED");
  });

  test("starts in two currencies", () => {
    expect(codeOf(withRows(["| £0 | 0% |", "| $100 | 20% |"], "1,000 through bands above"))).toBe("TABLE_BANDS_MALFORMED");
  });

  test("a table with no rows", () => {
    expect(codeOf(["| from | rate |", "| --- | --- |", "", "1,000 through bands above"])).toBe("TABLE_BANDS_MALFORMED");
  });
});

describe("a progressive total charges each part of the amount at its band's rate", () => {
  test("the issue's example: 0 on the first 10,000, 20% of the next 30,000, 40% of the last 5,000", () => {
    expect(valueOf([...BANDS, "45,000 through bands above"])).toBe("8,000");
  });

  test("`through the bands` and a bare `through bands` read the same table", () => {
    const out = run([...BANDS, "45,000 through the bands", "45,000 through bands", "45,000 through the bands above"]);
    expect(out.slice(6).map((o) => o.text)).toEqual(["8,000", "8,000", "8,000"]);
  });

  test("an amount inside the first band, on a boundary, and at zero", () => {
    const out = run([...BANDS, "5,000 through bands above", "10,000 through bands above", "40,000 through bands above", "0 through bands above"]);
    expect(out.slice(6).map((o) => o.text)).toEqual(["0", "0", "6,000", "0"]);
  });

  test("the whole preceding sum is the amount, and the result takes part in arithmetic", () => {
    expect(valueOf([...BANDS, "40,000 + 5,000 through bands above"])).toBe("8,000");
    expect(valueOf([...BANDS, "45,000 through bands above / 12"])).toBe("666.67");
    expect(valueOf([":pay = £45,000", ...BANDS, "pay - (pay through bands above)"])).toBe("£37,000.00");
  });

  test("a money amount keeps its currency, and plain bands take it", () => {
    expect(valueOf([...BANDS, "$45,000 through bands above"])).toBe("$8,000.00");
    expect(valueOf([...BANDS, "£45,000 through bands above"])).toBe("£8,000.00");
  });

  test("bands written in pounds give a plain amount their currency", () => {
    const uk = [
      "| from     | rate |",
      "| -------- | ---- |",
      "| £0       | 0%   |",
      "| £12,570  | 20%  |",
      "| £50,270  | 40%  |",
      "| £125,140 | 45%  |",
      "",
    ];
    expect(valueOf([...uk, "£60,000 through bands above"])).toBe("£11,432.00");
    expect(valueOf([...uk, "60000 through bands above"])).toBe("£11,432.00");
    expect(codeOf([...uk, "$60,000 through bands above"])).toBe("TABLE_BAND_UNIT_MISMATCH");
  });

  test("money is exact to the penny where a double would round the wrong way", () => {
    // $10.10 at 15% is $1.515, which rounds to $1.52; as a double it is 1.51499...
    const flat = ["| from | rate |", "| --- | --- |", "| 0 | 15% |", ""];
    expect(valueOf([...flat, "$10.10 through bands above"])).toBe("$1.52");
    const banded = ["| from | rate |", "| --- | --- |", "| 0 | 0% |", "| $10 | 15% |", ""];
    expect(valueOf([...banded, "$20.10 through bands above"])).toBe("$1.52");
  });

  test("a price per unit is a tiered tariff, charged on a count", () => {
    const tariff = ["| kWh | price |", "| --- | ----- |", "| 0   | 0     |", "| 100 | $0.15 |", "| 500 | $0.25 |", ""];
    expect(valueOf([...tariff, "350 through bands above"])).toBe("$37.50");
    expect(valueOf([...tariff, "600 through bands above"])).toBe("$85.00");
    expect(codeOf([...tariff, "$600 through bands above"])).toBe("TABLE_BAND_UNIT_MISMATCH");
  });

  test("plain-number rates multiply, as a share written as a decimal", () => {
    const table = ["| from | rate |", "| --- | --- |", "| 0 | 0 |", "| 10,000 | 0.2 |", "| 40,000 | 0.4 |", ""];
    expect(valueOf([...table, "45,000 through bands above"])).toBe("8,000");
  });

  test("a label column between the start and the rate is ignored", () => {
    const table = [
      "| from   | band    | rate |",
      "| ------ | ------- | ---- |",
      "| 0      | nil     | 0%   |",
      "| 10,000 | basic   | 20%  |",
      "| 40,000 | higher  | 40%  |",
      "",
    ];
    expect(valueOf([...table, "45,000 through bands above"])).toBe("8,000");
  });

  test("an amount with no exact value is worked in floating point", () => {
    // sqrt(2) * 10,000 is 14,142.1356...: 20% of the 4,142.1356 above 10,000.
    expect(valueOf([...BANDS, "sqrt(2) * 10,000 through bands above"])).toBe("828.43");
  });
});

describe("a progressive total refuses rather than guessing", () => {
  const withRows = (rows: string[], query: string): string[] => ["| from | rate |", "| --- | --- |", ...rows, "", query];

  test("bands that do not start at 0 leave part of the amount in no band", () => {
    const outcome = last(withRows(["| 10 | 10% |", "| 100 | 20% |"], "1,000 through bands above"));
    expect(outcome.code).toBe("TABLE_BANDS_NOT_FROM_ZERO");
    expect(outcome.text).toContain("starts at 10");
  });

  test("a negative amount falls in no band", () => {
    expect(codeOf([...BANDS, "-5 through bands above"])).toBe("TABLE_BAND_AMOUNT_INVALID");
  });

  test("an amount that is not a number or money", () => {
    expect(codeOf([...BANDS, "3 kg through bands above"])).toBe("TABLE_BAND_AMOUNT_INVALID");
    expect(codeOf([...BANDS, "20% through bands above"])).toBe("TABLE_BAND_AMOUNT_INVALID");
  });

  test("a plain rate among percentages is refused, a plain 0 is fine", () => {
    const outcome = last(withRows(["| 0 | 0 |", "| 100 | 20 |", "| 200 | 30% |"], "1,000 through bands above"));
    expect(outcome.code).toBe("TABLE_BANDS_MALFORMED");
    expect(outcome.text).toContain("20%");
    expect(valueOf(withRows(["| 0 | 0 |", "| 100 | 20% |"], "1,000 through bands above"))).toBe("180");
  });

  test("rates that mix percentages and prices, or two currencies of price", () => {
    expect(codeOf(withRows(["| 0 | 0% |", "| 100 | $0.20 |"], "1,000 through bands above"))).toBe("TABLE_BANDS_MALFORMED");
    expect(codeOf(withRows(["| 0 | £0.10 |", "| 100 | $0.20 |"], "1,000 through bands above"))).toBe("TABLE_BANDS_MALFORMED");
  });

  test("a missing or unreadable rate names its line", () => {
    const missing = last(withRows(["| 0 | 0% |", "| 100 |  |"], "1,000 through bands above"));
    expect(missing.code).toBe("TABLE_BANDS_MALFORMED");
    expect(missing.text).toContain("Line 4");
    expect(codeOf(withRows(["| 0 | 0% |", "| 100 | high |"], "1,000 through bands above"))).toBe("TABLE_BANDS_MALFORMED");
  });

  test("a one-column table has no rate", () => {
    expect(codeOf(["| from |", "| --- |", "| 0 |", "", "1,000 through bands above"])).toBe("TABLE_BANDS_MALFORMED");
  });

  test("an amount that is itself an error passes that error on", () => {
    const outcome = last([...BANDS, "line 99 through bands above"]);
    expect(outcome.text.startsWith("ERROR:")).toBe(true);
    expect(outcome.code).not.toBe("TABLE_BAND_AMOUNT_INVALID");
  });
});

describe("an edited table re-answers", () => {
  test("changing a rate or a label moves the answer on the next pass", () => {
    const lines = [...BANDS, "45,000 through bands above", 'column "rate" for 45,000 in bands above'];
    const engine = newTrackedEngine();
    const doc = new DocumentModel();
    doc.setDocument(lines.join("\n"));
    const evaluator = new ThreeTierEvaluator(doc, engine);
    try {
      evaluator.evaluate({ startLine: 1, endLine: lines.length });
      expect(doc.getLineAt(7)!.result!.toNumber()).toBe(8000);

      doc.editLine(5, "| 40,000 | 50%  |");
      evaluator.evaluate({ startLine: 1, endLine: lines.length });
      expect(doc.getLineAt(7)!.result!.toNumber()).toBe(8500);
      expect(doc.getLineAt(8)!.result!.toNumber()).toBe(0.5);
    } finally {
      evaluator.terminateWorker();
    }
  });
});

describe("reading one cell", () => {
  test("plain numbers, with properly grouped thousands", () => {
    expect(readCell("1200")).toMatchObject({ kind: "number", value: 1200 });
    expect(readCell(" 12,570.50 ")).toMatchObject({ kind: "number", value: 12570.5 });
    expect(readCell("-40")).toMatchObject({ kind: "number", value: -40 });
    expect(readCell(".5")).toMatchObject({ kind: "number", value: 0.5 });
  });

  test("a misplaced comma is text, not a guess", () => {
    expect(readCell("12,57")).toEqual({ kind: "text", text: "12,57" });
    expect(readCell("1,2,3")).toEqual({ kind: "text", text: "1,2,3" });
  });

  test("money with a symbol before or a code after", () => {
    expect(readCell("$4.20")).toMatchObject({ kind: "money", value: 4.2, currency: "USD" });
    expect(readCell("£12,570")).toMatchObject({ kind: "money", value: 12570, currency: "GBP" });
    expect(readCell("-$5")).toMatchObject({ kind: "money", value: -5, currency: "USD" });
    expect(readCell("$-5")).toMatchObject({ kind: "money", value: -5, currency: "USD" });
    expect(readCell("1,200 EUR")).toMatchObject({ kind: "money", value: 1200, currency: "EUR" });
    expect(readCell("-$-5")).toEqual({ kind: "text", text: "-$-5" });
    expect(readCell("1,200 XYZ")).toEqual({ kind: "text", text: "1,200 XYZ" });
  });

  test("money is read exactly, digit for digit", () => {
    const reading = readCell("$0.10");
    expect(reading).toMatchObject({ kind: "money", exact: { coef: 10n, scale: 2 } });
  });

  test("a percentage is read as its exact proportion", () => {
    expect(readCell("20%")).toMatchObject({ kind: "percent", value: 0.2, exact: { coef: 20n, scale: 2 } });
    expect(readCell("12.5 %")).toMatchObject({ kind: "percent", value: 0.125, exact: { coef: 125n, scale: 3 } });
  });

  test("text, units and blanks", () => {
    expect(readCell("n/a")).toEqual({ kind: "text", text: "n/a" });
    expect(readCell("12 kg")).toEqual({ kind: "text", text: "12 kg" });
    expect(readCell("")).toEqual({ kind: "empty" });
    expect(readCell("   ")).toEqual({ kind: "empty" });
    expect(readCell(undefined)).toEqual({ kind: "empty" });
  });
});
