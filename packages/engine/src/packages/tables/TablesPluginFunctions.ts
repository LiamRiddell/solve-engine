import { Value, ValueType, numberValue, errorValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { findTableAbove, columnIndex, numericColumn } from "./TableReader";

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
  /** The column held no plain-number cells to aggregate. */
  TABLE_COLUMN_NO_NUMERIC_CELLS: "TABLE_COLUMN_NO_NUMERIC_CELLS",
} as const;

/** The reductions a column aggregate can apply to its numeric cells. */
export type ColumnAggregateOp = "sum" | "average" | "min" | "max" | "count" | "median";

function reduce(op: ColumnAggregateOp, cells: number[]): number {
  switch (op) {
    case "sum":
      return cells.reduce((acc, n) => acc + n, 0);
    case "average":
      return cells.reduce((acc, n) => acc + n, 0) / cells.length;
    case "min":
      return Math.min(...cells);
    case "max":
      return Math.max(...cells);
    case "count":
      return cells.length;
    case "median": {
      const sorted = [...cells].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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

  const cells = numericColumn(table, index);
  if (op === "count") return numberValue(cells.length);
  if (cells.length === 0) {
    return errorValue(
      TablesErrorCodes.TABLE_COLUMN_NO_NUMERIC_CELLS,
      `Column "${columnName}" has no plain-number cells to aggregate (currency and unit cells are not read yet)`,
    );
  }

  return numberValue(reduce(op, cells));
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
