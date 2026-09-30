import { type MatrixData, type MatrixEntry, Value, ValueType, matrixValue, uomValue, errorValue, faultedOperand } from "@solve-js/vm/Value";
import type { SymbolicNode } from "@solve-js/symbolic";
import { matrixEntryToValue, matrixCompare, sameShape, unitListAlgebraRefused } from "@solve-js/vm/MatrixOps";
import { unifyUom, describeMeasure, nonNumericKind, binaryOp, sameUnit } from "@solve-js/vm/VMConversion";

/**
 * Lists that carry a unit (issue #745).
 *
 * A bracketed list holds one number per cell, and a list of quantities keeps
 * one unit beside those numbers ({@link MatrixData.unit}): `[1 km, 500 m]` is
 * the cells 1 and 0.5 in kilometres. The unit is the first quantity cell's,
 * as the comma aggregates take theirs, and every later cell is read in it: a
 * quantity is converted, and a bare number is taken to be in it already. A
 * cell whose measure differs (a length beside a mass, dollars beside euros
 * with no rate between them) has no reading in that unit and is refused by
 * name.
 *
 * These helpers are the one place a list's cells leave or enter that unit, so
 * every consumer (the literal, indexing, arithmetic, `in`, `map` and `reduce`,
 * a sweep) reads it the same way.
 *
 * The boundary: a list carries one unit, and only the element-wise forms are
 * read with it. Matrix algebra on quantities (a determinant of lengths, the
 * product of two matrices of metres) is refused by `unitListAlgebraRefused` in
 * vm/MatrixOps.ts,
 * and a symbolic cell has no unit, so a list with one cannot carry one.
 */

/** One cell of `m` as a Value: a quantity in the list's unit when it has one, otherwise as the cell is. */
export function listCellValue(m: MatrixData, cell: MatrixEntry): Value {
	if (m.unit !== undefined && typeof cell === "number") return uomValue(cell, m.unit);
	return matrixEntryToValue(cell);
}

/**
 * The refusal for two cells whose measures differ, or for two currencies with
 * no rate between them, naming both units.
 *
 * @param earlier - The list's unit, from the first quantity cell.
 * @param later - The unit of the cell that has no reading in it.
 */
export function cellMeasuresDiffer(earlier: string, later: string): Value {
	const first = describeMeasure(earlier);
	const second = describeMeasure(later);
	const opening = `A list holds one unit, and a cell in ${later} has no reading in ${earlier}`;
	if (first !== undefined && second !== undefined && first !== second) {
		return errorValue("MATRIX_CELL_UNITS_DIFFER", `${opening}: ${first} and ${second} are not one measure.`);
	}
	return errorValue("MATRIX_CELL_UNITS_DIFFER", `${opening}, since there is no conversion between them.`);
}

/**
 * Builds a list from one Value per cell, in the order `cells` is given (the
 * caller has already arranged it into column-major storage order).
 *
 * The unit is the first quantity cell's; a later quantity is converted into
 * it, and a bare number is read as already in it. A faulted cell fails the
 * whole list, as one bad cell always has. A cell that is not a number (text, a
 * date, a list) is refused by the caller before this; here a true or false and
 * a symbolic cell are kept as they are, and refused only beside a quantity,
 * since neither has a reading in a unit.
 *
 * @param rows - The rows of the result.
 * @param cols - The columns of the result.
 * @param cells - One Value per cell.
 * @returns The list, or the error Value that stops it.
 */
export function listFromCells(rows: number, cols: number, cells: readonly Value[]): Value {
	for (const cell of cells) {
		const fault = faultedOperand(cell);
		if (fault) return fault;
	}
	let anchor: Value | undefined;
	for (const cell of cells) {
		if (cell.type === ValueType.Uom && cell.unit !== undefined) {
			anchor = cell;
			break;
		}
	}
	const data: MatrixEntry[] = new Array<MatrixEntry>(cells.length);
	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i];
		if (anchor !== undefined && cell.type === ValueType.Percentage) {
			return errorValue(
				"MATRIX_CELL_NO_UNIT",
				`A list in ${anchor.unit} cannot hold a percentage: every cell of a list with a unit is an amount in it.`,
			);
		}
		if (cell.type === ValueType.Boolean || cell.type === ValueType.Symbolic) {
			if (anchor !== undefined) {
				return errorValue(
					"MATRIX_CELL_NO_UNIT",
					`A list in ${anchor.unit} cannot hold ${cell.type === ValueType.Boolean ? "a true or false" : "a formula"}: every cell of a list with a unit is an amount in it.`,
				);
			}
			data[i] = cell.type === ValueType.Boolean ? (cell.value as boolean) : (cell.value as SymbolicNode);
			continue;
		}
		if (anchor === undefined || cell.type !== ValueType.Uom || cell.unit === undefined || sameUnit(cell.unit, anchor.unit!)) {
			data[i] = cell.toNumber();
			continue;
		}
		const { rv, sameMeasure } = unifyUom(anchor, cell);
		if (!sameMeasure) return cellMeasuresDiffer(anchor.unit!, cell.unit);
		data[i] = rv;
	}
	return matrixValue(rows, cols, data, anchor?.unit);
}

/**
 * Whether an arithmetic operator meeting `l` and `r` has to be worked cell by
 * cell with units: a list that carries a unit on either side, or a list of
 * plain numbers meeting a quantity (`[1, 2] * 3 km`).
 */
export function needsUnitCells(l: Value, r: Value): boolean {
	const lList = l.type === ValueType.Matrix;
	const rList = r.type === ValueType.Matrix;
	if (!lList && !rList) return false;
	if (lList && (l.value as MatrixData).unit !== undefined) return true;
	if (rList && (r.value as MatrixData).unit !== undefined) return true;
	return (lList && r.type === ValueType.Uom) || (rList && l.type === ValueType.Uom);
}

/** The element-wise operators a list with a unit is read through. */
export type UnitListOp = "add" | "sub" | "mul" | "div" | "mod";

/** The plain-number operation for each operator, which `binaryOp` applies to the magnitudes. */
const NUMERIC: Readonly<Record<UnitListOp, (a: number, b: number) => number>> = {
	add: (a, b) => a + b,
	sub: (a, b) => a - b,
	mul: (a, b) => a * b,
	div: (a, b) => a / b,
	mod: (a, b) => a % b,
};

/** How each operator is named in a refusal. */
const VERB: Readonly<Record<UnitListOp, string>> = {
	add: "added to",
	sub: "taken from",
	mul: "multiplied by",
	div: "divided by",
	mod: "divided by",
};

/**
 * One cell of a list meeting one value: a quantity scaled by a number, a
 * quantity added to one of its measure, or a number taken into a quantity.
 * Two quantities multiplied or divided cell by cell (`[1 m, 2 m] * 3 m`) would
 * need the unit algebra of each product, which a list of one unit cannot hold
 * when the cells differ, so that is refused by name, as is a percentage, whose
 * readings (`+ 10%` is a tenth more) are the scalar forms'.
 */
function cellArithmetic(op: UnitListOp, a: Value, b: Value): Value {
	const aQuantity = a.type === ValueType.Uom;
	const bQuantity = b.type === ValueType.Uom;
	if (a.type === ValueType.Percentage || b.type === ValueType.Percentage) {
		return errorValue(
			"MATRIX_UNIT_OPERATION_UNSUPPORTED",
			`A list with a unit cannot be ${VERB[op]} a percentage: write the percentage as a number (0.1 for 10%) to scale every cell.`,
		);
	}
	if ((op === "mul" || op === "div" || op === "mod") && aQuantity && bQuantity) {
		return errorValue(
			"MATRIX_UNIT_OPERATION_UNSUPPORTED",
			`A list of quantities cannot be ${VERB[op]} another quantity cell by cell: a list carries one unit. Scale it by a plain number, or add a quantity of the same measure.`,
		);
	}
	if (op === "div" && !aQuantity && bQuantity) {
		return errorValue(
			"MATRIX_UNIT_OPERATION_UNSUPPORTED",
			`A list cannot divide a plain number by a quantity cell by cell: each answer would be in a reciprocal unit (per ${b.unit}), which a list does not carry.`,
		);
	}
	return binaryOp(a, b, NUMERIC[op], undefined, op === "mod" ? undefined : op);
}

/**
 * An element-wise operator over a list with a unit, or a plain list meeting a
 * quantity: each cell is worked as the scalar it stands for (see
 * {@link cellArithmetic}) and the answers are gathered back into one list in
 * one unit. Two lists must have one shape.
 *
 * @param op - The operator.
 * @param l - The left operand; at least one operand is a list.
 * @param r - The right operand.
 * @returns The list of answers, or the error Value that stops it.
 */
export function unitListArithmetic(op: UnitListOp, l: Value, r: Value): Value {
	const fault = faultedOperand(l, r);
	if (fault) return fault;
	const lm = l.type === ValueType.Matrix ? (l.value as MatrixData) : undefined;
	const rm = r.type === ValueType.Matrix ? (r.value as MatrixData) : undefined;
	for (const [side, other] of [[l, r], [r, l]] as const) {
		const kind = side.type === ValueType.Matrix ? undefined : nonNumericKind(side);
		if (kind !== undefined && other.type === ValueType.Matrix) {
			return errorValue(
				"MATRIX_UNIT_OPERATION_UNSUPPORTED",
				`A list with a unit cannot be combined with ${kind}: only a number or a quantity can meet each of its cells.`,
			);
		}
	}
	// Two lists multiplied is the matrix product, which is algebra, not a cell
	// by cell operation.
	if (op === "mul" && lm !== undefined && rm !== undefined) {
		const refused = unitListAlgebraRefused(lm, "a matrix product") ?? unitListAlgebraRefused(rm, "a matrix product");
		if (refused) return refused;
	}
	if (lm !== undefined && rm !== undefined && !sameShape(lm, rm)) {
		return errorValue("DIMENSION_MISMATCH", `Cannot combine matrices of different shapes: ${lm.rows}x${lm.cols} and ${rm.rows}x${rm.cols}`);
	}
	const shape = lm ?? rm!;
	const cells: Value[] = new Array<Value>(shape.data.length);
	for (let i = 0; i < shape.data.length; i++) {
		const a = lm !== undefined ? listCellValue(lm, lm.data[i]) : l;
		const b = rm !== undefined ? listCellValue(rm, rm.data[i]) : r;
		const answer = cellArithmetic(op, a, b);
		if (answer.type === ValueType.Error) return answer;
		cells[i] = answer;
	}
	return listFromCells(shape.rows, shape.cols, cells);
}

/**
 * A list converted with `in` or `to`, or given a unit straight after it: each
 * cell is converted as the scalar it stands for, by `convert`, and gathered
 * back into one list in the target unit.
 *
 * @param list - The list.
 * @param convert - The scalar conversion, applied to each cell.
 * @returns The converted list, or the error Value a cell's conversion gave.
 */
export function listConverted(list: Value, convert: (cell: Value) => Value): Value {
	const m = list.value as MatrixData;
	if (m.hasSymbolic) {
		return errorValue("MATRIX_CELL_NO_UNIT", "A list with a formula in it cannot be given a unit: a formula cell has no amount to put in one.");
	}
	const cells: Value[] = new Array<Value>(m.data.length);
	for (let i = 0; i < m.data.length; i++) {
		const cell = m.data[i];
		if (typeof cell === "boolean") {
			return errorValue("MATRIX_CELL_NO_UNIT", "A list with a true or false in it cannot be given a unit: that cell has no amount to put in one.");
		}
		const converted = convert(listCellValue(m, cell));
		if (converted.type === ValueType.Error || converted.type === ValueType.Pending) return converted;
		cells[i] = converted;
	}
	return listFromCells(m.rows, m.cols, cells);
}

/**
 * The right list's cells read in the left list's unit, for a comparison, or
 * the error Value when they have no reading in it. A list with no unit beside
 * one with a unit is read as already in it, as a bare number is.
 *
 * @param l - The left list.
 * @param r - The right list.
 */
export function alignForComparison(l: MatrixData, r: MatrixData): { left: MatrixData; right: MatrixData } | Value {
	if (l.unit === undefined || r.unit === undefined || l.unit === r.unit) return { left: l, right: r };
	const data: MatrixEntry[] = new Array<MatrixEntry>(r.data.length);
	const anchor = uomValue(1, l.unit);
	for (let i = 0; i < r.data.length; i++) {
		const cell = r.data[i];
		if (typeof cell !== "number") return errorValue("MATRIX_CELL_NO_UNIT", "A list with a unit can only be compared with amounts.");
		const { rv, sameMeasure } = unifyUom(anchor, uomValue(cell, r.unit));
		if (!sameMeasure) return cellMeasuresDiffer(l.unit, r.unit);
		data[i] = rv;
	}
	return { left: l, right: { ...r, data, unit: l.unit } };
}

/**
 * Two lists compared cell by cell, the right one read in the left one's unit
 * first when both carry one: `[1 km, 2 km] < [1500 m, 1500 m]` compares 1 with
 * 1.5 and 2 with 1.5. Two measures that do not convert are refused by name.
 *
 * @param l - The left list.
 * @param r - The right list.
 * @param cmp - The comparison of two magnitudes.
 */
export function unitListCompare(l: MatrixData, r: MatrixData, cmp: (a: number, b: number) => boolean): Value {
	const aligned = alignForComparison(l, r);
	if (aligned instanceof Value) return aligned;
	return matrixCompare(aligned.left, aligned.right, cmp);
}
