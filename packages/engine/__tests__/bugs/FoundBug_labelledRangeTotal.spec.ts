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
import { openBracketsAt } from "@solve-js/engine/ColonLabel";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `Total: total(1000:1002)` was refused as '"1000:1002" is not a
 * valid time', where `total(1000:1002)` on its own answers 3,003.
 *
 * A line that does not parse whole is retried with the text before a colon set
 * aside as a label, trying each colon from the right. The rightmost colon was
 * the range's, inside the call, and the check that refuses a colon pair the
 * clock rules declined (`1 + 24:00`) read `1000:1002` there as a time and
 * refused the line before the label's own colon was tried. A label stands at
 * the top level of a line, never inside a bracket, so a colon inside one is
 * now passed over (`openBracketsAt` in engine/ColonLabel.ts), and the call
 * after the label is the range batches V, Z and AA made it.
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

/** Bare tokens of the given types, for the unit tests: only the type is read. */
function tokens(...types: string[]): Token[] {
	return types.map((type, offset) => ({ type, value: type, text: type, offset, line: 1, col: offset + 1, lineBreaks: 0 }) as unknown as Token);
}

describe("the lines that exposed it", () => {
	test.each([
		["Total: total(1000:1002)", "3,003"],
		["Total: total(1,000:1,002)", "3,003"],
		["Cost: total(10:12)", "33"],
		["Total: sum(1:3)", "6"],
	])("%s answers as the unlabelled call does, through evaluateExpression and evaluateLine", (line, answer) => {
		expect(outcome(line)).toBe(answer);
		expect(single(line)).toBe(answer);
		expect(outcome(line.slice(line.indexOf(":") + 2))).toBe(answer);
	});

	test("through both document passes, which agree", () => {
		expect(both(["Total: total(1000:1002)", "total(1000:1002)", "Total: total(1,000:1,002)"])).toEqual(["3,003", "3,003", "3,003"]);
	});

	test("the other range forms after a label", () => {
		expect(outcome("Total: sum(x^2, 1:3)")).toBe("14");
		expect(outcome("Rent: map(x*2, 1:3)")).toBe("[2, 4, 6]");
		expect(outcome("Total (net): total(1000:1002)")).toBe("3,003");
		expect(outcome("Note: total: total(1:3)")).toBe("6");
		expect(outcome("Total: sum(1:3) + 1")).toBe("7");
	});
});

describe("the parts: openBracketsAt", () => {
	test("ordinary: the count of brackets open before each token", () => {
		expect(openBracketsAt(tokens("IDENT", "COLON", "IDENT", "LPAREN", "NUMBER", "COLON", "NUMBER", "RPAREN"))).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
		expect(openBracketsAt(tokens("LBRACKET", "LPAREN", "COLON", "RPAREN", "COLON", "RBRACKET", "COLON"))).toEqual([0, 1, 2, 2, 1, 1, 0]);
	});

	test("boundary: no tokens, no brackets, a bracket left open", () => {
		expect(openBracketsAt([])).toEqual([]);
		expect(openBracketsAt(tokens("NUMBER", "COLON", "NUMBER"))).toEqual([0, 0, 0]);
		expect(openBracketsAt(tokens("LPAREN", "NUMBER", "COLON"))).toEqual([0, 1, 1]);
	});

	test("hostile: closing brackets with none open never go below zero, and a deep nest is counted in one walk", () => {
		expect(openBracketsAt(tokens("RPAREN", "RBRACKET", "COLON", "LPAREN", "COLON"))).toEqual([0, 0, 0, 0, 1]);
		const deep = tokens(...Array.from({ length: 50_000 }, () => "LPAREN"), "COLON");
		expect(openBracketsAt(deep)[50_000]).toBe(50_000);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the label or the bound is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(outcome(`${word}: total(1000:1002)`)).toBe("3,003");
			for (const line of fill("Total: total(X:1002)", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
		});
	});

	test("many colons and deep brackets after a label are answered within the budget", () => {
		expectHonestLine(`Total: ${RESOURCE_PROBES.deepParens(500)}`, { budgetMs: 5_000 });
		expectHonestLine(`Total: total(${"(".repeat(200)}1000${")".repeat(200)}:1002)`, { budgetMs: 5_000 });
		expectHonestLine(`${"a: ".repeat(200)}total(1000:1002)`, { budgetMs: 5_000 });
	});

	test("markup-shaped text as the label is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`${edge}: total(1000:1002)`);
		expect(outcome("<b>Total</b>: total(1000:1002)")).not.toMatch(/not a valid time/);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a bound from the line above, a check and a section around it", () => {
		expect(both(["a = 1000", "Total: total(a:1002)", "check total(1000:1002) == 3,003", "Spent: total(10:12) + 1"])).toEqual(["1,000", "3,003", "✓", "34"]);
		expectHonestDocument("# Budget\nTotal: total(1000:1002)\n## Days\nCost: total(10:12)");
	});

	test("a colon pair that is no time and no range is still refused after a label", () => {
		expect(expectHonestLine("Total: total(24:00, 0:00)").kind).not.toBe("value");
		expect(outcome("Total: 1 + 24:00")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
	});

	test("a descending range after a label is refused as the unlabelled one is", () => {
		expect(outcome("Total: total(1002:1000)")).toBe(outcome("total(1002:1000)"));
	});

	test("an edit adding the label keeps the answer", () => {
		expect(both(["total(1000:1002)", "Total: total(1000:1002)", "Grand total: total(1000:1002)"])).toEqual(["3,003", "3,003", "3,003"]);
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negatives and a range of one", () => {
		expect(outcome("Total: total(0:0)")).toBe("0");
		expect(outcome("Total: total(-2:2)")).toBe("0");
		expect(outcome("Total: total(1000:1000)")).toBe("1,000");
	});

	test("each numeric edge as a bound after a label is honest", () => {
		for (const line of fill("Total: total(X:3)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["Total: total(1000:1002)\r", ""])).toEqual(["3,003", ""]);
	});
});
