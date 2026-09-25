import { Value, ValueType, numberValue, numberValueExact, uomValue, uomValueExact, errorValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { exactDecimalTotal } from "@solve-js/vm/ExactDecimals";
import { unifyQuantities } from "@solve-js/vm/VMConversion";
import { withSources } from "@solve-js/vm/Provenance";
import { findTableAbove, columnIndex, type MarkdownTable } from "./TableReader";
import { readCell } from "./TableCells";

/**
 * Runtime handlers for `sum of column "name" above` and its siblings.
 *
 * Every handler resolves entirely at execution time: the parselet pushes only
 * the column name, and the handler reads "which line am I on" and the raw text
 * of the lines above from the {@link LineExecutionContext} that `CALL_PLUGIN`
 * threads through (the same mechanism the lines package uses for `total
 * above`). It walks up to the nearest markdown table, reads the named column,
 * and reduces its numeric cells.
 *
 * The error discipline mirrors the lines package: a missing document, a table
 * that cannot be found, a column name that is not present, and a column with no
 * numeric cells each surface a clear, coded error Value rather than a silent
 * zero, which is the failure class this codebase treats as its worst.
 */

/** Scoped error codes this package owns, co-located per `errors/ErrorCode.ts`. */
export const TablesErrorCodes = {
  /** Cross-line table reads need a real document, absent on the single-expression path. */
  TABLE_NO_DOCUMENT: "TABLE_NO_DOCUMENT",
  /** No markdown table was found above the query line. */
  TABLE_NOT_FOUND: "TABLE_NOT_FOUND",
  /** The named column is not one of the table's headers. */
  TABLE_COLUMN_NOT_FOUND: "TABLE_COLUMN_NOT_FOUND",
  /** The column held no number or money cells to aggregate. */
  TABLE_COLUMN_NO_NUMERIC_CELLS: "TABLE_COLUMN_NO_NUMERIC_CELLS",
  /** A column summary met a percentage cell, which it does not add to or compare with the figures (#651). */
  TABLE_COLUMN_PERCENT_CELL: "TABLE_COLUMN_PERCENT_CELL",
  /** A lookup named a column the header carries more than once. */
  TABLE_COLUMN_AMBIGUOUS: "TABLE_COLUMN_AMBIGUOUS",
  /** No row's first cell carries the label an exact lookup asked for. */
  TABLE_ROW_NOT_FOUND: "TABLE_ROW_NOT_FOUND",
  /** More than one row carries the label, so an exact lookup cannot choose. */
  TABLE_ROW_AMBIGUOUS: "TABLE_ROW_AMBIGUOUS",
  /** An exact lookup's key was neither quoted text nor a plain number. */
  TABLE_LOOKUP_KEY_INVALID: "TABLE_LOOKUP_KEY_INVALID",
  /** The looked-up cell is empty. */
  TABLE_CELL_EMPTY: "TABLE_CELL_EMPTY",
  /** The looked-up cell is text, not a number, an amount of money or a percentage. */
  TABLE_CELL_NOT_A_VALUE: "TABLE_CELL_NOT_A_VALUE",
  /** The table cannot be read as bands: a start that is not a number, starts out of order, a rate that cannot be read. */
  TABLE_BANDS_MALFORMED: "TABLE_BANDS_MALFORMED",
  /** A progressive total's first band does not start at 0, so part of the amount falls in no band. */
  TABLE_BANDS_NOT_FROM_ZERO: "TABLE_BANDS_NOT_FROM_ZERO",
  /** A band lookup's amount is below where the first band starts. */
  TABLE_BAND_BELOW_FIRST: "TABLE_BAND_BELOW_FIRST",
  /** The amount placed in the bands is not a plain number or money, or is below zero for a progressive total. */
  TABLE_BAND_AMOUNT_INVALID: "TABLE_BAND_AMOUNT_INVALID",
  /** The amount, the band starts and the rates name currencies that do not go together. */
  TABLE_BAND_UNIT_MISMATCH: "TABLE_BAND_UNIT_MISMATCH",
} as const;

/** The reductions a column aggregate can apply to its numeric cells. */
export type ColumnAggregateOp =
  | "sum" | "average" | "min" | "max" | "count" | "median"
  | "stdev" | "sampleStdev" | "variance" | "sampleVariance" | "spread" | "mode";

/**
 * The smallest and largest cell in one pass, folded rather than spread.
 *
 * `Math.min(...cells)` makes the column into an argument list, so a long enough
 * column overflows the JavaScript stack: past about 126,000 rows on a default
 * stack, and past 80,000 on a smaller one, which is well inside the engine's own
 * document-line cap. `sum` on the same table always answered, because it folds.
 *
 * The seeds are the identities `Math.min` and `Math.max` return for no
 * arguments, so an empty column reads exactly as it did, and folding keeps the
 * NaN propagation and the `-0` preference the spread form had.
 */
function extremes(cells: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const n of cells) {
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  return { min, max };
}

/** Variance of a column's cells, population (divide by n) or sample (n-1). */
function columnVariance(cells: number[], sample: boolean): number {
  const n = cells.length;
  if (n === 0) return 0;
  const denom = sample ? n - 1 : n;
  if (denom <= 0) return 0;
  const mean = cells.reduce((acc, x) => acc + x, 0) / n;
  return cells.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / denom;
}

function reduce(op: ColumnAggregateOp, cells: number[]): number {
  switch (op) {
    case "sum":
      return cells.reduce((acc, n) => acc + n, 0);
    case "average":
      return cells.reduce((acc, n) => acc + n, 0) / cells.length;
    case "min":
      return extremes(cells).min;
    case "max":
      return extremes(cells).max;
    case "count":
      return cells.length;
    case "median": {
      const sorted = [...cells].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }
    case "stdev":
      return Math.sqrt(columnVariance(cells, false));
    case "sampleStdev":
      return Math.sqrt(columnVariance(cells, true));
    case "variance":
      return columnVariance(cells, false);
    case "sampleVariance":
      return columnVariance(cells, true);
    case "spread": {
      const { min, max } = extremes(cells);
      return max - min;
    }
    case "mode": {
      const counts = new Map<number, number>();
      let best = cells[0];
      let bestCount = 0;
      for (const n of cells) {
        const c = (counts.get(n) ?? 0) + 1;
        counts.set(n, c);
        if (c > bestCount) { bestCount = c; best = n; }
      }
      return best;
    }
  }
}

/**
 * Read the named column of the nearest table above and aggregate it.
 *
 * `count` is defined over the numeric cells found, so a column with no numbers
 * counts as zero rather than erroring. Every other reduction has no meaningful
 * value over an empty set, so it returns a coded error instead of a misleading
 * number.
 */
function aggregateColumn(
  op: ColumnAggregateOp,
  columnName: string,
  context: LineExecutionContext | undefined,
): Value {
  const getLineText = context?.getLineText;
  if (!getLineText || context!.lineIndex < 1) {
    return errorValue(
      TablesErrorCodes.TABLE_NO_DOCUMENT,
      'Reading a table column needs a real document, which the single-expression path (evaluateExpression) does not have',
    );
  }

  const table = findTableAbove(getLineText, context!.lineIndex);
  if (!table) {
    return errorValue(
      TablesErrorCodes.TABLE_NOT_FOUND,
      'No markdown table found above this line (a table row starts with "|", and needs a "|---|" separator under its header)',
    );
  }

  const index = columnIndex(table.header, columnName);
  if (index === -1) {
    const names = table.header.map((h) => `"${h}"`).join(", ");
    return errorValue(
      TablesErrorCodes.TABLE_COLUMN_NOT_FOUND,
      `The table above has no column named "${columnName}". Its columns are: ${names}`,
    );
  }

  const column = columnValues(table, index);
  const { values } = column;
  // A percentage is a cell like any other to count, and not a figure to add.
  if (op === "count") return numberValue(values.length + column.percentages);
  if (column.percentCell !== null) {
    return errorValue(
      TablesErrorCodes.TABLE_COLUMN_PERCENT_CELL,
      `The "${columnName}" cell on line ${column.percentCell.line} is a percentage, ${column.percentCell.text}: a column summary adds and compares figures, and a percentage is a proportion, not one of them`,
    );
  }
  if (values.length === 0) {
    return errorValue(
      TablesErrorCodes.TABLE_COLUMN_NO_NUMERIC_CELLS,
      `Column "${columnName}" has no number or money cells to aggregate (a cell with a unit is not read yet)`,
    );
  }
  if (column.money) return moneyAggregate(op, values, columnName);

  // A column of decimals totals exactly, the way a column of lines does, so
  // `sum of column "cost" above == 0.3` agrees with the 0.30 it shows. The
  // other reductions read the doubles. See vm/ExactDecimals.ts.
  if (op === "sum" || op === "average") {
    const exact = exactDecimalTotal(values, op === "average");
    if (exact !== null) return exact;
  }
  return numberValue(reduce(op, values.map((v) => v.toNumber())));
}

/**
 * A column's cells read as values, through the same reader a lookup uses
 * (see TableCells.readCell), or the refusal of a cell a summary cannot use.
 *
 * A number keeps the decimal it was written as, and money its currency, the
 * way the same figure typed on a line does (#651). The summaries used to read
 * plain numbers only, so a money cell was dropped without a word (`500`,
 * `$200`, `1,200` totalled 1,700), and grouping in the wrong place was read
 * as grouping (`12,57` as 1,257); the reader treats that as text. Text and
 * empty cells are skipped, as they always were. A percentage is counted, and
 * the first one is kept so a summary that adds can refuse it by name: it is a
 * proportion, not a figure to add to the others.
 */
function columnValues(table: MarkdownTable, colIndex: number): {
  values: Value[];
  money: boolean;
  percentages: number;
  percentCell: { line: number; text: string } | null;
} {
  const values: Value[] = [];
  let money = false;
  let percentages = 0;
  let percentCell: { line: number; text: string } | null = null;
  for (let i = 0; i < table.rows.length; i++) {
    const cell = table.rows[i][colIndex];
    const reading = readCell(cell);
    if (reading.kind === "number") {
      values.push(reading.exact.scale === 0 ? numberValue(reading.value) : numberValueExact(reading.value, reading.exact));
    } else if (reading.kind === "money") {
      money = true;
      values.push(uomValueExact(reading.value, reading.currency, reading.exact));
    } else if (reading.kind === "percent") {
      percentages++;
      percentCell ??= { line: table.rowLines[i], text: (cell ?? "").trim() };
    }
  }
  return { values, money, percentages, percentCell };
}

/**
 * Summarise a column holding money, in the currency written first, the way
 * `total above` combines the same figures typed as lines: a plain number
 * joins the column as an amount in that currency, and two currencies with no
 * rate between them are refused by name.
 */
function moneyAggregate(op: ColumnAggregateOp, values: Value[], columnName: string): Value {
  const verb = op === "sum" ? "added" : op === "average" ? "averaged" : "compared";
  const unified = unifyQuantities(values, verb);
  if (unified instanceof Value) return unified;
  const unit = unified.unit!;
  if (op === "variance" || op === "sampleVariance") {
    return errorValue(
      "UNIT_POWER_UNSUPPORTED",
      `The variance of column "${columnName}" would be in ${unit} squared, which is not an amount of money; its standard deviation is in ${unit}`,
    );
  }
  return withSources(uomValue(reduce(op, unified.magnitudes), unit), unified.sources);
}

function columnName(args: Value[]): string {
  const value = args[0];
  if (value && value.type === ValueType.String && typeof value.value === "string") {
    return value.value;
  }
  // The parselet always pushes a string, so this is defensive only.
  return String(value?.value ?? "");
}

/** `sum of column "name" [in table] above` / `total of column ...`. */
/**
 * Total of a named column's numeric cells in the nearest table above.
 *
 * @param args - One String: the column name.
 * @param context - Per-line execution context, source of the current line
 * number and the raw text of the lines above. Missing outside a document, in
 * which case a coded TABLE_NO_DOCUMENT error is returned.
 * @returns The column total, or a coded error Value.
 */
export function tableColumnSumHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("sum", columnName(args), context);
}

/** `average of column "name" [in table] above` / `mean of column ...`. */
/**
 * Mean of a named column's numeric cells in the nearest table above.
 *
 * @param args - One String: the column name.
 * @param context - Per-line execution context (see {@link tableColumnSumHandler}).
 * @returns The column mean, or a coded error Value.
 */
export function tableColumnAverageHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("average", columnName(args), context);
}

/** `min of column "name" [in table] above`. */
/**
 * Smallest numeric cell of a named column in the nearest table above.
 *
 * @param args - One String: the column name.
 * @param context - Per-line execution context (see {@link tableColumnSumHandler}).
 * @returns The column minimum, or a coded error Value.
 */
export function tableColumnMinHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("min", columnName(args), context);
}

/** `max of column "name" [in table] above`. */
/**
 * Largest numeric cell of a named column in the nearest table above.
 *
 * @param args - One String: the column name.
 * @param context - Per-line execution context (see {@link tableColumnSumHandler}).
 * @returns The column maximum, or a coded error Value.
 */
export function tableColumnMaxHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("max", columnName(args), context);
}

/** `count of column "name" [in table] above`. */
/**
 * How many numeric cells a named column holds in the nearest table above.
 *
 * @param args - One String: the column name.
 * @param context - Per-line execution context (see {@link tableColumnSumHandler}).
 * @returns The count (zero when the column has no numbers), or a coded error Value.
 */
export function tableColumnCountHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("count", columnName(args), context);
}

/** `median of column "name" [in table] above`. */
/**
 * Middle numeric cell of a named column in the nearest table above.
 *
 * @param args - One String: the column name.
 * @param context - Per-line execution context (see {@link tableColumnSumHandler}).
 * @returns The column median, or a coded error Value.
 */
export function tableColumnMedianHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("median", columnName(args), context);
}

/** `standard deviation of column "name" above` (population form). */
export function tableColumnStdevHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("stdev", columnName(args), context);
}

/** `sample standard deviation of column "name" above`. */
export function tableColumnSampleStdevHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("sampleStdev", columnName(args), context);
}

/** `variance of column "name" above` (population form). */
export function tableColumnVarianceHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("variance", columnName(args), context);
}

/** `sample variance of column "name" above`. */
export function tableColumnSampleVarianceHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("sampleVariance", columnName(args), context);
}

/** `spread of column "name" above`, largest minus smallest. */
export function tableColumnSpreadHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("spread", columnName(args), context);
}

/** `mode of column "name" above`, the most frequent cell. */
export function tableColumnModeHandler(args: Value[], context?: LineExecutionContext): Value {
  return aggregateColumn("mode", columnName(args), context);
}
