/**
 * Reading another line's answer: the checks every cross-line form shares, and
 * `ans`, which reads the line above under the name other calculators give it.
 *
 * Here rather than in the lines package because the VM reads `ans` too, where
 * an undefined name is reported, and the VM does not import package code.
 *
 * @module LineReads
 */

import { Value, ValueType, errorValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";

/**
 * Why a line's answer cannot be read, or null when it can.
 *
 * @param v - The line's cached answer, undefined when it has none yet.
 * @param lineNumber - The line, for the message.
 * @returns An error value, or null.
 */
export function lineValueProblem(v: Value | undefined, lineNumber: number): Value | null {
	if (v === undefined) {
		return errorValue("LINE_NOT_YET_EVALUATED", `Line ${lineNumber} has not been evaluated yet (forward reference, or out of range)`);
	}
	if (v.type === ValueType.Pending) {
		return errorValue("LINE_RESULT_PENDING", `Line ${lineNumber}'s result is still resolving`);
	}
	if (v.type === ValueType.Error) {
		return errorValue("LINE_RESULT_ERROR", `Line ${lineNumber} has an error`);
	}
	return null;
}

/**
 * The refusal a cross-line form gives outside a document, or null inside one.
 *
 * @param context - The line's execution context, if any.
 * @returns An error value, or null.
 */
export function noDocument(context: LineExecutionContext | undefined): Value | null {
	if (!context?.getLineResult) {
		return errorValue("LINE_REF_NO_DOCUMENT", "Cross-line references require a real document — not available outside one (e.g. evaluateExpression()'s single-expression path)");
	}
	return null;
}

/** The name Numi, Numbr and SpeedCrunch give the previous answer (#668). */
export const ANSWER_NAME = "ans";

/** π, the constant a formula writes, when nothing in the note is named π (#669). */
export const PI_NAME = "\u03C0";

/**
 * The line above's answer, as `prev` reads it: what `ans` means when no
 * variable of that name is defined (#668).
 *
 * @param context - The line's execution context, if any.
 * @returns The answer, or the error `prev` gives in the same place.
 */
export function previousLineAnswer(context: LineExecutionContext | undefined): Value {
	const missing = noDocument(context);
	if (missing) return missing;
	const target = context!.lineIndex - 1;
	const v = context!.getLineResult!(target);
	return lineValueProblem(v, target) ?? v!;
}
