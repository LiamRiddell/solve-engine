/**
 * A list given to a builtin that takes one number: worked out for each number,
 * or refused by name.
 *
 * A list is a matrix, and a matrix reads as 0 wherever one number is asked of
 * it (see `Value.toNumber`), so every one-number builtin answered a list with
 * the answer for 0: `sqrt([4, 9])` was 0, `cos([0, 1])` was 1 and
 * `fact([3, 4])` was 1. A function of one number that has an answer for each
 * number (`sqrt`, `sin`, `ln`, `fact`) is worked out for each cell, the way
 * element-wise arithmetic and the rounding family already treat a list; any
 * other builtin that reads its arguments as single numbers (`gcd`, `root`,
 * `atan2`, `isprime`) refuses a list by name and points at `map`.
 */

import { Value, ValueType, errorValue, matrixValue, numberValue, uomValue, type MatrixData } from "@solve-js/vm/Value";
import { cellDecimal, isManyCellList } from "@solve-js/vm/ListRounding";
import { numberText } from "@solve-js/utilities/Number";

/**
 * How a message names a builtin: its name when the reader calls it by name,
 * or the words for one reached through a phrase.
 *
 * @param name - The builtin's name, or "" when the reader never types it.
 */
function subject(name: string): string {
	return name === "" ? "This calculation" : name;
}

/**
 * A list with `applyCell` worked out for each of its cells, in the list's
 * shape; or null when `source` is not a list of several cells, for the caller
 * to work out as one number.
 *
 * Each cell is handed to `applyCell` as the number or quantity it stands for,
 * with its exact decimal (see `cellDecimal`), so a cell is worked out as the
 * same number on its own line would be. The answers share one unit, the one
 * the first answer carries (`sqrt([4 m2, 9 m2])` is in m). Refused by name,
 * rather than answered around it, when a cell is not a number (a true or
 * false, a formula with an unknown), when a cell's answer is not one real
 * number or quantity (`sqrt(-9)` is `3i`, which a list cannot hold), and when
 * the answers come in different units. A cell's own refusal (`ln(0)`) is
 * passed on as it is.
 *
 * @param source - The value the builtin was given.
 * @param name - The builtin's name for a message, or "" when it is reached by a phrase.
 * @param applyCell - Works out one cell.
 * @returns The list of answers, the refusal, or null.
 */
export function applyEachCell(source: Value, name: string, applyCell: (cell: Value) => Value): Value | null {
	if (!isManyCellList(source)) return null;
	return eachCellOf(source.value as MatrixData, name, applyCell);
}

/**
 * Every cell of a list, of any size, worked out by `applyCell`, in the list's
 * shape: the walk {@link applyEachCell} makes once it has a list of several
 * cells, with the same refusals. Arithmetic calls it directly, since a list of
 * one cell is still a list there (`[100] + 10%` is `[110]`).
 *
 * @param m - The list.
 * @param name - What a refusal calls the calculation, or "" for words of its own.
 * @param applyCell - Works out one cell.
 * @returns The list of answers, or the refusal.
 */
export function eachCellOf(m: MatrixData, name: string, applyCell: (cell: Value) => Value): Value {
	const data: number[] = [];
	let unit: string | undefined;
	for (let k = 0; k < m.data.length; k++) {
		const entry = m.data[k];
		if (typeof entry !== "number") {
			return errorValue(
				"LIST_CELL_UNSUPPORTED",
				`${subject(name)} works on a list only when every cell is a number: this one holds ${typeof entry === "boolean" ? "a true or false" : "a formula with an unknown in it"}.`,
			);
		}
		const cell = m.unit === undefined ? numberValue(entry) : uomValue(entry, m.unit);
		const exact = cellDecimal(entry);
		if (exact !== undefined) cell.exact = exact;
		const answer = applyCell(cell);
		if (answer.type === ValueType.Error) return answer;
		const answerUnit = answer.type === ValueType.Uom ? answer.unit : undefined;
		if (answer.type !== ValueType.Number && answer.type !== ValueType.Uom) {
			const shown = `${numberText(entry)}${m.unit === undefined ? "" : ` ${m.unit}`}`;
			return errorValue(
				"LIST_CELL_UNSUPPORTED",
				`${subject(name)} of ${shown} in this list has no real answer, and a list holds real numbers. Work that number out on its own line.`,
			);
		}
		if (k === 0) unit = answerUnit;
		else if (answerUnit !== unit) {
			return errorValue("LIST_CELL_UNSUPPORTED", `${subject(name)} gives this list's numbers answers in different units, and a list carries one unit.`);
		}
		data.push(answer.toNumber());
	}
	return matrixValue(m.rows, m.cols, data, unit);
}

/**
 * The refusal for a builtin that reads each argument as one number when an
 * argument is a list of several cells, or null when none is.
 *
 * @param name - The builtin's name for the message, or "" when it is reached by a phrase.
 * @param args - Its arguments.
 * @returns The `LIST_ARGUMENT_UNSUPPORTED` refusal, or null.
 */
export function listArgumentRefused(name: string, args: readonly Value[]): Value | null {
	if (!args.some(isManyCellList)) return null;
	return errorValue(
		"LIST_ARGUMENT_UNSUPPORTED",
		`${subject(name)} takes numbers, not a list: a list holds several numbers, and ${name === "" ? "it" : name} works on one at a time. To work it out for each number, use map, with x standing for each one.`,
	);
}
