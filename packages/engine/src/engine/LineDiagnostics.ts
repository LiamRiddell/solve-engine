/**
 * What a document line keeps of a failure it threw: the code, the message and
 * where in the line it happened.
 *
 * A single expression that fails throws an {@link EngineError}, and a host
 * reads its `code` and its `span` to underline the fault. A document line that
 * failed used to keep only the message, on every document path, so a host that
 * moved from one expression to a document lost the code it branched on and
 * the span it underlined (#709). These helpers are the one place each path
 * turns a thrown error into what the line keeps, so the paths cannot drift in
 * how they do it.
 *
 * Positions are in the reader's terms on every path: character offsets into
 * the line's own text, starting at 0, with the document's one-based line
 * number and the one-based column in that line. The engine measures a span
 * against whatever text it lexed, which is the whole document in the batch
 * pass and the expression alone everywhere else, so each caller says how far
 * that text starts from the start of the line.
 */

import { EngineError, normalizeUnknownError } from "@solve-js/errors/UnifiedErrorFramework";
import type { SourceSpan } from "@solve-js/errors/EngineError";
import { ValueType, type Value } from "@solve-js/vm/Value";

/**
 * A failure a line's expression threw, as the line keeps it.
 *
 * Kept small on purpose: the evaluator holds one per failed expression for as
 * long as the line stays failed, so it carries what a host reads and not the
 * whole error (its stack, context and cause).
 */
export interface LineFailure {
	/** The error's code, `NO_PREFIX_PARSELET` or `UNDEFINED_VARIABLE`: what a host branches on. */
	readonly code: string;
	/** The error's message, for the reader. */
	readonly message: string;
	/**
	 * Where in the line the fault is, as offsets into the line's text, or null
	 * when the engine has no position for it (a runtime failure such as an
	 * undefined variable is raised with none).
	 */
	readonly span: SourceSpan | null;
}

/**
 * An error thrown for the text of line `lineNumber`, its span moved onto that
 * line.
 *
 * `evaluateLine` lexes the text it is given on its own, so a parse error's span
 * counted lines from 1 whatever line the host said the text is on: the fault in
 * `evaluateLine(4, "3 + * 4")` was reported on line 1 (#836). The offsets and
 * the column are already right, since they count from the start of the text,
 * which is the start of the line. An error with no span, a line number that is
 * not a positive whole number, and an error already on the line are returned
 * as they are.
 *
 * @param error - The error the line threw.
 * @param lineNumber - The one-based line the host passed, or below 1 for none.
 * @returns The same error, or a copy whose span names the line.
 */
export function errorOnLine(error: EngineError, lineNumber: number): EngineError {
	const span = error.span;
	if (span === undefined || !Number.isSafeInteger(lineNumber) || lineNumber < 1) return error;
	// The text is one line, so the span is on it, even where the lexer counted
	// a stray carriage return inside it as the start of another.
	const line = lineNumber;
	if (span.line === line) return error;
	// A new error rather than an edited one: `span` is readonly, and the caller
	// may still hold the first.
	return new EngineError(error.category, {
		code: error.code,
		message: error.message,
		expected: error.expected,
		found: error.found,
		suggestion: error.suggestion,
		recoverable: error.recoverable,
		span: { ...span, line },
		context: error.context,
		cause: error.cause,
	});
}

/**
 * A span moved into the line's own terms.
 *
 * @param span - The span as the engine measured it, or undefined for none.
 * @param lineNumber - The document's one-based line number.
 * @param shift - How far the text the span was measured against starts from
 * the start of the line: the expression's offset in the line for a span
 * measured against the expression, or minus the line's offset in the document
 * for a span measured against the document.
 * @param lineLength - The line's length, which no offset in the result passes.
 * @returns Offsets into the line, the line number and the one-based column, or
 * null when there was no span or it holds no usable offsets.
 */
export function spanInLine(span: SourceSpan | undefined, lineNumber: number, shift: number, lineLength: number): SourceSpan | null {
	if (span === undefined || !Number.isFinite(span.start) || !Number.isFinite(span.end)) return null;
	const limit = Math.max(0, lineLength);
	const start = Math.min(limit, Math.max(0, span.start + shift));
	const end = Math.min(limit, Math.max(start, span.end + shift));
	return { start, end, line: lineNumber, col: start + 1 };
}

/**
 * What a line keeps of something one of its expressions threw.
 *
 * Anything thrown is accepted, since a line must record its failure and carry
 * on whatever reached it: a value that is not an {@link EngineError} is
 * normalised the way every other catch site does it, to `UNEXPECTED_ERROR` or
 * `UNKNOWN_ERROR` with no span.
 *
 * @param thrown - What the expression threw.
 * @param lineNumber - The document's one-based line number.
 * @param shift - See {@link spanInLine}.
 * @param lineLength - The line's length.
 * @returns The code, the message and the span in the line.
 */
export function lineFailureOf(thrown: unknown, lineNumber: number, shift: number, lineLength: number): LineFailure {
	const error = normalizeUnknownError(thrown);
	return { code: error.code, message: error.message, span: spanInLine(error.span, lineNumber, shift, lineLength) };
}

/**
 * Where an expression starts in its line, for a span measured against the
 * expression alone.
 *
 * A whole-line expression is the line's text trimmed, and sometimes less than
 * that (a list marker or a label the scan left out), so it is found in the
 * line rather than assumed to start at 0. Text that does not occur in the line
 * at all is taken to start at 0.
 *
 * @param lineText - The line's text.
 * @param expression - The expression evaluated from it.
 * @returns The expression's offset in the line.
 */
export function expressionOffsetInLine(lineText: string, expression: string): number {
	if (expression === "") return 0;
	const at = lineText.indexOf(expression);
	return at < 0 ? 0 : at;
}

/**
 * Where an inline solve's expression starts in its line.
 *
 * A solve's `start` is where its opening s-and-backtick is, and the expression
 * is the text after those two characters, taken as it stands.
 *
 * @param solveStart - The inline solve's `start`.
 * @returns The offset of its expression's first character.
 */
export function inlineExpressionOffset(solveStart: number): number {
	return solveStart + 2;
}

/** The failure fields a whole line and an inline solve share. */
interface FailureFields {
	error?: string | null;
	errorCode?: string | null;
	errorSpan?: SourceSpan | null;
}

/**
 * Put a thrown failure on a line or an inline solve: its message in `error`,
 * its code in `errorCode` and its position in `errorSpan`, the three fields a
 * host reads.
 *
 * @param target - The parsed line or inline solve that failed.
 * @param failure - What it threw, from {@link lineFailureOf}.
 */
export function recordLineFailure(target: FailureFields, failure: LineFailure): void {
	target.error = failure.message;
	target.errorCode = failure.code;
	target.errorSpan = failure.span;
}

/** The message of an error value: its `unit` holds it, and its `value` the code. */
function errorValueMessage(value: Value): string {
	return typeof value.unit === "string" ? value.unit : String(value.value);
}

/** What a line or an inline solve says about failing, as {@link documentErrors} reads it. */
interface FailureSource {
	error?: string | null;
	result?: Value | null;
}

/** The message of one thing that failed, or null when it did not. */
function failureMessage(source: FailureSource): string | null {
	if (source.error) return source.error;
	const result = source.result;
	return result && result.type === ValueType.Error ? errorValueMessage(result) : null;
}

/**
 * The flat list of a document's failures, one `Line N: message` entry for each
 * line or inline solve that failed, in document order.
 *
 * One rule for both document passes, so the lists they return agree: a
 * failure counts whether it was thrown (its message is in `error`) or
 * returned (its `result` is an error value). The batch pass used to list only
 * the thrown ones and the incremental pass both, so `5 kg + 3 m` was in one
 * list and not the other (#709).
 *
 * @param lines - The document's lines, each with its inline solves.
 * @returns The entries, in line order and left to right within a line.
 */
export function documentErrors(
	lines: readonly { readonly lineNumber: number; readonly error: string | null; readonly result: Value | null; readonly inlineSolves: readonly FailureSource[] }[],
): string[] {
	const errors: string[] = [];
	for (const line of lines) {
		const whole = failureMessage(line);
		if (whole !== null) errors.push(`Line ${line.lineNumber}: ${whole}`);
		for (const solve of line.inlineSolves) {
			const message = failureMessage(solve);
			if (message !== null) errors.push(`Line ${line.lineNumber}: ${message}`);
		}
	}
	return errors;
}
