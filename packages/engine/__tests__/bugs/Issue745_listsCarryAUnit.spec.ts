import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { formatValue, formatMatrixAligned } from "@solve-js/format/FormatEngine";
import { matrixValue, numberValue, percentageValue, uomValue, boolValue, stringValue, symbolicValue, errorValue, ValueType, type MatrixData } from "@solve-js/vm/Value";
import { varNode } from "@solve-js/symbolic";
import {
	alignForComparison,
	cellMeasuresDiffer,
	listCellValue,
	listConverted,
	listFromCells,
	needsUnitCells,
	unitListArithmetic,
	unitListCompare,
} from "@solve-js/vm/MatrixUnits";
import { collectionToValues, determinant, transpose, unitListAlgebraRefused } from "@solve-js/vm/MatrixOps";
import { serializeValue } from "@solve-js/worker/serialize";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";

/**
 * Issue #745: a bracketed list held plain numbers, so a quantity's unit was
 * dropped as the cell was stored: `[1 km, 2 km] * 2` answered `[2, 4]`, and a
 * sweep of a money line listed bare amounts. A list now carries one unit, the
 * first quantity cell's, with every later cell read in it. Arithmetic keeps
 * it, `in` converts every cell, indexing answers a quantity, money shows as
 * money, and a sweep answers a list in its line's unit. Cells of different
 * measures, and the matrix algebra one unit cannot express, are refused by
 * name.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

describe("the issue's lines", () => {
	test.each([
		["[1 km, 500 m] * 2", "[2.00 km, 1.00 km]"],
		["[1 km, 500 m]", "[1.00 km, 0.50 km]"],
		["[1 km, 500 m][1]", "0.50 km"],
		["[1 km, 2 km] * 2", "[2.00 km, 4.00 km]"],
		["[$5, $6] * 2", "[$10.00, $12.00]"],
		["[1, 2, 3] km", "[1.00 km, 2.00 km, 3.00 km]"],
		["[1 km, 500 m] in m", "[1,000.00 m, 500.00 m]"],
		["total of 1.2 km, 3 km, 800 m", "5.00 km"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("a sweep over a money line answers money, through both passes", () => {
		const { batch } = expectHonestDocument("price = $100\nqty = 3\nprice * qty\nline 3 for price from $100 to $300 step $50");
		expect(batch[3]).toBe("= [$300.00, $450.00, $600.00, $750.00, $900.00]");
	});
});

describe("what a list with a unit does", () => {
	test.each([
		["[1 km, 2]", "[1.00 km, 2.00 km]"],
		["[1 km; 500 m]", "[1.00 km; 0.50 km]"],
		["[1 km, 2 km; 3 km, 4 km]", "[1.00 km, 2.00 km; 3.00 km, 4.00 km]"],
		["[1, 2] in km", "[1.00 km, 2.00 km]"],
		["[1, 2] km in m", "[1,000.00 m, 2,000.00 m]"],
		["[1 km, 2 km] km", "[1.00 km, 2.00 km]"],
		["[1 km, 2 km] + 500 m", "[1.50 km, 2.50 km]"],
		["[1 km, 2 km] - [500 m, 1 km]", "[0.50 km, 1.00 km]"],
		["2 * [1 km, 2 km]", "[2.00 km, 4.00 km]"],
		["[1 km, 2 km] / 2", "[0.50 km, 1.00 km]"],
		["1 km / [1, 2]", "[1.00 km, 0.50 km]"],
		["-[1 km, 2 km]", "[-1.00 km, -2.00 km]"],
		["+[1 km, 2 km]", "[1.00 km, 2.00 km]"],
		["[1 km, 2 km][0, 1]", "2.00 km"],
		["[1 km, 500 m, 2 km][0:0, 0:1]", "[1.00 km, 0.50 km]"],
		["transpose([1 km, 2 km])", "[1.00 km; 2.00 km]"],
		["map(x*2, [1 km, 2 km])", "[2.00 km, 4.00 km]"],
		["map(x in m, [1 km, 2 km])", "[1,000.00 m, 2,000.00 m]"],
		["reduce(acc+x, [1 km, 2 km])", "3.00 km"],
		["reduce(acc+x, [$1, $2])", "$3.00"],
		["[1 km, 2 km] < [1500 m, 1500 m]", "[true, false]"],
		["[1 km, 2 km] == [1000 m, 2000 m]", "[true, true]"],
		["[10 °C, 50 °F]", "[10.00 °C, 10.00 °C]"],
		["[10 °C, 20 °C] in °F", "[50.00 °F, 68.00 °F]"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("a plain list is unchanged", () => {
		expect(show("[1, 2, 3]")).toBe("[1, 2, 3]");
		expect(show("[1, 2] * 2")).toBe("[2, 4]");
		expect(show("[1, 2] + [3, 4]")).toBe("[4, 6]");
		expect(show("[1,2;3,4] * [1,2;3,4]")).toBe("[7, 10; 15, 22]");
		expect(show("det([1,2;3,4])")).toBe("-2");
		expect(show("-[1, 2]")).toBe("[-1, -2]");
		expect(show("[true, false]")).toBe("[true, false]");
	});
});

describe("what is refused by name", () => {
	test.each([
		["[1 km, 2 kg]", "MATRIX_CELL_UNITS_DIFFER"],
		["[$5, €6]", "MATRIX_CELL_UNITS_DIFFER"],
		["[true, 1 km]", "MATRIX_CELL_NO_UNIT"],
		["[5%, 1 km]", "MATRIX_CELL_NO_UNIT"],
		["[1 km, 2 km] m", "UNIT_AFTER_UNIT"],
		["[1 km, 2 km] * 3 m", "MATRIX_UNIT_OPERATION_UNSUPPORTED"],
		["[1, 2] / 1 km", "MATRIX_UNIT_OPERATION_UNSUPPORTED"],
		["10 / [1 km, 2 km]", "MATRIX_UNIT_OPERATION_UNSUPPORTED"],
		["[1 km, 2 km] + 10%", "MATRIX_UNIT_OPERATION_UNSUPPORTED"],
		["det([1 km, 2 km; 3 km, 4 km])", "MATRIX_UNIT_ALGEBRA"],
		["inv([1 km, 2 km; 3 km, 4 km])", "MATRIX_UNIT_ALGEBRA"],
		["[1 km, 2 km; 3 km, 4 km] * [1 km, 2 km; 3 km, 4 km]", "MATRIX_UNIT_ALGEBRA"],
		["[1 km, 2 km; 3 km, 4 km]^2", "MATRIX_UNIT_ALGEBRA"],
		["dot([1 km, 2 km], [1, 2])", "MATRIX_UNIT_ALGEBRA"],
		["[1 km, 2 km] < [1 kg, 2 kg]", "MATRIX_CELL_UNITS_DIFFER"],
		["[(1, 2), 3]", "MATRIX_CELL_NON_NUMERIC"],
	])("%s", (line, errorCode) => {
		expect(code(line)).toBe(errorCode);
	});

	test("the messages name the units and what to write", () => {
		expect(show("[1 km, 2 kg]")).toBe("A list holds one unit, and a cell in kg has no reading in km: length and mass are not one measure.");
		expect(show("det([1 km, 2 km; 3 km, 4 km])")).toBe(
			"A determinant of a list in km is not covered: matrix algebra works on plain numbers, so write the list without its unit to work on the amounts.");
	});

	test("the aggregates refuse a list with a unit as they refuse a plain one, and cash flows read its currency", () => {
		expect(code("mean([1 km, 2 km])")).toBe(code("mean([1, 2])"));
		expect(code("mean([1 km, 2 km])")).toBe("AGGREGATE_NON_NUMERIC");
		expect(show("npv of [$-1000, $300, $400, $500] at 10%")).toBe("-$21.04");
		expect(show("npv of [-1000, 300, 400, 500] at 10%")).toBe("-21.04");
		expect(code("npv of [-1000 km, 300 km] at 10%")).toBe("CASH_FLOW_EXPECTED_AMOUNT");
		expect(show("shuffle [1 km, 1 km]")).toBe("[1.00 km, 1.00 km]");
	});
});

describe("the parts", () => {
	const km = (data: number[]): MatrixData => matrixValue(1, data.length, data, "km").value as MatrixData;
	const plain = (data: number[]): MatrixData => matrixValue(1, data.length, data).value as MatrixData;

	test("matrixValue carries the unit only when given one", () => {
		expect((matrixValue(1, 2, [1, 2]).value as MatrixData).unit).toBeUndefined();
		expect("unit" in (matrixValue(1, 2, [1, 2]).value as MatrixData)).toBe(false);
		expect(km([1, 2]).unit).toBe("km");
	});

	test("listCellValue", () => {
		expect(formatValue(listCellValue(km([1]), 1))).toBe("= 1.00 km");
		expect(listCellValue(plain([1]), 1).type).toBe(ValueType.Number);
		expect(listCellValue(km([1]), true).type).toBe(ValueType.Boolean);
	});

	test("listFromCells: the first quantity's unit, conversion, bare numbers and refusals", () => {
		expect(formatValue(listFromCells(1, 3, [numberValue(5), uomValue(1, "km"), uomValue(500, "m")]))).toBe("= [5.00 km, 1.00 km, 0.50 km]");
		expect(formatValue(listFromCells(1, 2, [numberValue(1), numberValue(2)]))).toBe("= [1, 2]");
		expect(listFromCells(1, 2, [uomValue(1, "km"), uomValue(1, "kg")]).errorCode).toBe("MATRIX_CELL_UNITS_DIFFER");
		expect(listFromCells(1, 2, [uomValue(1, "km"), boolValue(true)]).errorCode).toBe("MATRIX_CELL_NO_UNIT");
		expect(listFromCells(1, 2, [uomValue(1, "km"), percentageValue(0.5)]).errorCode).toBe("MATRIX_CELL_NO_UNIT");
		expect(listFromCells(1, 2, [uomValue(1, "km"), symbolicValue(varNode("x"))]).errorCode).toBe("MATRIX_CELL_NO_UNIT");
		expect(listFromCells(1, 2, [uomValue(1, "km"), errorValue("X_FAILED", "failed")]).errorCode).toBe("X_FAILED");
		expect(formatValue(listFromCells(0, 0, []))).toBe("= []");
		expect(formatValue(listFromCells(1, 2, [uomValue(1, "km"), uomValue(2, "kilometres")]))).toBe("= [1.00 km, 2.00 km]");
	});

	test("cellMeasuresDiffer names both measures, or the missing conversion", () => {
		expect(cellMeasuresDiffer("km", "kg").errorMessage).toBe("A list holds one unit, and a cell in kg has no reading in km: length and mass are not one measure.");
		expect(cellMeasuresDiffer("USD", "EUR").errorMessage).toContain("no conversion between them");
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(cellMeasuresDiffer(word, "km").errorCode).toBe("MATRIX_CELL_UNITS_DIFFER");
		});
	});

	test("needsUnitCells", () => {
		const list = matrixValue(1, 2, [1, 2]);
		const unitList = matrixValue(1, 2, [1, 2], "km");
		expect(needsUnitCells(list, numberValue(2))).toBe(false);
		expect(needsUnitCells(list, list)).toBe(false);
		expect(needsUnitCells(numberValue(1), numberValue(2))).toBe(false);
		expect(needsUnitCells(unitList, numberValue(2))).toBe(true);
		expect(needsUnitCells(numberValue(2), unitList)).toBe(true);
		expect(needsUnitCells(list, uomValue(1, "km"))).toBe(true);
		expect(needsUnitCells(uomValue(1, "km"), list)).toBe(true);
		expect(needsUnitCells(uomValue(1, "km"), uomValue(1, "m"))).toBe(false);
	});

	test("unitListArithmetic: each operator, shapes and faults", () => {
		const unitList = matrixValue(1, 2, [1, 2], "km");
		expect(formatValue(unitListArithmetic("add", unitList, uomValue(500, "m")))).toBe("= [1.50 km, 2.50 km]");
		expect(formatValue(unitListArithmetic("sub", unitList, uomValue(1, "km")))).toBe("= [0.00 km, 1.00 km]");
		expect(formatValue(unitListArithmetic("mul", unitList, numberValue(3)))).toBe("= [3.00 km, 6.00 km]");
		expect(formatValue(unitListArithmetic("div", unitList, numberValue(4)))).toBe("= [0.25 km, 0.50 km]");
		expect(formatValue(unitListArithmetic("mod", unitList, numberValue(2)))).toBe("= [1.00 km, 0.00 km]");
		expect(unitListArithmetic("add", unitList, matrixValue(1, 3, [1, 2, 3], "km")).errorCode).toBe("DIMENSION_MISMATCH");
		expect(unitListArithmetic("add", unitList, errorValue("X_FAILED", "failed")).errorCode).toBe("X_FAILED");
		expect(unitListArithmetic("add", unitList, stringValue("abc")).errorCode).toBe("MATRIX_UNIT_OPERATION_UNSUPPORTED");
		expect(unitListArithmetic("add", unitList, uomValue(1, "kg")).errorCode).toBe("INCOMPATIBLE_UNITS");
		expect(unitListArithmetic("mul", unitList, unitList).errorCode).toBe("MATRIX_UNIT_ALGEBRA");
	});

	test("listConverted: every cell, and a cell with no amount refused", () => {
		const convert = (cell: import("@solve-js/vm/Value").Value) => uomValue(cell.toNumber() * 1000, "m");
		expect(formatValue(listConverted(matrixValue(1, 2, [1, 2], "km"), convert))).toBe("= [1,000.00 m, 2,000.00 m]");
		expect(listConverted(matrixValue(1, 2, [true, 1]), convert).errorCode).toBe("MATRIX_CELL_NO_UNIT");
		expect(listConverted(matrixValue(1, 1, [varNode("x")]), convert).errorCode).toBe("MATRIX_CELL_NO_UNIT");
		expect(listConverted(matrixValue(1, 1, [1]), () => errorValue("NOPE", "no")).errorCode).toBe("NOPE");
	});

	test("alignForComparison and unitListCompare", () => {
		const aligned = alignForComparison(km([1, 2]), matrixValue(1, 2, [1500, 500], "m").value as MatrixData);
		expect(aligned).not.toHaveProperty("errorCode");
		expect((aligned as { right: MatrixData }).right.data).toEqual([1.5, 0.5]);
		expect(alignForComparison(km([1]), plain([1]))).toEqual({ left: km([1]), right: plain([1]) });
		expect(formatValue(unitListCompare(km([1, 2]), matrixValue(1, 2, [1500, 1500], "m").value as MatrixData, (a, b) => a < b))).toBe("= [true, false]");
		expect(unitListCompare(km([1]), matrixValue(1, 1, [1], "kg").value as MatrixData, (a, b) => a < b).errorCode).toBe("MATRIX_CELL_UNITS_DIFFER");
	});

	test("unitListAlgebraRefused, determinant and transpose", () => {
		expect(unitListAlgebraRefused(plain([1]), "a determinant")).toBeNull();
		expect(unitListAlgebraRefused(km([1]), "a determinant")?.errorCode).toBe("MATRIX_UNIT_ALGEBRA");
		expect(determinant(matrixValue(1, 1, [3], "km").value as MatrixData).errorCode).toBe("MATRIX_UNIT_ALGEBRA");
		expect((transpose(km([1, 2])).value as MatrixData).unit).toBe("km");
	});

	test("collectionToValues hands out quantities", () => {
		const cells = collectionToValues(matrixValue(1, 2, [1, 2], "km"));
		expect(Array.isArray(cells) && cells.map((c) => formatValue(c))).toEqual(["= 1.00 km", "= 2.00 km"]);
	});

	test("the aligned grid, the worker value and toJSON carry the unit", () => {
		expect(formatMatrixAligned(matrixValue(2, 1, [1, 20], "m").value as MatrixData)).toBe("[  1.00 m ]\n[ 20.00 m ]");
		expect(serializeValue(matrixValue(1, 2, [1, 2], "km")).matrix?.unit).toBe("km");
		expect(serializeValue(matrixValue(1, 2, [1, 2])).matrix).not.toHaveProperty("unit");
		expect(matrixValue(1, 2, [1, 2], "km").toJSON().unit).toBe("km");
	});
});

describe("a snapshot round trip keeps the unit", () => {
	test("through engine.toJSON and back", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("d = [1 km, 500 m]\nd * 2", { inputType: "markdown" });
		const restored = ExpressionEngine.fromJSON(engine.toJSON(), { packages: BUILTIN_PACKAGES });
		expect(formatValue(restored.evaluateExpression("d"))).toBe("= [1.00 km, 0.50 km]");
		expect(formatValue(restored.evaluateExpression("d[1] + 1 m"))).toBe("= 0.50 km");
	});
});

describe("adversarial", () => {
	test("numeric edges in a list with a unit stay honest", () => {
		for (const line of [
			...fill("[X km, 500 m]", NUMERIC_EDGES),
			...fill("[1 km, X m] * 2", NUMERIC_EDGES),
			...fill("[1 km, 2 km] * X", NUMERIC_EDGES),
			...fill("[X, 2] km in m", NUMERIC_EDGES),
			...fill("[$X, $2] * 3", NUMERIC_EDGES),
		]) {
			expectHonestLine(line, { allowNaN: true });
		}
	});

	test("a conversion below the display budget is still shown as not zero", () => {
		expect(show("[1e-9 km, 1 km] in mm")).toBe("[0.001 mm, 1,000,000.00 mm]");
		expect(show("[1 nm, 1 km]")).not.toMatch(/^\[0\.00 nm/);
	});

	test("prototype words as the unit and inside a list are ordinary words", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`[1, 2] ${word}`);
				expectHonestLine(`[1, 2] in ${word}`);
				expectHonestLine(`[1 km, 2 ${word}]`);
			}
		});
	});

	test("text edges beside a list with a unit are read as text", () => {
		for (const line of fill("[1 km, 2 km] X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("a long list with a unit, and a long list meeting a quantity, answer in time", () => {
		const cells = Array.from({ length: 1_000 }, (_, i) => `${i} m`).join(", ");
		expectHonestLine(`[${cells}] * 2`, { budgetMs: 4_000 });
		expectHonestLine(`[${cells}] in km`, { budgetMs: 4_000 });
		expectHonestLine(`map(x * 2, 0:999) * 1 km`, { budgetMs: 4_000 });
	});

	test("a list from variables and line references, an edit, and both passes agree", () => {
		const { batch } = expectHonestDocument("a = 1 km\nb = 500 m\nd = [a, b]\nd * 2\nd[1]\nd in m");
		expect(batch.slice(2)).toEqual(["= [1.00 km, 0.50 km]", "= [2.00 km, 1.00 km]", "= 0.50 km", "= [1,000.00 m, 500.00 m]"]);
		const edited = evaluateDocument(newTrackedEngine(), "a = 2 km\nb = 500 m\nd = [a, b]\nd * 2", { inputType: "markdown" });
		expect(formatValue(edited.lines[3].result!)).toBe("= [4.00 km, 1.00 km]");
	});

	test("a sweep whose answers change unit is read in the first answer's unit, or refused across measures", () => {
		const { batch } = expectHonestDocument("x = 1\nif x > 1 then 1000 m else 1 km\nline 2 for x from 1 to 2 step 1");
		expect(batch[2]).toBe("= [1.00 km, 1.00 km]");
		const measures = expectHonestDocument("x = 1\nif x > 1 then 1 kg else 1 km\nline 2 for x from 1 to 2 step 1");
		expect(measures.batch[2]).toMatch(/^ERROR /);
	});

	test("a what-if and a check through a list with a unit", () => {
		const { batch } = expectHonestDocument("d = 1 km\n[d, 500 m] * 2\nline 2 with d = 2 km\ncheck [d, d] == [1000 m, 1 km]");
		expect(batch[1]).toBe("= [2.00 km, 1.00 km]");
		expect(batch[2]).toBe("= [4.00 km, 1.00 km]");
	});

	test("many lines of lists with units", () => {
		expectHonestDocument(RESOURCE_PROBES.manyLines(300, "[1 km, 500 m] * 2"));
	});
});
