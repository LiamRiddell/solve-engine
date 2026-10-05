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
import { labelledRetryError } from "@solve-js/engine/ColonLabel";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `Total: average(10:12)`, `Slice: v[0:1]` and
 * `Total: max(1000:1002)` reported `Expected an operator or the end of the
 * line, but found ":"`, about the label's colon, instead of what was wrong
 * with the expression after it.
 *
 * A line that does not parse whole is retried with the text before a colon set
 * aside as a label. When that retry failed too, its error was discarded and the
 * whole line's error reported, which only says the parse stopped at the colon.
 * The line is `<label>: <expression>` and the expression's own error is the
 * specific one, so it is now reported (`labelledRetryError` in
 * engine/ColonLabel.ts): `average(10:12)`'s clock time, `v[0:1]`'s slice that
 * needs two ranges, `max(1000:1002)`'s time that does not exist. The rightmost
 * label's retry is the one kept, since its expression holds no colon of a
 * label's. A colon followed by `=` (`x := 5`) keeps the line's own wording,
 * which says to assign with `=` alone.
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

const COLON_WORDING = 'UNEXPECTED_TRAILING_TOKEN: Expected an operator or the end of the line, but found ":"';

describe("the lines that exposed it", () => {
	test.each([
		["Total: average(10:12)", "average(10:12)"],
		["Total: max(1000:1002)", "max(1000:1002)"],
		["Total: (1 + 2", "(1 + 2"],
		["Rent: $1200 +", "$1200 +"],
		["Note: a: average(10:12)", "average(10:12)"],
	])("%s reports the error %s raises on its own, through evaluateExpression and evaluateLine", (line, expression) => {
		const own = outcome(expression);
		expect(own).not.toBe(COLON_WORDING);
		expect(outcome(line)).toBe(own);
		expect(single(line)).toBe(own);
	});

	test("the real refusals, as the reader sees them", () => {
		expect(outcome("Total: average(10:12)")).toBe(
			"AGGREGATE_CALL_RANGE: In average(...), 10:12 is a clock time, not a range, and a time cannot be averaged: a colon between two numbers is a range only as the list of sum, prod, map or reduce. To average numbers, list them with commas, as in average(1, 2, 3).",
		);
		expect(outcome("Total: max(1000:1002)")).toBe('INVALID_TIME_LITERAL: "1000:1002" is not a valid time');
		expect(outcome("Total: (1 + 2")).toBe('UNEXPECTED_END_OF_INPUT: The line ends where ")" was expected');
	});

	test("through both document passes, which agree, with the list defined above", () => {
		expect(both(["v = [1, 2, 3]", "Slice: v[0:1]", "v[0:1]", "Slice: v[0]"])).toEqual([
			"[1, 2, 3]",
			'ERROR Range-based matrix slicing needs exactly 2 arguments ("a[rowRange, colRange]"), got 1.',
			'ERROR Range-based matrix slicing needs exactly 2 arguments ("a[rowRange, colRange]"), got 1.',
			"1",
		]);
	});

	test("a line that parses after its label is untouched", () => {
		expect(outcome("Total: total(1000:1002)")).toBe("3,003");
		expect(outcome("Rent: $1200")).toBe("$1,200.00");
		expect(outcome("input value: :x = 5")).toBe("5");
	});
});

describe("the parts: labelledRetryError", () => {
	const retry = new Error("the expression's own error");

	test("ordinary: a parse stopped at a label's colon reports the retry's error", () => {
		expect(labelledRetryError({ type: "COLON" }, { type: "IDENT" }, retry)).toBe(retry);
		expect(labelledRetryError({ type: "COLON" }, { type: "NUMBER" }, "a message")).toBe("a message");
	});

	test("boundary: no retry ran, or the colon ends the line", () => {
		expect(labelledRetryError({ type: "COLON" }, { type: "IDENT" }, undefined)).toBeUndefined();
		expect(labelledRetryError({ type: "COLON" }, undefined, retry)).toBe(retry);
	});

	test("hostile: a parse that stopped elsewhere, and a colon before an equals sign, keep the line's own error", () => {
		expect(labelledRetryError({ type: "IDENT" }, { type: "COLON" }, retry)).toBeUndefined();
		expect(labelledRetryError({ type: "QUESTION" }, { type: "COLON" }, retry)).toBeUndefined();
		expect(labelledRetryError({ type: "COLON" }, { type: "EQUALS" }, retry)).toBeUndefined();
		expect(labelledRetryError({ type: "constructor" }, { type: "__proto__" }, retry)).toBeUndefined();
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the label or inside the expression is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(outcome(`${word}: average(10:12)`)).toBe(outcome("average(10:12)"));
			for (const line of fill("Total: X(10:12)", PROTOTYPE_WORDS)) expectHonestLine(line);
		});
	});

	test("many labels and a deep bracket are answered within the budget", () => {
		expectHonestLine(`${"a: ".repeat(500)}average(10:12)`, { budgetMs: 5_000 });
		expectHonestLine(`Total: ${"(".repeat(500)}1`, { budgetMs: 5_000 });
		expectHonestLine(`Total: ${RESOURCE_PROBES.longSum(2_000)} +`, { budgetMs: 5_000 });
	});

	test("markup-shaped text after the label is read as text, and the error quotes no markup as code", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`Total: ${edge} +`);
		expectHonestLine("Total: <script>alert(1)</script>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("the line's own colon wording stays where the parse did not stop at a label's colon", () => {
		expect(outcome("x := 5")).toBe(COLON_WORDING);
		expect(outcome("x:")).toBe(COLON_WORDING);
	});

	test("a typo after the label, a value from above and a section around it", () => {
		expect(both(["# Costs", "a = 5", "Total: a +", "Total: a + 1"])).toEqual(["", "5", 'ERROR The line ends after "+", where a value was expected', "6"]);
		expectHonestDocument("Total: average(10:12)\nRent: $1200 +\nSlice: v[0:1]");
	});

	test("an edit that completes the expression answers it", () => {
		expect(both(["Total: (1 + 2"])).toEqual(['ERROR The line ends where ")" was expected']);
		expect(both(["Total: (1 + 2)"])).toEqual(["3"]);
	});
});

describe("adversarial: edge cases", () => {
	test("each numeric edge in a failing labelled expression is honest", () => {
		for (const line of fill("Total: X +", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("an empty label, a whitespace label, and CRLF", () => {
		expectHonestLine(": average(10:12)");
		expectHonestLine("   : average(10:12)");
		expect(both(["Total: average(10:12)\r", ""])).toEqual([`ERROR ${outcome("average(10:12)").replace(/^[A-Z_]+: /, "")}`, ""]);
	});
});
