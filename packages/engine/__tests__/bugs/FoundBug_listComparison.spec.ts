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
import {
	boolValue,
	errorValue,
	matrixValue,
	numberValue,
	numberValueRational,
	percentageValue,
	stringValue,
	uomValue,
	ValueType,
	type MatrixData,
	type Value,
} from "@solve-js/vm/Value";
import { answersCellByCell, atListPrecision, isListOfAnswers, listAgainstOne, listConditionRefused } from "@solve-js/vm/ListComparison";
import { valuesEqual, valuesOrdered } from "@solve-js/vm/Comparisons";
import { logicalNot } from "@solve-js/packages/conditionals/NotFunctions";
import { checkComparison } from "@solve-js/packages/conditionals/CheckFunctions";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a list compared with one number answered a single true or false.
 *
 * `[100, 200] < 5` was true, `5 > [1, 2]` was true and `[100, 200] > 5` was
 * false. The comparison opcodes passed a list and a number to the general
 * order rule, whose last resort read each side through `toNumber()`, and a
 * list's number is 0. Two lists were already compared cell by cell, and `==`
 * between two lists gave a list of answers, so a list beside one value is now
 * compared cell by cell too (`listAgainstOne` in vm/ListComparison.ts, called
 * from `valuesEqual` and `valuesOrdered` in vm/Comparisons.ts once the cheap
 * number test has failed). A list of answers joins with `and`, `or`, `&&`
 * and `||` cell by cell and is negated cell by cell; where one answer is
 * needed, the condition of an `if`, it is refused by name
 * (`LIST_CONDITION_UNSUPPORTED`), and a `check` of a list names the list.
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

/** A Value as the reader sees it. */
function shown(value: Value | null): string {
	if (value === null) return "null";
	if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
	return formatValue(value).replace(/^=\s*/, "");
}

const IF_REFUSED =
	'LIST_CONDITION_UNSUPPORTED: "if" needs one true or false, and this is a list of 2 cells. Compare one cell, as in v[0] > 5, or choose for each cell with map, as in map(if x > 5 then 1 else 0, v).';

describe("the lines that exposed it", () => {
	test.each([
		["[100, 200] < 5", "[false, false]"],
		["[100, 200] > 5", "[true, true]"],
		["5 > [1, 2]", "[true, true]"],
		["[100, 200] > 150", "[false, true]"],
		["[100, 200] >= 200", "[false, true]"],
		["[100, 200] <= 100", "[true, false]"],
		["[100, 200] == 100", "[true, false]"],
		["[100, 200] != 100", "[false, true]"],
		["150 < [100, 200]", "[false, true]"],
		["150 >= [100, 200]", "[true, false]"],
		["100 == [100, 200]", "[true, false]"],
		["[1, 2] ≥ 2", "[false, true]"],
		["[1, 2] ≤ 1", "[true, false]"],
		["[1, 2; 3, 4] > 2", "[false, false; true, true]"],
		["[5] > 3", "[true]"],
	])("%s is %s through evaluateExpression and evaluateLine", (line, answer) => {
		expect(outcome(line)).toBe(answer);
		expect(single(line)).toBe(answer);
	});

	test.each([
		["[100 m, 200 m] > 150 m", "[false, true]"],
		["[1 km, 2 km] > 1500 m", "[false, true]"],
		["[1 km, 2 km] == 1000 m", "[true, false]"],
		["1500 m < [1 km, 2 km]", "[false, true]"],
		["[$100, $200] > $150", "[false, true]"],
		["[100 m, 200 m] != 100 m", "[false, true]"],
	])("a list with a unit compares each cell as the quantity it is: %s is %s", (line, answer) => {
		expect(outcome(line)).toBe(answer);
		expect(single(line)).toBe(answer);
	});

	test("two lists keep their answers, of one shape or refused by name", () => {
		expect(outcome("[1, 2] > [0, 3]")).toBe("[true, false]");
		expect(outcome("[100, 200] == [100, 300]")).toBe("[true, false]");
		expect(outcome("[1, 2] != [1, 2]")).toBe("[false, false]");
		expect(outcome("[1, 2] == [1, 2, 3]")).toBe("DIMENSION_MISMATCH: Cannot compare matrices of different shapes: 1x2 and 1x3");
		expect(outcome("[1, 2] < [1, 2, 3]")).toBe("DIMENSION_MISMATCH: Cannot compare matrices of different shapes: 1x2 and 1x3");
	});

	test("each cell agrees with the same comparison on its own line", () => {
		for (const [cells, other] of [[["100", "200", "-5", "0"], "100"], [["1 km", "2 km"], "1500 m"], [["$0.10", "$19.99"], "$1"]] as const) {
			for (const op of ["<", "<=", ">", ">=", "==", "!="]) {
				const list = `[${cells.join(", ")}] ${op} ${other}`;
				const alone = cells.map((cell) => outcome(`${cell} ${op} ${other}`));
				expect({ list, answer: outcome(list) }).toEqual({ list, answer: `[${alone.join(", ")}]` });
				const flipped = `${other} ${op} [${cells.join(", ")}]`;
				const flippedAlone = cells.map((cell) => outcome(`${other} ${op} ${cell}`));
				expect({ flipped, answer: outcome(flipped) }).toEqual({ flipped, answer: `[${flippedAlone.join(", ")}]` });
			}
		}
	});

	test("lists of answers join with and, or, && and || cell by cell, and negate cell by cell", () => {
		expect(outcome("[1, 2] > 1 and true")).toBe("[false, true]");
		expect(outcome("[1, 2] > 1 && true")).toBe("[false, true]");
		expect(outcome("[1, 2] > 1 || false")).toBe("[false, true]");
		expect(outcome("[1, 2] > 1 or false")).toBe("[false, true]");
		expect(outcome("([1, 2] > 1) and ([1, 2] > 0)")).toBe("[false, true]");
		expect(outcome("([1, 2] > 1) or ([1, 2] > 5)")).toBe("[false, true]");
		expect(outcome("([1, 2] == [1, 2]) and ([1, 2] == [1, 3])")).toBe("[true, false]");
		expect(outcome("true + [true, false]")).toBe("[true, false]");
		expect(outcome("[1, 2] > 1 and 1 > 0")).toBe("[false, true]");
		expect(outcome("not ([1, 2] > 1)")).toBe("[true, false]");
		expect(outcome("!([1, 2] > 1)")).toBe("[true, false]");
		expect(outcome("[1, 2] > 1 && [1, 2, 3] > 1")).toBe("DIMENSION_MISMATCH: Cannot compare matrices of different shapes: 1x2 and 1x3");
	});

	test("the forms that add numbers keep adding them", () => {
		expect(outcome("[1, 2] + true")).toBe("[2, 3]");
		expect(outcome("[true, false] + 1")).toBe("[2, 1]");
		expect(outcome("sum([1, 2] > 1)")).toBe("1");
		expect(outcome("true and false")).toBe("false");
		expect(outcome("2 and 3")).toBe("5");
	});

	test("an if needs one answer, so a list as its condition is refused by name", () => {
		expect(outcome("if [1, 2] > 0 then 1 else 2")).toBe(IF_REFUSED);
		expect(single("if [1, 2] > 0 then 1 else 2")).toBe(IF_REFUSED);
		expect(outcome("if [1, 2] then 1 else 2")).toBe(IF_REFUSED);
		expect(outcome("if [1] > 0 then 1 else 2")).toMatch(/is a list of one cell\./);
		expect(outcome("[1, 2] > 0 ? 1 : 2")).toMatch(/^TERNARY_UNSUPPORTED: /);
		expect(outcome("map(if x > 150 then 1 else 0, [100, 200])")).toBe("[0, 1]");
		expect(outcome("if [100, 200][1] > 150 then 1 else 0")).toBe("1");
	});

	test("a check gives one verdict, so a list in a check is refused naming the list", () => {
		const refusal = "CHECK_INCOMPARABLE: check: [1, 2] is a list, and a check gives one verdict, so it compares one value at a time: check one cell, as in check v[0] > 5";
		expect(outcome("check [1, 2] > 0")).toBe(refusal);
		expect(outcome("check 5 > [1, 2]")).toBe(refusal);
		expect(outcome("check [1, 2] == [1, 2]")).toMatch(/^CHECK_INCOMPARABLE: check: \[1, 2\] is a list.*check v\[0\] == 5$/);
		expect(outcome("check [100, 200][1] > 150")).toBe("✓");
	});

	test("through both document passes, which agree", () => {
		expect(both(["v = [100, 200]", "v > 150", "v == 100", "150 < v", "limit = 150 m", "[100 m, 200 m] > limit", "prev and true", "not (v > 150)", "if v > 150 then 1 else 0"])).toEqual([
			"[100, 200]",
			"[false, true]",
			"[true, false]",
			"[false, true]",
			"150.00 m",
			"[false, true]",
			"[false, true]",
			"[true, false]",
			`ERROR ${IF_REFUSED.replace(/^[A-Z_]+: /, "")}`,
		]);
	});
});

describe("the parts: listAgainstOne and atListPrecision", () => {
	const greater = (l: Value, r: Value): Value => valuesOrdered(l, r, 2);

	test("ordinary: each cell meets the one value in the order written, keeping the shape", () => {
		const seen: string[] = [];
		const out = listAgainstOne(matrixValue(2, 1, [100, 200]), numberValue(150), (l, r) => {
			seen.push(`${l.toNumber()} ${r.toNumber()}`);
			return greater(l, r);
		})!;
		expect(seen).toEqual(["100 150", "200 150"]);
		const m = out.value as MatrixData;
		expect([m.rows, m.cols, m.data]).toEqual([2, 1, [false, true]]);
		const flipped: string[] = [];
		listAgainstOne(numberValue(150), matrixValue(1, 2, [100, 200]), (l, r) => {
			flipped.push(`${l.toNumber()} ${r.toNumber()}`);
			return greater(l, r);
		});
		expect(flipped).toEqual(["150 100", "150 200"]);
	});

	test("ordinary: a cell carries the list's unit, and the answer has none", () => {
		const out = listAgainstOne(matrixValue(1, 2, [1, 2], "km"), uomValue(1500, "m"), (l, r) => {
			expect(l.type).toBe(ValueType.Uom);
			expect(l.unit).toBe("km");
			return greater(l, r);
		})!;
		expect((out.value as MatrixData).data).toEqual([false, true]);
		expect((out.value as MatrixData).unit).toBeUndefined();
	});

	test("boundary: no list, or two lists, is left to the caller; an empty list gives an empty list", () => {
		expect(listAgainstOne(numberValue(1), numberValue(2), greater)).toBeNull();
		expect(listAgainstOne(matrixValue(1, 1, [1]), matrixValue(1, 1, [2]), greater)).toBeNull();
		expect((listAgainstOne(matrixValue(0, 0, []), numberValue(1), greater)!.value as MatrixData).data).toEqual([]);
	});

	test("boundary: zero, negative zero, the extreme doubles, infinity and NaN cells", () => {
		const out = listAgainstOne(matrixValue(1, 6, [0, -0, Number.MAX_VALUE, Number.MIN_VALUE, Infinity, NaN]), numberValue(0), (l, r) => valuesEqual(l, r, false))!;
		expect((out.value as MatrixData).data).toEqual([true, true, false, false, false, false]);
	});

	test("hostile: the first cell's refusal refuses the list, and a rule's non-answer is passed on", () => {
		let calls = 0;
		const refused = listAgainstOne(matrixValue(1, 3, [1, 2, 3]), numberValue(1), () => {
			calls++;
			return errorValue("OWN", "own");
		})!;
		expect(refused.errorCode).toBe("OWN");
		expect(calls).toBe(1);
		expect(listAgainstOne(matrixValue(1, 2, [1, 2], "km"), uomValue(1, "kg"), greater)!.errorCode).toBe("INCOMPATIBLE_UNITS");
		expect(listAgainstOne(matrixValue(1, 1, [1]), numberValue(1), () => numberValue(7))!.toNumber()).toBe(7);
	});

	test("hostile: a large list is worked in one walk", () => {
		const cells = Array.from({ length: 50_000 }, (_, i) => i);
		const out = listAgainstOne(matrixValue(1, cells.length, cells), numberValue(25_000), greater)!;
		const data = (out.value as MatrixData).data;
		expect(data.length).toBe(50_000);
		expect(data.filter((cell) => cell === true).length).toBe(24_999);
	});

	test("atListPrecision drops an exact fraction or decimal and keeps every other value", () => {
		const third = numberValueRational(1 / 3, { n: 1n, d: 3n });
		const plain = atListPrecision(third);
		expect(plain.rational).toBeUndefined();
		expect(plain.toNumber()).toBe(1 / 3);
		const n = numberValue(5);
		expect(atListPrecision(n)).toBe(n);
		const km = uomValue(2, "km");
		expect(atListPrecision(km)).toBe(km);
		const text = stringValue("5");
		expect(atListPrecision(text)).toBe(text);
		expect(outcome("[1/3] == 1/3")).toBe("[true]");
		expect(outcome("[0.1 + 0.2] == 0.3")).toBe("[true]");
		expect(outcome("[$0.30] == $0.1 + $0.2")).toBe("[true]");
	});
});

describe("the parts: answersCellByCell, isListOfAnswers and listConditionRefused", () => {
	const both = (l: Value, r: Value): Value => boolValue(l.value === true && r.value === true);

	test("answersCellByCell pairs two lists cell with cell, and a list with one value", () => {
		expect(shown(answersCellByCell(matrixValue(1, 2, [true, false]), matrixValue(1, 2, [true, true]), both))).toBe("[true, false]");
		expect(shown(answersCellByCell(boolValue(true), matrixValue(1, 2, [true, false]), both))).toBe("[true, false]");
		expect(answersCellByCell(boolValue(true), boolValue(true), both)).toBeNull();
		expect(answersCellByCell(matrixValue(1, 2, [true, false]), matrixValue(2, 1, [true, true]), both)!.errorCode).toBe("DIMENSION_MISMATCH");
		expect(answersCellByCell(matrixValue(1, 2, [1, 2]), matrixValue(1, 2, [1, 2]), () => errorValue("OWN", "own"))!.errorCode).toBe("OWN");
		expect((answersCellByCell(matrixValue(0, 0, []), matrixValue(0, 0, []), both)!.value as MatrixData).data).toEqual([]);
	});

	test("isListOfAnswers is true only for a list whose every cell is a true or false", () => {
		expect(isListOfAnswers(matrixValue(1, 2, [true, false]))).toBe(true);
		expect(isListOfAnswers(matrixValue(1, 1, [false]))).toBe(true);
		expect(isListOfAnswers(matrixValue(1, 2, [true, 1]))).toBe(false);
		expect(isListOfAnswers(matrixValue(1, 2, [1, 0]))).toBe(false);
		expect(isListOfAnswers(matrixValue(0, 0, []))).toBe(false);
		expect(isListOfAnswers(boolValue(true))).toBe(false);
		expect(isListOfAnswers(numberValue(1))).toBe(false);
	});

	test("listConditionRefused counts the cells and names what needed one answer", () => {
		expect(shown(listConditionRefused(matrixValue(1, 2, [true, false]), "if"))).toBe(IF_REFUSED);
		expect(String(listConditionRefused(matrixValue(1, 1, [true]), "if").errorMessage)).toContain("a list of one cell.");
		expect(String(listConditionRefused(matrixValue(0, 0, []), "if").errorMessage)).toContain("a list of 0 cells.");
	});

	test("valuesEqual and valuesOrdered compare a list with one value cell by cell, and leave the rest as it was", () => {
		expect(shown(valuesOrdered(matrixValue(1, 2, [100, 200]), numberValue(150), 0))).toBe("[true, false]");
		expect(shown(valuesOrdered(numberValue(150), matrixValue(1, 2, [100, 200]), 3))).toBe("[true, false]");
		expect(shown(valuesEqual(matrixValue(1, 2, [100, 200]), numberValue(100), true))).toBe("[false, true]");
		expect(shown(valuesEqual(matrixValue(1, 2, [1, 2]), stringValue("a"), false))).toBe("false");
		expect(valuesOrdered(matrixValue(1, 2, [1, 2]), stringValue("a"), 0).errorCode).toBe("TEXT_COMPARISON");
		expect(valuesOrdered(matrixValue(1, 2, [1, 2]), errorValue("OWN", "own"), 0).errorCode).toBe("OWN");
		expect(shown(valuesOrdered(numberValue(1), numberValue(2), 0))).toBe("true");
		expect(shown(valuesOrdered(matrixValue(1, 2, [1, 2]), percentageValue(0.5), 2))).toBe("[true, true]");
	});

	test("logicalNot negates a list of answers cell by cell and still refuses a list of numbers", () => {
		expect(shown(logicalNot([matrixValue(1, 2, [true, false])]))).toBe("[false, true]");
		expect(logicalNot([matrixValue(1, 2, [1, 2])]).errorCode).toBe("NOT_NEEDS_BOOLEAN");
		expect(logicalNot([matrixValue(0, 0, [])]).errorCode).toBe("NOT_NEEDS_BOOLEAN");
	});

	test("checkComparison refuses a list on either side, quoting a long list short", () => {
		const long = matrixValue(1, 200, Array.from({ length: 200 }, (_, i) => i));
		const refused = checkComparison([long, numberValue(1), stringValue(">")]);
		expect(refused.errorCode).toBe("CHECK_INCOMPARABLE");
		expect(String(refused.errorMessage).length).toBeLessThan(220);
		expect(checkComparison([numberValue(1), matrixValue(1, 2, [1, 2]), stringValue("<=")]).errorMessage).toMatch(/check v\[0\] <= 5$/);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the list, a cell or the other side is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("[X, 200] > 150", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const line of fill("[100, 200] == X", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const line of fill("if X > [1, 2] then 1 else 2", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const word of PROTOTYPE_WORDS) expectHonestDocument(`${word} = [1, 2]\n${word} > 1\n!(prev)\nprev and true`);
		});
	});

	test("a huge list, a long sum, a huge range and deep brackets are compared within the budget", () => {
		expectHonestLine(`[${Array.from({ length: 5_000 }, (_, i) => String(i)).join(", ")}] > 2500`, { budgetMs: 5_000 });
		expectHonestLine(`[${RESOURCE_PROBES.longSum(2_000)}, 1] >= 5`, { budgetMs: 5_000 });
		expectHonestLine(`map(x, ${RESOURCE_PROBES.hugeRange()}) > 5`, { budgetMs: 5_000 });
		expectHonestLine(`[${RESOURCE_PROBES.deepParens(200)}, 3] == 1`, { budgetMs: 5_000 });
		expectHonestLine(`[1, 2] < ${RESOURCE_PROBES.hugePower()}`, { budgetMs: 5_000 });
		expectHonestDocument(RESOURCE_PROBES.manyLines(500, "!(prev)").replace(/^1\n/, "[1, 2] > 1\n"), { budgetMs: 10_000 });
	});

	test("look-alike, invisible and markup-shaped text in the list or the other side is read as text", () => {
		for (const edge of TEXT_EDGES) {
			expectHonestLine(`[${edge}, 200] > 150`);
			expectHonestLine(`[100, 200] == ${edge}`);
		}
		expect(outcome("[100​, 200] > 150")).toBe("[false, true]");
		expect(outcome("[100, 200] > ٥")).toBe("UNDEFINED_VARIABLE: Undefined variable: ٥");
		expect(outcome('[1, 2] == "<script>"')).toBe("false");
		expect(outcome('[1, 2] < "<b>1</b>"')).toMatch(/^TEXT_COMPARISON: /);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo, a unit that does not fit, text and a colour are honest refusals", () => {
		expect(outcome("[100, 200] > 15O")).toMatch(/^UNDEFINED_VARIABLE: /);
		expect(outcome("[1 km, 2 km] > 1 kg")).toBe("INCOMPATIBLE_UNITS: length and mass cannot be compared");
		expect(outcome("[1, 2] < \"a\"")).toBe('TEXT_COMPARISON: "a" on the right is text and the other side is a bracketed list, so they cannot be put in order.');
		expect(outcome("[1, 2] > #fff")).toMatch(/^COLOUR_ARITHMETIC: A colour cannot be put in order/);
		expect(outcome("[1 kg, 3 m] > 1")).toMatch(/^MATRIX_CELL_UNITS_DIFFER: /);
	});

	test("a plain list beside a quantity reads each cell as a plain number, as one plain number does", () => {
		expect(outcome("[1, 2] > 1 kg")).toBe(`[${outcome("1 > 1 kg")}, ${outcome("2 > 1 kg")}]`);
		expect(outcome("[1, 2] == 1 kg")).toBe(`[${outcome("1 == 1 kg")}, ${outcome("2 == 1 kg")}]`);
	});

	test("the feature meeting the others: a cell read, a sum, map, a conversion, a section and a value from the line above", () => {
		expect(outcome("([100, 200] > 150)[1]")).toBe("true");
		expect(outcome("sum([100, 200, 300] > 150)")).toBe("2");
		expect(outcome("map(x > 150, [100, 200])")).toBe("[false, true]");
		expect(outcome("[1 km, 2 km] in m > 1500 m")).toBe("[false, true]");
		expect(outcome("([100, 200] + 10%) > 150")).toBe("[false, true]");
		expect(outcome("([1, 2] > 1) as number")).toMatch(/^LIST_CONVERSION_UNSUPPORTED: /);
		const doc = both(["# Readings", "r = [12, 18, 25]", "## Over", "r > 20", "prev and r > 10", "sum(r > 15)"]);
		expect(doc.slice(1)).toEqual(["[12, 18, 25]", "", "[false, false, true]", "[false, false, true]", "2"]);
	});

	test("an edit from a number to a list, and back, follows through both passes", () => {
		expect(both(["v = 100", "v > 50"])).toEqual(["100", "true"]);
		expect(both(["v = [100, 20]", "v > 50"])).toEqual(["[100, 20]", "[true, false]"]);
		expect(both(["v = [100, 20]", "v > 50", "v = 30", "v > 50"])).toEqual(["[100, 20]", "[true, false]", "30", "false"]);
	});

	test("the single-line entry point agrees with the document on every form", () => {
		for (const line of ["[100, 200] > 150", "[1 km, 2 km] == 1000 m", "not ([1, 2] > 1)", "[1, 2] > 1 && true", "if [1, 2] > 0 then 1 else 2"]) {
			const alone = single(line);
			const inDocument = both([line])[0];
			expect(inDocument).toBe(/^[A-Z_]+: /.test(alone) ? `ERROR ${alone.replace(/^[A-Z_]+: /, "")}` : alone);
		}
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negative zero, negatives, 2^53, the extreme doubles, infinity and NaN", () => {
		expect(outcome("[0, -0] == 0")).toBe("[true, true]");
		expect(outcome("[-1, 1] < 0")).toBe("[true, false]");
		expect(outcome("[2^53, 2^53 + 2] > 2^53")).toBe("[false, true]");
		expect(outcome("[1e308, -1e308] > 0")).toBe("[true, false]");
		expect(outcome("[5e-324, 0] > 0")).toBe("[true, false]");
		expect(outcome("[1/0, 1] > 1e308")).toMatch(/^(\[true, false\]|[A-Z_]+: )/);
		expect(outcome("[0, 1] == 0/0")).toMatch(/^(\[false, false\]|[A-Z_]+: )/);
	});

	test("every numeric edge as a cell and as the other side is honest, and the two document passes agree", () => {
		for (const line of fill("[X, 200] > 150", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("[100, 200] <= X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("X != [$100, $200]", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const edge of NUMERIC_EDGES) expectHonestDocument(`v = [${edge}, 1]\nv > 0\n!(prev)`, { allowNaN: true });
	});

	test("CRLF, a trailing newline and padding", () => {
		expect(both(["[100, 200] > 150\r", ""])).toEqual(["[false, true]", ""]);
		expect(outcome("   [100, 200]   >   150   ")).toBe("[false, true]");
	});
});
