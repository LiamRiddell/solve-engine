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
import { boolValue, errorValue, matrixValue, numberValue, percentageValue, uomValue, ValueType, type MatrixData, type Value } from "@solve-js/vm/Value";
import { percentageBeforeListRefused, percentageMeetsList, type PercentageCell } from "@solve-js/vm/ListPercentage";
import { eachCellOf } from "@solve-js/vm/ListArguments";
import { unitListArithmetic } from "@solve-js/vm/MatrixUnits";
import { decimalToString } from "@solve-js/decimal";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `[100, 200] + 10%` answered `[100.10, 200.10]`.
 *
 * `100 + 10%` is 110: a percentage beside a quantity is a share of it. A list
 * is a matrix, and element-wise arithmetic read the percentage as its bare
 * fraction (`Value.toNumber`), so it added 0.1 to each cell; `- 10%` took 0.1
 * away; and a list with a unit (`[100 m, 200 m] + 10%`, `$[100, 200] * 10%`,
 * `10% of [$100, $200]`) refused the percentage outright. A percentage meeting
 * a list in `+` or `-` is now worked out for each cell by the rule one number
 * follows (`percentageMeetsList` in vm/ListPercentage.ts, called from the VM's
 * `listAddOrSubtract`), and a list with a unit multiplies and divides by a
 * percentage's fraction (`cellArithmetic` in vm/MatrixUnits.ts). A percentage
 * written before a plain list with `+` or `-` would make a list of
 * percentages, which a list cannot hold, so it is refused by name
 * (`LIST_PERCENTAGE_UNSUPPORTED`).
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

/** The refusal for a percentage before a plain list, with its code. */
const BEFORE_PLUS =
	"LIST_PERCENTAGE_UNSUPPORTED: A percentage plus a list would be a list of percentages, and a list holds plain numbers. To add the percentage to each number, write the list first, as in [100, 200] + 10%.";
const BEFORE_MINUS =
	"LIST_PERCENTAGE_UNSUPPORTED: A percentage less a list would be a list of percentages, and a list holds plain numbers. To take the percentage off each number, write the list first, as in [100, 200] - 10%.";

describe("the lines that exposed it", () => {
	test.each([
		["[100, 200] + 10%", "[110, 220]"],
		["[100, 200] - 10%", "[90, 180]"],
		["[100, 200] + 10 percent", "[110, 220]"],
		["[100, 200] - 10 percent", "[90, 180]"],
		["[100, 200] + -10%", "[90, 180]"],
		["[100, 200] - 100%", "[0, 0]"],
		["[100, 200] + 0%", "[100, 200]"],
		["[1, 2; 3, 4] + 10%", "[1.10, 2.20; 3.30, 4.40]"],
		["[0.1, 0.2] + 10%", "[0.11, 0.22]"],
		["[100] + 10%", "[110]"],
		["[100, 200] + 10% + 10%", "[121, 242]"],
		["[100, 200] - 10% - 10%", "[81, 162]"],
		["[100, 200] + (10% + 5%)", "[115.00, 230.00]"],
		["[100 m, 200 m] + 10%", "[110.00 m, 220.00 m]"],
		["[100 kg, 200 kg] - 10%", "[90.00 kg, 180.00 kg]"],
		["$[100, 200] + 10%", "[$110.00, $220.00]"],
		["[$100, $200] + 10%", "[$110.00, $220.00]"],
		["$[100, 200] - 10%", "[$90.00, $180.00]"],
		["[$0.10, $0.20] + 15%", "[$0.12, $0.23]"],
		["10% + [100 m, 200 m]", "[110.00 m, 220.00 m]"],
		["10% - [$100, $200]", "[$90.00, $180.00]"],
	])("%s is %s through evaluateExpression and evaluateLine", (line, answer) => {
		expect(outcome(line)).toBe(answer);
		expect(single(line)).toBe(answer);
	});

	test.each([
		["[100 m, 200 m] * 10%", "[10.00 m, 20.00 m]"],
		["[100 m, 200 m] / 10%", "[1,000.00 m, 2,000.00 m]"],
		["10% of [100 m, 200 m]", "[10.00 m, 20.00 m]"],
		["10% on [100 m, 200 m]", "[110.00 m, 220.00 m]"],
		["10% of $[100, 200]", "[$10.00, $20.00]"],
		["$[100, 200] * 10%", "[$10.00, $20.00]"],
		["10% on $[100, 200]", "[$110.00, $220.00]"],
		["$[100, 200] / 10%", "[$1,000.00, $2,000.00]"],
		["[100 m, 200 m] mod 30%", "[0.10 m, 0.20 m]"],
	])("a list with a unit multiplies and divides by a percentage's fraction: %s is %s", (line, answer) => {
		expect(outcome(line)).toBe(answer);
		expect(single(line)).toBe(answer);
	});

	test("the forms that already read a percentage of a list keep their answers", () => {
		expect(outcome("[100, 200] * 10%")).toBe("[10, 20]");
		expect(outcome("[100, 200] / 10%")).toBe("[1,000, 2,000]");
		expect(outcome("10% of [100, 200]")).toBe("[10, 20]");
		expect(outcome("10% on [100, 200]")).toBe("[110.00, 220.00]");
		expect(outcome("10% off [100, 200]")).toBe("[90, 180]");
		expect(outcome("10% off [100 m, 200 m]")).toBe("[90.00 m, 180.00 m]");
		expect(outcome("[100, 200] increased by 10%")).toBe("[110.00, 220.00]");
		expect(outcome("[100, 200] decreased by 10%")).toBe("[90, 180]");
		expect(outcome("10% * [100, 200]")).toBe("[10, 20]");
		expect(outcome("[100, 200] + 0.1")).toBe("[100.10, 200.10]");
	});

	test("each cell agrees with the same number on its own line", () => {
		for (const [cells, pct] of [[["100", "200", "0.1", "-50"], "10%"], [["1.005", "3"], "12.5%"], [["$0.10", "$19.99"], "15%"]] as const) {
			for (const sign of ["+", "-"]) {
				const list = `[${cells.join(", ")}] ${sign} ${pct}`;
				const alone = cells.map((cell) => outcome(`${cell} ${sign} ${pct}`));
				const answer = outcome(list);
				expect({ list, answer }).toEqual({ list, answer: `[${alone.join(", ")}]` });
			}
		}
	});

	test("a percentage before a plain list is refused by name, never a list of fractions", () => {
		expect(outcome("10% + [100, 200]")).toBe(BEFORE_PLUS);
		expect(outcome("10% - [100, 200]")).toBe(BEFORE_MINUS);
		expect(single("10% + [100, 200]")).toBe(BEFORE_PLUS);
		expect(outcome("10% + 100")).toBe("10,010.00%");
	});

	test("through both document passes, which agree", () => {
		expect(both(["v = [100, 200]", "v + 10%", "v - 10%", "10% of v", "rate = 10%", "v + rate", "prev + 10%", "10% + v"])).toEqual([
			"[100, 200]",
			"[110, 220]",
			"[90, 180]",
			"[10, 20]",
			"10.00%",
			"[110, 220]",
			"[121, 242]",
			`ERROR ${BEFORE_PLUS.replace(/^[A-Z_]+: /, "")}`,
		]);
	});
});

describe("the parts: percentageMeetsList", () => {
	const add: PercentageCell = (a, b) => numberValue(a.toNumber() * (1 + b.toNumber()));

	test("ordinary: each cell meets the percentage in the order written, keeping the shape", () => {
		const seen: string[] = [];
		const out = percentageMeetsList(matrixValue(2, 1, [100, 200]), percentageValue(0.1), 1, (a, b) => {
			seen.push(`${a.type}:${a.toNumber()} ${b.type}:${b.toNumber()}`);
			return add(a, b);
		})!;
		expect(seen).toEqual([`${ValueType.Number}:100 ${ValueType.Percentage}:0.1`, `${ValueType.Number}:200 ${ValueType.Percentage}:0.1`]);
		const m = out.value as MatrixData;
		expect([m.rows, m.cols]).toEqual([2, 1]);
		expect(m.data[0]).toBeCloseTo(110);
	});

	test("ordinary: a cell carries its unit and its exact decimal, and a percentage first stays first", () => {
		const seen: string[] = [];
		const out = percentageMeetsList(percentageValue(0.1), matrixValue(1, 2, [1.005, 4], "m"), -1, (a, b) => {
			seen.push(`${a.type === ValueType.Percentage ? "%" : "cell"} ${b.type === ValueType.Uom ? `${b.unit} ${decimalToString(b.exact!)}` : "?"}`);
			return uomValue(b.toNumber(), "m");
		})!;
		expect(seen).toEqual(["% m 1.005", "% m 4"]);
		expect((out.value as MatrixData).unit).toBe("m");
	});

	test("boundary: no percentage, no list, or neither, is left to the caller", () => {
		expect(percentageMeetsList(matrixValue(1, 2, [1, 2]), numberValue(0.1), 1, add)).toBeNull();
		expect(percentageMeetsList(numberValue(100), percentageValue(0.1), 1, add)).toBeNull();
		expect(percentageMeetsList(percentageValue(0.1), numberValue(100), 1, add)).toBeNull();
		expect(percentageMeetsList(percentageValue(0.1), percentageValue(0.2), 1, add)).toBeNull();
		expect(percentageMeetsList(boolValue(true), matrixValue(1, 2, [1, 2]), 1, add)).toBeNull();
	});

	test("boundary: an empty list, a list of one, zero, negative zero and the extreme doubles", () => {
		expect((percentageMeetsList(matrixValue(0, 0, []), percentageValue(0.1), 1, add)!.value as MatrixData).data).toEqual([]);
		expect((percentageMeetsList(matrixValue(1, 1, [100]), percentageValue(0.1), 1, add)!.value as MatrixData).data[0]).toBeCloseTo(110);
		const edges = percentageMeetsList(matrixValue(1, 4, [0, -0, Number.MAX_VALUE, Number.MIN_VALUE]), percentageValue(0), 1, add)!;
		expect((edges.value as MatrixData).data).toEqual([0, -0, Number.MAX_VALUE, Number.MIN_VALUE]);
	});

	test("hostile: a percentage before a plain list is refused, before any cell is worked", () => {
		let calls = 0;
		const out = percentageMeetsList(percentageValue(0.1), matrixValue(1, 2, [1, 2]), 1, (a, b) => {
			calls++;
			return add(a, b);
		})!;
		expect(out.errorCode).toBe("LIST_PERCENTAGE_UNSUPPORTED");
		expect(calls).toBe(0);
	});

	test("hostile: a cell that is not a number, a cell's own refusal and a rule with no reading refuse the list", () => {
		expect(percentageMeetsList(matrixValue(1, 2, [true, 2]), percentageValue(0.1), 1, add)!.errorCode).toBe("LIST_CELL_UNSUPPORTED");
		expect(percentageMeetsList(matrixValue(1, 2, [1, 2]), percentageValue(0.1), 1, () => errorValue("OWN", "own"))!.errorCode).toBe("OWN");
		const none = percentageMeetsList(matrixValue(1, 2, [1, 2]), percentageValue(0.1), -1, () => null)!;
		expect(none.errorCode).toBe("LIST_PERCENTAGE_UNSUPPORTED");
		expect(String(none.errorMessage)).toBe("A cell of this list cannot have a percentage taken from it: only a number or a quantity has a share.");
	});

	test("hostile: a large list is worked out in one walk", () => {
		const cells = Array.from({ length: 50_000 }, (_, i) => i);
		const out = percentageMeetsList(matrixValue(1, cells.length, cells), percentageValue(0.1), 1, add)!;
		expect((out.value as MatrixData).data.length).toBe(50_000);
	});
});

describe("the parts: percentageBeforeListRefused, eachCellOf and unitListArithmetic", () => {
	test("percentageBeforeListRefused gives the order that works for each sign", () => {
		expect(`${String(percentageBeforeListRefused(1).errorCode)}: ${String(percentageBeforeListRefused(1).errorMessage)}`).toBe(BEFORE_PLUS);
		expect(`${String(percentageBeforeListRefused(-1).errorCode)}: ${String(percentageBeforeListRefused(-1).errorMessage)}`).toBe(BEFORE_MINUS);
	});

	test("eachCellOf works a list of any size, where applyEachCell leaves a list of one to its caller", () => {
		const twice = (cell: Value): Value => numberValue(cell.toNumber() * 2);
		expect((eachCellOf(matrixValue(1, 1, [4]).value as MatrixData, "f", twice).value as MatrixData).data).toEqual([8]);
		expect((eachCellOf(matrixValue(2, 2, [1, 2, 3, 4]).value as MatrixData, "f", twice).value as MatrixData).data).toEqual([2, 4, 6, 8]);
		expect(eachCellOf(matrixValue(1, 2, [false, 4]).value as MatrixData, "", twice).errorCode).toBe("LIST_CELL_UNSUPPORTED");
		expect(eachCellOf(matrixValue(1, 2, [1, 2]).value as MatrixData, "", () => boolValue(true)).errorCode).toBe("LIST_CELL_UNSUPPORTED");
	});

	test("unitListArithmetic multiplies, divides and finds a remainder by a percentage's fraction", () => {
		const list = matrixValue(1, 2, [100, 200], "m");
		expect((unitListArithmetic("mul", list, percentageValue(0.1)).value as MatrixData).data).toEqual([10, 20]);
		expect((unitListArithmetic("mul", percentageValue(0.1), list).value as MatrixData).data).toEqual([10, 20]);
		expect((unitListArithmetic("div", list, percentageValue(0.5)).value as MatrixData).data).toEqual([200, 400]);
		expect((unitListArithmetic("mod", list, percentageValue(0.3)).value as MatrixData).unit).toBe("m");
		expect(unitListArithmetic("div", list, percentageValue(0)).isError()).toBe(false);
	});

	test("unitListArithmetic keeps its guard for a percentage added or taken away, which the VM answers first", () => {
		const list = matrixValue(1, 2, [100, 200], "m");
		expect(unitListArithmetic("add", list, percentageValue(0.1)).errorCode).toBe("MATRIX_UNIT_OPERATION_UNSUPPORTED");
		expect(unitListArithmetic("sub", percentageValue(0.1), list).errorCode).toBe("MATRIX_UNIT_OPERATION_UNSUPPORTED");
	});
});

describe("adversarial: security", () => {
	test("a prototype word as a cell or as the percentage is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("[X, 200] + 10%", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const line of fill("[100, 200] + X%", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const line of fill("X% + [100 m, 200 m]", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const word of PROTOTYPE_WORDS) expectHonestDocument(`${word} = 10%\n[100, 200] + ${word}`);
		});
	});

	test("a huge list, a long sum inside a list, a huge range and deep brackets are worked within the budget", () => {
		expectHonestLine(`[${Array.from({ length: 5_000 }, (_, i) => String(i)).join(", ")}] + 10%`, { budgetMs: 5_000 });
		expectHonestLine(`[${RESOURCE_PROBES.longSum(2_000)}, 1] - 10%`, { budgetMs: 5_000 });
		expectHonestLine(`map(x, ${RESOURCE_PROBES.hugeRange()}) + 10%`, { budgetMs: 5_000 });
		expectHonestLine(`[${RESOURCE_PROBES.deepParens(200)}, 3] + 10%`, { budgetMs: 5_000 });
		expectHonestLine(`[1, 2] + ${RESOURCE_PROBES.hugePower()}%`, { budgetMs: 5_000 });
		expectHonestDocument(RESOURCE_PROBES.manyLines(500, "prev + 1%").replace(/^1\n/, "[1, 2]\n"), { budgetMs: 10_000 });
	});

	test("look-alike, invisible and markup-shaped text in the list or the percentage is read as text", () => {
		for (const edge of TEXT_EDGES) {
			expectHonestLine(`[${edge}, 200] + 10%`);
			expectHonestLine(`[100, 200] + ${edge}%`);
		}
		expect(outcome("[100​, 200] + 10%")).toBe("[110, 220]");
		expect(outcome("[٥, 200] + 10%")).toBe("UNDEFINED_VARIABLE: Undefined variable: ٥");
		expect(outcome("[100, 200] + ٥%")).not.toMatch(/^\[/);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo, a unit that does not fit and a cell of true or false are honest refusals", () => {
		expect(outcome("[100, 200] + 10 percnt")).not.toMatch(/^\[100\.10/);
		expect(outcome("[true, 2] + 10%")).toBe("LIST_CELL_UNSUPPORTED: This calculation works on a list only when every cell is a number: this one holds a true or false.");
		expect(outcome("[100 m, 200 kg] + 10%")).toMatch(/^MATRIX_CELL_UNITS_DIFFER: /);
		expect(outcome("[100, foo] + 10%")).toBe("UNDEFINED_VARIABLE: Undefined variable: foo");
		expect(outcome("[100, 200] + [10%, 20%]")).not.toMatch(/^CRASHED/);
	});

	test("the feature meeting the others: rounding, a cell read, an aggregate, map, a conversion, a check and a section", () => {
		expect(outcome("round([100, 200] + 12.5%)")).toBe("[113, 225]");
		expect(outcome("[100, 200] + 10% to 2 dp")).toBe("[110.00, 220.00]");
		expect(outcome("([100, 200] + 10%)[1]")).toBe("220");
		expect(outcome("sum([100, 200] + 10%)")).toBe("330");
		expect(outcome("map(x + 10%, [100, 200])")).toBe(outcome("[100, 200] + 10%"));
		expect(outcome("([100 km, 200 km] + 10%) in m")).toBe("[110,000.00 m, 220,000.00 m]");
		const doc = both(["# Prices", "p = $[100, 200]", "p + 20% #tax", "## After", "sum(p + 20%)"]);
		expect(doc.slice(1, 3)).toEqual(["[$100.00, $200.00]", "[$120.00, $240.00]"]);
		expect(doc[4]).toBe("$360.00");
	});

	test("an edit from a number to a list, and back, follows through both passes", () => {
		expect(both(["v = 100", "v + 10%"])).toEqual(["100", "110"]);
		expect(both(["v = [100, 200]", "v + 10%"])).toEqual(["[100, 200]", "[110, 220]"]);
		expect(both(["v = [100, 200]", "v + 10%", "v = 300", "v + 10%"])).toEqual(["[100, 200]", "[110, 220]", "300", "330"]);
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negative zero, negatives and the percentage edges", () => {
		expect(outcome("[0, -0] + 10%")).toBe("[0, 0]");
		expect(outcome("[-100, 100] - 10%")).toBe("[-90, 90]");
		expect(outcome("[100, 200] - 200%")).toBe("[-100, -200]");
		expect(outcome("[1e308, 1] + 100%")).toBe("[∞, 2]");
		expect(outcome("[1.7976931348623157e308, 5e-324] + 10%")).toBe("[∞, 4.94e-324]");
		expect(outcome("[100, 200] + 1e400%")).toMatch(/^PERCENTAGE_OVERFLOW: /);
		expect(outcome("[9007199254740992, 1] + 10%")).toBe(`[${outcome("9007199254740992 + 10%")}, 1.10]`);
	});

	test("every numeric edge as a cell and as the percentage is honest, and the two document passes agree", () => {
		for (const line of fill("[X, 200] + 10%", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("[100, 200] - X%", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("X% + [$100, $200]", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const edge of NUMERIC_EDGES) expectHonestDocument(`v = [${edge}, 1]\nv + 10%`, { allowNaN: true });
	});

	test("CRLF, a trailing newline and padding", () => {
		expect(both(["[100, 200] + 10%\r", ""])).toEqual(["[110, 220]", ""]);
		expect(outcome("   [100, 200]   +   10%   ")).toBe("[110, 220]");
	});
});

describe("found bugs pinned by this sweep", () => {
	// Open, found by this sweep and not this change's: a list compared with
	// one number answers one true or false, so [100, 200] < 5 is true and
	// [100, 200] > 5 is false. Reported with this batch; the fix turns this red.
	test.failing("found bug: [100, 200] < 5 answers true", () => {
		expect(outcome("[100, 200] < 5")).not.toBe("true");
	});

	// Open, found by this sweep and not this change's: a percentage written
	// inside a list is stored as its fraction, so a list of percentages added
	// to a list adds the fractions. Reported with this batch; the fix turns
	// this red.
	test.failing("found bug: [100, 200] + [10%, 20%] adds the fractions", () => {
		expect(outcome("[100, 200] + [10%, 20%]")).not.toBe("[100.10, 200.20]");
	});
});
