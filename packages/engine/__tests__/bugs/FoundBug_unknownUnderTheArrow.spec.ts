import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { unknownNameIn } from "@solve-js/vm/SymbolicOps";
import { constNode, varNode, type SymbolicNode } from "@solve-js/symbolic";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { numberValue, percentageValue, stringValue, symbolicValue, uomValue } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: an unknown met by an operation that needs one amount answered
 * zero under the arrow. `foo percent =>` gave `= 0.00%` and `foo km =>` gave
 * `= 0.00 km`, while `foo percent` alone says `Undefined variable: foo`.
 *
 * The arrow evaluates with every name that has no value kept as a formula, so
 * that `foo + 1 =>` is `foo+1`. A formula has no single number, and
 * `Value.toNumber()` reports 0 for one; the operations that give a value a
 * unit, a percentage, a base, a fraction, scientific notation, `as number` or
 * a tolerance each read the formula through it. They now refuse it with the
 * error an ordinary line gives, naming the formula's first unknown
 * (`unknownNameIn`), and unary plus keeps the formula as the no-op it is. The
 * same reading reached a formula stored by a bare assignment (`y = x + 1`,
 * then `y km`) without any arrow, and is refused the same way.
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

describe("the lines that exposed it", () => {
	test.each([
		"foo percent =>", "foo% =>", "foo as % =>", "foo to % =>", "foo in % =>", "foo as percentage =>", "foo% of 10 =>",
		"foo km =>", "foo kg =>", "foo m/s =>", "2 * foo km =>", "(foo + 1) km =>", "foo km + 1 =>", "foo km in m =>",
		"$foo =>", "foo usd =>", "€foo =>", "foo GBP =>", "foo hours =>", "foo minutes + 5 =>", "foo celsius =>",
		"foo as hex =>", "foo as binary =>", "foo as fraction =>", "foo as sci =>", "foo as number =>", "foo +/- 1 =>",
	])("%s is refused as the undefined name it holds", (line) => {
		expect(shown(line)).toBe("THROWS Undefined variable: foo");
	});

	test("the refusal is the one the line without the arrow gives", () => {
		for (const line of ["foo percent", "foo km", "$foo", "foo as hex"]) {
			expect({ line, arrow: shown(`${line} =>`) }).toEqual({ line, arrow: shown(line) });
		}
	});

	test("the refusal carries the code an undefined name has", () => {
		let code = "";
		try {
			newTrackedEngine().evaluateExpression("foo percent =>");
		} catch (e) {
			code = (e as { code: string }).code;
		}
		expect(code).toBe("UNDEFINED_VARIABLE");
	});

	test("an unknown in arithmetic stays a formula, as the arrow is for", () => {
		expect(shown("foo =>")).toBe("foo");
		expect(shown("foo + 1 =>")).toBe("foo+1");
		expect(shown("foo * 2 =>")).toBe("2foo");
		expect(shown("-foo =>")).toBe("-foo");
		expect(shown("10% of foo =>")).toBe("0.1foo");
		expect(shown("round(foo) =>")).toBe("round(foo)");
	});

	test("unary plus keeps the formula, as it keeps every other value", () => {
		expect(shown("+foo =>")).toBe("foo");
		expect(shown("+(foo + 1) =>")).toBe("foo+1");
		expect(shown("+5 =>")).toBe("5");
	});

	test("a name with a value takes its unit or percentage as before", () => {
		expect(both(["x = 3", "x percent =>", "x km =>", "x as hex =>"])).toEqual(["3", "3.00%", "3.00 km", "0x3"]);
		expect(shown("5 percent =>")).toBe("5.00%");
		expect(shown("5 km =>")).toBe("5.00 km");
	});

	test("the refusals that already named the unknown are unchanged", () => {
		expect(shown("foo in km =>")).toBe("An unknown has no single amount to convert to km: only a number or a quantity can be converted.");
		expect(shown("foo as multiplier =>")).toBe('A multiplier is a plain number or a percentage, as in "0.5 as multiplier" or "50% as multiplier", not an unknown.');
	});
});

describe("the parts: unknownNameIn", () => {
	test("ordinary: the first unknown of a formula, in the order written", () => {
		expect(unknownNameIn(symbolicValue(varNode("foo")))).toBe("foo");
		expect(unknownNameIn(symbolicValue({ kind: "add", left: varNode("b"), right: varNode("a") }))).toBe("b");
		expect(unknownNameIn(symbolicValue({ kind: "add", left: constNode(1), right: varNode("rate") }))).toBe("rate");
	});

	test("boundary: a value that is not a formula has none", () => {
		expect(unknownNameIn(numberValue(0))).toBeNull();
		expect(unknownNameIn(numberValue(-0))).toBeNull();
		expect(unknownNameIn(percentageValue(0.5))).toBeNull();
		expect(unknownNameIn(uomValue(5, "km"))).toBeNull();
		expect(unknownNameIn(stringValue("foo"))).toBeNull();
	});

	test("boundary: a formula with no unknown left has none", () => {
		expect(unknownNameIn(symbolicValue(constNode(3)))).toBeNull();
	});

	test("hostile: a prototype word is an ordinary unknown's name", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(unknownNameIn(symbolicValue(varNode(word)))).toBe(word);
		}
	});

	test("hostile: a formula as deep as the size guard admits is read without overflowing the stack", () => {
		let deep: SymbolicNode = varNode("deep");
		for (let i = 0; i < 9_000; i++) deep = { kind: "neg", operand: deep };
		expect(unknownNameIn(symbolicValue(deep))).toBe("deep");
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`${word} percent =>`, `${word} km =>`, `$${word} =>`, `${word} as hex =>`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			const outcome = expectHonestLine(line);
			expect(outcome.kind).not.toBe("value");
		});
	});

	test("a long sum of unknowns before a unit is refused in time", () => {
		const line = `(${RESOURCE_PROBES.longSum(2_000).replace(/\d+/g, "a")}) km =>`;
		expectHonestLine(line, { budgetMs: 5_000 });
		expect(shown(line)).toMatch(/^THROWS /);
	});

	test.each(fill("X percent =>", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge before percent: %j", (line) => {
		expectHonestLine(line);
	});

	test("a look-alike name is its own unknown, refused under its own spelling", () => {
		// A Cyrillic о in place of the Latin o.
		expect(shown("fоo percent =>")).toBe("THROWS Undefined variable: fоo");
	});

	test("markup-shaped text before a unit is read as text", () => {
		expectHonestLine("<b>foo</b> km =>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a formula stored by a bare assignment is refused the same way, with no arrow", () => {
		expect(both(["y = x + 1", "y km", "y percent", "y as hex", "y + 1"])).toEqual([
			"x+1", "THREW: Undefined variable: x", "THREW: Undefined variable: x", "THREW: Undefined variable: x", "x+2",
		]);
	});

	test("the formula answers once its unknown has a value above it", () => {
		expect(both(["y = x + 1", "x = 2", "y km", "y percent =>"])).toEqual(["x+1", "2", "3.00 km", "3.00%"]);
	});

	test("a typo in a defined name is refused with the nearest name, as without the arrow", () => {
		const lines = ["rate = 5", "rat percent =>", "rat percent"];
		const answers = both(lines);
		expect(answers[1]).toBe(answers[2]);
		expect(answers[1]).toMatch(/^THREW: Undefined variable: rat/);
	});

	test("a check and a what-if over the refused line stay honest", () => {
		expectHonestDocument("a = 5\nfoo percent =>\ncheck line 2 == 5%");
		expectHonestDocument("a = 5\nfoo km =>\nline 2 with foo = 3");
	});

	test("after a snapshot round trip the line is still refused, never 0.00 km", () => {
		// A snapshot keeps values, and a formula is not one, so the restored
		// engine has no y at all; either way the answer is a refusal.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "y = x + 1");
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			expect(() => restored.evaluateExpression("y km")).toThrow(/^Undefined variable: [xy]$/);
		} finally {
			restored.clear();
		}
	});

	test("an edit that gives the unknown a value turns the refusal into the answer", () => {
		expect(both(["foo percent =>"])).toEqual(["THREW: Undefined variable: foo"]);
		expect(both(["foo = 12", "foo percent =>"])).toEqual(["12", "12.00%"]);
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("y = x + X\ny km\ny percent", NUMERIC_EDGES))("a formula over a numeric edge: %j", (text) => {
		expectHonestDocument(text, { allowNaN: text.includes("0/0") });
	});

	test.each(fill("X percent =>", NUMERIC_EDGES))("a number before percent under the arrow: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("zero and negative zero with a unit under the arrow are amounts, not unknowns", () => {
		expect(shown("0 km =>")).toBe("0.00 km");
		expect(shown("-0 percent =>")).toBe("0.00%");
	});

	test("an empty and a whitespace-only line before the arrow say what is missing", () => {
		expect(shown("=>")).toMatch(/^THROWS "=>" needs an expression/);
		expect(shown("   =>")).toMatch(/^THROWS "=>" needs an expression/);
	});

	test("CRLF and a trailing newline change nothing", () => {
		expect(both(["foo percent =>\r", ""])[0]).toBe("THREW: Undefined variable: foo");
	});
});
