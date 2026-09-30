import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { fixedArityError, builtinArityError } from "@solve-js/vm/VMBuiltinArity";
import { dotProduct, vectorLength, matrixMultiply } from "@solve-js/vm/MatrixOps";
import { floatOf, notPlainNumberKind } from "@solve-js/vm/PlainNumberForms";
import {
	ValueType,
	numberValue,
	stringValue,
	uomValue,
	percentageValue,
	boolValue,
	matrixValue,
	errorValue,
	bigIntValue,
	symbolicValue,
	type MatrixData,
} from "@solve-js/vm/Value";
import { varNode } from "@solve-js/symbolic";

/**
 * Issue #828: `vec2`, `vec3` and `vec4` did not check how many components they
 * were given (`vec2(1, 2, 3)` was [2, 3], `vec3(1, 2)` a stack underflow),
 * `dot` was a matrix product (two row vectors were refused, and a row and a
 * column gave a one-by-one matrix), and `float(2.5)` built a one-by-one matrix.
 * The keywords now refuse a wrong count by name, `dot` is the dot product of
 * two vectors, and `float` is the plain number its argument is.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function codeOf(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.type === ValueType.Error ? String(v.errorCode) : `value ${formatValue(v)}`;
	} catch (e) {
		return e instanceof EngineError ? e.code : `raw ${(e as Error).name}`;
	}
}

/** A row vector's storage. */
function row(...cells: number[]): MatrixData {
	return { rows: 1, cols: cells.length, data: cells, hasSymbolic: false };
}

/** A column vector's storage. */
function column(...cells: number[]): MatrixData {
	return { rows: cells.length, cols: 1, data: cells, hasSymbolic: false };
}

describe("vec2, vec3 and vec4 take exactly their count", () => {
	test.each([
		["vec2(1, 2)", "[1, 2]"],
		["vec3(1, 2, 3)", "[1, 2, 3]"],
		["vec4(1, 2, 3, 4)", "[1, 2, 3, 4]"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test.each([
		["vec2(1, 2, 3)", "vec2() takes 2 arguments, but was given 3 arguments"],
		["vec2(1)", "vec2() takes 2 arguments, but was given 1 argument"],
		["vec2()", "vec2() takes 2 arguments, but was given none"],
		["vec3(1, 2)", "vec3() takes 3 arguments, but was given 2 arguments"],
		["vec3(1, 2, 3, 4)", "vec3() takes 3 arguments, but was given 4 arguments"],
		["vec4(1, 2, 3)", "vec4() takes 4 arguments, but was given 3 arguments"],
		["vec4(1, 2, 3, 4, 5)", "vec4() takes 4 arguments, but was given 5 arguments"],
	])("%s is refused by name", (line, message) => {
		expect(show(line)).toBe(`THROWS ${message}`);
		expect(codeOf(line)).toBe("BUILTIN_ARITY_MISMATCH");
	});

	test("a wrong count never reaches the stack: the line above is untouched", () => {
		const lines = newTrackedEngine().parseDocument("x = 5\nvec3(1, 2)\nx + 1").lines;
		expect(lines[1].error).toBe("vec3() takes 3 arguments, but was given 2 arguments");
		expect(formatValue(lines[2].result!)).toBe("= 6");
	});
});

describe("dot is the dot product of two vectors", () => {
	test.each([
		["dot([1,2,3], [4,5,6])", "32"],
		["dot([1,2,3], [4;5;6])", "32"],
		["dot([1;2;3], [4,5,6])", "32"],
		["dot([1;2;3], [4;5;6])", "32"],
		["dot(vec3(1, 2, 3), vec3(4, 5, 6))", "32"],
		["dot([1, 0], [0, 1])", "0"],
		["dot([-1, 2], [3, -4])", "-11"],
		["dot(6, 7)", "42"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test.each([
		["dot([1,2], [4,5,6])", "dot needs two vectors of the same length, but one has 2 components and the other 3."],
		["dot(2, [1,2])", "dot needs two vectors of the same length, but one has 1 component and the other 2."],
		["dot([1,2;3,4], [5,6;7,8])", 'dot takes two vectors, and a 2x2 matrix is not one. For a matrix product, write "*".'],
		["dot([1,2], [1,2;3,4])", 'dot takes two vectors, and a 2x2 matrix is not one. For a matrix product, write "*".'],
	])("%s is refused by name", (line, message) => {
		expect(show(line)).toBe(message);
		expect(codeOf(line)).toBe("DIMENSION_MISMATCH");
	});

	test("the matrix product stays with *, and its refusal no longer carries an em-dash or an operator", () => {
		expect(show("[1,2;3,4] * [5,6;7,8]")).toBe("[19, 22; 43, 50]");
		expect(show("[1,2,3] * [4;5;6]")).toBe("[32]");
		const refusal = show("[1,2,3] * [4,5,6]");
		expect(refusal).toBe("Cannot multiply a 1x3 matrix by a 1x3 matrix: the first has 3 columns and the second 1 row, and the two must match.");
		expect(refusal).not.toMatch(/—|!==/);
	});
});

describe("float is the plain number its argument is", () => {
	test.each([
		["float(2.5)", "2.50"],
		["float(3)", "3"],
		["float(-0.5)", "-0.50"],
		["float(50%)", "0.50"],
		['float("2.5")', "2.50"],
		['float(" 1,234.5 ")', "1,234.50"],
		['float("-1e3")', "-1,000"],
		["float(2) + 3", "5"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test.each([
		['float("hello")', 'float takes a number, or text that is a number, and "hello" is not one.'],
		['float("12abc")', 'float takes a number, or text that is a number, and "12abc" is not one.'],
		["float([1, 2])", "float takes a plain number, not a bracketed list."],
		["float(5 km)", "float takes a plain number, not a length."],
		["float(£5)", "float takes a plain number, not money."],
		["float(true)", "float takes a plain number, not true or false."],
	])("%s is refused by name", (line, message) => {
		expect(show(line)).toBe(message);
		expect(codeOf(line)).toBe("FLOAT_TAKES_NUMBER");
	});

	test("a date is refused as every numeric builtin refuses one", () => {
		// float is called by name, so the refusal names it (FoundBug_textInNumericBuiltins).
		expect(show("float(1 Jan 2026)")).toMatch(/^float takes a number, not a date or time/);
	});

	test("float of a single-cell matrix is refused, not unwrapped", () => {
		expect(codeOf("float([2.5])")).toBe("FLOAT_TAKES_NUMBER");
	});
});

describe("the parts", () => {
	test("fixedArityError words and codes the refusal as a builtin's is", () => {
		const e = fixedArityError("vec3", 3, 2);
		expect(e.code).toBe("BUILTIN_ARITY_MISMATCH");
		expect(e.message).toBe("vec3() takes 3 arguments, but was given 2 arguments");
		expect(fixedArityError("vec2", 2, 0).message).toBe("vec2() takes 2 arguments, but was given none");
		expect(fixedArityError("vec2", 2, 1).message).toBe("vec2() takes 2 arguments, but was given 1 argument");
		expect(fixedArityError("f", 1, 1_000_000).message).toBe("f() takes 1 argument, but was given 1000000 arguments");
		// The same wording the dispatch-time check gives a builtin.
		expect(builtinArityError(66, 3)?.message).toBe("dot() takes 2 arguments, but was given 3 arguments");
		expect(builtinArityError(115, 2)?.message).toBe("float() takes 1 argument, but was given 2 arguments");
		expect(builtinArityError(115, 1)).toBeUndefined();
	});

	test("vectorLength reads a row, a column and nothing else", () => {
		expect(vectorLength(row(1, 2, 3))).toBe(3);
		expect(vectorLength(column(1, 2, 3))).toBe(3);
		expect(vectorLength(row(7))).toBe(1);
		expect(vectorLength(row())).toBe(0);
		expect(vectorLength({ rows: 2, cols: 2, data: [1, 2, 3, 4], hasSymbolic: false })).toBeNull();
	});

	test("dotProduct: ordinary, boundary and hostile shapes", () => {
		expect(dotProduct(row(1, 2, 3), row(4, 5, 6)).toNumber()).toBe(32);
		expect(dotProduct(row(1, 2, 3), column(4, 5, 6)).toNumber()).toBe(32);
		expect(dotProduct(row(), row()).toNumber()).toBe(0);
		// A sum starts from zero, so a product of negative zero adds to 0.
		expect(dotProduct(row(-0), row(1)).toNumber()).toBe(0);
		expect(dotProduct(row(1e308), row(10)).toNumber()).toBe(Infinity);
		expect(dotProduct(row(1, 2), row(1)).errorCode).toBe("DIMENSION_MISMATCH");
		expect(dotProduct({ rows: 2, cols: 2, data: [1, 2, 3, 4], hasSymbolic: false }, row(1, 2)).errorCode).toBe("DIMENSION_MISMATCH");
		// A symbolic component keeps the sum symbolic, and a constant one folds.
		const symbolic = matrixValue(1, 2, [varNode("x"), 2]).value as MatrixData;
		const dotted = dotProduct(symbolic, row(3, 4));
		expect(dotted.type).toBe(ValueType.Symbolic);
		expect(formatValue(dotted)).toBe("3x+8");
	});

	test("matrixMultiply is unchanged for shapes that line up", () => {
		const product = matrixMultiply(row(1, 2, 3), column(4, 5, 6));
		expect(product.type).toBe(ValueType.Matrix);
		expect((product.value as MatrixData).data).toEqual([32]);
	});

	test("notPlainNumberKind names each kind that is not a plain number", () => {
		expect(notPlainNumberKind(numberValue(1))).toBeUndefined();
		expect(notPlainNumberKind(percentageValue(0.5))).toBeUndefined();
		expect(notPlainNumberKind(bigIntValue(BigInt(10)))).toBeUndefined();
		expect(notPlainNumberKind(uomValue(5, "km"))).toBe("a length");
		expect(notPlainNumberKind(uomValue(5, "GBP"))).toBe("money");
		expect(notPlainNumberKind(boolValue(true))).toBe("true or false");
		expect(notPlainNumberKind(stringValue("x"))).toBe("text");
		expect(notPlainNumberKind(matrixValue(1, 1, [1]))).toBe("a bracketed list");
		expect(notPlainNumberKind(symbolicValue(varNode("x")))).toBe("an unknown");
	});

	test("floatOf: ordinary, boundary and hostile arguments", () => {
		expect(floatOf(numberValue(2.5)).toNumber()).toBe(2.5);
		expect(Object.is(floatOf(numberValue(-0)).toNumber(), -0)).toBe(true);
		expect(floatOf(percentageValue(0.5)).type).toBe(ValueType.Number);
		expect(floatOf(bigIntValue(BigInt("1152921504606846976"))).toNumber()).toBe(1152921504606846976);
		expect(floatOf(stringValue("1,000")).toNumber()).toBe(1000);
		expect(floatOf(stringValue("")).errorCode).toBe("FLOAT_TAKES_NUMBER");
		expect(floatOf(stringValue("1,00")).errorCode).toBe("FLOAT_TAKES_NUMBER");
		expect(floatOf(stringValue("NaN")).errorCode).toBe("FLOAT_TAKES_NUMBER");
		expect(floatOf(stringValue("Infinity")).errorCode).toBe("FLOAT_TAKES_NUMBER");
		// A long piece of text is quoted back only in part.
		const long = floatOf(stringValue("a".repeat(10_000)));
		expect(String(long.errorMessage).length).toBeLessThan(120);
		// An error is passed on, not wrapped.
		const fault = errorValue("SOMETHING", "went wrong");
		expect(floatOf(fault)).toBe(fault);
	});
});

describe("adversarial", () => {
	test("security: prototype words as components, arguments and float's text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const line of [`vec2(${word}, 1)`, `dot([${word}], [1])`, `float(${word})`, `float("${word}")`, `vec3(1, 2, ${word})`]) {
					expectHonestLine(line);
				}
			}
		});
	});

	test("security: long argument lists, long vectors and long text are refused or answered in time", () => {
		const many = Array.from({ length: 100 }, (_, i) => String(i)).join(", ");
		expect(codeOf(`vec2(${many})`)).toBe("BUILTIN_ARITY_MISMATCH");
		// Past the line's own limits the limit answers first, by name.
		const tooMany = Array.from({ length: 5_000 }, (_, i) => String(i)).join(", ");
		expect(codeOf(`vec2(${tooMany})`)).toBe("EXPRESSION_TOO_LONG");
		expectHonestLine(`dot(map(x*1, 1:100000), map(x*1, 1:100000))`, { budgetMs: 5_000 });
		expectHonestLine(`float(${RESOURCE_PROBES.longText()})`, { budgetMs: 5_000 });
		expectHonestLine(`float(${RESOURCE_PROBES.deepParens(500)})`);
	});

	test("security: look-alike and markup-shaped text inside float is read as text", () => {
		for (const text of TEXT_EDGES) {
			const quoted = JSON.stringify(text);
			expectHonestLine(`float(${quoted})`);
		}
		expect(codeOf('float("５")')).toBe("FLOAT_TAKES_NUMBER");
		expect(codeOf('float("<script>alert(1)</script>")')).toBe("FLOAT_TAKES_NUMBER");
	});

	test("realistic: a value from the line above, a typo, and the forms meeting each other", () => {
		const lines = newTrackedEngine().parseDocument("a = [1, 2, 3]\nb = [4; 5; 6]\ndot(a, b)\nfloat(dot(a, b)) / 2\nvec2(dot(a, b), 1)").lines;
		expect(lines.map((l) => (l.result ? formatValue(l.result) : l.error))).toEqual([
			"= [1, 2, 3]",
			"= [4; 5; 6]",
			"= 32",
			"= 16",
			"= [32, 1]",
		]);
		expect(codeOf("dott([1], [2])")).not.toMatch(/^raw/);
		expect(codeOf("vec3(1, 2 3)")).not.toMatch(/^raw/);
	});

	test("edge cases: the numeric corpus through each form", () => {
		for (const line of [...fill("vec2(X, 1)", NUMERIC_EDGES), ...fill("dot([X, 1], [2, 3])", NUMERIC_EDGES), ...fill("float(X)", NUMERIC_EDGES)]) {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		}
		expect(show("float(9007199254740993)")).toBe("9,007,199,254,740,992");
		expect(show("dot([1e308], [10])")).toBe("∞");
	});
});
