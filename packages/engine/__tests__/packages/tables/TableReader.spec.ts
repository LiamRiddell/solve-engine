/**
 * The pure markdown-table reading behind the tables package.
 *
 * These helpers take plain strings and never touch the engine, so they are
 * tested directly here, separately from the document plumbing that feeds them
 * (that path is covered in `ColumnAggregate.spec.ts`). The awkward cases live
 * here: escaped pipes, ragged rows, delimiter detection, and the exact edge of
 * what counts as a plain number.
 */
import { describe, expect, test } from "@jest/globals";
import {
  isTableRow,
  isSeparatorRow,
  splitTableRow,
  parseNumericCell,
  findTableAbove,
  columnIndex,
  numericColumn,
} from "@solve-js/packages/tables/TableReader";

describe("row and separator detection", () => {
  test("a leading pipe (after any indent) marks a table row", () => {
    expect(isTableRow("| a | b |")).toBe(true);
    expect(isTableRow("   | a | b |")).toBe(true);
    expect(isTableRow("a | b")).toBe(false);
    expect(isTableRow("total above")).toBe(false);
  });

  test("a delimiter row is only pipes, dashes, colons and spaces, with a dash", () => {
    expect(isSeparatorRow("|---|---|")).toBe(true);
    expect(isSeparatorRow("| :--- | ---: |")).toBe(true);
    expect(isSeparatorRow("|:-:|")).toBe(true);
    // A data row of empty cells has no dash, so it is not the delimiter.
    expect(isSeparatorRow("|   |   |")).toBe(false);
    // A row with words is not a delimiter.
    expect(isSeparatorRow("| a | b |")).toBe(false);
  });
});

describe("splitting a row into cells", () => {
  test("outer pipes are optional and cells are trimmed", () => {
    expect(splitTableRow("| rent | 1200 |")).toEqual(["rent", "1200"]);
    expect(splitTableRow("rent | 1200")).toEqual(["rent", "1200"]);
  });

  test("an escaped pipe stays inside its cell", () => {
    expect(splitTableRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });

  test("empty cells are preserved as empty strings", () => {
    expect(splitTableRow("| a |  | c |")).toEqual(["a", "", "c"]);
  });
});

describe("parsing a cell as a number", () => {
  test("plain integers and decimals parse", () => {
    expect(parseNumericCell("1200")).toBe(1200);
    expect(parseNumericCell(" 3.5 ")).toBe(3.5);
    expect(parseNumericCell("-40")).toBe(-40);
    expect(parseNumericCell(".5")).toBe(0.5);
  });

  test("thousands separators are removed", () => {
    expect(parseNumericCell("4,812")).toBe(4812);
    expect(parseNumericCell("1,200.50")).toBe(1200.5);
  });

  test("currency, units, text, and blanks are not plain numbers", () => {
    expect(parseNumericCell("$50")).toBeNull();
    expect(parseNumericCell("50 usd")).toBeNull();
    expect(parseNumericCell("n/a")).toBeNull();
    expect(parseNumericCell("")).toBeNull();
    expect(parseNumericCell("   ")).toBeNull();
    expect(parseNumericCell(undefined)).toBeNull();
  });
});

describe("finding and reading a table above a line", () => {
  const lines = [
    "# Budget", // 1
    "", // 2
    "| item | cost |", // 3
    "| --- | --- |", // 4
    "| rent | 1200 |", // 5
    "| food | 300 |", // 6
    "", // 7
    'sum of column "cost" above', // 8
  ];
  const getLineText = (n: number): string | undefined => lines[n - 1];

  test("the nearest table above is parsed into header and data rows", () => {
    const table = findTableAbove(getLineText, 8)!;
    expect(table.header).toEqual(["item", "cost"]);
    expect(table.rows).toEqual([
      ["rent", "1200"],
      ["food", "300"],
    ]);
  });

  test("the named column resolves to its numeric cells", () => {
    const table = findTableAbove(getLineText, 8)!;
    const idx = columnIndex(table.header, "cost");
    expect(idx).toBe(1);
    expect(numericColumn(table, idx)).toEqual([1200, 300]);
  });

  test("a column name that is not a header returns -1", () => {
    const table = findTableAbove(getLineText, 8)!;
    expect(columnIndex(table.header, "price")).toBe(-1);
  });

  test("no table above returns null", () => {
    expect(findTableAbove((): undefined => undefined, 3)).toBeNull();
    expect(findTableAbove((n) => ["just prose", "more prose"][n - 1], 3)).toBeNull();
  });

  test("a pipe block with no delimiter is not read as a table", () => {
    const noDelimiter = ["| a | b |", "| c | d |"];
    expect(findTableAbove((n) => noDelimiter[n - 1], 3)).toBeNull();
  });
});
