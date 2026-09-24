import { Value, ValueType, numberValue, uomValue, errorValue, stringValue } from "@solve-js/vm/Value";
import { isCheckResult } from "@solve-js/packages/conditionals/CheckFunctions";
import { nonNumericKind, unifyQuantities } from "@solve-js/vm/VMConversion";
import { sourcesOfValues, withSources } from "@solve-js/vm/Provenance";
import { exactDecimalTotal } from "@solve-js/vm/ExactDecimals";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { headingOf, isSummaryLine, sectionKey } from "./SectionReader";
import { formatLineTrace, traceProblem } from "@solve-js/explain/LineTracer";

/**
 * Cross-line data access, `prev`, `line<N>`, `sum(line X : line Y)`
 * `total(line X : line Y)`, `average(line X : line Y)`, `total above`/
 * `sum above`/`average above`, and the section aggregates `total of section
 * "Travel"` / `sum of` / `average of` / `count of`.
 *
 * Every handler here follows the SAME short-circuit discipline, which is
 * the actual load-bearing correctness requirement of this whole package
 * (not the line-number arithmetic, which is trivial): `Value.toNumber()`
 * returns `0` for BOTH `Pending` and `Error` types (confirmed in
 * `vm/Value.ts`), so any handler that skipped this check would silently
 * compute a wrong number instead of surfacing a clear error the moment it
 * touched an unresolved-async or already-errored line, exactly the
 * failure class `ARCHITECTURE.md` §12 P0 item 1 (still open) describes,
 * and exactly the class of bug this codebase treats as its worst. See
 * `checkLineValue()` below, every handler routes through it.
 */

/**
 * The second argument `inputs of line N` passes to `lineRef`, asking for the
 * line's trace rather than its value.
 *
 * The form shares `lineRef`'s plugin slot instead of registering a function of
 * its own, since it reads the same target line through the same context. (A
 * seeded random draw keys a plugin call by the function's name, so a new
 * function would not have moved any draw either.)
 */
export const TRACE_INPUTS = 1;

function checkLineValue(v: Value | undefined, lineNumber: number): Value | null {
  if (v === undefined) {
    return errorValue("LINE_NOT_YET_EVALUATED", `Line ${lineNumber} has not been evaluated yet (forward reference, or out of range)`);
  }
  if (v.type === ValueType.Pending) {
    return errorValue("LINE_RESULT_PENDING", `Line ${lineNumber}'s result is still resolving`);
  }
  if (v.type === ValueType.Error) {
    return errorValue("LINE_RESULT_ERROR", `Line ${lineNumber} has an error`);
  }
  return null; // no problem — safe to use v
}

function requireContext(context: LineExecutionContext | undefined): Value | null {
  if (!context?.getLineResult) {
    return errorValue("LINE_REF_NO_DOCUMENT", "Cross-line references require a real document — not available outside one (e.g. evaluateExpression()'s single-expression path)");
  }
  return null;
}

/** `prev`, the immediately-preceding line's cached result. */
/**
 * The immediately preceding line's cached result.
 *
 * @param _args - Unused. `prev` takes no arguments.
 * @param context - Per-line execution context. Supplies the document's
 * cached results; without it the handler returns a LINES_NO_CONTEXT error
 * rather than guessing, since line references are meaningless outside a
 * document.
 * @returns The computed Value, or an error Value when the context is
 * missing or a referenced line has no numeric result.
 */
export function prevHandler(_args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  const targetLine = context!.lineIndex - 1;
  const v = context!.getLineResult!(targetLine);
  const err = checkLineValue(v, targetLine);
  return err ?? v!;
}

/**
 * The line number `line deleted` compiles to, wherever a line reference can
 * stand: on its own, as either end of a range, or as goal seek's target.
 *
 * It rides the existing `lineRef` call rather than a plugin function of its
 * own, so every place a line reference can stand accepts it unchanged. No line
 * can be written as `line -1` (the minus is an operator, not part of the
 * reference), so the number is free to mean "deleted".
 */
export const DELETED_LINE_NUMBER = -1;

/**
 * The answer for `line deleted`: the same named error in every context, a
 * document or not, since there is no line to read either way. See
 * `DELETED_LINE_REF` in `normalizer/LineRefNormalizerRule.ts` for why a
 * deleted reference is written this way rather than left pointing at whichever
 * line took its place.
 */
function deletedLineError(): Value {
  return errorValue("LINE_REFERENCE_DELETED", "This reference pointed at a line that has been deleted");
}

/** `line<N>` / `line N`, an arbitrary line's cached result by 1-based number. */
/**
 * An arbitrary line's cached result, by one-based line number.
 *
 * @param args - A single Number holding the target line number.
 * @param context - Per-line execution context. Supplies the document's
 * cached results; without it the handler returns a LINES_NO_CONTEXT error
 * rather than guessing, since line references are meaningless outside a
 * document.
 * @returns The computed Value, or an error Value when the context is
 * missing or a referenced line has no numeric result. `line deleted`
 * ({@link DELETED_LINE_NUMBER}) answers with its named error first, with or
 * without a document.
 */
export function lineRefHandler(args: Value[], context?: LineExecutionContext): Value {
  // `inputs of line N` shares this function's plugin slot; see TRACE_INPUTS.
  if (args.length === 2 && args[1].toNumber() === TRACE_INPUTS) return inputsOfHandler(args, context);
  if (args[0].toNumber() === DELETED_LINE_NUMBER) return deletedLineError();
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  const targetLine = args[0].toNumber();
  const v = context!.getLineResult!(targetLine);
  const err = checkLineValue(v, targetLine);
  return err ?? v!;
}

/**
 * Add or average a column of results, reading them all in one unit.
 *
 * The same rule the inline `total of X, Y, Z` list follows, and for the same
 * reason: a column of money is money, `1.2 km` above `800 m` is 2 km rather
 * than a refusal or a nonsense 802, and a column mixing measures is refused by
 * dimension because there is no unit both can be read in. The unit is the
 * first one in the column, since that is the one the reader wrote first.
 */
function combineQuantities(values: Value[], isAverage: boolean): Value {
  // A column of decimals totals exactly, so `total above` over 0.1 and 0.2 is
  // the 0.3 a later `== 0.3` agrees with. See vm/ExactDecimals.ts. The exact
  // total carries the column's sources as the double one below does: an exact
  // column is all plain numbers, so there is no conversion rate to add.
  const exact = exactDecimalTotal(values, isAverage);
  if (exact !== null) return withSources(exact, sourcesOfValues(values));
  const unified = unifyQuantities(values, isAverage ? "averaged" : "added");
  if (unified instanceof Value) return unified;
  const sum = unified.magnitudes.reduce((acc, n) => acc + n, 0);
  const result = isAverage ? sum / values.length : sum;
  if (unified.unit === undefined) return withSources(numberValue(result), unified.sources);
  const combined = withSources(uomValue(result, unified.unit), unified.sources);
  // A total of clock-time spans is still a span, so a timesheet column of
  // `17:30 - 09:00` lines totals to a clock rather than to milliseconds. One
  // ordinary quantity in the column is enough to make the total a quantity.
  if (values.every((v) => v.datetimeSpan === true)) combined.datetimeSpan = true;
  return combined;
}

/**
 * Shared range-walk for `sum(line X : line Y)` / `total(...)` /
 * `average(...)`. Restricted to plain `Number`/`Uom` values of the SAME
 * measure, errors on `String`/`Boolean`/`Datetime` rather than silently
 * coercing via `.toNumber()` (which would, e.g., turn a Datetime into an
 * epoch-ms number and silently "sum" timestamps together).
 */
function aggregateRange(from: number, to: number, context: LineExecutionContext, isAverage: boolean): Value {
  const values: Value[] = [];
  const step = from <= to ? 1 : -1;
  // The whole span is declared before any of it is read: the walk below
  // stops at the first line it cannot use, and a cycle that closes through
  // a later one must still be known to the graph. Only the part of the span
  // the document has, though: a range written to line three million has no
  // line to read past the last one, and no cycle can close through a line
  // that is not there. Declaring all of it exhausted the heap.
  const lineCount = context.getLineCount?.();
  if (context.noteLineRead && lineCount !== undefined) {
    const first = Math.max(1, Math.min(from, to));
    const last = Math.min(lineCount, Math.max(from, to));
    for (let n = first; n <= last; n++) context.noteLineRead(n);
  }
  for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
    // A blank line or a heading inside the range has no figure to add, as a
    // spreadsheet's SUM passes over an empty cell. It used to be read as a
    // forward reference, so pressing Enter inside a summed range turned the
    // sum into an error (#562). Only a line inside the document is passed
    // over; a range past its end still reports that line.
    if (lineCount !== undefined && n >= 1 && n <= lineCount && context.isLineBoundary?.(n)) continue;
    const v = context.getLineResult!(n);
    const err = checkLineValue(v, n);
    if (err) return err;
    if (v!.type !== ValueType.Number && v!.type !== ValueType.Uom) {
      return errorValue("LINE_RANGE_NON_NUMERIC", `Line ${n} is not a plain number or unit value — cannot include it in a sum/total/average range`);
    }
    values.push(v!);
  }
  if (values.length === 0) {
    return errorValue("LINE_RANGE_EMPTY", `Lines ${from} to ${to} hold no figures to ${isAverage ? "average" : "add up"}: every line in the range is blank or a heading.`);
  }
  return combineQuantities(values, isAverage);
}

/** `sum(line X : line Y)` / `total(line X : line Y)`. */
/**
 * Sum of the numeric results across an inclusive line range.
 *
 * @param args - Two Numbers: the first and last line of the range.
 * @param context - Per-line execution context. Supplies the document's
 * cached results; without it the handler returns a LINES_NO_CONTEXT error
 * rather than guessing, since line references are meaningless outside a
 * document.
 * @returns The computed Value, or an error Value when the context is
 * missing or a referenced line has no numeric result.
 */
export function sumRangeHandler(args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  return aggregateRange(args[0].toNumber(), args[1].toNumber(), context!, false);
}

/** `average(line X : line Y)`. */
/**
 * Mean of the numeric results across an inclusive line range.
 *
 * @param args - Two Numbers: the first and last line of the range.
 * @param context - Per-line execution context. Supplies the document's
 * cached results; without it the handler returns a LINES_NO_CONTEXT error
 * rather than guessing, since line references are meaningless outside a
 * document.
 * @returns The computed Value, or an error Value when the context is
 * missing or a referenced line has no numeric result.
 */
export function averageRangeHandler(args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  return aggregateRange(args[0].toNumber(), args[1].toNumber(), context!, true);
}

/**
 * `total above` / `sum above` / `average above`, aggregate every line's
 * result from the current line's immediate predecessor backward, stopping
 * at (not including) the nearest blank line or `#` heading.
 */
function aggregateAbove(context: LineExecutionContext, isAverage: boolean): Value {
  const boundaryCheck = context.isLineBoundary;
  if (!boundaryCheck) {
    return errorValue("LINE_REF_NO_DOCUMENT", "\"above\" aggregation requires a real document");
  }
  const values: Value[] = [];
  // The block is declared before it is read, for the reason the range gives:
  // the walk stops at the first line it cannot use, and the graph has to
  // know the rest of the block regardless.
  if (context.noteLineRead) {
    for (let n = context.lineIndex - 1; n >= 1 && !boundaryCheck(n); n--) context.noteLineRead(n);
  }
  for (let n = context.lineIndex - 1; n >= 1; n--) {
    if (boundaryCheck(n)) break;
    const v = context.getLineResult!(n);
    // A check line is a statement about the column, not one of its values,
    // passed or failed alike (#506).
    if (isCheckResult(v)) continue;
    // A subtotal above is a summary of figures already in the column, not
    // another figure: `10`, `total above`, `5`, `total above` is 15, not the
    // 25 that counted the first total as well (#551). The same test the
    // section totals use, so the two forms agree about one note.
    if (isSummaryLine(context.getLineText?.(n) ?? "")) continue;
    const err = checkLineValue(v, n);
    if (err) return err;
    if (v!.type !== ValueType.Number && v!.type !== ValueType.Uom) {
      return errorValue("LINE_RANGE_NON_NUMERIC", `Line ${n} is not a plain number or unit value — cannot include it in "above" aggregation`);
    }
    values.push(v!);
  }
  if (values.length === 0) return errorValue("LINE_RANGE_EMPTY", "No lines above to aggregate (hit the top of the document, a blank line, or a heading immediately)");
  // The walk runs upwards from the line above, so the column arrives bottom
  // first. The unit the answer carries is the one written at the top of the
  // column, which is the one the reader started with, so put it back in
  // reading order before combining.
  values.reverse();
  return combineQuantities(values, isAverage);
}

/** `total above`, every numeric result on lines before this one. */
/**
 * Sum of every numeric result on lines above this one.
 *
 * @param _args - Unused. `total above` takes no arguments.
 * @param context - Per-line execution context. Supplies the document's
 * cached results; without it the handler returns a LINES_NO_CONTEXT error
 * rather than guessing, since line references are meaningless outside a
 * document.
 * @returns The computed Value, or an error Value when the context is
 * missing or a referenced line has no numeric result.
 */
export function totalAboveHandler(_args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  return aggregateAbove(context!, false);
}

/** `average above`, the mean of every numeric result before this line. */
/**
 * Mean of every numeric result on lines above this one.
 *
 * @param _args - Unused. `average above` takes no arguments.
 * @param context - Per-line execution context. Supplies the document's
 * cached results; without it the handler returns a LINES_NO_CONTEXT error
 * rather than guessing, since line references are meaningless outside a
 * document.
 * @returns The computed Value, or an error Value when the context is
 * missing or a referenced line has no numeric result.
 */
export function averageAboveHandler(_args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireContext(context);
  if (ctxError) return ctxError;
  return aggregateAbove(context!, true);
}

// ── Sections ──────────────────────────────────────────────────────────────

/** What a section aggregate does with the figures it gathers. */
type SectionMode = "sum" | "average" | "count";

/** A heading found in the document, and the line it sits on. */
interface PlacedHeading {
  readonly line: number;
  readonly level: number;
  readonly name: string;
}

/** How many heading names a "not found" message lists before it counts the rest. */
const HEADINGS_LISTED = 6;

/**
 * A section aggregate reads the document's text as well as its results, since
 * it finds its block by a heading, which has no result of its own.
 */
function requireSectionContext(context: LineExecutionContext | undefined): Value | null {
  if (!context?.getLineResult || !context.getLineText || !context.isLineBoundary) {
    return errorValue(
      "SECTION_NO_DOCUMENT",
      "A section total reads the lines under a heading, so it needs a document, which the single-expression path does not have.",
    );
  }
  return null;
}

/** Items joined the way a sentence lists them: `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The refusal for a name no heading carries, naming the headings there are, so
 * a slip in the name is a one-look fix rather than a silent zero.
 */
function sectionNotFound(name: string, headings: readonly PlacedHeading[]): Value {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const heading of headings) {
    const key = sectionKey(heading.name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    names.push(`"${heading.name}"`);
  }
  if (names.length === 0) {
    return errorValue("SECTION_NOT_FOUND", `No heading is named "${name}": this note has no headings.`);
  }
  if (names.length === 1) {
    return errorValue("SECTION_NOT_FOUND", `No heading is named "${name}". The only heading in this note is ${names[0]}.`);
  }
  const shown = names.length > HEADINGS_LISTED
    ? [...names.slice(0, HEADINGS_LISTED), `${names.length - HEADINGS_LISTED} more`]
    : names;
  return errorValue("SECTION_NOT_FOUND", `No heading is named "${name}". The headings in this note are ${listed(shown)}.`);
}

/**
 * The refusal for a name two or more headings carry. Either block could be the
 * one meant, and adding both would answer a question nobody asked, so neither
 * is chosen.
 */
function sectionAmbiguous(matches: readonly PlacedHeading[]): Value {
  const lines = matches.map((h) => String(h.line));
  return errorValue(
    "SECTION_AMBIGUOUS",
    `${matches.length} headings are named "${matches[0].name}" (lines ${listed(lines)}), so the section is unclear. Give each its own name.`,
  );
}

/**
 * {@link checkLineValue} for a line inside a section, with one reading added.
 *
 * Every line above this one has already run, so a line above with nothing to
 * read is one that gave no figure, such as prose the note does not evaluate,
 * and is reported as a line with an error rather than as one not reached yet.
 * Below this line, nothing has run yet.
 */
function checkSectionMember(v: Value | undefined, lineNumber: number, lineIndex: number): Value | null {
  if (v === undefined && lineNumber < lineIndex) {
    return errorValue("LINE_RESULT_ERROR", `Line ${lineNumber} has an error`);
  }
  return checkLineValue(v, lineNumber);
}

/**
 * The refusal for a line that is not a number or a quantity, naming the line,
 * its section and what it is. The same code the inline aggregates refuse with.
 */
function sectionNonNumeric(v: Value, lineNumber: number, heading: string, verb: string): Value {
  const kind = nonNumericKind(v);
  const message = kind === undefined
    ? `Line ${lineNumber}, under "${heading}", is not a plain number or quantity, so it cannot be ${verb}.`
    : `Line ${lineNumber}, under "${heading}", is ${kind}, so it cannot be ${verb}: only numbers and quantities can.`;
  return errorValue("AGGREGATE_NON_NUMERIC", message);
}

/**
 * `total of section "Travel"` and its siblings: the figures under the heading
 * named, down to the next heading at the same level or above.
 *
 * One walk collects the document's headings, because all of them are needed:
 * the one asked for can sit anywhere, a second heading with the same name has
 * to be noticed, and the block ends at the next heading at its level or above.
 * The lines of the block are then read the way `total above` reads its own:
 * blank lines, headings and other markdown are passed over, a line that is
 * itself a summary is left out (see {@link isSummaryLine}), and an unreadable or
 * non-numeric line stops the answer with an error naming it.
 *
 * The block is declared to the dependency graph before any of it is read, for
 * the reason the range gives: the read stops at the first line it cannot use.
 * The two headings that bound it are declared too. They have no result, so they
 * can never close a cycle, and declaring them makes an edit that moves the
 * block's edges reach this line.
 */
function aggregateSection(context: LineExecutionContext, name: string, mode: SectionMode): Value {
  const getText = context.getLineText!;
  const getResult = context.getLineResult!;
  const isBoundary = context.isLineBoundary!;
  const wanted = sectionKey(name);

  const headings: PlacedHeading[] = [];
  let lastLine = 0;
  for (let n = 1; ; n++) {
    const text = getText(n);
    if (text === undefined) break; // past the end of the document
    lastLine = n;
    // A heading starts with `#`, and most lines hold none.
    if (text.indexOf("#") === -1) continue;
    const heading = headingOf(text);
    if (heading !== null) headings.push({ line: n, level: heading.level, name: heading.name });
  }

  const matches = wanted === "" ? [] : headings.filter((h) => sectionKey(h.name) === wanted);
  if (matches.length === 0) return sectionNotFound(name, headings);
  if (matches.length > 1) return sectionAmbiguous(matches);
  const open = matches[0];
  const close = headings.find((h) => h.line > open.line && h.level <= open.level);
  const end = close === undefined ? lastLine + 1 : close.line;

  const members: number[] = [];
  for (let n = open.line + 1; n < end; n++) {
    if (n === context.lineIndex) continue; // the query line, when it sits inside its own section
    if (isBoundary(n)) continue; // a blank line, a subheading, a comment
    if (isSummaryLine(getText(n) ?? "")) continue;
    members.push(n);
  }
  if (context.noteLineRead) {
    context.noteLineRead(open.line);
    for (const n of members) context.noteLineRead(n);
    if (close !== undefined) context.noteLineRead(close.line);
  }

  const verb = mode === "average" ? "averaged" : "added";
  const values: Value[] = [];
  for (const n of members) {
    const v = getResult(n);
    // A check line is a statement about the section, not one of its figures,
    // passed or failed alike, as `total above` treats it (#506).
    if (isCheckResult(v)) continue;
    const err = checkSectionMember(v, n, context.lineIndex);
    if (err) return err;
    // `count of section` is "how many figures sit under the heading", so a
    // line that is not a number still counts; only sum and average add.
    if (mode !== "count" && v!.type !== ValueType.Number && v!.type !== ValueType.Uom) {
      return sectionNonNumeric(v!, n, open.name, verb);
    }
    values.push(v!);
  }

  if (mode === "count") return numberValue(values.length);
  if (values.length === 0) {
    return errorValue("SECTION_EMPTY", `The section "${open.name}" has no figures to ${mode === "average" ? "average" : "add up"}.`);
  }
  return combineQuantities(values, mode === "average");
}

/**
 * `total of section "Travel"` / `sum of section "Travel"`: the sum of every
 * figure under the heading, in the unit the first one is written in.
 *
 * @param args - A single String holding the heading's name.
 * @param context - Per-line execution context. Supplies the document's text and
 * cached results; without them the handler returns a SECTION_NO_DOCUMENT error.
 * @returns The total, or an error Value naming what stopped it.
 */
export function sectionSumHandler(args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireSectionContext(context);
  if (ctxError) return ctxError;
  return aggregateSection(context!, String(args[0].value), "sum");
}

/**
 * `average of section "Travel"`: the mean of the figures under the heading.
 *
 * @param args - A single String holding the heading's name.
 * @param context - Per-line execution context. Supplies the document's text and
 * cached results; without them the handler returns a SECTION_NO_DOCUMENT error.
 * @returns The mean, or an error Value naming what stopped it.
 */
export function sectionAverageHandler(args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireSectionContext(context);
  if (ctxError) return ctxError;
  return aggregateSection(context!, String(args[0].value), "average");
}

/**
 * `count of section "Travel"`: how many figures sit under the heading.
 *
 * @param args - A single String holding the heading's name.
 * @param context - Per-line execution context. Supplies the document's text and
 * cached results; without them the handler returns a SECTION_NO_DOCUMENT error.
 * @returns The count, or an error Value naming what stopped it.
 */
export function sectionCountHandler(args: Value[], context?: LineExecutionContext): Value {
  const ctxError = requireSectionContext(context);
  if (ctxError) return ctxError;
  return aggregateSection(context!, String(args[0].value), "count");
}

/**
 * `inputs of line N`, the lines that fed line N's answer, followed upwards,
 * as one line of text: `payment 527.84 (line 4) <- deposit 100,000 (line 2),
 * rate 4.00% (line 1)`.
 *
 * A trace reads lines that have already been worked out, so it only looks up:
 * line N must be above the asking line, and a line in the trace that reads a
 * line below itself (a forward reference) stops it with a named error rather
 * than a guess, as do two lines that read each other (a cycle). Both document
 * passes refuse the same way, so they agree on every document.
 *
 * @param args - A single Number, the line to trace.
 * @param context - Per-line execution context. Supplies the trace; without a
 * document the handler returns a `LINE_REF_NO_DOCUMENT` error.
 * @returns The trace as a String, or an error Value naming what stopped it.
 */
export function inputsOfHandler(args: Value[], context?: LineExecutionContext): Value {
  if (!context?.traceLine) {
    return errorValue("LINE_REF_NO_DOCUMENT", "Tracing a line's inputs needs a document to read, and the single-expression entry point has none");
  }
  const target = args[0].toNumber();
  const asking = context.lineIndex;
  if (target >= asking) {
    return errorValue(
      "TRACE_FORWARD_REFERENCE",
      `Line ${target} is not above this line, so its answer has not been worked out yet: a trace reads the lines above it`,
    );
  }
  if (target < 1) {
    return errorValue("LINE_NOT_YET_EVALUATED", `There is no line ${target} to trace`);
  }
  const trace = context.traceLine(target);
  const problem = traceProblem(trace);
  if (problem?.kind === "cycle") {
    return errorValue(
      "TRACE_CYCLE",
      problem.line === problem.reader
        ? `Line ${problem.line} reads its own answer, so it has no inputs to trace`
        : `Line ${problem.reader} reads line ${problem.line}, which leads back to line ${problem.reader}: lines that read each other have no answer to trace`,
    );
  }
  if (problem?.kind === "forward") {
    return errorValue(
      "TRACE_FORWARD_REFERENCE",
      `Line ${problem.reader} reads line ${problem.line}, which is below it, so the order its answer was worked out in cannot be traced`,
    );
  }
  return stringValue(formatLineTrace(trace));
}
