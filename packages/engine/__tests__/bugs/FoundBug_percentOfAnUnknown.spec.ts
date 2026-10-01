import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { symbolicPercentChange } from "@solve-js/vm/SymbolicOps";
import { varNode, formatSymbolic, type SymbolicNode } from "@solve-js/symbolic";
import { ValueType, numberValue, symbolicValue, errorValue, type Value } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a percentage added to an unknown under the arrow added its bare
 * fraction. `foo + 10% =>` answered `foo+0.1`, where `200 + 10%` adds a tenth
 * of 200 and answers 220. The two readings are different formulas: once foo
 * is 200 the first says 200.1 and the second 220, so a formula written with
 * the arrow answered differently from the same line with a number in it, and
 * `solve(x + 10% = 220, x)` answered 219.9.
 *
 * A percentage on the right of an unknown now scales it, as it scales a number
 * (`symbolicPercentChange`): `foo + 10%` is `1.1foo` and `foo - 10%` is
 * `0.9foo`. A percentage on the left (`10% + foo`) keeps the reading `10% + 5`
 * has, a percentage whose value is `5.1`, so it stays `foo+0.1`.
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** A formula value's display, or the error's code. */
function asText(v: Value): string {
	if (v.type === ValueType.Error) return `ERROR ${v.value as string}`;
	if (v.type === ValueType.Symbolic) return formatSymbolic(v.value as SymbolicNode);
	return String(v.toNumber());
}

describe("the lines that exposed it", () => {
	test("a percentage added to or taken from an unknown is a share of it", () => {
		expect(shown("foo + 10% =>")).toBe("1.1foo");
		expect(shown("foo - 10% =>")).toBe("0.9foo");
		expect(shown("foo + 12.5% =>")).toBe("1.125foo");
		expect(shown("foo + 100% =>")).toBe("2foo");
	});

	test("the formula answers what the line with a number answers", () => {
		expect(both(["y = x + 10%", "x = 200", "y", "200 + 10%"])).toEqual(["1.1x", "200", "220", "220"]);
		expect(both(["y = x - 10%", "x = 200", "y", "200 - 10%"])).toEqual(["0.9x", "200", "180", "180"]);
	});

	test("an equation with a percentage of its unknown is solved for that reading", () => {
		expect(shown("solve(x + 10% = 220, x)")).toBe("200");
		expect(shown("solve(x - 10% = 180, x)")).toBe("200");
		expect(both(["x + 10% = 220", "x =>"])).toEqual(['x stored as an equation: solve with "x =>"', "200"]);
	});

	test("a formula takes the share whole, and percentages in a row compound", () => {
		expect(shown("(foo + 1) + 10% =>")).toBe("1.1(foo+1)");
		expect(shown("2foo + 10% =>")).toBe("2.2foo");
		expect(shown("foo + 10% + 10% =>")).toBe("1.21foo");
		expect(shown("(foo + 10%) - 10% =>")).toBe("0.99foo");
		expect(shown("-foo + 10% =>")).toBe("-1.1foo");
		expect(shown("sqrt(foo) + 10% =>")).toBe("1.1*sqrt(foo)");
	});

	test("the boundary: a percentage on the left keeps the reading a percentage plus a number has", () => {
		expect(shown("10% + foo =>")).toBe("foo+0.1");
		expect(shown("10% + 5")).toBe("510.00%");
		// Times, of and divided by were already a share of the unknown.
		expect(shown("foo * 10% =>")).toBe("0.1foo");
		expect(shown("10% of foo =>")).toBe("0.1foo");
	});
});

describe("the parts: symbolicPercentChange", () => {
	const foo = symbolicValue(varNode("foo"));

	test("ordinary: added and taken away", () => {
		expect(asText(symbolicPercentChange(foo, 0.1, 1))).toBe("1.1foo");
		expect(asText(symbolicPercentChange(foo, 0.1, -1))).toBe("0.9foo");
		expect(asText(symbolicPercentChange(foo, 0.25, 1))).toBe("1.25foo");
	});

	test("boundary: zero, negative zero, a whole and a negative share", () => {
		expect(asText(symbolicPercentChange(foo, 0, 1))).toBe("foo");
		expect(asText(symbolicPercentChange(foo, -0, -1))).toBe("foo");
		// All of it taken away leaves nothing, whatever foo is.
		expect(symbolicPercentChange(foo, 1, -1)).toEqual(numberValue(0));
		expect(asText(symbolicPercentChange(foo, 2, -1))).toBe("-foo");
		expect(asText(symbolicPercentChange(foo, -0.1, 1))).toBe("0.9foo");
	});

	test("boundary: a value that is not a formula is scaled as a number", () => {
		expect(symbolicPercentChange(numberValue(200), 0.1, 1).toNumber()).toBe(220);
	});

	test("hostile: no exact number to scale by, or an operand with none, is refused by code", () => {
		for (const fraction of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			expect(asText(symbolicPercentChange(foo, fraction, 1))).toBe("ERROR SYMBOLIC_NONFINITE_OPERAND");
		}
		expect(asText(symbolicPercentChange(errorValue("X", "y"), 0.1, 1))).toBe("ERROR SYMBOLIC_NONFINITE_OPERAND");
	});

	test("hostile: a prototype word is an ordinary unknown", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(asText(symbolicPercentChange(symbolicValue(varNode(word)), 0.1, 1))).toBe(`1.1${word}`);
		}
	});

	test("edge: the largest and smallest doubles stay exact or are refused, never a NaN", () => {
		for (const fraction of [Number.MAX_VALUE, Number.MIN_VALUE, 2 ** 53, 1e-300]) {
			const answer = asText(symbolicPercentChange(foo, fraction, 1));
			expect(answer).not.toMatch(/NaN|Infinity/);
		}
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`${word} + 10% =>`, `solve(${word} + 10% = 220, ${word})`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a long run of percentages compounds in time, or is refused by name", () => {
		const line = `foo${" + 10%".repeat(120)} =>`;
		expectHonestLine(line, { budgetMs: 5_000 });
	});

	test("an unknown deep in brackets takes its share", () => {
		expect(shown(`${"(".repeat(30)}foo${")".repeat(30)} + 10% =>`)).toBe("1.1foo");
	});

	test("a look-alike percent sign is not a percentage, and the line stays honest", () => {
		// The Arabic percent sign and the full-width one.
		expectHonestLine("foo + 10٪ =>");
		expectHonestLine("foo + 10％ =>");
	});

	test.each(fill("foo + 10% X =>", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the share: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text is read as text", () => {
		expectHonestLine("<i>foo</i> + 10% =>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a share from the line above, a check and a what-if over it", () => {
		expect(both(["tax = 20%", "price + tax =>"])).toEqual(["20.00%", "1.2price"]);
		expectHonestDocument("tax = 20%\ny = price + tax\nprice = 50\ny\ncheck y == 60");
		expect(both(["tax = 20%", "y = price + tax", "price = 50", "y"])).toEqual(["20.00%", "1.2price", "50", "60"]);
		expectHonestDocument("y = x + 10%\nx = 200\nline 1 with x = 300");
	});

	test("the share meets a quantity: refused by name, as a unit in a formula is", () => {
		expect(shown("foo + 10% km =>")).toMatch(/^A formula keeps no units/);
	});

	test("an edit that gives the unknown a value turns the formula into the number", () => {
		expect(both(["foo + 10% =>"])).toEqual(["1.1foo"]);
		expect(both(["foo = 200", "foo + 10% =>"])).toEqual(["200", "220"]);
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("foo + X% =>", NUMERIC_EDGES))("an unknown plus a numeric edge as a percentage: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
		expect(shown(line)).not.toMatch(/foo\+0\.\d/);
	});

	test("a share that is nearly nothing reads as the unknown itself", () => {
		expect(shown("foo + 1e-300% =>")).toBe("foo");
		expect(shown("foo + 0.0001% =>")).toBe("1.000001foo");
		expect(shown("foo + -0% =>")).toBe("foo");
	});

	test("CRLF and a trailing newline change nothing", () => {
		expect(both(["foo + 10% =>\r", ""])[0]).toBe("1.1foo");
	});
});
