/**
 * A list compared with one value: one answer per cell, the way two lists of
 * one shape are compared.
 *
 * `[100, 200] > 150` asks the question of each number, so it is
 * `[false, true]`, as `[100, 200] > [150, 150]` is. A list in a comparison
 * used to be read as the one number a list gives where one number is asked of
 * it (0), so `[100, 200] < 5` answered true and `[100, 200] > 5` false: a
 * single, confident and wrong answer about every cell at once. Each cell now
 * meets the other side as the number or quantity it stands for, through the
 * rule one number follows, so a cell agrees with the same comparison on its own
 * line (`[1 km, 2 km] > 1500 m` is `[false, true]`, and a length beside a mass
 * is refused as it is for one length). Lists of answers join with `and` and
 * `or` cell by cell too (see {@link answersCellByCell}).
 *
 * The boundary: a list of answers is not one answer, so where one true or
 * false is needed (the condition of an `if`) a list is refused by name rather
 * than read as one; see {@link listConditionRefused}. Two lists of different
 * shapes are refused as before.
 *
 * @module ListComparison
 */

import { Value, ValueType, errorValue, matrixValue, numberValue, uomValue, type MatrixData, type MatrixEntry } from "@solve-js/vm/Value";
import { listCellValue } from "@solve-js/vm/MatrixUnits";
import { sameShape } from "@solve-js/vm/MatrixOps";

/** One cell meeting the other side, with the operands in the order the reader wrote them: a true or false, or the refusal. */
export type CellComparison = (left: Value, right: Value) => Value;

/**
 * One value read at the precision a list cell is held at, for comparing with
 * the cells.
 *
 * A list cell is a double, so `[1/3]` holds the double nearest a third. A lone
 * `1/3` keeps its exact fraction, and comparing the double with it found them
 * unequal, though the reader wrote the same thing twice and `[1/3] == [1/3]`
 * is true. Dropping the exact fraction or decimal from the one value compares
 * like with like, as two lists are compared. Any other value is returned as
 * it is.
 *
 * @param one - The value on the side that is not a list.
 * @returns The value as a double (in its unit), or `one` itself.
 */
export function atListPrecision(one: Value): Value {
	if (one.rational === undefined && one.exact === undefined) return one;
	if (one.type === ValueType.Number) return numberValue(one.toNumber());
	if (one.type === ValueType.Uom && one.unit !== undefined) return uomValue(one.toNumber(), one.unit);
	return one;
}

/**
 * A list on exactly one side of a comparison, worked out cell by cell; or null
 * when neither side is a list or both are, for the caller's own reading.
 *
 * Each cell is handed to `compareCell` as the number or quantity it stands
 * for (in the list's unit when it has one), a true or false as itself, and the
 * one value at the precision a cell is held at (see {@link atListPrecision}),
 * so the answer for a cell is the answer the same comparison gives on its own
 * line. The answers keep the list's shape. The first refusal a cell gives (two
 * units that share no measure, a colour) refuses the whole list, as one bad
 * cell always has.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param compareCell - The comparison of one cell with the other side.
 * @returns A list of true and false, the refusal, or null.
 */
export function listAgainstOne(l: Value, r: Value, compareCell: CellComparison): Value | null {
	const listLeft = l.type === ValueType.Matrix;
	if (listLeft === (r.type === ValueType.Matrix)) return null;
	const list = (listLeft ? l.value : r.value) as MatrixData;
	const one = atListPrecision(listLeft ? r : l);
	const answers: MatrixEntry[] = new Array<MatrixEntry>(list.data.length);
	for (let i = 0; i < list.data.length; i++) {
		const cell = listCellValue(list, list.data[i]);
		const answer = listLeft ? compareCell(cell, one) : compareCell(one, cell);
		if (answer.type !== ValueType.Boolean) return answer;
		answers[i] = answer.value === true;
	}
	return matrixValue(list.rows, list.cols, answers);
}

/**
 * Two operands joined cell by cell where either is a list: a list beside one
 * value as {@link listAgainstOne} reads it, and two lists of one shape cell
 * with cell. It is how `and` and `or` join lists of answers, so
 * `([1, 2] > 1) and ([1, 2] > 0)` is `[false, true]`. Null when neither side
 * is a list.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param rule - One pair of cells to one true or false, or the refusal.
 * @returns A list of true and false, the refusal, or null.
 */
export function answersCellByCell(l: Value, r: Value, rule: CellComparison): Value | null {
	if (l.type !== ValueType.Matrix || r.type !== ValueType.Matrix) return listAgainstOne(l, r, rule);
	const lm = l.value as MatrixData;
	const rm = r.value as MatrixData;
	if (!sameShape(lm, rm)) {
		return errorValue("DIMENSION_MISMATCH", `Cannot compare matrices of different shapes: ${lm.rows}x${lm.cols} and ${rm.rows}x${rm.cols}`);
	}
	const answers: MatrixEntry[] = new Array<MatrixEntry>(lm.data.length);
	for (let i = 0; i < lm.data.length; i++) {
		const answer = rule(listCellValue(lm, lm.data[i]), listCellValue(rm, rm.data[i]));
		if (answer.type !== ValueType.Boolean) return answer;
		answers[i] = answer.value === true;
	}
	return matrixValue(lm.rows, lm.cols, answers);
}

/**
 * Whether a value is a list of answers: a list with at least one cell, every
 * cell a true or false, as a comparison of a list gives.
 *
 * @param value - Any value.
 */
export function isListOfAnswers(value: Value): boolean {
	if (value.type !== ValueType.Matrix) return false;
	const data = (value.value as MatrixData).data;
	if (data.length === 0) return false;
	for (let i = 0; i < data.length; i++) if (typeof data[i] !== "boolean") return false;
	return true;
}

/**
 * The refusal for a list where one true or false is needed: the condition of
 * an `if`. A list compared with a value answers once per cell, and reading
 * that list as one answer (it read as 0, so as false) picked a branch no cell
 * asked for. The message points at the forms that do work: one cell, or `map`
 * to choose for each cell.
 *
 * @param list - The list met where a condition was expected.
 * @param where - What needed the condition, in words (`if`).
 * @returns The `LIST_CONDITION_UNSUPPORTED` error Value.
 */
export function listConditionRefused(list: Value, where: string): Value {
	const count = (list.value as MatrixData).data.length;
	const cells = count === 1 ? "one cell" : `${count} cells`;
	return errorValue(
		"LIST_CONDITION_UNSUPPORTED",
		`"${where}" needs one true or false, and this is a list of ${cells}. Compare one cell, as in v[0] > 5, or choose for each cell with map, as in map(if x > 5 then 1 else 0, v).`,
	);
}
