import { Value, ValueType, numberValue, uomValue, errorValue } from "@solve-js/vm/Value";
import { unifyQuantities } from "@solve-js/vm/VMConversion";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { lineCarriesTag } from "./TagScanner";

/**
 * Category tag sums, `total of #tag` / `sum of #tag` / `average of #tag` /
 * `count of #tag`, which collect every line in the document carrying that tag.
 *
 * Like the lines package, every handler routes a fetched line through
 * {@link checkLineValue} before arithmetic: `Value.toNumber()` returns `0` for
 * both `Pending` and `Error`, so touching an unresolved or errored line without
 * this check would silently compute a wrong number rather than surface the
 * error, the failure class this codebase treats as its worst.
 */

type TagMode = "sum" | "average" | "count";

function checkLineValue(v: Value | undefined, lineNumber: number): Value | null {
  if (v === undefined) {
    return errorValue("LINE_NOT_YET_EVALUATED", `Line ${lineNumber} has not been evaluated yet`);
  }
  if (v.type === ValueType.Pending) {
    return errorValue("LINE_RESULT_PENDING", `Line ${lineNumber}'s result is still resolving`);
  }
  if (v.type === ValueType.Error) {
    return errorValue("LINE_RESULT_ERROR", `Line ${lineNumber} has an error`);
  }
  return null;
}

function requireContext(context: LineExecutionContext | undefined): Value | null {
  if (!context?.getLineResult || !context.getLineText) {
    return errorValue("TAG_NO_DOCUMENT", "Category tag sums require a real document, not available outside one (e.g. evaluateExpression()'s single-expression path)");
  }
  return null;
}

/**
 * Walks the whole document, keeping every line whose raw text carries `#tag`,
 * and reduces their results. Skips the querying line itself (its own text
 * carries the tag) and any boundary line (a blank line or heading), and holds
 * the same Pending/Error and single-unit guards the lines package uses.
 */
function aggregateTagged(context: LineExecutionContext, tag: string, mode: TagMode): Value {
  const getText = context.getLineText!;
  const getResult = context.getLineResult!;
  const isBoundary = context.isLineBoundary;
  const needle = tag.toLowerCase();

  const values: Value[] = [];
  let count = 0;

  for (let n = 1; ; n++) {
    const text = getText(n);
    if (text === undefined) break; // past the end of the document
    if (n === context.lineIndex) continue; // the query line reads its own tag
    if (isBoundary && isBoundary(n)) continue; // a blank line or heading
    if (!lineCarriesTag(text, needle)) continue;

    const v = getResult(n);
    const err = checkLineValue(v, n);
    if (err) return err;
    if (mode !== "count") {
      // `count of #tag` is "how many lines carry the tag", so a non-numeric
      // tagged line still counts; only sum and average need a number to add.
      if (v!.type !== ValueType.Number && v!.type !== ValueType.Uom) {
        return errorValue("TAG_NON_NUMERIC", `Line ${n}, tagged #${tag}, is not a plain number or unit value.`);
      }
      values.push(v!);
    }
    count++;
  }

  if (mode === "count") return numberValue(count);
  if (count === 0) return errorValue("TAG_EMPTY", `No lines are tagged #${tag}.`);
  // The same rule the `above` aggregates and the inline `total of X, Y, Z`
  // list follow: read the whole set in the first unit written, and refuse a
  // set that mixes measures by naming the two dimensions.
  const isAverage = mode === "average";
  const unified = unifyQuantities(values, isAverage ? "averaged" : "added");
  if (unified instanceof Value) return unified;
  const sum = unified.magnitudes.reduce((acc, n) => acc + n, 0);
  const result = isAverage ? sum / values.length : sum;
  if (unified.unit === undefined) return numberValue(result);
  const combined = uomValue(result, unified.unit);
  // A total of clock-time spans is still a span; see the same rule in
  // `LinesPluginFunctions.combineQuantities`.
  if (values.every((v) => v.datetimeSpan === true)) combined.datetimeSpan = true;
  return combined;
}

/** `total of #tag` / `sum of #tag`, the sum of every line carrying the tag. */
/** Sum of every tagged line's result. @param args A String holding the tag name. */
export function tagSumHandler(args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  return aggregateTagged(context!, String(args[0].value), "sum");
}

/** `average of #tag`, the mean of every line carrying the tag. */
/** Mean of every tagged line's result. @param args A String holding the tag name. */
export function tagAverageHandler(args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  return aggregateTagged(context!, String(args[0].value), "average");
}

/** `count of #tag`, how many lines carry the tag. */
/** Count of the lines carrying the tag. @param args A String holding the tag name. */
export function tagCountHandler(args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  return aggregateTagged(context!, String(args[0].value), "count");
}
