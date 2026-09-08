/**
 * What "wrong" means for an editing session.
 *
 * The other oracle asks whether the engine survived. This one asks whether it
 * was right, and it can only ask that because there is something to be right
 * against: a pass over the finished text, with no editing history behind it, is
 * the answer the document has. Anything a host does to reach that same text has
 * to agree with it, line for line.
 *
 * Two things about the comparison are load-bearing, and both were learned by
 * getting them wrong first.
 *
 * The oracle has to be **settled**. A whole-document feature can need more than
 * one pass to reach its answer (a total reads lines that are themselves still
 * being computed), so a single pass is not the document's answer, it is the
 * document's answer so far. Comparing against one reported sixty disagreements
 * that were nothing but the oracle being read too early.
 *
 * Both sides need the **same number** of passes. Give the editor one and the
 * oracle three and the run stops measuring correctness and starts measuring
 * which of them converges faster, which is a different question and not one
 * with a right answer.
 *
 * @module DocumentOracle
 */

import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { DocumentCase, EditAction, Outcome } from "@tools/fuzz/FuzzCase";

/**
 * How many passes each side gets before its answers are read.
 *
 * Three, because the longest settling chain the generated shapes can build is
 * two hops (a definition removed, the name forgotten at the end of that pass,
 * the reader re-run on the next), and one spare pass costs almost nothing while
 * a run that is one short reports the engine's convergence as a bug.
 */
const PASSES = 3;

/** The line separator a document is joined on. Written this way so no editor strips it. */
const NEWLINE = String.fromCharCode(10);

/** One line's answer, formatted the way a host displays it. */
function shown(document: DocumentModel, lineNumber: number): string {
	const result = document.getLineAt(lineNumber)?.result;
	return result ? formatValue(result).replace(/^=\s*/, "") : "";
}

/** Every line's answer, in order. */
function answers(document: DocumentModel, count: number): string[] {
	const out: string[] = [];
	for (let n = 1; n <= count; n++) out.push(shown(document, n));
	return out;
}

/**
 * What the document says, asked with no history.
 *
 * A fresh engine each time rather than a cleared one. `clear()` is trusted
 * elsewhere in this fuzzer and is almost certainly complete, but "almost
 * certainly" is not a property an oracle can have: an incomplete reset would
 * show up as the engine disagreeing with itself, which is exactly the finding
 * this module reports, and the run would spend its time on the fuzzer's bug
 * rather than the engine's. Construction is the dominant cost of a document
 * case because of it, and that is the right trade.
 *
 * Retired with {@link ThreeTierEvaluator.terminateWorker} when it is done,
 * which is the disposal every host is expected to call and the one thing a
 * throwaway evaluator is easy to forget. An evaluator subscribes to the shared
 * global-variable store, and that store is module-level, so one that is never
 * retired keeps itself, its document and its engine alive for the life of the
 * process: 263KB each, and this builds one per action per case. The first
 * version of this ran out of a 256MB heap because of it.
 *
 * @param lines - The document text, one entry per line.
 * @returns One answer per line.
 */
function settled(lines: string[]): string[] {
	const document = new DocumentModel();
	document.setDocument(lines.join(NEWLINE));
	const evaluator = new ThreeTierEvaluator(document, new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
	try {
		for (let pass = 0; pass < PASSES; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
		return answers(document, lines.length);
	} finally {
		evaluator.terminateWorker();
	}
}

/** Where a session and a settled pass first differ. */
interface Disagreement {
	/** The 1-based line. */
	line: number;
	/** What a settled pass over the same text says. */
	expected: string;
	/** What the edited document says. */
	got: string;
	/** The action that produced it, described for the report. */
	after: string;
	/** The text both sides were asked about. */
	lines: string[];
}

/** One action, in the form a report can print. */
export function describeAction(action: EditAction): string {
	if (action.kind === "view") return `view(${action.at}-${action.end ?? action.at})`;
	if (action.kind === "delete") return `delete(${action.at})`;
	return `${action.kind}(${action.at}, ${JSON.stringify(action.text ?? "")})`;
}

/**
 * Replay an editing session and compare it against the text it produced.
 *
 * Actions are clamped here rather than by the generator, so a seed means the
 * same session whatever the engine does with it: an action past the end of a
 * document that turned out shorter is skipped, not renumbered.
 *
 * The comparison happens after **every** action rather than once at the end.
 * The end state is what a user sees, but the action that broke it is what a
 * reader needs, and a session that recovers on a later action would otherwise
 * report nothing at all.
 *
 * @param documentCase - The starting text and the actions.
 * @returns The first disagreement, or `null` when every line agreed throughout.
 */
export function replayDocumentCase(documentCase: DocumentCase): Disagreement | null {
	const lines = [...documentCase.lines];
	if (lines.length === 0) return null;

	const document = new DocumentModel();
	document.setDocument(lines.join(NEWLINE));
	const evaluator = new ThreeTierEvaluator(document, new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
	try {
		return replayWith(documentCase, document, evaluator, lines);
	} finally {
		// The same disposal {@link settled} explains. This one is per case
		// rather than per action, but a soak runs thousands of cases in one
		// process and they add up just as surely.
		evaluator.terminateWorker();
	}
}

/** The session itself, once the evaluator is owned by a caller that retires it. */
function replayWith(
	documentCase: DocumentCase,
	document: DocumentModel,
	evaluator: ThreeTierEvaluator,
	lines: string[],
): Disagreement | null {
	evaluator.evaluate({ startLine: 1, endLine: lines.length });

	for (const action of documentCase.actions) {
		if (lines.length === 0) return null;
		if (action.kind === "edit") {
			if (action.at > lines.length) continue;
			document.editLine(action.at, action.text ?? "");
			lines[action.at - 1] = action.text ?? "";
		} else if (action.kind === "insert") {
			if (action.at > lines.length + 1) continue;
			evaluator.applyTransaction([{ startLine: action.at, deleteCount: 0, insertLines: [action.text ?? ""] }]);
			lines.splice(action.at - 1, 0, action.text ?? "");
		} else if (action.kind === "delete") {
			// Never below two lines. A one-line document is a different feature
			// with its own tests, and shrinking towards it would turn every
			// finding into the same uninformative case.
			if (action.at > lines.length || lines.length <= 2) continue;
			evaluator.applyTransaction([{ startLine: action.at, deleteCount: 1, insertLines: [] }]);
			lines.splice(action.at - 1, 1);
		} else {
			if (action.at > lines.length) continue;
			const end = Math.max(action.at, Math.min(lines.length, action.end ?? action.at));
			evaluator.setViewport({ startLine: action.at, endLine: end });
		}

		for (let pass = 0; pass < PASSES; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });

		const expected = settled(lines);
		const got = answers(document, lines.length);
		for (let i = 0; i < expected.length; i++) {
			if (expected[i] === got[i]) continue;
			return {
				line: i + 1,
				expected: expected[i],
				got: got[i],
				after: describeAction(action),
				lines: [...lines],
			};
		}
	}

	return null;
}

/**
 * Run one document case and classify what happened.
 *
 * A throw is still a finding here, and still reported as one: the incremental
 * path is driven by hosts that have no catch around it, so an exception from an
 * ordinary sequence of edits is worse than a wrong answer, not better.
 *
 * @param documentCase - The session to replay.
 * @param options - The slow threshold. A document case is expensive by nature,
 * so the caller is expected to hand it a budget of its own rather than the one
 * a single expression is judged against.
 * @returns What the session did.
 */
export function runDocumentCase(documentCase: DocumentCase, options: { slowMs?: number } = {}): Outcome {
	const started = performance.now();
	let disagreement: Disagreement | null;
	try {
		disagreement = replayDocumentCase(documentCase);
	} catch (thrown) {
		const elapsedMs = performance.now() - started;
		const name = thrown instanceof Error ? thrown.constructor.name : typeof thrown;
		const message = thrown instanceof Error ? thrown.message : String(thrown);
		return { kind: "throw", elapsedMs, thrownName: name, detail: `editing session threw ${name}: ${message}` };
	}

	const elapsedMs = performance.now() - started;
	if (disagreement) {
		return {
			kind: "disagreement",
			elapsedMs,
			detail:
				`line ${disagreement.line} after ${disagreement.after}: ` +
				`a settled pass says ${JSON.stringify(disagreement.expected)}, ` +
				`the edited document says ${JSON.stringify(disagreement.got)}`,
		};
	}

	const slowMs = options.slowMs ?? 0;
	if (slowMs > 0 && elapsedMs > slowMs) {
		return { kind: "slow", elapsedMs, detail: `editing session took ${elapsedMs.toFixed(0)}ms` };
	}
	return { kind: "ok", elapsedMs, detail: "every line agreed with a settled pass" };
}
