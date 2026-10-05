import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { opensWithCall } from "@solve-js/engine/EquationShape";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `readExpressionTokens` read `f(x) = x + prev` and
 * `f(x) = x + weather in London` as code, where compiling them refuses them,
 * so the language service and the evaluator disagreed about what is code.
 *
 * `readExpressionTokens` (which a host uses to point at variables and
 * references) settles "is this code" the way compiling does, with no side
 * effects: the parser, then the statement shapes compiling runs (a running
 * total, an assignment, an equation). The parser refuses the two definitions,
 * for reading lines and for reaching live data, and the statement reading then
 * took the line for an equation, since each side of its `=` parses on its own.
 * Compiling never stores a line that opens with a call as an equation (the
 * scalar-equation grammar declines it and the parser decides it), so the
 * statement reading now declines it too, through the same test
 * (`opensWithCall` in engine/EquationShape.ts). A definition that compiles to a
 * refusal is no code, as `24:00` is none: what `ReadExpressionTokensAgreement`
 * pins is that the two readings agree, and compiling is the reference.
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

/** Whether the language service's reading and compiling agree about `line`, and what they say. */
function agreement(line: string): { read: boolean; compiles: boolean } {
	const read = newTrackedEngine().readExpressionTokens(line) !== null;
	const compiles = newTrackedEngine().tryCompileExpression(line);
	return { read, compiles };
}

describe("the lines that exposed it", () => {
	test.each([
		"f(x) = x + prev",
		"f(x) = x + weather in London",
		"f(x) = x + line 1",
		"g(a, b) = a * b + total above",
		"sin(x) = 0.5",
		"f(2) + x = 5",
	])("%s is no code to either reading", (line) => {
		expect(agreement(line)).toEqual({ read: false, compiles: false });
	});

	test.each(["f(x) = 2x", "f(x, y) = x + y", "tax = 20%", "x^2 - 4 = 0", "total += 5", "(x + 1)^2 = 4"])("%s is code to both readings", (line) => {
		expect(agreement(line)).toEqual({ read: true, compiles: true });
	});

	test("the refusals the reader sees, through evaluateExpression and evaluateLine", () => {
		for (const line of ["f(x) = x + prev", "f(x) = x + weather in London"]) {
			expect(single(line)).toBe(outcome(line));
		}
		expect(outcome("f(x) = x + prev")).toMatch(/^FUNCTION_BODY_READS_LINES: /);
		expect(outcome("f(x) = x + weather in London")).toMatch(/^FUNCTION_BODY_MUST_BE_SYNCHRONOUS: /);
	});

	test("through both document passes, which agree", () => {
		const doc = both(["7", "f(x) = x + prev", "f(2)", "g(x) = x + 1", "g(2)"]);
		expect(doc[1]).toMatch(/^ERROR "f\(\.\.\.\)"'s body reads other lines/);
		expect(doc.slice(3)).toEqual(["g(x) defined", "3"]);
	});
});

describe("the parts: opensWithCall", () => {
	const types = (...names: string[]) => names.map((type) => ({ type }));

	test("ordinary: a name or function and its bracket open the line", () => {
		expect(opensWithCall(types("IDENT", "LPAREN", "IDENT", "RPAREN", "EQUALS", "NUMBER"))).toBe(true);
		expect(opensWithCall(types("FUNC", "LPAREN", "IDENT", "RPAREN"))).toBe(true);
	});

	test("boundary: a bracket first, a product, one token and none", () => {
		expect(opensWithCall(types("LPAREN", "IDENT", "RPAREN"))).toBe(false);
		expect(opensWithCall(types("NUMBER", "STAR", "LPAREN"))).toBe(false);
		expect(opensWithCall(types("IDENT"))).toBe(false);
		expect(opensWithCall([])).toBe(false);
	});

	test("hostile: a bracket second whatever comes first, and inherited names as types", () => {
		expect(opensWithCall(types("constructor", "LPAREN"))).toBe(true);
		expect(opensWithCall(types("__proto__", "toString"))).toBe(false);
		expect(opensWithCall(types(...Array.from({ length: 50_000 }, () => "LPAREN")))).toBe(true);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the function or its parameter agrees, and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const line = `${word}(x) = x + prev`;
				const { read, compiles } = agreement(line);
				expect({ line, read }).toEqual({ line, read: compiles });
			}
		});
	});

	test("a long body and many parameters are read within the budget", () => {
		const started = performance.now();
		agreement(`f(x) = ${RESOURCE_PROBES.longSum(2_000)} + prev`);
		agreement(`f(${Array.from({ length: 200 }, (_, k) => `p${k}`).join(", ")}) = p0 + prev`);
		expect(performance.now() - started).toBeLessThan(10_000);
	});

	test("markup-shaped and look-alike text in the body agrees", () => {
		for (const edge of TEXT_EDGES) {
			const line = `f(x) = x + ${edge} + prev`;
			const { read, compiles } = agreement(line);
			expect({ line, read }).toEqual({ line, read: compiles });
		}
	});
});

describe("adversarial: realistic breakage", () => {
	test("a definition typed toward its refusal agrees at every step", () => {
		const steps = ["f", "f(", "f(x", "f(x)", "f(x) =", "f(x) = x", "f(x) = x +", "f(x) = x + p", "f(x) = x + pr", "f(x) = x + prev"];
		for (const line of steps) {
			const { read, compiles } = agreement(line);
			expect({ line, read }).toEqual({ line, read: compiles });
		}
	});

	test("the edit that passes the value in compiles, and the document answers it", () => {
		expect(agreement("f(x, v) = x + v")).toEqual({ read: true, compiles: true });
		expect(both(["f(x, v) = x + v", "7", "f(2, prev)"])).toEqual(["f(x, v) defined", "7", "9"]);
		expectHonestDocument("7\nf(x) = x + prev\nf(x) = x + weather in London\nf(2)");
	});
});

describe("adversarial: edge cases", () => {
	test("each numeric edge in the body agrees", () => {
		for (const line of fill("f(x) = x * (X) + prev", NUMERIC_EDGES)) {
			const { read, compiles } = agreement(line);
			expect({ line, read }).toEqual({ line, read: compiles });
		}
	});

	test("whitespace, a trailing comment and CRLF agree", () => {
		for (const line of ["  f(x) = x + prev  ", "f(x) = x + prev // note", "f(x) = x + prev\r"]) {
			const { read, compiles } = agreement(line);
			expect({ line, read }).toEqual({ line, read: compiles });
		}
	});
});
