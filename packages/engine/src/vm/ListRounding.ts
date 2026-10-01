/**
 * Rounding a list cell by cell, and the refusal for a conversion a list has no
 * one number for.
 *
 * A list is a matrix, and a matrix reads as 0 wherever one number is asked of
 * it (see `Value.toNumber`), so the rounding family answered a list with a
 * single zero: `[0.001, 0.006] to 4 dp` was `0.0000`, `round([1.5, 2.4])` was
 * `0` and `[1234, 5678] as sci` was `0e+0`. Rounding has an answer for each
 * cell, so a list is rounded cell by cell and keeps its shape; a conversion
 * to text (scientific notation, a fraction) or to a percentage or a base has
 * no list form, so it is refused by name.
 */

import { Value, ValueType, errorValue, matrixValue, numberValue, uomValue, type MatrixData } from "@solve-js/vm/Value";
import { decimalFromExponentLiteral, decimalFromLiteral, type DecimalData } from "@solve-js/decimal";

/**
 * The exact decimal a list cell is written as: the shortest decimal that reads
 * back as the cell's double, which is the number a reader typed or sees
 * (`1.005` for the cell typed 1.005). Undefined for an infinity or a NaN.
 *
 * A list cell is held as a double, so the exact decimal a lone number keeps is
 * not there to round from; without this, `[1.005] to 2 dp` rounded the double
 * (1.00499...) down to 1.00 where `1.005 to 2 dp` is 1.01. The shortest text is
 * the decimal the cell stands for, so rounding it rounds what the reader wrote.
 *
 * @param cell - A list cell's number.
 * @returns Its decimal, or undefined.
 */
export function cellDecimal(cell: number): DecimalData | undefined {
	if (!Number.isFinite(cell)) return undefined;
	const text = String(cell === 0 ? 0 : cell);
	if (/e/i.test(text)) return decimalFromExponentLiteral(text) ?? undefined;
	return decimalFromLiteral(text);
}

/**
 * Whether a value is a list of more than one cell, the shape the rounding
 * family rounds cell by cell. A list of one cell already reads as its one
 * number, so it is not taken here.
 *
 * @param value - Any value.
 */
export function isManyCellList(value: Value): boolean {
	if (value.type !== ValueType.Matrix) return false;
	const m = value.value as MatrixData;
	return m.data.length > 1;
}

/**
 * A list with every cell rounded by `roundCell`, in the list's unit and shape,
 * each cell shown to the places its rounding set; or null when `source` is not
 * a list of several cells, for the caller to round as one number.
 *
 * Each cell is handed to `roundCell` as the number or quantity it stands for,
 * with its exact decimal (see {@link cellDecimal}), so a cell rounds as the
 * same number on its own line would. A cell that is not a number (a true or
 * false, a formula with an unknown) has nothing to round, and the list is
 * refused by name rather than rounded around it.
 *
 * @param source - The value being rounded.
 * @param roundCell - Rounds one cell; the rounding asked for.
 * @param what - The rounding in the reader's words, for the refusal (`rounded`).
 * @returns The rounded list, the refusal, or null.
 */
export function roundEachCell(source: Value, roundCell: (cell: Value) => Value, what: string): Value | null {
	if (!isManyCellList(source)) return null;
	const m = source.value as MatrixData;
	const data: number[] = [];
	const places: (number | undefined)[] = [];
	let anyPlaces = false;
	for (const entry of m.data) {
		if (typeof entry !== "number") {
			return errorValue(
				"LIST_ROUNDING_NON_NUMERIC",
				`A list can be ${what} only when every cell is a number: this one holds ${typeof entry === "boolean" ? "a true or false" : "a formula with an unknown in it"}.`,
			);
		}
		const cell = m.unit === undefined ? numberValue(entry) : uomValue(entry, m.unit);
		const exact = cellDecimal(entry);
		if (exact !== undefined) cell.exact = exact;
		const rounded = roundCell(cell);
		if (rounded.type === ValueType.Error) return rounded;
		data.push(rounded.toNumber());
		places.push(rounded.decimalPlaces);
		if (rounded.decimalPlaces !== undefined) anyPlaces = true;
	}
	return matrixValue(m.rows, m.cols, data, m.unit, anyPlaces ? places : undefined);
}

/**
 * The refusal for a list given a conversion that writes one number (scientific
 * notation, a fraction, a percentage, a base), or null when `value` is not a
 * list of several cells.
 *
 * @param value - The value being converted.
 * @param done - What the conversion does, in the reader's words (`written in scientific notation`).
 */
export function listConversionRefused(value: Value, done: string): Value | null {
	if (!isManyCellList(value)) return null;
	return errorValue(
		"LIST_CONVERSION_UNSUPPORTED",
		`A list cannot be ${done}: it holds several numbers, not one. Convert one value at a time.`,
	);
}
