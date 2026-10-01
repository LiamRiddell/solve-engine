/**
 * A percentage added to a list or taken from it: worked out for each number,
 * the way it is for one number.
 *
 * `100 + 10%` is 110, because a percentage beside a quantity is a share of
 * that quantity. A list is a matrix, and element-wise arithmetic read the
 * percentage as its bare fraction, so `[100, 200] + 10%` added 0.1 to each
 * cell and answered `[100.10, 200.10]`, and a list with a unit refused the
 * percentage outright. Here each cell meets the percentage as the number or
 * quantity it stands for, through the same rule one number follows, so
 * `[100, 200] + 10%` is `[110, 220]` and `[$100, $200] - 10%` is
 * `[$90, $180]`.
 *
 * Only `+` and `-` read a percentage as a share of the other side. Multiplying
 * or dividing by one is multiplying or dividing by its fraction (`10% of 200`
 * is 20), which element-wise arithmetic already does.
 *
 * The boundary: a percentage written before a plain list (`10% + [100, 200]`)
 * is refused by name. One number there gives a percentage (`10% + 100` is
 * 10,010%), a list holds plain numbers and would show that as 100.10, and a
 * reader who wrote it most likely meant the list first. A percentage before a
 * list of quantities reads as it does before one quantity (`10% + $5` is
 * $5.50), so `10% + [$100, $200]` is `[$110, $220]`.
 */

import { Value, ValueType, errorValue, type MatrixData } from "@solve-js/vm/Value";
import { eachCellOf } from "@solve-js/vm/ListArguments";

/**
 * One cell meeting the percentage, with the operands in the order the reader
 * wrote them, by the rule one number follows; or null when that rule has no
 * reading for the pair.
 */
export type PercentageCell = (left: Value, right: Value) => Value | null;

/**
 * `list + p%`, `list - p%`, `p% + list` or `p% - list`, worked out cell by
 * cell; or null when the operands are not a list and a percentage, for the
 * caller's own arithmetic.
 *
 * Each cell is handed to `combine` as the number or quantity it stands for,
 * with its exact decimal, so a cell is worked out as the same number on its own
 * line would be (`[100, 200] + 10%` is exactly `[110, 220]`). The answer keeps
 * the list's shape and unit. A cell that is not a number (a true or false, a
 * formula with an unknown) refuses the list, as a function of one number does.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param sign - `1` for `+`, `-1` for `-`.
 * @param combine - The scalar rule, for one cell and the percentage.
 * @returns The list of answers, the refusal, or null.
 */
export function percentageMeetsList(l: Value, r: Value, sign: 1 | -1, combine: PercentageCell): Value | null {
	const percentageFirst = l.type === ValueType.Percentage;
	if (!percentageFirst && r.type !== ValueType.Percentage) return null;
	const list = percentageFirst ? r : l;
	if (list.type !== ValueType.Matrix) return null;
	const m = list.value as MatrixData;
	if (percentageFirst && m.unit === undefined) return percentageBeforeListRefused(sign);
	return eachCellOf(m, "", (cell) => (percentageFirst ? combine(l, cell) : combine(cell, r)) ?? percentageCellRefused(sign));
}

/**
 * The refusal for a percentage written before a plain list.
 *
 * @param sign - `1` for `+`, `-1` for `-`.
 * @returns The `LIST_PERCENTAGE_UNSUPPORTED` refusal, with the order that works.
 */
export function percentageBeforeListRefused(sign: 1 | -1): Value {
	return errorValue(
		"LIST_PERCENTAGE_UNSUPPORTED",
		sign === 1
			? "A percentage plus a list would be a list of percentages, and a list holds plain numbers. To add the percentage to each number, write the list first, as in [100, 200] + 10%."
			: "A percentage less a list would be a list of percentages, and a list holds plain numbers. To take the percentage off each number, write the list first, as in [100, 200] - 10%.",
	);
}

/**
 * The refusal for a cell the scalar rule has no reading for. A cell is a
 * number or a quantity, which the rule always reads, so this stands guard
 * rather than being reached from a line.
 *
 * @param sign - `1` for `+`, `-1` for `-`.
 */
function percentageCellRefused(sign: 1 | -1): Value {
	return errorValue(
		"LIST_PERCENTAGE_UNSUPPORTED",
		`A cell of this list cannot have a percentage ${sign === 1 ? "added to" : "taken from"} it: only a number or a quantity has a share.`,
	);
}
