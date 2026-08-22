/**
 * `formatMatrixAligned` renders a matrix as a stacked, column-aligned grid, one
 * row per line with each column right-padded to its widest cell. It is separate
 * from `formatValue`, whose compact single-line form stays the stable text the
 * API and worker DTO use.
 */
import { describe, expect, test } from "@jest/globals";
import { formatMatrixAligned, formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType, type MatrixData } from "@solve-js/vm/Value";

function matrixOf(source: string): MatrixData {
	const engine = newTrackedEngine("en");
	const v = engine.evaluateExpression(source)[0];
	expect(v.type).toBe(ValueType.Matrix);
	return v.value as MatrixData;
}

test("stacks rows and right-aligns columns to their widest cell", () => {
	expect(formatMatrixAligned(matrixOf("[1, 2; 30, 4]"))).toBe("[  1  2 ]\n[ 30  4 ]");
});

test("a column vector is one row per line", () => {
	expect(formatMatrixAligned(matrixOf("[1; 20; 300]"))).toBe("[   1 ]\n[  20 ]\n[ 300 ]");
});

test("a row vector stays on one line", () => {
	expect(formatMatrixAligned(matrixOf("[1, 2, 3]"))).toBe("[ 1  2  3 ]");
});

test("columns align independently when widths differ across rows", () => {
	expect(formatMatrixAligned(matrixOf("[1, 200; 300, 4]"))).toBe("[   1  200 ]\n[ 300    4 ]");
});

test("the compact formatValue form is unchanged (still single line)", () => {
	// The grid is a display extra; the canonical text an assertion or DTO reads
	// must not move.
	const engine = newTrackedEngine("en");
	const v = engine.evaluateExpression("[1, 2; 3, 4]")[0];
	expect(formatValue(v)).toBe("= [1, 2; 3, 4]");
});
