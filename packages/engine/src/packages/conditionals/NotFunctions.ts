/**
 * The work behind `not` and a prefix `!` (#751): the logical negation of a
 * true-or-false value.
 *
 * Negation is defined for a boolean, and for a list of them cell by cell (`not
 * ([1, 2] > 1)` is `[true, false]`). A number is not read as zero or as a
 * bit pattern (`~` is the bit complement), and text, a date or an amount has no
 * truth of its own, so each of those is refused by name rather than answered.
 */

import { Value, ValueType, boolValue, errorValue, matrixValue, type MatrixData } from "@solve-js/vm/Value";
import { isListOfAnswers } from "@solve-js/vm/ListComparison";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ConditionalsErrorCodes } from "./ConditionalsErrorCodes";

/** The longest a refused value is quoted at, so a long text or list does not flood the message. */
const MOST_QUOTED = 40;

/**
 * What kind of value a refused operand is, in the reader's words.
 *
 * @param value - The operand negation was asked of.
 * @returns A short noun phrase such as "a number" or "text".
 */
export function kindOfOperand(value: Value): string {
	switch (value.type) {
		case ValueType.Number:
		case ValueType.Hex:
		case ValueType.BigInt:
			return "a number";
		case ValueType.Percentage:
			return "a percentage";
		case ValueType.Uom:
			return "an amount";
		case ValueType.String:
			return "text";
		case ValueType.Datetime:
			return "a date";
		case ValueType.Matrix:
			return "a list";
		case ValueType.Range:
			return "a range";
		case ValueType.Symbolic:
			return "a formula";
		default:
			return "another kind of value";
	}
}

/**
 * `logicalNot(value, spelling)`: true for false and false for true.
 *
 * @param args - The operand, then the spelling the reader used (`not` or `!`),
 * which the refusal quotes.
 * @returns A boolean, a list of them for a list of answers, or a `NOT_NEEDS_BOOLEAN` error naming what the operand is.
 */
export function logicalNot(args: Value[]): Value {
	const operand = args[0];
	const spelling = args[1]?.type === ValueType.String ? String(args[1].value) : "not";
	if (operand === undefined) {
		return errorValue(ConditionalsErrorCodes.NOT_NEEDS_BOOLEAN, `"${spelling}" needs a true or false value after it, as in not (5 > 3).`);
	}
	if (operand.type === ValueType.Boolean) return boolValue(operand.value !== true);
	// A list of answers, as a comparison of a list gives, is negated cell by
	// cell, as `and` and `or` join it (see vm/ListComparison.ts).
	if (isListOfAnswers(operand)) {
		const m = operand.value as MatrixData;
		return matrixValue(m.rows, m.cols, m.data.map((cell) => cell !== true));
	}
	const shown = formatValue(operand).replace(/^=\s*/, "");
	const quoted = shown.length > MOST_QUOTED ? `${shown.slice(0, MOST_QUOTED)}...` : shown;
	return errorValue(
		ConditionalsErrorCodes.NOT_NEEDS_BOOLEAN,
		`"${spelling}" works on true or false, and ${quoted} is ${kindOfOperand(operand)}: compare it first, as in not (x > 3).`,
	);
}
