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
		return errorValue("LINE_REF_NO_DOCUMENT", "A line reference needs a document to read, and an expression evaluated on its own has none");
	}
	return null;
}

/** The name Numi, Numbr and SpeedCrunch give the previous answer (#668). */
export const ANSWER_NAME = "ans";

/** π, the constant a formula writes, when nothing in the note is named π (#669). */
export const PI_NAME = "\u03C0";

/**
 * Whether a name that holds no value still reads as one: `π` as the constant
 * and `ans` as the line above. Such a name is not an unknown, under the arrow or
 * in an equation, so `π km =>` is 3.14 km and `2x = π` is solved for `x` alone.
 * A note that gives either name a value of its own is read with that value, so
 * callers ask this only of a name with none.
 *
 * @param name - A variable name.
 * @returns True for `π` and `ans`.
 */
export function readsWithoutValue(name: string): boolean {
	return name === ANSWER_NAME || name === PI_NAME;
}

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
