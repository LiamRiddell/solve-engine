/**
 * The per-pass work budget (#711): one count, in line runs, of the work a pass
 * over a document does across its lines.
 *
 * Every other limit counts work inside one expression, and the forms that
 * reach across lines were capped one line at a time: a sweep at 100,000 line
 * re-runs, goal seek at its probes, a span aggregate not at all. Twenty sweep
 * lines each inside their own cap made one pass re-run 2,000,000 lines. The
 * engine keeps the count for the pass (see
 * `LineExecutionContext.spendWork`), and the form whose work would cross
 * `config.vm.maxLineRunsPerPass` is refused by name while the lines above it
 * keep their answers.
 */

import type { LineExecutionContext } from "@solve-js/vm/VM";
import { errorValue, ValueType, type MatrixData, type Value } from "@solve-js/vm/Value";

/**
 * How many lines a span aggregate reads for the cost of one line run.
 *
 * Measured on Node 24: a sweep re-runs a line in about 5.2 µs, and `total above`
 * reads one in about 0.3 µs, so sixteen reads cost about what one re-run does.
 * A span is charged its reads at that rate, so a ledger with a total after each
 * of 2,000 entries spends about 250,000 of the default budget.
 */
export const SPAN_READS_PER_LINE_RUN = 16;

/** The code a pass's refusal carries. */
export const PASS_WORK_BUDGET_EXCEEDED = "PASS_WORK_BUDGET_EXCEEDED";

/**
 * The refusal for work that would take a pass past its budget.
 *
 * @param form - What would have done the work, as the start of a sentence ("This sweep").
 * @param limit - The budget, `config.vm.maxLineRunsPerPass`.
 */
export function passWorkRefusal(form: string, limit: number): Value {
	return errorValue(
		PASS_WORK_BUDGET_EXCEEDED,
		`${form} would take this pass over the note past ${limit.toLocaleString("en-US")} line runs, the most one pass does (vm.maxLineRunsPerPass), so it is not worked out. The lines above keep their answers; raise the setting or split the note to go further.`,
	);
}

/** The code the refusal of a line whose answer the document cannot keep carries. */
export const DOCUMENT_ELEMENT_LIMIT_EXCEEDED = "DOCUMENT_ELEMENT_LIMIT_EXCEEDED";

/** Characters of text that count as one kept element. */
export const TEXT_CHARACTERS_PER_ELEMENT = 8;

/**
 * The elements a document keeps for an answer (#694): a list or matrix its
 * cells, text one to {@link TEXT_CHARACTERS_PER_ELEMENT} characters, and any
 * other answer one.
 *
 * @param value - A line's answer.
 */
export function keptElements(value: Value): number {
	if (value.type === ValueType.Matrix) {
		const m = value.value as MatrixData;
		return Math.max(1, m.rows * m.cols);
	}
	if (value.type === ValueType.String) return Math.max(1, Math.ceil(String(value.value).length / TEXT_CHARACTERS_PER_ELEMENT));
	return 1;
}

/**
 * The refusal for a line whose answer would take what the document keeps past
 * its ceiling.
 *
 * @param lineNumber - The line refused.
 * @param size - Its answer's elements, from {@link keptElements}.
 * @param limit - The ceiling, `config.vm.maxRetainedElements`.
 */
export function keptElementsRefusal(lineNumber: number, size: number, limit: number): Value {
	return errorValue(
		DOCUMENT_ELEMENT_LIMIT_EXCEEDED,
		`Line ${lineNumber}'s answer holds ${size.toLocaleString("en-US")} elements, which would take what this note keeps past ${limit.toLocaleString("en-US")}, the most one note keeps (vm.maxRetainedElements), so it is not kept. The lines above keep their answers; raise the setting or split the note to go further.`,
	);
}

/**
 * Charge the lines a span aggregate reads to the pass, at
 * {@link SPAN_READS_PER_LINE_RUN} reads to a line run.
 *
 * @param context - The asking line's context; without a document nothing is charged.
 * @param reads - The lines the form reads.
 * @param form - What reads them, for the refusal.
 * @returns The refusal when the reads would cross the budget, or null.
 */
export function spendSpanReads(context: LineExecutionContext, reads: number, form: string): Value | null {
	if (!(reads > 0)) return null;
	return context.spendWork?.(reads / SPAN_READS_PER_LINE_RUN, form) ?? null;
}
