import { Value, ValueType, numberValue, uomValue, errorValue, stringValue } from "@solve-js/vm/Value";
import { unifyQuantities } from "@solve-js/vm/VMConversion";
import { withSources } from "@solve-js/vm/Provenance";
import { exactDecimalTotal } from "@solve-js/vm/ExactDecimals";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { formatValue } from "@solve-js/format/FormatEngine";
import { lineCarriesTag, tagEdgesOf } from "./TagScanner";

/**
 * Category tag sums, `total of #tag` / `sum of #tag` / `average of #tag` /
 * `count of #tag`, which collect every line in the document carrying that tag,
 * and `total by tag`, which breaks the whole note down by every tag at once.
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
 * Reduces the results of every line carrying `#tag`. Skips the querying line
 * itself (its own text carries the tag) and any boundary line (a blank line or
 * heading), and holds the same Pending/Error and single-unit guards the lines
 * package uses.
 *
 * Reads its members from the index the document paths maintain
 * ({@link LineExecutionContext.getTaggedLines}), and falls back to walking the
 * document for a host that supplies line text without one. The walk is what
 * this was: it looks at every line for every aggregate, so a document of tagged
 * amounts and totals cost aggregates x lines a pass, and twenty thousand such
 * lines took four minutes. The two orders agree line for line, since the index
 * is built from {@link memberTagsOf}, the whole-line reading of the same rules
 * {@link lineCarriesTag} applies to one name.
 */
function aggregateTagged(context: LineExecutionContext, tag: string, mode: TagMode): Value {
  const getText = context.getLineText!;
  const getResult = context.getLineResult!;
  const isBoundary = context.isLineBoundary;
  const needle = tag.toLowerCase();

  const values: Value[] = [];
  let count = 0;

  // Ascending, so the first unreadable member this reports is the first one in
  // the document, which is what the walk named and what a reader looks for.
  const indexed = context.getTaggedLines?.(needle);
  // Every carrier is declared before any is read, for the reason the line
  // range gives: the walk stops at the first member it cannot use.
  if (indexed !== undefined && context.noteLineRead) {
    for (const n of indexed) if (n !== context.lineIndex) context.noteLineRead(n);
  }

  for (let i = 1; ; i++) {
    let n: number;
    if (indexed !== undefined) {
      if (i > indexed.length) break;
      n = indexed[i - 1];
    } else {
      n = i;
      const text = getText(n);
      if (text === undefined) break; // past the end of the document
      if (!lineCarriesTag(text, needle)) continue;
    }
    if (n === context.lineIndex) continue; // the query line reads its own tag
    if (isBoundary && isBoundary(n)) continue; // a blank line or heading

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
  return combineTagged(values, mode === "average");
}

/**
 * Add or average one group's values into its answer.
 *
 * The same rule the `above` aggregates and the inline `total of X, Y, Z` list
 * follow: read the whole set in the first unit written, and refuse a set that
 * mixes measures by naming the two dimensions. Shared by `total of #tag` and
 * the breakdown, so a tag's figure in `total by tag` is the one its own total
 * gives.
 */
function combineTagged(values: Value[], isAverage: boolean): Value {
  // Tagged decimals total exactly, as a column does. See vm/ExactDecimals.ts.
  const exact = exactDecimalTotal(values, isAverage);
  if (exact !== null) return exact;
  const unified = unifyQuantities(values, isAverage ? "averaged" : "added");
  if (unified instanceof Value) return unified;
  const sum = unified.magnitudes.reduce((acc, n) => acc + n, 0);
  const result = isAverage ? sum / values.length : sum;
  if (unified.unit === undefined) return withSources(numberValue(result), unified.sources);
  const combined = withSources(uomValue(result, unified.unit), unified.sources);
  // A total of clock-time spans is still a span; see the same rule in
  // `LinesPluginFunctions.combineQuantities`.
  if (values.every((v) => v.datetimeSpan === true)) combined.datetimeSpan = true;
  return combined;
}

/** One category in the breakdown: the tag as first written, and its lines. */
interface TagGroup {
  readonly label: string;
  readonly lines: number[];
}

/**
 * A share of the whole as a reader would say it: a whole percentage, with a
 * share too small to round to 1% shown as `<1%` rather than as a `0%` that reads
 * as nothing at all.
 */
function formatShare(share: number): string {
  const percent = share * 100;
  const rounded = Math.round(percent);
  if (rounded === 0 && percent > 0) return "<1%";
  return `${rounded}%`;
}

/**
 * A group's total as the notepad would show it on its own line: the engine's
 * default display, without the result marker.
 */
function formatAmount(total: Value): string {
  return formatValue(total).replace(/^=\s*/, "");
}

/**
 * `total by tag`: every category tag in the document, each with its total and
 * its share of the whole, as one line of text.
 *
 * One walk finds the groups, in the order each tag first appears, with the same
 * reading of a line `total of #tag` uses ({@link tagEdgesOf}): the querying
 * line, headings and blank lines are passed over, and a tag being asked about
 * is not a member. Every tagged line is declared to the dependency graph before
 * any is read, and each is read once.
 *
 * The whole is every tagged line counted once, read in the first unit written.
 * When each line carries one tag the shares add up to 100%. A line carrying two
 * tags counts toward both, so overlapping tags can add up to more, which is the
 * honest reading: each share is still that tag's part of the whole. Dividing by
 * the tag totals added together instead would force 100% by counting that line
 * twice in the whole.
 *
 * The answer is text, not a number, since it is several figures with labels.
 * `total of #tag` is the form to carry a group's figure into arithmetic.
 */
function breakdownByTag(context: LineExecutionContext): Value {
  const getText = context.getLineText!;
  const getResult = context.getLineResult!;
  const isBoundary = context.isLineBoundary;

  const groups = new Map<string, TagGroup>();
  const members: number[] = [];
  const firstTagOn = new Map<number, string>();
  for (let n = 1; ; n++) {
    const text = getText(n);
    if (text === undefined) break; // past the end of the document
    if (n === context.lineIndex) continue;
    if (text.indexOf("#") === -1) continue; // the overwhelmingly common line
    if (isBoundary && isBoundary(n)) continue; // a blank line or heading
    const tags = tagEdgesOf(text).members;
    if (tags.length === 0) continue;
    for (const tag of tags) {
      const key = tag.toLowerCase();
      let group = groups.get(key);
      if (group === undefined) {
        group = { label: tag, lines: [] };
        groups.set(key, group);
      }
      // `#food #Food` on one line is one membership, not two.
      if (group.lines[group.lines.length - 1] !== n) group.lines.push(n);
    }
    members.push(n);
    firstTagOn.set(n, tags[0]);
  }
  if (members.length === 0) {
    return errorValue("TAG_EMPTY", "No lines carry a tag, so there is nothing to break down.");
  }
  if (context.noteLineRead) for (const n of members) context.noteLineRead(n);

  const valueAt = new Map<number, Value>();
  for (const n of members) {
    const v = getResult(n);
    const err = checkLineValue(v, n);
    if (err) return err;
    if (v!.type !== ValueType.Number && v!.type !== ValueType.Uom) {
      return errorValue("TAG_NON_NUMERIC", `Line ${n}, tagged #${firstTagOn.get(n)}, is not a plain number or unit value.`);
    }
    valueAt.set(n, v!);
  }

  // The whole, which is also where a set mixing measures is refused: two tags
  // in different measures have no whole to be shares of.
  const whole = unifyQuantities(members.map((n) => valueAt.get(n)!), "added");
  if (whole instanceof Value) {
    const reason = whole.errorMessage ?? "The tagged lines cannot be added";
    const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`;
    return errorValue(
      whole.errorCode ?? "INCOMPATIBLE_UNITS",
      `${sentence} A breakdown needs every tagged line in one measure, so the tags share one whole.`,
    );
  }
  const magnitudeAt = new Map<number, number>();
  members.forEach((n, i) => magnitudeAt.set(n, whole.magnitudes[i]));
  const wholeSum = whole.magnitudes.reduce((acc, m) => acc + m, 0);
  if (wholeSum === 0) {
    return errorValue("TAG_BREAKDOWN_NO_WHOLE", "The tagged lines add up to zero, so no tag has a share of them.");
  }

  const parts: string[] = [];
  for (const group of groups.values()) {
    const total = combineTagged(group.lines.map((n) => valueAt.get(n)!), false);
    if (total.type === ValueType.Error) return total;
    const part = group.lines.reduce((acc, n) => acc + magnitudeAt.get(n)!, 0);
    parts.push(`${group.label} ${formatAmount(total)} (${formatShare(part / wholeSum)})`);
  }
  return stringValue(parts.join(" · "));
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

/**
 * `total by tag` / `sum by tag`: every tag in the document with its total and
 * its share of the whole, as text (`food $65.00 (68%) · transport $30.00 (32%)`).
 *
 * @param _args - Unused. `total by tag` takes no arguments.
 * @param context - Per-line execution context. Supplies the document's text and
 * cached results; without them the handler returns a TAG_NO_DOCUMENT error.
 * @returns A String Value holding the breakdown, or an error Value naming what
 * stopped it.
 */
export function tagBreakdownHandler(_args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  return breakdownByTag(context!);
}
