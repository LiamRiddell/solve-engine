/**
 * What "wrong" means for the two whole-document entry points: answering the
 * same text differently.
 *
 * `parseDocument` and `evaluateDocument` are each one call over a whole text,
 * and each is the document's answer as that entry point gives it, so they are
 * compared as they are called: one call each, on a fresh engine each. The
 * settled-pass discipline the document oracle needs (it compares a session that
 * has run many passes against a fresh one) does not arise, because neither side
 * here has a history: both are one pass, which is the same number (#688).
 *
 * The comparison reads what a host reads: how many lines came back, and for
 * each line the text of its error or its formatted answer. Where a failure is
 * carried is not compared. The batch pass reports a line that failed to parse in
 * `line.error` and the incremental pass as an error value in `line.result`, a
 * known difference of shape that the 3.0 plan's single line-error type removes;
 * comparing it would report every failing line, and hide the disagreements this
 * exists to find. The error's text is compared, so a different message is still
 * found.
 *
 * @module CrossPathOracle
 */

import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsedLine, ParsingResult } from "@solve-js/types/ParsingResult";
import type { CrossPathCase, Outcome } from "@tools/fuzz/FuzzCase";

/** A document case costs two engine constructions; the same slow threshold the document generator uses is far past that. */
const CROSS_PATH_SLOW_MS = 2000;

/** The line separator a document is joined on. Written this way so no editor strips it. */
const NEWLINE = String.fromCharCode(10);

/**
 * One line as a host reads it: its error's text, or its formatted answer, or
 * nothing.
 *
 * @param line - A line of either pass's result.
 * @returns A comparable string.
 */
export function lineAnswer(line: ParsedLine): string {
	if (line.error) return `error: ${line.error}`;
	const result = line.result;
	if (!result) return "";
	if (result.type === ValueType.Error) return `error: ${typeof result.unit === "string" ? result.unit : String(result.value)}`;
	return formatValue(result).replace(/^=\s*/, "");
}

/** Where the two passes first differ. */
export interface CrossPathDisagreement {
	/** The 1-based line, or 0 when the two passes returned different line counts. */
	line: number;
	/** What `parseDocument` says. */
	batch: string;
	/** What `evaluateDocument` says. */
	incremental: string;
}

/**
 * Compare the two passes' results, line for line.
 *
 * @param batch - `parseDocument`'s result.
 * @param incremental - `evaluateDocument`'s result.
 * @returns The first disagreement, or null when they agree.
 */
export function compareResults(batch: ParsingResult, incremental: ParsingResult): CrossPathDisagreement | null {
	if (batch.lines.length !== incremental.lines.length) {
		return { line: 0, batch: `${batch.lines.length} lines`, incremental: `${incremental.lines.length} lines` };
	}
	for (let i = 0; i < batch.lines.length; i++) {
		const a = lineAnswer(batch.lines[i]);
		const b = lineAnswer(incremental.lines[i]);
		if (a !== b) return { line: i + 1, batch: a, incremental: b };
	}
	return null;
}

/**
 * Run one text through both entry points and classify what happened.
 *
 * A throw from either is a finding and reported as one: both are public entry
 * points a host calls with no catch around them.
 *
 * @param crossPathCase - The document.
 * @param options - The slow threshold.
 * @returns What happened.
 */
export function runCrossPathCase(crossPathCase: CrossPathCase, options: { slowMs?: number } = {}): Outcome {
	const text = crossPathCase.lines.join(NEWLINE);
	const started = performance.now();
	const batchEngine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const incrementalEngine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	let disagreement: CrossPathDisagreement | null;
	try {
		const batch = batchEngine.parseDocument(text, { inputType: "markdown" });
		const incremental = evaluateDocument(incrementalEngine, text, { inputType: "markdown" });
		disagreement = compareResults(batch, incremental);
	} catch (thrown) {
		const elapsedMs = performance.now() - started;
		const name = thrown instanceof Error ? thrown.constructor.name : typeof thrown;
		const message = thrown instanceof Error ? thrown.message : String(thrown);
		return { kind: "throw", elapsedMs, thrownName: name, detail: `a whole-document pass threw ${name}: ${message}` };
	} finally {
		batchEngine.clear();
		incrementalEngine.clear();
	}

	const elapsedMs = performance.now() - started;
	if (disagreement) {
		const where = disagreement.line === 0 ? "the line count" : `line ${disagreement.line}`;
		return {
			kind: "disagreement",
			elapsedMs,
			detail: `${where}: parseDocument says ${JSON.stringify(disagreement.batch)}, evaluateDocument says ${JSON.stringify(disagreement.incremental)}`,
		};
	}
	const slowMs = options.slowMs ?? CROSS_PATH_SLOW_MS;
	if (slowMs > 0 && elapsedMs > slowMs) {
		return { kind: "slow", elapsedMs, detail: `the two passes took ${elapsedMs.toFixed(0)}ms` };
	}
	return { kind: "ok", elapsedMs, detail: "both passes gave every line the same answer" };
}
