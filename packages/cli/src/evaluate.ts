/**
 * Evaluating with a wait for live data, and the result objects built from it.
 *
 * Shared by the `solve` command and the MCP server (packages/mcp), so both
 * wait for live values the same way and answer in the same shape: the object
 * `solve --json` prints is the object an MCP tool call returns, less the exit
 * code. Nothing here touches a stream or the file system.
 */

import type { ExpressionEngine, Value } from "solve-engine";
import type { ParsingResult } from "solve-engine/engine";
import { documentAnswers, documentChecks, hasPending, isFailure, statusOf, type ReportedAnswer, type ReportedCheck } from "./report";

/** The most times a run re-evaluates while waiting for live values, whatever the wait. */
export const MAX_SETTLE_ROUNDS = 8;

/** A thrown value's message, whatever was thrown. */
export function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** A thrown value's code, when it carries a string one. */
export function codeOf(error: unknown): string | null {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : null;
}

/** Whether this runtime can compute in a zone. */
export function isKnownZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/**
 * Evaluates, and while anything is still waiting for live data, waits for it
 * to settle and evaluates again, within the one deadline given.
 *
 * `settle` waits for the fetches already started; a value whose first fetch
 * reveals a second needs another round, which is why this loops. The rounds
 * are capped as well as the time, so a data source that starts a new fetch on
 * every run cannot keep the loop turning until the deadline.
 *
 * @param engine - The engine whose fetches to wait for.
 * @param evaluate - Evaluates once and returns the result.
 * @param pending - Whether a result still waits for live data.
 * @param waitMs - The deadline, in milliseconds from now.
 * @returns The last result: settled, or still pending at the deadline.
 */
export async function evaluateSettled<T>(engine: ExpressionEngine, evaluate: () => T, pending: (result: T) => boolean, waitMs: number): Promise<T> {
	const deadline = Date.now() + waitMs;
	let result = evaluate();
	for (let round = 0; round < MAX_SETTLE_ROUNDS && pending(result); round++) {
		const left = deadline - Date.now();
		if (left <= 0) break;
		try {
			await engine.settle({ timeoutMs: left });
		} catch (error) {
			if (codeOf(error) !== "SETTLE_TIMEOUT") throw error;
			return evaluate();
		}
		result = evaluate();
	}
	return result;
}

/** One expression's outcome: a value, or the error that stopped it being read. */
type ExpressionOutcome = { value: Value } | { error: unknown };

/**
 * One expression, evaluated with the wait, as a reported answer. An
 * expression the engine cannot read is `not-read` with the thrown code.
 *
 * @param engine - The engine to evaluate on.
 * @param text - The expression.
 * @param waitMs - How long to wait for live data.
 */
export async function answerExpression(engine: ExpressionEngine, text: string, waitMs: number): Promise<ReportedAnswer> {
	const outcome = await evaluateSettled<ExpressionOutcome>(
		engine,
		() => {
			try {
				return { value: engine.evaluateExpression(text) };
			} catch (error) {
				return { error };
			}
		},
		(o) => "value" in o && o.value.isPending(),
		waitMs,
	);
	if ("value" in outcome) {
		const status = statusOf(outcome.value);
		return {
			line: 1,
			text,
			status,
			display: status === "pending" ? `no answer from live data within ${waitMs} ms` : engine.formatValue(outcome.value),
			code: status === "answered" ? null : outcome.value.errorCode ?? null,
			value: outcome.value.toJSON(),
		};
	}
	return { line: 1, text, status: "not-read", display: messageOf(outcome.error), code: codeOf(outcome.error), value: null };
}

/** The result object for one expression. */
export interface ExpressionReport {
	expression: string;
	status: ReportedAnswer["status"];
	display: string;
	code: string | null;
	value: Record<string, unknown> | null;
}

/** The result object for one expression's answer. */
export function expressionReport(answer: ReportedAnswer): ExpressionReport {
	return { expression: answer.text, status: answer.status, display: answer.display, code: answer.code, value: answer.value };
}

/**
 * Evaluates a document with the wait.
 *
 * @param engine - The engine to evaluate on.
 * @param evaluateDocument - The document pass, `evaluateDocument` from `solve-engine/engine`.
 * @param text - The document.
 * @param waitMs - How long to wait for live data.
 */
export function evaluateDocumentSettled(
	engine: ExpressionEngine,
	evaluateDocument: (engine: ExpressionEngine, text: string) => ParsingResult,
	text: string,
	waitMs: number,
): Promise<ParsingResult> {
	return evaluateSettled(engine, () => evaluateDocument(engine, text), hasPending, waitMs);
}

/** The result object for a document: every answer, and how many count as failures. */
export interface DocumentReport {
	lines: ReportedAnswer[];
	failed: number;
}

/** The result object for a document's answers. */
export function documentReport(engine: ExpressionEngine, result: ParsingResult, waitMs: number, strict: boolean): DocumentReport {
	const lines = documentAnswers(result, (value) => engine.formatValue(value), waitMs);
	return { lines, failed: lines.filter((a) => isFailure(a, strict)).length };
}

/** The result object for a document's checks, with the counts. */
export interface CheckReport {
	checks: ReportedCheck[];
	passed: number;
	failed: number;
	unevaluated: number;
	pending: number;
}

/** The result object for a document's check lines. */
export function checkReport(engine: ExpressionEngine, result: ParsingResult, waitMs: number): CheckReport {
	const checks = documentChecks(result, (value) => engine.formatValue(value), waitMs);
	const count = (s: ReportedCheck["status"]) => checks.filter((c) => c.status === s).length;
	return { checks, passed: count("passed"), failed: count("failed"), unevaluated: count("error") + count("not-read"), pending: count("pending") };
}
