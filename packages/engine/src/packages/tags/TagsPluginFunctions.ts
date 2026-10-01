import { Value, ValueType, numberValue, uomValue, errorValue, stringValue } from "@solve-js/vm/Value";
import { unifyQuantities } from "@solve-js/vm/VMConversion";
import { sourcesOfValues, withSources } from "@solve-js/vm/Provenance";
import { exactDecimalTotal } from "@solve-js/vm/ExactDecimals";
import { numberOfBase } from "@solve-js/vm/ExactIntegers";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { formatValue } from "@solve-js/format/FormatEngine";
import { lineCarriesTag, memberTagsOf, tagEdgesOf } from "./TagScanner";
import { spendSpanReads } from "@solve-js/vm/PassWork";

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
    return errorValue("TAG_NO_DOCUMENT", "Category tag sums need a document, and a line evaluated on its own has none");
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

  // Charged as a scan of the whole note, which is what the batch pass does and
  // what the incremental index saves, so both passes charge alike (#711).
  const refused = spendSpanReads(context, context.getLineCount?.() ?? 0, "A tag total");
  if (refused) return refused;

  // Ascending, so the first unreadable member this reports is the first one in
  // the document, which is what the walk named and what a reader looks for.
  // Asking declares the read of every carrier, before any is read, as one edge
  // on the tag (#733): the walk below stops at the first member it cannot use,
  // and a cycle through a later one still has to be known.
  const indexed = context.getTaggedLines?.(needle);

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

    // A member of the tag asked for is covered by the edge the index took.
    const v = getResult(n, indexed !== undefined);
    const err = checkLineValue(v, n);
    if (err) return err;
    if (mode !== "count") {
      // `count of #tag` is "how many lines carry the tag", so a non-numeric
      // tagged line still counts; only sum and average need a number to add.
      // A number written in a base is added as the number it is.
      const figure = numberOfBase(v!);
      if (figure.type !== ValueType.Number && figure.type !== ValueType.Uom) {
        return errorValue("TAG_NON_NUMERIC", `Line ${n}, tagged #${tag}, is not a plain number or unit value.`);
      }
      values.push(figure);
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
  // Tagged decimals total exactly, as a column does, and carry their sources
  // as a column's total does. See vm/ExactDecimals.ts.
  const exact = exactDecimalTotal(values, isAverage);
  if (exact !== null) return withSources(exact, sourcesOfValues(values));
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

/** One category in the breakdown: the tag as first written, and its lines. */
interface TagGroup {
  readonly label: string;
  readonly lines: number[];
}

/**
 * A breakdown already worked out, kept so every `total by tag` line that asks
 * the same question of the same values is served the same answer.
 *
 * The question is the document's groups (the object the tag index hands out,
 * which stays the same while the text does) and the one line left out of
 * them, the asking line when it carries a tag itself. The values are checked
 * member by member, by identity: a line's answer is a new Value whenever the
 * line runs again, so an unchanged Value is an unchanged answer, and a member
 * below the asker that has not run yet reads as `undefined` here as it does in
 * the walk. Whether each member is a boundary is checked the same way, since
 * the evaluator can decide that as it reaches the line.
 */
interface BreakdownMemo {
  /** The line left out because it asked and carries a tag, or 0 when none was. */
  readonly excluded: number;
  /** Every candidate member, ascending: the lines carrying any tag, less {@link excluded}. */
  readonly candidates: readonly number[];
  /** Whether each candidate was a boundary line when the answer was made. */
  readonly boundary: readonly boolean[];
  /** Each candidate's answer when the answer was made. */
  readonly values: readonly (Value | undefined)[];
  /** The breakdown, or the error that stopped it. */
  readonly answer: Value;
}

/**
 * The breakdowns kept for each set of groups, a few per set.
 *
 * Weakly keyed, so a set of groups the document has moved past goes with
 * everything kept against it. A handful per set, because the asking lines that
 * carry a tag each leave a different line out, and a note rarely has more
 * than one or two of those.
 */
const breakdownMemos = new WeakMap<ReadonlyMap<string, readonly number[]>, BreakdownMemo[]>();

/** How many breakdowns are kept for one set of groups. */
const MEMOS_PER_GROUPS = 4;

/**
 * The document's tag groups read off every line's text, for a host that
 * supplies line text but no tag index. The same reading the index makes
 * ({@link memberTagsOf}), so the two agree.
 */
function walkTagGroups(getText: (n: number) => string | undefined): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let n = 1; ; n++) {
    const text = getText(n);
    if (text === undefined) break; // past the end of the document
    if (text.indexOf("#") === -1) continue; // the overwhelmingly common line
    for (const tag of memberTagsOf(text)) {
      const lines = groups.get(tag);
      if (lines === undefined) groups.set(tag, [n]);
      else if (lines[lines.length - 1] !== n) lines.push(n);
    }
  }
  return groups;
}

/**
 * `total by tag`: every category tag in the document, each with its total and
 * its share of the whole, as one line of text.
 *
 * The groups come from the tag index the document paths keep
 * ({@link LineExecutionContext.getTagGroups}), in the order each tag first
 * appears, with the same reading of a line `total of #tag` uses: the querying
 * line, headings and blank lines are passed over, and a tag being asked about
 * is not a member. Every tagged line is read once.
 *
 * The answer is worked out once for a given set of groups and member values
 * and served from {@link breakdownMemos} to every other line asking the same,
 * so five hundred breakdown lines cost about what one does (#734).
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

  // A scan of the whole note, charged to the pass (#711).
  const refused = spendSpanReads(context, context.getLineCount?.() ?? 0, "total by tag");
  if (refused) return refused;

  const indexed = context.getTagGroups?.();
  const groups: ReadonlyMap<string, readonly number[]> = indexed ?? walkTagGroups(getText);

  // Every line carrying some tag, ascending, less the asking line.
  const asking = context.lineIndex;
  const seen = new Set<number>();
  for (const lines of groups.values()) for (const n of lines) seen.add(n);
  const excluded = seen.delete(asking) ? asking : 0;
  const candidates = [...seen].sort((a, b) => a - b);

  const boundary = candidates.map((n) => isBoundary !== undefined && isBoundary(n));
  // Covered by the edge on every tag the index took, when there is one.
  const values = candidates.map((n, i) => (boundary[i] ? undefined : getResult(n, indexed !== undefined)));

  // A walk without an index has no edge to take on the tags, so it declares
  // the members, as it always has.
  if (indexed === undefined && context.noteLineRead) {
    for (let i = 0; i < candidates.length; i++) if (!boundary[i]) context.noteLineRead(candidates[i]);
  }

  const memos = indexed !== undefined ? breakdownMemos.get(indexed) : undefined;
  if (memos !== undefined) {
    for (const memo of memos) {
      // A copy, since a line's answer is its own to decorate.
      if (memo.excluded === excluded && sameMembers(memo, candidates, boundary, values)) return memo.answer.clone();
    }
  }

  const answer = computeBreakdown(groups, candidates, boundary, values, getText);
  if (indexed !== undefined) {
    const memo: BreakdownMemo = { excluded, candidates, boundary, values, answer };
    if (memos === undefined) breakdownMemos.set(indexed, [memo]);
    else {
      if (memos.length >= MEMOS_PER_GROUPS) memos.shift();
      memos.push(memo);
    }
    return answer.clone();
  }
  return answer;
}

/** Whether a kept breakdown was made from exactly these members, boundaries and values. */
function sameMembers(memo: BreakdownMemo, candidates: readonly number[], boundary: readonly boolean[], values: readonly (Value | undefined)[]): boolean {
  if (memo.candidates.length !== candidates.length) return false;
  for (let i = 0; i < candidates.length; i++) {
    if (memo.candidates[i] !== candidates[i] || memo.boundary[i] !== boundary[i] || memo.values[i] !== values[i]) return false;
  }
  return true;
}

/**
 * The breakdown itself, from the groups and the members' values: the whole,
 * each group's total and its share, or the error that stops it.
 */
function computeBreakdown(
  groups: ReadonlyMap<string, readonly number[]>,
  candidates: readonly number[],
  boundary: readonly boolean[],
  values: readonly (Value | undefined)[],
  getText: (n: number) => string | undefined,
): Value {
  const members: number[] = [];
  const valueAt = new Map<number, Value | undefined>();
  for (let i = 0; i < candidates.length; i++) {
    if (boundary[i]) continue; // a blank line or heading
    members.push(candidates[i]);
    valueAt.set(candidates[i], values[i]);
  }
  if (members.length === 0) {
    return errorValue("TAG_EMPTY", "No lines carry a tag, so there is nothing to break down.");
  }

  // Read in document order, so the first line that cannot be used is the one
  // named, as the walk named it.
  for (const n of members) {
    const err = checkLineValue(valueAt.get(n), n);
    if (err) return err;
    // A number written in a base is shared out as the number it is.
    const v = numberOfBase(valueAt.get(n)!);
    valueAt.set(n, v);
    if (v.type !== ValueType.Number && v.type !== ValueType.Uom) {
      const first = tagEdgesOf(getText(n) ?? "").members[0] ?? "";
      return errorValue("TAG_NON_NUMERIC", `Line ${n}, tagged #${first}, is not a plain number or unit value.`);
    }
  }

  // The groups in the order each tag first appears among the members, and a
  // tie (two tags new on one line) in the order the line writes them. Each is
  // labelled as its first member writes it.
  const isMember = new Set(members);
  const ordered: { key: string; first: number; lines: number[] }[] = [];
  for (const [key, lines] of groups) {
    const kept = lines.filter((n) => isMember.has(n));
    if (kept.length > 0) ordered.push({ key, first: kept[0], lines: kept });
  }
  const tagsOn = new Map<number, string[]>();
  const writtenOn = (n: number): string[] => {
    let tags = tagsOn.get(n);
    if (tags === undefined) {
      tags = tagEdgesOf(getText(n) ?? "").members;
      tagsOn.set(n, tags);
    }
    return tags;
  };
  const placeOnLine = (key: string, n: number): number => writtenOn(n).findIndex((tag) => tag.toLowerCase() === key);
  ordered.sort((a, b) => a.first - b.first || placeOnLine(a.key, a.first) - placeOnLine(b.key, b.first));
  const tagGroups: TagGroup[] = ordered.map((group) => ({
    label: writtenOn(group.first)[placeOnLine(group.key, group.first)] ?? group.key,
    lines: group.lines,
  }));

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
  for (const group of tagGroups) {
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
