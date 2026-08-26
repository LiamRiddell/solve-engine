import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { ColumnAggregateParselet } from "./parselets/ColumnAggregateParselet";
import {
  tableColumnSumHandler,
  tableColumnAverageHandler,
  tableColumnMinHandler,
  tableColumnMaxHandler,
  tableColumnCountHandler,
  tableColumnMedianHandler,
  tableColumnStdevHandler,
  tableColumnSampleStdevHandler,
  tableColumnVarianceHandler,
  tableColumnSampleVarianceHandler,
  tableColumnSpreadHandler,
  tableColumnModeHandler,
} from "./TablesPluginFunctions";

/**
 * Read a markdown table's column as data: `sum of column "cost" in table
 * above`, `average of column "cost" above`.
 *
 * A markdown table is the one block the evaluator classifies and then skips,
 * so a note can hold a table of numbers and none of them can be totalled from
 * where they sit. This package addresses the nearest table above the query
 * line, names one of its columns, and reduces that column's numeric cells,
 * reusing the same cross-line plumbing the lines package built for `total
 * above` (a per-line `LineExecutionContext`, extended with `getLineText` so
 * the skipped table rows can be read back from source).
 *
 * Trigger-word collision policy (this codebase's phrase-fusion rule, see
 * `MathPhrasesPackage.ts`): the whole verb-and-noun is phrase-fused, never the
 * bare verb. `average of` is already fused to `AVERAGE_OF` by the math-phrases
 * package; registering the longer `average of column` in the same phrase trie
 * wins by longest-match, so plain `average of 1, 2, 3` is untouched while
 * `average of column "x"` routes here. `sum of` is claimed by no one, so
 * `sum of column` fuses cleanly. Synonyms (`total`->sum, `mean`->average)
 * share a token type and parselet, matching how the lines package treats
 * `sum`/`total` as one.
 *
 * Decisions worth stating (also in the docs and changeset):
 * - Addressing: nearest table above only. An explicit table label is deferred.
 * - Non-numeric cells: skipped, not an error, so a stray label or a blank cell
 *   does not break an otherwise-numeric column. A column with no numbers at all
 *   is a clear error (except `count`, which is then zero).
 * - Currency and units in cells: not read yet. A cell carrying a `$` or a unit
 *   is treated as non-numeric and skipped. Plain numbers first, on purpose.
 */
export const TABLES_PACKAGE: IEnginePackage = {
  name: "solve-tables",
  phrases: {
    "sum of column": "TABLE_COLUMN_SUM",
    "total of column": "TABLE_COLUMN_SUM",
    "average of column": "TABLE_COLUMN_AVERAGE",
    "mean of column": "TABLE_COLUMN_AVERAGE",
    "min of column": "TABLE_COLUMN_MIN",
    "minimum of column": "TABLE_COLUMN_MIN",
    "max of column": "TABLE_COLUMN_MAX",
    "maximum of column": "TABLE_COLUMN_MAX",
    "count of column": "TABLE_COLUMN_COUNT",
    "median of column": "TABLE_COLUMN_MEDIAN",
    // Spread and shape of a column (#184), the same aggregates the inline list
    // form grew. Longer phrases than the mathphrases list forms, so the trie
    // takes them only when "column" actually follows.
    "standard deviation of column": "TABLE_COLUMN_STDEV",
    "stdev of column": "TABLE_COLUMN_STDEV",
    "sample standard deviation of column": "TABLE_COLUMN_SAMPLE_STDEV",
    "variance of column": "TABLE_COLUMN_VARIANCE",
    "sample variance of column": "TABLE_COLUMN_SAMPLE_VARIANCE",
    "spread of column": "TABLE_COLUMN_SPREAD",
    "mode of column": "TABLE_COLUMN_MODE",
  },
  prefixParselets: {
    TABLE_COLUMN_SUM: new ColumnAggregateParselet("TABLE_COLUMN_SUM"),
    TABLE_COLUMN_AVERAGE: new ColumnAggregateParselet("TABLE_COLUMN_AVERAGE"),
    TABLE_COLUMN_MIN: new ColumnAggregateParselet("TABLE_COLUMN_MIN"),
    TABLE_COLUMN_MAX: new ColumnAggregateParselet("TABLE_COLUMN_MAX"),
    TABLE_COLUMN_COUNT: new ColumnAggregateParselet("TABLE_COLUMN_COUNT"),
    TABLE_COLUMN_MEDIAN: new ColumnAggregateParselet("TABLE_COLUMN_MEDIAN"),
    TABLE_COLUMN_STDEV: new ColumnAggregateParselet("TABLE_COLUMN_STDEV"),
    TABLE_COLUMN_SAMPLE_STDEV: new ColumnAggregateParselet("TABLE_COLUMN_SAMPLE_STDEV"),
    TABLE_COLUMN_VARIANCE: new ColumnAggregateParselet("TABLE_COLUMN_VARIANCE"),
    TABLE_COLUMN_SAMPLE_VARIANCE: new ColumnAggregateParselet("TABLE_COLUMN_SAMPLE_VARIANCE"),
    TABLE_COLUMN_SPREAD: new ColumnAggregateParselet("TABLE_COLUMN_SPREAD"),
    TABLE_COLUMN_MODE: new ColumnAggregateParselet("TABLE_COLUMN_MODE"),
  },
  pluginFunctions: {
    TABLE_COLUMN_SUM: tableColumnSumHandler,
    TABLE_COLUMN_AVERAGE: tableColumnAverageHandler,
    TABLE_COLUMN_MIN: tableColumnMinHandler,
    TABLE_COLUMN_MAX: tableColumnMaxHandler,
    TABLE_COLUMN_COUNT: tableColumnCountHandler,
    TABLE_COLUMN_MEDIAN: tableColumnMedianHandler,
    TABLE_COLUMN_STDEV: tableColumnStdevHandler,
    TABLE_COLUMN_SAMPLE_STDEV: tableColumnSampleStdevHandler,
    TABLE_COLUMN_VARIANCE: tableColumnVarianceHandler,
    TABLE_COLUMN_SAMPLE_VARIANCE: tableColumnSampleVarianceHandler,
    TABLE_COLUMN_SPREAD: tableColumnSpreadHandler,
    TABLE_COLUMN_MODE: tableColumnModeHandler,
  },
};
