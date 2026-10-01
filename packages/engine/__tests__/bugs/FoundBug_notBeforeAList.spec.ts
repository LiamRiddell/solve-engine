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
import { boolValue, matrixValue, numberValue, stringValue, ValueType } from "@solve-js/vm/Value";
import { logicalNot } from "@solve-js/packages/conditionals/NotFunctions";
import { negates, notWordNormalizerRule } from "@solve-js/packages/conditionals/normalizer/NotNormalizerRule";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `not` before a bracketed list was read as a name.
 *
 * `not [1, 2]` answered "Undefined variable: not" while `not ([1, 2] > 1)` and
 * `![1, 2]` were read as negation. The normaliser fuses the word `not` into a
 * negation only before a token that can open a condition, and a square
 * bracket was not one of them, so the word stayed a name and the bracket
 * became an index into a list of that name. A square bracket now opens the
 * condition (`OPENS_CONDITION` in NotNormalizerRule.ts), so the list reaches
 * `logicalNot`: a list of answers is negated cell by cell (`not [true, false]`
 * is `[false, true]`), and a list of numbers is refused by name, as `![1, 2]`
 * and `not 5` are.
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

/** A line's tokens, as the normaliser sees them. */
function lexed(line: string): Token[] {
	const lexer = newTrackedEngine().getLexer();
	lexer.resetExpression(line);
	return Array.from(lexer);
}

/** The refusal for `spelling` before the list shown as `list`. */
function refused(list: string, spelling = "not"): string {
	return `NOT_NEEDS_BOOLEAN: "${spelling}" works on true or false, and ${list} is a list: compare it first, as in not (x > 3).`;
}

describe("not before a bracketed list is negation", () => {
	test.each([
		["not [true, false]", "[false, true]"],
		["not [1 > 0, 2 > 3]", "[false, true]"],
		["not [true]", "[false]"],
		["NOT [true, false]", "[false, true]"],
		["not[true, false]", "[false, true]"],
		["not not [true, false]", "[true, false]"],
		["not [true, false] and [true, true]", "[false, true]"],
		["not ([1, 2] > 1)", "[true, false]"],
	])("%s is %s on both single-line paths", (line, shown) => {
		expect(outcome(line)).toBe(shown);
		expect(single(line)).toBe(shown);
	});

	test.each([
		["not [1, 2]", refused("[1, 2]")],
		["not [1; 2]", refused("[1; 2]")],
		["not [1, 2] and true", refused("[1, 2]")],
		["![1, 2]", refused("[1, 2]", "!")],
	])("%s is refused by name, as not 5 is", (line, refusal) => {
		expect(outcome(line)).toBe(refusal);
		expect(single(line)).toBe(refusal);
	});

	test("not 5 says the same thing of a number", () => {
		expect(outcome("not 5")).toBe(`NOT_NEEDS_BOOLEAN: "not" works on true or false, and 5 is a number: compare it first, as in not (x > 3).`);
	});

	test("in a document, and before a name holding a list, both passes agree", () => {
		expect(both(["not [true, false]", "not [1, 2]", "y = [true, false]", "not y", "x = [1, 2]", "not x"])).toEqual([
			"[false, true]",
			`ERROR ${refused("[1, 2]").replace(/^NOT_NEEDS_BOOLEAN: /, "")}`,
			"[true, false]",
			"[false, true]",
			"[1, 2]",
			`ERROR ${refused("[1, 2]").replace(/^NOT_NEEDS_BOOLEAN: /, "")}`,
		]);
	});

	test("the boundary: a variable named not is still defined and read, but not before a bracket is negation", () => {
		expect(both(["not = [5, 6]", "not + 1", "not[0]"])).toEqual([
			"[5, 6]",
			"[6, 7]",
			`ERROR ${refused("[0]").replace(/^NOT_NEEDS_BOOLEAN: /, "")}`,
		]);
	});
});

describe("negates, before a square bracket", () => {
	const rule = notWordNormalizerRule();

	test("ordinary: a not at the start of a line or after if, before a list", () => {
		expect(negates(lexed("not [true, false]"), 0)).toBe(true);
		expect(negates(lexed("if not [true] then 1 else 2"), 1)).toBe(true);
		expect(negates(lexed("not[1]"), 0)).toBe(true);
		expect(rule.match(lexed("not [1, 2]"), 0)?.replacement[0].type).toBe("NOT");
	});

	test("boundary: a not after a value, and a not at the end, stay a word", () => {
		expect(negates(lexed("x not [1]"), 1)).toBe(false);
		expect(negates(lexed("not"), 0)).toBe(false);
		expect(negates(lexed("not = [1, 2]"), 0)).toBe(false);
		expect(rule.match(lexed("x not [1]"), 1)).toBeNull();
	});

	test("hostile: a word that only looks like not, an empty line, a past-the-end position", () => {
		expect(negates(lexed("knot [1]"), 0)).toBe(false);
		expect(negates(lexed("n\u043Et [1]"), 0)).toBe(false);
		expect(negates([], 0)).toBe(false);
		expect(negates(lexed("not [1]"), 9)).toBe(false);
		expect(rule.match(lexed("constructor [1]"), 0)).toBeNull();
	});
});

describe("logicalNot over a list", () => {
	test("ordinary: a list of answers is negated cell by cell, keeping its shape", () => {
		const negated = logicalNot([matrixValue(1, 2, [true, false]), stringValue("not")]);
		expect(negated.type).toBe(ValueType.Matrix);
		expect(formatValue(negated)).toBe("= [false, true]");
	});

	test("boundary: one cell, and a column", () => {
		expect(formatValue(logicalNot([matrixValue(1, 1, [false]), stringValue("not")]))).toBe("= [true]");
		expect(formatValue(logicalNot([matrixValue(2, 1, [true, false]), stringValue("not")]))).toBe("= [false; true]");
	});

	test("hostile: a list of numbers, a mixed list, and a spelling that is not text", () => {
		expect(logicalNot([matrixValue(1, 2, [1, 2]), stringValue("not")]).errorCode).toBe("NOT_NEEDS_BOOLEAN");
		expect(logicalNot([matrixValue(1, 2, [true, 2]), stringValue("not")]).errorCode).toBe("NOT_NEEDS_BOOLEAN");
		expect(String(logicalNot([matrixValue(1, 2, [1, 2]), numberValue(3)]).errorMessage)).toMatch(/^"not" works on true or false/);
		expect(logicalNot([boolValue(true), stringValue("!")]).value).toBe(false);
	});
});

describe("adversarial: security", () => {
	test("a prototype word inside or before the list is an unknown name, and Object.prototype is unchanged", () => {
		expectPrototypeUntouched(() => {
			for (const line of [...fill("not [X]", PROTOTYPE_WORDS), ...fill("not [true, X]", PROTOTYPE_WORDS), ...fill("not X", PROTOTYPE_WORDS)]) {
				const o = expectHonestLine(line);
				expect(o.kind).not.toBe("value");
			}
			for (const word of PROTOTYPE_WORDS) expectHonestDocument(`${word} = [true, false]\nnot ${word}\nnot [${word}]`);
		});
	});

	test("a long list, deep brackets, a huge range and many lines answer within budget", () => {
		const many = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? "true" : "false")).join(", ");
		expectHonestLine(`not [${many}]`);
		expectHonestLine(`not [${RESOURCE_PROBES.deepParens(300)}]`);
		expectHonestLine(`not [${RESOURCE_PROBES.hugeRange()}]`);
		expectHonestLine(`not [${RESOURCE_PROBES.hugePower()}]`);
		expectHonestDocument(RESOURCE_PROBES.manyLines(500, "not [true, false]"));
	});

	test("look-alike characters and markup-shaped text are read as what they are", () => {
		for (const line of fill("not [X]", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		expect(outcome("not [١, ٢]")).not.toBe("[false, true]");
		expect(outcome(`not ["<script>alert(1)</script>"]`)).not.toMatch(/^\[/);
		// A zero-width space is passed over, as it is between any two words.
		expect(outcome("not\u200B [true]")).toBe(outcome("not [true]"));
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo inside the list, a list from the line above, and an edit through both passes", () => {
		expectHonestLine("not [tru, false]");
		expect(both(["a = 5", "not [a > 3, a > 9]"])[1]).toBe("[false, true]");
		expect(both(["a = 1", "not [a > 3, a > 9]"])[1]).toBe("[true, true]");
	});

	test("a check and an if over the negated list", () => {
		expectHonestDocument("check not [true, false] == [false, true]");
		expect(outcome("if not [true, false] then 1 else 2")).toMatch(/^LIST_CONDITION_UNSUPPORTED: /);
	});
});

describe("adversarial: edge cases", () => {
	test("every numeric edge in the list is refused or answered honestly", () => {
		for (const line of [...fill("not [X]", NUMERIC_EDGES), ...fill("not [X > 0]", NUMERIC_EDGES)]) {
			expectHonestLine(line, { allowNaN: true });
		}
	});

	test("an empty list, a nested one, whitespace and CRLF", () => {
		expect(outcome("not []")).toMatch(/^EMPTY_MATRIX_LITERAL: /);
		expectHonestLine("not [[true, false], [false, true]]");
		expect(outcome("not    [true]")).toBe("[false]");
		const { batch } = expectHonestDocument("not [true, false]\r\nnot [1, 2]\r\n");
		expect(batch[0]).toBe("= [false, true]");
	});
});
