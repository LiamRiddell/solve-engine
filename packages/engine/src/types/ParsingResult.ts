/**
 * Result shapes returned when a whole document is parsed rather than a single
 * expression.
 *
 * These describe what a host renders: which lines carry results, where in each
 * line those results belong, and what went wrong where it did.
 */

import { Value } from "@solve-js/vm/Value";
import { DiagnosticReportJSON } from "@solve-js/diagnostics";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";

/**
 * One inline solve, and where it sits in its line.
 *
 * An inline solve is an expression embedded in prose between backticks. A line
 * can hold several, so positions are what let a host place each result against
 * the right span rather than at the end of the line.
 */
export interface InlineSolvePosition {
    /** Character offset where the expression starts, within its line. */
    start: number;
    /** Character offset just past the end of the expression. */
    end: number;
    /** The expression text, without the surrounding backticks. */
    expression: string;
    /** One-based line number. */
    lineNumber: number;
    /** One-based column, for hosts that report positions to a user. */
    columnNumber: number;
    /** The evaluated value, or null when evaluation failed or was skipped. */
    result?: Value | null;
    /** Message when this span failed, leaving others on the line intact. */
    error?: string | null;
}

/**
 * One line of a parsed document.
 *
 * A line carries either a whole-line expression or a set of inline solves,
 * never both. `isEmpty` covers the third case: prose, a heading, or a blank.
 */
export interface ParsedLine {
    /** One-based line number. */
    lineNumber: number;
    /** The raw line text as it appeared. */
    text: string;
    /** Character offset of the line start within the whole document. */
    startPosition: number;
    /** Character offset just past the line end within the whole document. */
    endPosition: number;
    /** Whether the line holds nothing to evaluate. */
    isEmpty: boolean;
    /** Whether the line holds backtick-delimited expressions. */
    hasInlineSolves: boolean;
    /** Each embedded expression and its position. Empty for a whole-line expression. */
    inlineSolves: InlineSolvePosition[];
    /** The whole-line expression, or null when the line has inline solves or nothing. */
    expression: string | null;
    /** The whole-line result, or null when there is none or it failed. */
    result: Value | null;
    /** Message when the whole-line expression failed. */
    error: string | null;
}

/**
 * Everything produced by parsing a document.
 *
 * Errors are collected rather than thrown. One bad line must not cost the
 * results of every other line, so failures are reported alongside the lines
 * that did evaluate.
 */
export interface ParsingResult {
    /** Every line in document order, including ones with nothing to evaluate. */
    lines: ParsedLine[];
    /** Line count, so a caller need not measure `lines`. */
    totalLines: number;
    /** Messages from lines that failed. Those lines are still present above. */
    errors: string[];
    /** Stage-by-stage trace, present only when diagnostics were requested. */
    diagnostics?: DiagnosticReportJSON;
}

/** How a document should be parsed. */
export interface UnifiedParsingOptions {
    /**
     * How to read the input.
     *
     * `markdown` respects headings, comments and code fences, and looks for
     * inline solves. `raw` treats every line as an expression. `code` is for
     * input already known to be expressions.
     */
    inputType: 'markdown' | 'raw' | 'code';
    /** Locale for keywords and number formatting. Defaults to English. */
    localeCode?: string;
    /** Include line offsets and positions. Costs a little to compute. */
    includeLineInfo?: boolean;
    /** Include syntax-highlighting spans. */
    includeHighlights?: boolean;
    /** Collect a stage-by-stage trace. For tooling only: it is not free. */
    includeDiagnostics?: boolean;
}

