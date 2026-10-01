/**
 * Turning the engine's answers into what the command prints.
 *
 * The engine hands back a `ParsingResult` for a document and a `Value` for an
 * expression. This module decides, for each line, whether it answered, failed,
 * is still waiting for live data, or was not read as an expression at all, and
 * writes that as aligned text for a person or as one JSON object for a program.
 */

import type { Value } from "solve-engine";
import type { ParsedLine, ParsingResult } from "solve-engine/engine";
import { escapeForTerminal } from "./terminal";

/**
 * What became of one line, or of one inline solve.
 *
 * - `answered`: a value the engine computed.
 * - `failed`: the engine evaluated it and answered with an error (a failed
 *   check, a unit that does not fit, live data that is switched off).
 * - `pending`: live data that did not arrive within the wait.
 * - `not-read`: the engine could not read the line as an expression. In a
 *   note that is usually prose, so it is not a failure unless `--strict`.
 */
export type LineStatus = "answered" | "failed" | "pending" | "not-read";

/** One reported answer: a whole line, or one inline solve inside a line. */
export interface ReportedAnswer {
	/** One-based line number. */
	line: number;
	/** The line's text, or an inline solve's expression. */
	text: string;
	/** What became of it. */
	status: LineStatus;
	/** The answer as the engine writes it (`= 12`), or the failure's message. */
	display: string;
	/** The error code, when it failed or was not read. */
	code: string | null;
	/** The value as JSON (`Value.toJSON`), or null when there is none. */
	value: Record<string, unknown> | null;
}

/** Formats a value the way the engine's host would, `engine.formatValue`. */
export type FormatValue = (value: Value) => string;

/** How long the run waited, for a pending line's message. */
function pendingMessage(waitMs: number): string {
	return `no answer from live data within ${waitMs} ms`;
}

/**
 * The status of one computed value: an error value is a failure, a pending
 * one is still waiting, anything else answered.
 */
export function statusOf(value: Value): LineStatus {
	if (value.isPending()) return "pending";
	if (value.isError()) return "failed";
	return "answered";
}

/** One answer from a value, or from the message a thrown line left. */
function answerOf(
	line: number,
	text: string,
	value: Value | null | undefined,
	error: string | null | undefined,
	errorCode: string | null | undefined,
	format: FormatValue,
	waitMs: number,
): ReportedAnswer | null {
	if (value != null) {
		const status = statusOf(value);
		const display = status === "pending" ? pendingMessage(waitMs) : format(value);
		const code = status === "answered" ? null : value.errorCode ?? null;
		return { line, text, status, display, code, value: value.toJSON() };
	}
	if (error != null) return { line, text, status: "not-read", display: error, code: errorCode ?? null, value: null };
	return null;
}

/**
 * Every answer in a document, in line order: one per evaluated line, and one
 * per inline solve for a line that holds them. Blank lines, headings and the
 * other lines the engine skips produce none.
 *
 * @param result - The engine's document result.
 * @param format - Writes a value as the engine would.
 * @param waitMs - The wait, named in a pending line's message.
 */
export function documentAnswers(result: ParsingResult, format: FormatValue, waitMs: number): ReportedAnswer[] {
	const out: ReportedAnswer[] = [];
	for (const line of result.lines) {
		if (line.hasInlineSolves) {
			for (const solve of line.inlineSolves) {
				const answer = answerOf(line.lineNumber, `\`${solve.expression}\``, solve.result, solve.error, solve.errorCode, format, waitMs);
				if (answer !== null) out.push(answer);
			}
			continue;
		}
		if (line.isEmpty) continue;
		const answer = answerOf(line.lineNumber, line.text, line.result, line.error, line.errorCode, format, waitMs);
		if (answer !== null) out.push(answer);
	}
	return out;
}

/** Whether any line in a document is still waiting for live data. */
export function hasPending(result: ParsingResult): boolean {
	return result.lines.some(
		(line) => line.result?.isPending() === true || line.inlineSolves.some((solve) => solve.result?.isPending() === true),
	);
}

/** Whether an answer counts against the exit code. */
export function isFailure(answer: ReportedAnswer, strict: boolean): boolean {
	return answer.status === "failed" || answer.status === "pending" || (strict && answer.status === "not-read");
}

/**
 * A line written as a check: the `check` keyword opening it, after a label if
 * it has one, and not a variable of that name being assigned (`check = $80`).
 *
 * The same test as the engine's `isWrittenAsCheck` (conditionals/CheckFunctions.ts),
 * which is not public; the spec compares the two over a corpus so they cannot
 * drift.
 */
export const CHECK_LINE = /^\s*(?:[^:"]*:\s*)?check\s+(?![-+*/]?=[^=])/i;

/** A passed check's answer: a tick, and for an approximate check how close it came. */
const CHECK_PASS = /^\u2713( \(differs by [^)]*\))?$/;

/**
 * What became of one check line: `passed` and `failed` as the engine counts
 * them, `error` for a check that answered some other error (its live data is
 * switched off, its two sides cannot be compared), `not-read` for one the
 * engine could not read, and `pending` for one whose live data never came.
 */
export type CheckStatus = "passed" | "failed" | "error" | "pending" | "not-read";

/** One check line and its outcome. */
export interface ReportedCheck {
	/** One-based line number. */
	line: number;
	/** The line as written. */
	text: string;
	/** What became of it. */
	status: CheckStatus;
	/** The tick, the failure's message, or why it was not read. */
	display: string;
	/** The error code, when it did not pass. */
	code: string | null;
}

/**
 * Every check line in a document and its outcome.
 *
 * A check passed when the engine answered it with a tick, and failed when it
 * answered `CHECK_FAILED`: the same two the engine counts in
 * `ParsingResult.checks`. A line written as a check that did neither (it could
 * not be read, it answered some other error, or its live data never came) is
 * reported as well, because a check that was never
 * evaluated has not passed, and a CI run that skipped it silently would be
 * green over a broken gate. A line that starts with `check` but answered an
 * ordinary value is a variable called `check` (`check * 2`), not a check.
 *
 * @param result - The engine's document result.
 * @param format - Writes a value as the engine would.
 * @param waitMs - The wait, named in a pending line's message.
 */
export function documentChecks(result: ParsingResult, format: FormatValue, waitMs: number): ReportedCheck[] {
	const out: ReportedCheck[] = [];
	for (const line of result.lines) {
		if (line.hasInlineSolves || !CHECK_LINE.test(line.text)) continue;
		const check = checkOf(line, format, waitMs);
		if (check !== null) out.push(check);
	}
	return out;
}

/** One check line's outcome, or null when the line is not a check after all. */
function checkOf(line: ParsedLine, format: FormatValue, waitMs: number): ReportedCheck | null {
	const base = { line: line.lineNumber, text: line.text };
	const value = line.result;
	if (value == null) {
		if (line.error == null) return null;
		return { ...base, status: "not-read", display: line.error, code: line.errorCode ?? null };
	}
	if (value.isPending()) return { ...base, status: "pending", display: pendingMessage(waitMs), code: null };
	if (value.isError()) {
		const code = value.errorCode ?? null;
		return { ...base, status: code === "CHECK_FAILED" ? "failed" : "error", display: format(value), code };
	}
	const shown = String(value.value);
	if (value.isString() && CHECK_PASS.test(shown)) return { ...base, status: "passed", display: shown, code: null };
	return null;
}

/** The line-number column's width, the widest number's digits. */
function numberWidth(lines: readonly { line: number }[]): number {
	return lines.reduce((w, a) => Math.max(w, String(a.line).length), 1);
}

/** The widest the text column grows before a long line is cut. */
const TEXT_COLUMN = 48;

/** A line's text, cut to fit its column with an ellipsis. */
function fitted(text: string, width: number): string {
	const clean = escapeForTerminal(text);
	const chars = Array.from(clean);
	if (chars.length <= width) return clean + " ".repeat(width - chars.length);
	return chars.slice(0, width - 1).join("") + "\u2026";
}

/** The prefix a status puts before its message in the text output. */
function prefixed(status: LineStatus | CheckStatus, display: string): string {
	const text = escapeForTerminal(display);
	if (status === "pending") return `pending: ${text}`;
	if (status === "not-read") return `not read: ${text}`;
	if ((status === "failed" || status === "error") && !text.startsWith("check failed")) return `error: ${text}`;
	return text;
}

/**
 * The text output for a list of answers or checks: the line number, the line
 * cut to a column, then the answer, one row each.
 *
 * @param rows - What to print.
 * @param include - Whether a row is printed at all.
 */
export function renderRows<T extends { line: number; text: string; status: LineStatus | CheckStatus; display: string }>(
	rows: readonly T[],
	include: (row: T) => boolean = () => true,
): string {
	const shown = rows.filter(include);
	const nw = numberWidth(shown);
	const tw = Math.min(TEXT_COLUMN, shown.reduce((w, r) => Math.max(w, Array.from(escapeForTerminal(r.text)).length), 0));
	return shown.map((r) => `${String(r.line).padStart(nw)}  ${fitted(r.text, tw)}  ${prefixed(r.status, r.display)}`.trimEnd() + "\n").join("");
}

/** "1 line" or "2 lines". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/**
 * The closing line of `solve check`: how many checks passed, failed, and could
 * not be evaluated.
 */
export function checkSummary(checks: readonly ReportedCheck[]): string {
	const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
	const parts = [`${count("passed")} passed`, `${count("failed")} failed`];
	const unevaluated = count("error") + count("not-read");
	if (unevaluated > 0) parts.push(`${unevaluated} could not be evaluated`);
	if (count("pending") > 0) parts.push(`${count("pending")} still waiting for live data`);
	return `${plural(checks.length, "check")}: ${parts.join(", ")}`;
}

/**
 * An expression's answer as the command prints it: the engine's text with its
 * leading `= ` taken off, since the command line has no line for it to follow.
 */
export function expressionDisplay(display: string): string {
	return display.startsWith("= ") ? display.slice(2) : display;
}
