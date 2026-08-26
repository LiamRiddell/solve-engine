/**
 * Whole-document evaluation through the incremental engine.
 *
 * The engine has two ways to read a document, and they are not interchangeable.
 * {@link ExpressionEngine.parseDocument} is the light batch pass: it scans the
 * text, reads earlier lines' results, and skips markdown, which is everything
 * line references, category tags and table columns need. What it has no way to
 * do is re-run an earlier line with a variable bound to a trial value, which is
 * exactly what goal seek (`solve line N for x = target`) is, so goal seek comes
 * back as a `GOAL_SEEK_NO_DOCUMENT` error through `parseDocument`.
 *
 * The re-run primitive lives on the incremental `DocumentModel` +
 * `ThreeTierEvaluator` path (a live editor drives it on every keystroke). This
 * helper stands that path up for a single pass and hands back the familiar
 * {@link ParsingResult}, so a caller reads the answers exactly as it would from
 * `parseDocument`, goal seek included. A documentation notepad that wants goal
 * seek to resolve, and the tests that prove those examples, both go through
 * here.
 *
 * Two boundaries, each deliberate:
 *
 * - It builds a fresh model and evaluator per call and disposes the evaluator
 *   before returning, which suits occasional evaluation, not the keystroke loop
 *   a real editor runs against one long-lived `ThreeTierEvaluator`.
 * - Unlike `parseDocument`, it does not classify a markdown table's own rows as
 *   skippable: they reach the evaluator as expressions and error. A document
 *   that mixes a raw table with goal seek is the one case that wants both paths,
 *   the table read through `parseDocument` and the goal seek through here.
 */
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { findInlineSolvesInLine } from "@solve-js/engine/ExpressionEngineSafety";
import { Value, ValueType } from "@solve-js/vm/Value";
import type {
	ParsedLine,
	ParsingResult,
	UnifiedParsingOptions,
	InlineSolvePosition,
} from "@solve-js/types/ParsingResult";

/** Read the human-readable message off an error Value (`unit` holds it, `value` holds the code). */
function errorMessageOf(value: Value): string {
	return typeof value.unit === "string" ? value.unit : String(value.value);
}

/**
 * Evaluate a whole document with full cross-line context, including the line
 * re-runs goal seek needs, and return per-line results in the same shape
 * {@link ExpressionEngine.parseDocument} produces.
 *
 * @param engine - The engine to borrow for the pass. Its current document model
 * (if any) is restored before returning.
 * @param input - The document text, newline-separated.
 * @param options - Parsing options, matching `parseDocument`. Only `inputType`
 * is consulted; it defaults to `markdown`.
 */
export function evaluateDocument(
	engine: ExpressionEngine,
	input: string,
	_options: UnifiedParsingOptions = { inputType: "markdown" },
): ParsingResult {
	const previousDocumentModel = engine.getDocumentModel();

	const doc = new DocumentModel();
	doc.setDocument(input);
	// The constructor wires the model onto the engine (engine.setDocumentModel),
	// which is what makeLineContext reads to expose the re-run primitive.
	const evaluator = new ThreeTierEvaluator(doc, engine);

	try {
		const lineCount = doc.lineCount;
		evaluator.evaluate({ startLine: 1, endLine: lineCount });

		const lines: ParsedLine[] = [];
		const errors: string[] = [];
		// Document character offsets are not carried on the line model, so they
		// are accumulated here to keep startPosition/endPosition faithful to
		// parseDocument's, one newline between lines.
		let offset = 0;

		for (let n = 1; n <= lineCount; n++) {
			const state = doc.getLineAt(n)!;
			const text = state.text;
			const startPosition = offset;
			const endPosition = offset + text.length;
			offset = endPosition + 1; // + the newline that separated this line from the next

			const hasInlineSolves = state.inlineSolveCount > 0;
			let inlineSolves: InlineSolvePosition[] = [];
			let expression: string | null = null;
			let result: Value | null = null;

			if (state.isEmpty) {
				// Prose, a heading, or a blank line: nothing to report.
			} else if (hasInlineSolves) {
				// Zip the located spans against the line's per-expression results,
				// which the model holds in the same left-to-right order.
				inlineSolves = findInlineSolvesInLine(text, n).map((span, i) => {
					const value = state.results[i]?.[0] ?? null;
					if (value && value.type === ValueType.Error) {
						const message = errorMessageOf(value);
						errors.push(`Line ${n}: ${message}`);
						return { ...span, result: null, error: message };
					}
					return { ...span, result: value, error: null };
				});
			} else {
				expression = state.expressions[0] ?? null;
				// A returned error (goal seek with no document, a faulted
				// conversion) stays in `result` as an error-typed Value, exactly
				// as parseDocument leaves it, so both document passes report a
				// line the same way and a caller can compare them value for
				// value. It is also gathered into `errors` for a flat list.
				result = state.result ?? null;
				if (result && result.type === ValueType.Error) {
					errors.push(`Line ${n}: ${errorMessageOf(result)}`);
				}
			}

			lines.push({
				lineNumber: n,
				text,
				startPosition,
				endPosition,
				isEmpty: state.isEmpty,
				hasInlineSolves,
				inlineSolves,
				expression,
				// Always null: the incremental pass stores a line's failure as an
				// error-typed Value in `result` (above), never as a thrown error
				// the way parseDocument sets this field. Kept for shape parity.
				error: null,
				result,
			});
		}

		return { lines, totalLines: lineCount, errors };
	} finally {
		// Drop this pass's evaluator (unsubscribes it from the shared global
		// store) and put back whatever document the host had wired, so borrowing
		// the engine for one pass leaves nothing behind.
		evaluator.terminateWorker();
		engine.setDocumentModel(previousDocumentModel);
	}
}
