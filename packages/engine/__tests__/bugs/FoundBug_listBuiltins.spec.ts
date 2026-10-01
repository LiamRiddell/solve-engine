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
import { boolValue, errorValue, matrixValue, numberValue, uomValue, ValueType, type MatrixData, type Value } from "@solve-js/vm/Value";
import { applyEachCell, listArgumentRefused } from "@solve-js/vm/ListArguments";
import { EACH_CELL_BUILTINS, TAKES_LIST, builtinFunctions, callBuiltin, listBuiltinCall } from "@solve-js/vm/VMBuiltins";
import { builtinFunctionName } from "@solve-js/vm/VMBuiltinArity";
import { decimalToString } from "@solve-js/decimal";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `sqrt([4, 9])` answered 0.
 *
 * A list is a matrix, and a matrix reads as 0 wherever one number is asked of
 * it, so every builtin that reads one number (sqrt, sin, ln, fact, gcd, root
 * and the rest) answered a list with its answer for 0: `sqrt([4, 9])` was 0,
 * `cos([0, 1])` was 1, `fact([3, 4])` was 1 and `hex([10, 11])` was `0x0`.
 * The call is now decided once, where the VM calls a builtin
 * (`listBuiltinCall` in vm/VMBuiltins.ts): a function of one number with an
 * answer for each number (`EACH_CELL_BUILTINS`) is worked out for each cell
 * (`applyEachCell` in vm/ListArguments.ts), the way element-wise arithmetic
 * and the rounding family treat a list; a builtin that takes a list as it is
 * (`TAKES_LIST`) is left alone; and any other refuses a list by name
 * (`listArgumentRefused`, `LIST_ARGUMENT_UNSUPPORTED`), pointing at `map`.
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

/** The refusal a builtin read as single numbers gives a list. */
const REFUSED = (name: string): string =>
	`LIST_ARGUMENT_UNSUPPORTED: ${name} takes numbers, not a list: a list holds several numbers, and ${name} works on one at a time. To work it out for each number, use map, with x standing for each one.`;

/** The list form of a cell's answer, as the engine writes a list of plain numbers. */
function cellsOf(line: string): number[] {
	const value = newTrackedEngine().evaluateExpression(line);
	expect(value.type).toBe(ValueType.Matrix);
	return [...(value.value as MatrixData).data] as number[];
}

describe("the lines that exposed it", () => {
	test.each([
		["sqrt([4, 9])", "[2, 3]"],
		["sqrt([4, 9; 16, 25])", "[2, 3; 4, 5]"],
		["sqrt([4; 9])", "[2; 3]"],
		["cbrt([8, 27])", "[2, 3]"],
		["cos([0, 1])", "[1, 0.54]"],
		["sin([30 deg, 90 deg])", "[0.50, 1]"],
		["sind([30, 90])", "[0.50, 1]"],
		["ln([1, 2])", "[0, 0.69]"],
		["log10([10, 100])", "[1, 2]"],
		["exp([0, 1])", "[1, 2.72]"],
		["sign([-2, 3])", "[-1, 1]"],
		["trunc([1.5, -2.5])", "[1, -2]"],
		["fact([3, 4])", "[6, 24]"],
		["[3, 4]!", "[6, 24]"],
		["square root of [4, 9]", "[2, 3]"],
		["degtorad([180, 90])", "[3.14, 1.57]"],
		["sqrt([4 m2, 9 m2])", "[2.00 m, 3.00 m]"],
		["trunc([1.5 km, 2.5 km])", "[1.00 km, 2.00 km]"],
	])("%s is %s through evaluateExpression and evaluateLine", (line, answer) => {
		expect(outcome(line)).toBe(answer);
		expect(single(line)).toBe(answer);
	});

	test.each([
		["gcd([4, 6], 2)", "gcd"],
		["lcm([4, 6], 2)", "lcm"],
		["root(3, [8, 27])", "root"],
		["root([2, 3], 8)", "root"],
		["atan2([1, 2], 1)", "atan2"],
		["atan2(1, [1, 2])", "atan2"],
		["imul([2, 3], 4)", "imul"],
		["hex([10, 11])", "hex"],
		["bin([2, 3])", "bin"],
		["combination([5, 6], 2)", "combination"],
		["[3, 4] choose 2", "combination"],
		["permutation([5, 6], 2)", "permutation"],
		["isprime([2, 4])", "isprime"],
		["nextprime([2, 4])", "nextprime"],
		["modpow([2, 3], 3, 5)", "modpow"],
		["modinv([3, 4], 7)", "modinv"],
		["re([1, 2])", "re"],
		["im([1, 2])", "im"],
		["conj([1, 2])", "conj"],
		["log 8 base [2, 4]", "log"],
	])("%s is refused by name, never a number", (line, name) => {
		expect(outcome(line)).toBe(REFUSED(name));
		expect(single(line)).toBe(REFUSED(name));
	});

	test("every function worked for each number agrees with the same function on each number alone", () => {
		for (const index of EACH_CELL_BUILTINS) {
			const name = builtinFunctionName(index);
			for (const cells of [["0.5", "0.25"], ["2", "3"]]) {
				const alone = cells.map((cell) => newTrackedEngine().evaluateExpression(`${name}(${cell})`));
				const refused = alone.find((value) => value.isError());
				const list = `${name}([${cells.join(", ")}])`;
				if (refused !== undefined) expect({ list, answer: outcome(list) }).toEqual({ list, answer: `${String(refused.errorCode)}: ${String(refused.errorMessage)}` });
				else expect({ list, cells: cellsOf(list) }).toEqual({ list, cells: alone.map((value) => value.toNumber()) });
			}
		}
	});

	test("the builtins that take a list as it is keep their answers", () => {
		expect(outcome("total([1, 2])")).toBe("3");
		expect(outcome("det([1, 2; 3, 4])")).toBe("-2");
		expect(outcome("abs([1, 2; 3, 4])")).toBe("-2");
		expect(outcome("dot([1, 2], [3, 4])")).toBe("11");
		expect(outcome("transpose([1, 2])")).toBe("[1; 2]");
		expect(outcome("round([1.5, 2.4])")).toBe("[2, 2]");
		expect(outcome("int([1.5, 2.5])")).toBe("[1, 2]");
		expect(outcome("[2, 3] days")).toBe("[2 days, 3 days]");
		expect(outcome("map(sqrt(x), [4, 9])")).toBe("[2, 3]");
		expect(outcome("float([1, 2])")).toBe("FLOAT_TAKES_NUMBER: float takes a plain number, not a bracketed list.");
	});

	test("the phrase forms that read one number refuse a list, where they answered 0", () => {
		const unnamed = REFUSED("this").replace("this takes", "This calculation takes").replace("and this works", "and it works");
		expect(outcome("[1, 2] per hour")).toBe(unnamed);
		expect(outcome("[5, 10] / week")).toBe(unnamed);
		expect(outcome("[10, 20] km at 5 km/h")).toBe(unnamed);
		expect(outcome("split [$10, $20] between 3")).toBe(unnamed);
		expect(outcome("[90, 150] minutes in hours and minutes")).toBe(unnamed);
		expect(outcome("clamp [1, 5] between 2 and 4")).toBe(REFUSED("clamp"));
		expect(outcome("5 is to [1,2] as 3 is to what")).toBe(REFUSED("proportion"));
		expect(single("[1, 2] per hour")).toBe(unnamed);
	});

	test("a list of one cell is still the one number it is", () => {
		expect(outcome("sqrt([16])")).toBe("4");
		expect(outcome("gcd([4], 6)")).toBe("2");
	});

	test("through both document passes, which agree", () => {
		expect(both(["v = [4, 9]", "sqrt(v)", "sqrt(v) + 1", "sum(sqrt(v))", "gcd(v, 2)"])).toEqual([
			"[4, 9]",
			"[2, 3]",
			"[3, 4]",
			"5",
			`ERROR ${REFUSED("gcd").replace(/^[A-Z_]+: /, "")}`,
		]);
	});
});

describe("the parts: applyEachCell", () => {
	const root = (cell: Value): Value => numberValue(Math.sqrt(cell.toNumber()));

	test("ordinary: each cell worked out, in the list's shape", () => {
		const out = applyEachCell(matrixValue(2, 2, [4, 9, 16, 25]), "sqrt", root)!;
		const m = out.value as MatrixData;
		expect(m.data).toEqual([2, 3, 4, 5]);
		expect([m.rows, m.cols]).toEqual([2, 2]);
		expect(m.unit).toBeUndefined();
	});

	test("ordinary: a cell reaches the function as its quantity with its decimal, and the answer's unit is the list's", () => {
		const seen: string[] = [];
		const out = applyEachCell(matrixValue(1, 2, [1.005, 4], "m2"), "sqrt", (cell) => {
			seen.push(`${cell.type === ValueType.Uom ? cell.unit : "plain"} ${decimalToString(cell.exact!)}`);
			return uomValue(Math.sqrt(cell.toNumber()), "m");
		})!;
		expect(seen).toEqual(["m2 1.005", "m2 4"]);
		expect((out.value as MatrixData).unit).toBe("m");
	});

	test("boundary: not a list of several cells is left to the caller", () => {
		expect(applyEachCell(numberValue(4), "sqrt", root)).toBeNull();
		expect(applyEachCell(matrixValue(1, 1, [4]), "sqrt", root)).toBeNull();
		expect(applyEachCell(uomValue(4, "m2"), "sqrt", root)).toBeNull();
		expect(applyEachCell(boolValue(true), "sqrt", root)).toBeNull();
	});

	test("boundary: zero, negative zero and the extreme doubles as cells", () => {
		const out = applyEachCell(matrixValue(1, 4, [0, -0, Number.MAX_VALUE, Number.MIN_VALUE]), "sqrt", root)!;
		expect((out.value as MatrixData).data).toEqual([0, -0, Math.sqrt(Number.MAX_VALUE), Math.sqrt(Number.MIN_VALUE)]);
	});

	test("hostile: a cell that is not a number refuses the list", () => {
		const bool = applyEachCell(matrixValue(1, 2, [true, 4]), "sqrt", root)!;
		expect(bool.errorCode).toBe("LIST_CELL_UNSUPPORTED");
		expect(String(bool.errorMessage)).toBe("sqrt works on a list only when every cell is a number: this one holds a true or false.");
		const unnamed = applyEachCell(matrixValue(1, 2, [false, 4]), "", root)!;
		expect(String(unnamed.errorMessage)).toBe("This calculation works on a list only when every cell is a number: this one holds a true or false.");
	});

	test("hostile: a cell with no real answer refuses the list, naming the cell and its unit", () => {
		const complex = applyEachCell(matrixValue(1, 2, [4, -9]), "sqrt", () => boolValue(true))!;
		expect(complex.errorCode).toBe("LIST_CELL_UNSUPPORTED");
		expect(String(complex.errorMessage)).toBe("sqrt of 4 in this list has no real answer, and a list holds real numbers. Work that number out on its own line.");
		const km = applyEachCell(matrixValue(1, 2, [Infinity, 1], "km"), "sqrt", () => boolValue(true))!;
		expect(String(km.errorMessage)).toBe("sqrt of ∞ km in this list has no real answer, and a list holds real numbers. Work that number out on its own line.");
	});

	test("hostile: a cell's own refusal is passed on, and answers in two units are refused", () => {
		const refused = applyEachCell(matrixValue(1, 2, [1, 0]), "ln", (cell) => (cell.toNumber() === 0 ? errorValue("FUNCTION_DOMAIN", "no") : cell))!;
		expect(refused.errorCode).toBe("FUNCTION_DOMAIN");
		let k = 0;
		const mixed = applyEachCell(matrixValue(1, 2, [1, 2]), "f", (cell) => (k++ === 0 ? uomValue(cell.toNumber(), "m") : cell))!;
		expect(String(mixed.errorMessage)).toBe("f gives this list's numbers answers in different units, and a list carries one unit.");
	});

	test("hostile: a large list is worked out in one walk", () => {
		const cells = Array.from({ length: 50_000 }, (_, i) => i);
		const out = applyEachCell(matrixValue(1, cells.length, cells), "sqrt", root)!;
		expect((out.value as MatrixData).data.length).toBe(50_000);
	});
});

describe("the parts: listArgumentRefused", () => {
	test("ordinary, boundary and hostile arguments", () => {
		expect(listArgumentRefused("gcd", [matrixValue(1, 2, [4, 6]), numberValue(2)])?.errorCode).toBe("LIST_ARGUMENT_UNSUPPORTED");
		expect(listArgumentRefused("gcd", [numberValue(2), matrixValue(2, 1, [4, 6])])?.errorCode).toBe("LIST_ARGUMENT_UNSUPPORTED");
		expect(listArgumentRefused("gcd", [matrixValue(1, 1, [4]), numberValue(2)])).toBeNull();
		expect(listArgumentRefused("gcd", [])).toBeNull();
		expect(String(listArgumentRefused("", [matrixValue(1, 2, [1, 2])])?.errorMessage)).toBe(
			"This calculation takes numbers, not a list: a list holds several numbers, and it works on one at a time. To work it out for each number, use map, with x standing for each one.",
		);
		expect(String(listArgumentRefused("<b>x</b>", [matrixValue(1, 2, [1, 2])])?.errorMessage)).toContain("<b>x</b> takes numbers");
	});
});

describe("the parts: listBuiltinCall, EACH_CELL_BUILTINS and TAKES_LIST", () => {
	test("ordinary: a function of one number is worked for each cell, and one of several refuses", () => {
		const sqrt = listBuiltinCall(0, [matrixValue(1, 2, [4, 9])])!;
		expect((sqrt.value as MatrixData).data).toEqual([2, 3]);
		expect(listBuiltinCall(38, [matrixValue(1, 2, [4, 6]), numberValue(2)])?.errorCode).toBe("LIST_ARGUMENT_UNSUPPORTED");
	});

	test("boundary: no list, a list of one, and a builtin that takes a list are left to the call", () => {
		expect(listBuiltinCall(0, [numberValue(4)])).toBeNull();
		expect(listBuiltinCall(0, [matrixValue(1, 1, [4])])).toBeNull();
		expect(listBuiltinCall(64, [matrixValue(2, 2, [1, 2, 3, 4])])).toBeNull();
		expect(listBuiltinCall(44, [matrixValue(1, 2, [1, 2])])).toBeNull();
	});

	test("hostile: a builtin of one number given a second argument is refused, not worked for each cell", () => {
		expect(listBuiltinCall(0, [matrixValue(1, 2, [4, 9]), numberValue(1)])?.errorCode).toBe("LIST_ARGUMENT_UNSUPPORTED");
		expect(listBuiltinCall(9_999, [matrixValue(1, 2, [4, 9])])?.errorCode).toBe("LIST_ARGUMENT_UNSUPPORTED");
	});

	test("callBuiltin: ordinary, an unregistered index, and an entry planted on Object.prototype", () => {
		expect(callBuiltin(0, [numberValue(9)]).toNumber()).toBe(3);
		expect(callBuiltin(9_999, [numberValue(9)]).errorCode).toBe("UNKNOWN_BUILTIN_FUNCTION");
		expect(callBuiltin(-1, [numberValue(9)]).errorCode).toBe("UNKNOWN_BUILTIN_FUNCTION");
		expect(callBuiltin(Number.NaN, [numberValue(9)]).errorCode).toBe("UNKNOWN_BUILTIN_FUNCTION");
		const proto = Object.prototype as unknown as Record<number, unknown>;
		let called = false;
		proto[9_999] = () => {
			called = true;
			return numberValue(1);
		};
		try {
			expect(callBuiltin(9_999, [numberValue(9)]).errorCode).toBe("UNKNOWN_BUILTIN_FUNCTION");
			expect(called).toBe(false);
		} finally {
			delete proto[9_999];
		}
	});

	test("the two sets do not overlap, and every function worked for each cell takes one number by name", () => {
		for (const index of EACH_CELL_BUILTINS) {
			expect(TAKES_LIST.has(index)).toBe(false);
			expect(builtinFunctionName(index)).not.toBe("");
			expect(builtinFunctions[index]).toBeDefined();
		}
	});
});

describe("adversarial: security", () => {
	test("a prototype word as a cell is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("sqrt([X, 9])", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const line of fill("gcd([X, 6], 2)", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const word of PROTOTYPE_WORDS) expectHonestLine(`${word}([4, 9])`);
		});
	});

	test("a huge list, a long sum inside a list and a huge range are worked within the budget", () => {
		expectHonestLine(`sqrt([${Array.from({ length: 5_000 }, (_, i) => String(i)).join(", ")}])`, { budgetMs: 5_000 });
		expectHonestLine(`sin([${RESOURCE_PROBES.longSum(2_000)}, 1])`, { budgetMs: 5_000 });
		expectHonestLine(`sqrt(map(x, ${RESOURCE_PROBES.hugeRange()}))`, { budgetMs: 5_000 });
		expectHonestLine(`fact([${RESOURCE_PROBES.deepParens(200)}, 3])`, { budgetMs: 5_000 });
	});

	test("markup-shaped and look-alike text in a list is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`sqrt([${edge}, 4])`);
		expect(outcome("sqrt([4\u200B, 9])")).not.toBe("0");
		expect(outcome("sqrt([٤, 9])")).not.toBe("0");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a list from the line above, a check over it and a section around it", () => {
		expect(both(["# Sides", "areas = [4 m2, 9 m2]", "sides = sqrt(areas)", "check sum(sides) == 5 m", "gcd(areas, 2)"])).toEqual([
			"",
			"[4.00 m2, 9.00 m2]",
			"[2.00 m, 3.00 m]",
			"✓",
			`ERROR ${REFUSED("gcd").replace(/^[A-Z_]+: /, "")}`,
		]);
	});

	test("a typo, a unit that does not fit and a cell with no real answer are refused, not answered around", () => {
		expect(outcome("sqrt([4 km, 9 km])")).toBe("UNIT_ROOT_UNSUPPORTED: sqrt: a quantity in km has no square root with a unit; only an area has a length as its root.");
		expect(outcome("sin([1 km, 2 km])")).toBe("FUNCTION_TAKES_NUMBER: sin takes an angle or a plain number, not a length");
		expect(outcome("sqrt([4, -9])")).toBe("LIST_CELL_UNSUPPORTED: sqrt of -9 in this list has no real answer, and a list holds real numbers. Work that number out on its own line.");
		expect(outcome("ln([1, 0])")).toBe("FUNCTION_DOMAIN: ln(0) has no real value: ln is only defined for positive numbers.");
		expect(outcome("fact([3, 2.5])")).toBe(outcome("fact(2.5)"));
		expect(outcome("sqrt([true, 4])")).toBe("LIST_CELL_UNSUPPORTED: sqrt works on a list only when every cell is a number: this one holds a true or false.");
	});

	test("an edit from a number to a list keeps the answer honest", () => {
		expect(both(["v = 4", "sqrt(v)"])).toEqual(["4", "2"]);
		expect(both(["v = [4, 9]", "sqrt(v)"])).toEqual(["[4, 9]", "[2, 3]"]);
	});

	test("a list worked for each number meets rounding, arithmetic and a what-if", () => {
		expect(outcome("sqrt([2, 3]) to 3 dp")).toBe("[1.414, 1.732]");
		expect(outcome("sqrt([4, 9]) * 2")).toBe("[4, 6]");
		expectHonestDocument("v = [4, 9]\nsides = sqrt(v)\nsum(sides)\nsides as sci\nsides to 1 dp");
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negative zero, negatives and the quotients with no finite answer", () => {
		expect(outcome("sqrt([0, -0])")).toBe("[0, 0]");
		expect(outcome("sign([-0, 0])")).toBe("[0, 0]");
		expect(outcome("cbrt([-8, 8])")).toBe("[-2, 2]");
		expect(outcome("exp([1000, 1])")).toBe("[∞, 2.72]");
		expect(outcome("exp(1000)")).toBe("∞");
		expect(outcome("ln(1/0)")).toBe("∞");
		expect(outcome("ln([1, 1/0])")).toBe("[0, ∞]");
		expect(outcome("sqrt([1/0, 4])")).toBe("[∞, 2]");
	});

	test("2^53, the largest double and the largest factorial", () => {
		expect(outcome("sqrt([2^53, 4])")).toBe("[94,906,265.62, 2]");
		expect(outcome("fact([170, 171])")).toBe(outcome("fact(171)"));
		expect(expectHonestLine("sqrt([1e308, 4])").kind).toBe("value");
	});

	test("every numeric edge as a cell is honest", () => {
		for (const line of fill("sqrt([X, 4])", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("sin([X, 1])", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("gcd([X, 1], 2)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["sqrt([4, 9])\r", ""])).toEqual(["[2, 3]", ""]);
	});

	// Was open, found by this sweep: a percentage added to a list added the
	// percentage as a fraction to each cell. Fixed in FoundBug_listPercentage.
	test("found bug, fixed: [100, 200] + 10% adds a tenth of each cell", () => {
		expect(outcome("[100, 200] + 10%")).toBe("[110, 220]");
	});
});
