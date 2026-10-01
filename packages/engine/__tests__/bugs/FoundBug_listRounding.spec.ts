import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { boolValue, matrixValue, numberValue, uomValue, ValueType, type MatrixData } from "@solve-js/vm/Value";
import { cellDecimal, isManyCellList, listConversionRefused, roundEachCell } from "@solve-js/vm/ListRounding";
import { decimalToString } from "@solve-js/decimal";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `[0.001, 0.006] to 4 dp` answered `0.0000`, a list rounded to
 * one zero.
 *
 * A list is a matrix, and a matrix reads as 0 wherever one number is asked of
 * it, so every rounding builtin (`to N dp`, `to N sf`, `round`, `ceil`,
 * `floor`, and `rounded` and `to nearest`, which are built from them) rounded
 * that 0 and answered a scalar. A list is now rounded cell by cell
 * (`roundEachCell` in vm/ListRounding.ts), each cell shown to the places its
 * rounding set (`MatrixData.places`). The conversions that write one number
 * (`as sci`, `as %`, `as fraction`, `in hex`, binary, octal) answered `0e+0`,
 * `0.00%`, `0` and `0x0`; they have no list form and refuse a list by name
 * (`LIST_CONVERSION_UNSUPPORTED`). `in km` already converted a list.
 */

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A line's answer through the single-line entry point evaluateLine, or `CODE: message`. */
function single(line: string): string {
	try {
		const value = newTrackedEngine().evaluateLine(1, line);
		if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (error) {
		if (error instanceof EngineError) return `${error.code}: ${error.message}`;
		throw error;
	}
}

/** A document line's answer, or `ERROR <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "ERROR no line";
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	if (line.result.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** Each line of a document through both document passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

const LIST_REFUSAL = "LIST_CONVERSION_UNSUPPORTED: A list cannot be";

describe("the lines that exposed it", () => {
	test.each([
		["[0.001, 0.006] to 4 dp", "[0.0010, 0.0060]"],
		["map(x/1000, 1:3) to 4 dp", "[0.0010, 0.0020, 0.0030]"],
		["round([0.001, 0.006], 4)", "[0.0010, 0.0060]"],
		["[1.23456, 2.5] to 2 dp", "[1.23, 2.50]"],
		["[0.001, 0.006] to 2 sf", "[0.0010, 0.0060]"],
		["[1234, 0.5] to 2 sf", "[1,200, 0.50]"],
		["[1.2345, 2.5] to 4 sf", "[1.235, 2.500]"],
		["round([1.5, 2.4])", "[2, 2]"],
		["ceil([1.5, 2.5])", "[2, 3]"],
		["floor([1.5, -2.5])", "[1, -3]"],
		["[1.234, 5.678] rounded", "[1, 6]"],
		["[1.234, 5.678] rounded up", "[2, 6]"],
		["[12, 37] to nearest 10", "[10, 40]"],
		["[1000 m, 2000 m] in km", "[1.00 km, 2.00 km]"],
	])("%s is %s through evaluateExpression and evaluateLine", (line, answer) => {
		expect(outcome(line)).toBe(answer);
		expect(single(line)).toBe(answer);
	});

	test.each([
		["[1234, 5678] as sci", "written in scientific notation"],
		["[0.5, 0.25] as %", "written as a percentage"],
		["[1, 2] as fraction", "written as a fraction"],
		["[1234, 5678] in hex", "written in hex"],
		["[3, 4] as binary", "written in binary"],
	])("%s is refused by name, never a scalar", (line, done) => {
		const message = `${LIST_REFUSAL} ${done}: it holds several numbers, not one. Convert one value at a time.`;
		expect(outcome(line)).toBe(message);
		expect(single(line)).toBe(message);
	});

	test("int and as int cut a list cell by cell, and as number refuses it", () => {
		expect(outcome("int([1.5, -2.5])")).toBe("[1, -2]");
		expect(outcome("[1.5, -2.5] as int")).toBe("[1, -2]");
		expect(outcome("[1.5 km, 2.5 km] as int")).toBe("[1, 2]");
		expect(outcome("[1, 2] as number")).toBe(`${LIST_REFUSAL} read as one number: it holds several numbers, not one. Convert one value at a time.`);
	});

	// Open, found here and outside this change: the other one-number builtins
	// (sqrt, sin, log and the rest) still read a list as 0, so sqrt([4, 9])
	// answers 0. Reported with this batch; the fix turns this red.
	test.failing("found bug: sqrt([4, 9]) reads the list as 0 and answers 0", () => {
		expect(outcome("sqrt([4, 9])")).not.toBe("0");
	});

	test("through both document passes, which agree", () => {
		expect(both(["v = [0.001, 0.006]", "v to 4 dp", "round(v, 3)", "v * 1000 to 1 dp", "v as sci"])).toEqual([
			"[0.001, 0.006]",
			"[0.0010, 0.0060]",
			"[0.001, 0.006]",
			"[1.0, 6.0]",
			"ERROR A list cannot be written in scientific notation: it holds several numbers, not one. Convert one value at a time.",
		]);
	});

	test("a cell rounds as the same number does on its own line", () => {
		expect(outcome("[1.005, 2.675] to 2 dp")).toBe("[1.01, 2.68]");
		expect(outcome("1.005 to 2 dp")).toBe("1.01");
		expect(outcome("[0.1, 0.2] to 20 dp")).toBe("[0.10000000000000000000, 0.20000000000000000000]");
		expect(outcome("[1 km, 2.345 km] to 1 dp")).toBe("[1.0 km, 2.3 km]");
		expect(outcome("[$1.234, $5] to 1 dp")).toBe("[$1.2, $5.0]");
		expect(outcome("[1, 2; 3, 4] to 1 dp")).toBe("[1.0, 2.0; 3.0, 4.0]");
	});
});

describe("the parts: cellDecimal", () => {
	test("ordinary: the shortest decimal that reads back as the cell", () => {
		expect(decimalToString(cellDecimal(1.005)!)).toBe("1.005");
		expect(decimalToString(cellDecimal(-0.25)!)).toBe("-0.25");
		expect(decimalToString(cellDecimal(42)!)).toBe("42");
	});

	test("boundary: zero, negative zero, exponent forms and the extreme doubles", () => {
		expect(decimalToString(cellDecimal(0)!)).toBe("0");
		expect(decimalToString(cellDecimal(-0)!)).toBe("0");
		expect(decimalToString(cellDecimal(1e-7)!)).toBe("0.0000001");
		expect(decimalToString(cellDecimal(1e21)!)).toBe("1000000000000000000000");
		expect(cellDecimal(Number.MAX_VALUE)).toBeDefined();
		expect(cellDecimal(Number.MIN_VALUE)).toBeDefined();
	});

	test("hostile: no decimal for an infinity or a NaN", () => {
		expect(cellDecimal(Infinity)).toBeUndefined();
		expect(cellDecimal(-Infinity)).toBeUndefined();
		expect(cellDecimal(NaN)).toBeUndefined();
	});
});

describe("the parts: isManyCellList", () => {
	test("ordinary, boundary and hostile values", () => {
		expect(isManyCellList(matrixValue(1, 2, [1, 2]))).toBe(true);
		expect(isManyCellList(matrixValue(2, 2, [1, 2, 3, 4]))).toBe(true);
		expect(isManyCellList(matrixValue(1, 1, [1]))).toBe(false);
		expect(isManyCellList(matrixValue(0, 0, []))).toBe(false);
		expect(isManyCellList(numberValue(5))).toBe(false);
		expect(isManyCellList(boolValue(true))).toBe(false);
	});
});

describe("the parts: roundEachCell", () => {
	const toTwo = (cell: ReturnType<typeof numberValue>) => {
		const out = numberValue(Math.round(cell.toNumber() * 100) / 100);
		out.decimalPlaces = 2;
		return out;
	};

	test("ordinary: each cell rounded, in shape and unit, with its places", () => {
		const out = roundEachCell(matrixValue(1, 2, [1.234, 5.678]), toTwo, "rounded")!;
		const m = out.value as MatrixData;
		expect(m.data).toEqual([1.23, 5.68]);
		expect(m.places).toEqual([2, 2]);
		const km = roundEachCell(matrixValue(2, 1, [1, 2], "km"), (cell) => cell, "rounded")!;
		expect((km.value as MatrixData).unit).toBe("km");
		expect((km.value as MatrixData).rows).toBe(2);
		expect((km.value as MatrixData).places).toBeUndefined();
	});

	test("ordinary: each cell reaches the rounding as a number or quantity carrying its decimal", () => {
		const seen: string[] = [];
		roundEachCell(matrixValue(1, 2, [1.005, 2], "m"), (cell) => {
			seen.push(`${cell.type === ValueType.Uom ? cell.unit : "plain"} ${decimalToString(cell.exact!)}`);
			return cell;
		}, "rounded");
		expect(seen).toEqual(["m 1.005", "m 2"]);
	});

	test("boundary: not a list of several cells is left to the caller", () => {
		expect(roundEachCell(numberValue(1.5), toTwo, "rounded")).toBeNull();
		expect(roundEachCell(matrixValue(1, 1, [1.5]), toTwo, "rounded")).toBeNull();
		expect(roundEachCell(uomValue(2, "km"), toTwo, "rounded")).toBeNull();
	});

	test("hostile: a cell with no number refuses the list, and a refusing rounding is passed on", () => {
		const bool = roundEachCell(matrixValue(1, 2, [true, false]), toTwo, "rounded")!;
		expect(bool.errorCode).toBe("LIST_ROUNDING_NON_NUMERIC");
		expect(String(bool.errorMessage)).toBe("A list can be rounded only when every cell is a number: this one holds a true or false.");
		const refused = roundEachCell(matrixValue(1, 2, [1, 2]), () => listConversionRefused(matrixValue(1, 2, [1, 2]), "rounded")!, "rounded")!;
		expect(refused.errorCode).toBe("LIST_CONVERSION_UNSUPPORTED");
	});

	test("hostile: a large list is rounded in one walk", () => {
		const cells = Array.from({ length: 50_000 }, (_, i) => i / 7);
		const out = roundEachCell(matrixValue(1, cells.length, cells), toTwo, "rounded")!;
		expect((out.value as MatrixData).data.length).toBe(50_000);
	});
});

describe("the parts: listConversionRefused", () => {
	test("ordinary, boundary and hostile values", () => {
		expect(listConversionRefused(matrixValue(1, 2, [1, 2]), "written in hex")?.errorCode).toBe("LIST_CONVERSION_UNSUPPORTED");
		expect(listConversionRefused(matrixValue(1, 1, [1]), "written in hex")).toBeNull();
		expect(listConversionRefused(numberValue(1), "written in hex")).toBeNull();
		expect(String(listConversionRefused(matrixValue(1, 2, [1, 2]), "<b>x</b>")?.errorMessage)).toContain("<b>x</b>");
	});
});

describe("adversarial: security", () => {
	test("a prototype word as a cell is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("[X, 0.006] to 4 dp", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const line of fill("[X, 2] as sci", PROTOTYPE_WORDS)) expectHonestLine(line);
		});
	});

	test("a huge list and a long sum inside a list are rounded within the budget", () => {
		expectHonestLine(`[${Array.from({ length: 5_000 }, (_, i) => String(i / 3)).join(", ")}] to 2 dp`, { budgetMs: 5_000 });
		expectHonestLine(`[${RESOURCE_PROBES.longSum(2_000)}, 1] to 2 dp`, { budgetMs: 5_000 });
		expectHonestLine(`map(x/7, ${RESOURCE_PROBES.hugeRange()}) to 2 dp`, { budgetMs: 5_000 });
	});

	test("markup-shaped and look-alike text in a list is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`[${edge}, 1] to 2 dp`);
		expect(outcome("[1​, 2] to 2 dp")).not.toBe("0.00");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a list from the line above, a check of it and a section around it", () => {
		expect(both(["# Rates", "rates = [0.0125, 0.034]", "rates to 3 dp", "check sum(rates to 3 dp) == 0.047", "rates as %"])).toEqual([
			"",
			"[0.01, 0.03]",
			"[0.013, 0.034]",
			"✓",
			"ERROR A list cannot be written as a percentage: it holds several numbers, not one. Convert one value at a time.",
		]);
	});

	test("arithmetic after the rounding re-decides the precision, as for a number", () => {
		expect(outcome("([0.001, 0.006] to 4 dp) * 2")).toBe("[0.002, 0.012]");
		expect(outcome("sum([1.234, 5.678] to 1 dp)")).toBe("6.90");
	});

	test("an edit from a number to a list keeps the rounding honest", () => {
		expect(both(["v = 0.001", "v to 4 dp"])).toEqual(["0.001", "0.0010"]);
		expect(both(["v = [0.001, 0.002]", "v to 4 dp"])).toEqual(["[0.001, 0.002]", "[0.0010, 0.0020]"]);
	});

	test("a list of true and false is refused, not rounded around", () => {
		expect(outcome("[true, false] to 2 dp")).toBe("LIST_ROUNDING_NON_NUMERIC: A list can be rounded only when every cell is a number: this one holds a true or false.");
		expectHonestDocument("v = [1.5, 2.5]\nv rounded\nv to 1 dp\nv as fraction\nround(v)");
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negative zero, halves and negatives", () => {
		expect(outcome("[0, -0] to 2 dp")).toBe("[0.00, 0.00]");
		expect(outcome("[-1.5, 1.5] to 0 dp")).toBe("[-2, 2]");
		expect(outcome("[0.0049, 0.006] to 2 dp")).toBe("[0.00, 0.01]");
	});

	test("the largest place count, past it, and a list of one", () => {
		expect(outcome("[1, 2] to 101 dp")).toBe('INVALID_DECIMAL_PLACES: "to 101 dp": expected a place count between 0 and 100');
		expect(expectHonestLine("[1, 2] to 100 dp").kind).toBe("value");
		expect(outcome("[1.5] to 2 dp")).toBe("1.50");
	});

	test("every numeric edge as a cell is honest", () => {
		for (const line of fill("[X, 1] to 2 dp", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("[X, 1] to 3 sf", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["[0.001, 0.006] to 4 dp\r", ""])).toEqual(["[0.0010, 0.0060]", ""]);
	});
});
