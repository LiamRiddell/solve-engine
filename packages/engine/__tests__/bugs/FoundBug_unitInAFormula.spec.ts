import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { solveEquationValues, symbolicBuiltin, symbolicPow, symbolicQuantityRefused } from "@solve-js/vm/SymbolicOps";
import { constNode, varNode } from "@solve-js/symbolic";
import { ValueType, numberValue, percentageValue, stringValue, symbolicValue, uomValue, type Value } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: arithmetic between an unknown and a quantity dropped the unit.
 * `foo * 5 km =>` answered `5foo`, `5 km / foo =>` `5/foo` and `solve(2x = 4
 * km, x)` `2`, the kilometres gone without a word. A formula is algebra on
 * numbers and its tree has nowhere to keep a unit, so the arithmetic read the
 * quantity as its bare number.
 *
 * The symbolic page said nothing about carrying a unit into a formula, so the
 * honest minimum is a refusal by name: the line now says a formula keeps no
 * units, names the unknown and the unit it would lose, and points at giving the
 * unknown a value or leaving the unit off (`SYMBOLIC_QUANTITY_OPERAND`). The
 * same refusal covers a power, a function call and the two sides of `solve`.
 */

const REFUSAL = 'A formula keeps no units, so combining "foo" with an amount in km would drop the km. Give "foo" a value on a line above, or write the formula without the unit.';

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

/** The code of an error-typed value. */
function codeOf(v: Value | null): string | null {
	return v !== null && v.type === ValueType.Error ? (v.value as string) : null;
}

describe("the lines that exposed it", () => {
	test.each(["foo * 5 km =>", "5 km * foo =>", "foo + 5 km =>", "foo - 5 km =>", "foo / 5 km =>", "5 km / foo =>", "(5 km)^foo =>", "hypot(foo, 5 km) =>", "(foo + 1) * 5 km * 2 =>"])(
		"%s is refused naming the unknown and the unit",
		(line) => {
			expect(shown(line)).toBe(REFUSAL);
		},
	);

	test("money and other units are refused the same way, each named", () => {
		expect(shown("foo - $5 =>")).toMatch(/^A formula keeps no units, so combining "foo" with an amount in USD would drop the USD\./);
		expect(shown("sqrt(foo) * 2 kg =>")).toMatch(/with an amount in kg would drop the kg\./);
		expect(shown("foo * 3 hours =>")).toMatch(/^A formula keeps no units/);
	});

	test("the refusal carries its code", () => {
		const v = newTrackedEngine().evaluateExpression("foo * 5 km =>");
		expect(codeOf(v)).toBe("SYMBOLIC_QUANTITY_OPERAND");
	});

	test("solve refuses a side with a unit, naming the unknown it solves for", () => {
		expect(shown("solve(2x = 4 km, x)")).toBe('A formula keeps no units, so combining "x" with an amount in km would drop the km. Give "x" a value on a line above, or write the formula without the unit.');
		expect(shown("solve(4 km = 2x, x)")).toMatch(/^A formula keeps no units/);
	});

	test("arithmetic with plain numbers and percentages stays a formula", () => {
		expect(shown("foo * 5 =>")).toBe("5foo");
		expect(shown("foo * 50% =>")).toBe("0.5foo");
		expect(shown("foo + 5 =>")).toBe("foo+5");
		expect(shown("solve(2x = 4, x)")).toBe("2");
	});

	test("once the unknown has a value the unit is kept", () => {
		expect(both(["foo = 3", "foo * 5 km =>", "5 km / foo =>"])).toEqual(["3", "15.00 km", "1.67 km"]);
	});

	test("a formula stored by a bare assignment is refused the same way when a unit meets it", () => {
		expect(both(["y = x * 2", "y * 5 km", "x = 4", "y * 5 km"])).toEqual(["2x", REFUSAL.replace(/"foo"/g, '"x"'), "4", "40.00 km"]);
	});
});

describe("the parts: symbolicQuantityRefused", () => {
	const foo = symbolicValue(varNode("foo"));

	test("ordinary: a quantity on either side of a formula is refused", () => {
		expect(codeOf(symbolicQuantityRefused(foo, uomValue(5, "km")))).toBe("SYMBOLIC_QUANTITY_OPERAND");
		expect(codeOf(symbolicQuantityRefused(uomValue(5, "km"), foo))).toBe("SYMBOLIC_QUANTITY_OPERAND");
		expect(formatValue(symbolicQuantityRefused(foo, uomValue(5, "km"))!)).toBe(REFUSAL);
	});

	test("boundary: no quantity, or a quantity with no unit, is not refused", () => {
		expect(symbolicQuantityRefused(foo, numberValue(5))).toBeNull();
		expect(symbolicQuantityRefused(foo, percentageValue(0.1))).toBeNull();
		expect(symbolicQuantityRefused(numberValue(0), foo)).toBeNull();
		expect(symbolicQuantityRefused(foo, foo)).toBeNull();
		expect(symbolicQuantityRefused(foo, stringValue("km"))).toBeNull();
	});

	test("boundary: zero, negative zero and a negative amount are still amounts in a unit", () => {
		for (const amount of [0, -0, -5, Number.MAX_VALUE, Number.MIN_VALUE]) {
			expect(codeOf(symbolicQuantityRefused(foo, uomValue(amount, "km")))).toBe("SYMBOLIC_QUANTITY_OPERAND");
		}
	});

	test("boundary: a formula with no unknown left is described without a name", () => {
		const message = formatValue(symbolicQuantityRefused(symbolicValue(constNode(3)), uomValue(5, "km"))!);
		expect(message).toContain("combining an unknown with an amount in km");
		expect(message).toContain("Give the unknown a value");
	});

	test("hostile: a prototype word is named as an ordinary unknown", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(formatValue(symbolicQuantityRefused(symbolicValue(varNode(word)), uomValue(1, "m"))!)).toContain(`"${word}"`);
		}
	});

	test("a power, a call and solve refuse through it too", () => {
		expect(codeOf(symbolicPow(uomValue(5, "km"), foo))).toBe("SYMBOLIC_QUANTITY_OPERAND");
		expect(codeOf(symbolicPow(foo, uomValue(2, "km")))).toBe("SYMBOLIC_QUANTITY_OPERAND");
		expect(codeOf(symbolicBuiltin(26, [foo, uomValue(3, "km")]))).toBe("SYMBOLIC_QUANTITY_OPERAND");
		expect(codeOf(solveEquationValues(foo, uomValue(4, "km"), "foo"))).toBe("SYMBOLIC_QUANTITY_OPERAND");
		expect(codeOf(solveEquationValues(uomValue(4, "km"), foo, "foo"))).toBe("SYMBOLIC_QUANTITY_OPERAND");
		// Without a unit the same calls build their formulas.
		expect(symbolicPow(numberValue(5), foo).type).toBe(ValueType.Symbolic);
		expect(symbolicBuiltin(26, [foo, numberValue(3)]).type).toBe(ValueType.Symbolic);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`${word} * 5 km =>`, `5 km / ${word} =>`, `solve(2${word} = 4 km, ${word})`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			const outcome = expectHonestLine(line);
			expect(outcome.kind).not.toBe("value");
		});
	});

	test("a long sum of unknowns times a quantity is refused in time", () => {
		const line = `(${Array(150).fill("a").join(" + ")}) * 5 km =>`;
		expectHonestLine(line, { budgetMs: 5_000 });
		expect(shown(line)).toMatch(/^A formula keeps no units, so combining "a"/);
	});

	test("an unknown deep in brackets meets a quantity and is refused in time", () => {
		const line = `${"(".repeat(40)}foo${")".repeat(40)} * 5 km =>`;
		expectHonestLine(line, { budgetMs: 5_000 });
		expect(shown(line)).toBe(REFUSAL);
		// Deeper than the complexity guard allows is refused by that guard, in time.
		const deeper = `${"(".repeat(600)}foo${")".repeat(600)} * 5 km =>`;
		expectHonestLine(deeper, { budgetMs: 5_000 });
		expect(shown(deeper)).toMatch(/^THROWS Expression complexity score/);
	});

	test("a look-alike unit is not a unit, and the line stays honest", () => {
		// A Cyrillic м in place of the Latin m.
		expectHonestLine("foo * 5 kм =>");
		expect(shown("foo * 5 kм =>")).not.toBe("5foo");
	});

	test.each(fill("foo * 5 km X =>", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the quantity: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text is read as text", () => {
		expectHonestLine("<b>foo</b> * 5 km =>");
		expectHonestLine("foo * 5 km => <script>alert(1)</script>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above that carries a unit is refused against an unknown", () => {
		expect(both(["d = 5 km", "d * foo =>"])).toEqual(["5.00 km", REFUSAL]);
	});

	test("a check and a what-if over the refused line stay honest", () => {
		expectHonestDocument("d = 5 km\nfoo * d =>\ncheck line 2 == 5 km");
		expectHonestDocument("d = 5 km\nfoo * d =>\nline 2 with foo = 3");
	});

	test("an edit that gives the unknown a value turns the refusal into the quantity", () => {
		expect(both(["foo * 5 km =>"])).toEqual([REFUSAL]);
		expect(both(["foo = 2", "foo * 5 km =>"])).toEqual(["2", "10.00 km"]);
	});

	test("a typo in a unit name is an unknown of its own, and two unknowns stay a formula", () => {
		expect(shown("foo * 5 kmm =>")).toMatch(/foo|kmm/);
		expectHonestLine("foo * 5 kmm =>");
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("foo * X km =>", NUMERIC_EDGES))("an unknown times a numeric edge in km: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
		const answer = shown(line);
		expect(answer).not.toMatch(/foo$/);
	});

	test("zero and negative zero in a unit are still refused", () => {
		expect(shown("foo * 0 km =>")).toBe(REFUSAL);
		expect(shown("foo + -0 km =>")).toBe(REFUSAL);
	});

	test("CRLF and a trailing newline change nothing", () => {
		expect(both(["foo * 5 km =>\r", ""])[0]).toBe(REFUSAL);
	});
});
