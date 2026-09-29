import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import {
	documentErrors,
	errorOnLine,
	expressionOffsetInLine,
	inlineExpressionOffset,
	lineFailureOf,
	recordLineFailure,
	spanInLine,
} from "@solve-js/engine/LineDiagnostics";
import { EngineError, ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { ErrorCategory } from "@solve-js/errors/EngineError";
import { ValueType, errorValue, numberValue } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Issue #709: a failed document line kept only its message. `3 + * 4` throws
 * `NO_PREFIX_PARSELET` with a span through `evaluateExpression`, and every
 * document path dropped both; the incremental pass also filed the failure as an
 * error value with a code of its own (`eval_failed`), put it in `result` where
 * the batch pass put it in `error`, and the two passes listed different
 * failures in `errors`. A document line and an inline solve now carry
 * `errorCode` and `errorSpan` beside `error`, the incremental pass keeps the
 * code the line threw, both passes put a thrown failure in `error` and a
 * returned one in `result`, and both list every failure in `errors`.
 */

const DOC = ["3 + * 4", "5 kg + 3 m", "price * 2", "sqrt(-1 m)", "total is s`2 +` and s`5 kg + 3 m`"].join("\n");

function batch(text: string): ParsingResult {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" });
}

function incremental(text: string): ParsingResult {
	return evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" });
}

/** Each line's failure fields and whether it has a result, the parts both passes must agree on. */
function failures(result: ParsingResult) {
	return result.lines.map((line) => ({
		error: line.error,
		code: line.errorCode ?? null,
		span: line.errorSpan ?? null,
		result: line.result === null ? null : line.result.type === ValueType.Error ? String(line.result.value) : "value",
		solves: line.inlineSolves.map((solve) => ({ error: solve.error ?? null, code: solve.errorCode ?? null, result: solve.result ? String(solve.result.value) : null })),
	}));
}

describe("the document in the issue", () => {
	test("both passes give each line the same failure fields", () => {
		expect(failures(incremental(DOC))).toEqual(failures(batch(DOC)));
	});

	test("a thrown failure keeps the code and span the expression throws on its own", () => {
		let alone: EngineError | undefined;
		try {
			newTrackedEngine().evaluateExpression("3 + * 4");
		} catch (error) {
			alone = error as EngineError;
		}
		for (const result of [batch(DOC), incremental(DOC)]) {
			expect(result.lines[0]).toMatchObject({ error: alone!.message, errorCode: alone!.code, errorSpan: alone!.span, result: null });
		}
	});

	test("the incremental pass no longer mints a code of its own", () => {
		const text = JSON.stringify(incremental(DOC));
		expect(text).not.toContain("eval_failed");
		expect(text).not.toContain("exec_failed");
	});

	test("both passes list the same six failures", () => {
		expect(incremental(DOC).errors).toEqual(batch(DOC).errors);
		expect(batch(DOC).errors).toHaveLength(6);
	});

	test("a line that did not fail has null in all three fields", () => {
		const line = batch("1 + 1").lines[0];
		expect({ error: line.error, code: line.errorCode, span: line.errorSpan }).toEqual({ error: null, code: null, span: null });
	});
});

describe("what the live evaluator stores", () => {
	function evaluate(text: string) {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(text);
		const evaluator = new ThreeTierEvaluator(doc, engine);
		return { doc, evaluator, pass: () => evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }) };
	}

	test("a thrown failure's stored value carries the code the line threw, and the failure beside it", () => {
		const { doc, evaluator, pass } = evaluate("3 + * 4\nprice * 2");
		try {
			pass();
			const first = doc.getLineAt(1)!;
			expect(String(first.result?.value)).toBe("NO_PREFIX_PARSELET");
			expect(first.failures?.[0]).toEqual({ code: "NO_PREFIX_PARSELET", message: 'Expected a value after "+", but found "*"', span: { start: 4, end: 5, line: 1, col: 5 } });
			expect(String(doc.getLineAt(2)!.result?.value)).toBe("UNDEFINED_VARIABLE");
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("each expression on a line keeps its own message, not the first one's", () => {
		const { doc, evaluator, pass } = evaluate("a s`2 +` b s`nope * 2`");
		try {
			pass();
			const state = doc.getLineAt(1)!;
			expect(state.results.map((group) => String(group[0].value))).toEqual(["UNEXPECTED_END_OF_INPUT", "UNDEFINED_VARIABLE"]);
			expect(state.results.map((group) => String(group[0].unit))).toEqual(['The line ends after "+", where a value was expected', "Undefined variable: nope"]);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("an edit that fixes a line clears its failure, and one that breaks a line adds one", () => {
		const { doc, evaluator, pass } = evaluate("3 + * 4\n2 + 2");
		try {
			pass();
			doc.editLine(1, "3 + 4");
			doc.editLine(2, "2 + * 2");
			const lines = pass().lines;
			const one = lines.find((line) => line.lineNumber === 1)!;
			const two = lines.find((line) => line.lineNumber === 2)!;
			expect({ code: one.errorCode ?? null, error: one.error }).toEqual({ code: null, error: null });
			expect(two.errorCode).toBe("NO_PREFIX_PARSELET");
			expect(doc.getLineAt(1)!.failures).toBeUndefined();
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a second pass over clean lines runs from cached programs and reports nothing new", () => {
		const { evaluator, pass } = evaluate("x = 5\nx * 2\nprice * 2");
		try {
			pass();
			const again = pass().lines;
			expect(again.find((line) => line.lineNumber === 3)?.errorCode).toBe("UNDEFINED_VARIABLE");
			expect(again.filter((line) => line.lineNumber !== 3).every((line) => (line.errorCode ?? null) === null)).toBe(true);
		} finally {
			evaluator.terminateWorker();
		}
	});
});

describe("unit: errorOnLine", () => {
	const parseError = () => ErrorFactory.parsing({ code: "NO_PREFIX_PARSELET", message: "m", span: { start: 4, end: 5, line: 1, col: 5 }, suggestion: "s", context: { a: 1 } });

	test("moves the span onto the line, keeping every other field", () => {
		const moved = errorOnLine(parseError(), 4);
		expect(moved.span).toEqual({ start: 4, end: 5, line: 4, col: 5 });
		expect({ code: moved.code, message: moved.message, suggestion: moved.suggestion, context: moved.context, category: moved.category }).toEqual({ code: "NO_PREFIX_PARSELET", message: "m", suggestion: "s", context: { a: 1 }, category: ErrorCategory.PARSING });
	});

	test("returns the error itself when there is nothing to move", () => {
		const onLineOne = parseError();
		expect(errorOnLine(onLineOne, 1)).toBe(onLineOne);
		const noSpan = ErrorFactory.execution("UNDEFINED_VARIABLE", "Undefined variable: x");
		expect(errorOnLine(noSpan, 7)).toBe(noSpan);
	});

	test("boundary and hostile line numbers leave the error as it is", () => {
		for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
			const error = parseError();
			expect(errorOnLine(error, n)).toBe(error);
		}
		expect(errorOnLine(parseError(), 2 ** 53 - 1).span?.line).toBe(2 ** 53 - 1);
	});

	test("a span the lexer put on a later line, after a stray carriage return, is on the host's line", () => {
		const error = ErrorFactory.parsing({ code: "X", message: "m", span: { start: 9, end: 10, line: 2, col: 1 } });
		expect(errorOnLine(error, 5).span).toEqual({ start: 9, end: 10, line: 5, col: 1 });
	});

	test("the copy is a new error, so a host changing it cannot change the original", () => {
		const original = parseError();
		const moved = errorOnLine(original, 3);
		expect(moved).not.toBe(original);
		expect(original.span?.line).toBe(1);
	});

	test("through evaluateLine, the host's line number reaches the span (#836)", () => {
		try {
			newTrackedEngine().evaluateLine(4, "3 + * 4");
			throw new Error("expected a throw");
		} catch (error) {
			expect((error as EngineError).span).toEqual({ start: 4, end: 5, line: 4, col: 5 });
		}
	});
});

describe("unit: spanInLine", () => {
	test("shifts a span measured against an expression, or against the document", () => {
		expect(spanInLine({ start: 4, end: 5 }, 3, 2, 20)).toEqual({ start: 6, end: 7, line: 3, col: 7 });
		expect(spanInLine({ start: 22, end: 23, line: 4, col: 5 }, 4, -18, 7)).toEqual({ start: 4, end: 5, line: 4, col: 5 });
	});

	test("clamps into the line, never before its start or past its end", () => {
		expect(spanInLine({ start: -5, end: -1 }, 1, 0, 10)).toEqual({ start: 0, end: 0, line: 1, col: 1 });
		expect(spanInLine({ start: 50, end: 60 }, 1, 0, 10)).toEqual({ start: 10, end: 10, line: 1, col: 11 });
		expect(spanInLine({ start: 3, end: 1 }, 1, 0, 10)).toEqual({ start: 3, end: 3, line: 1, col: 4 });
		expect(spanInLine({ start: 0, end: 0 }, 1, 0, -3)).toEqual({ start: 0, end: 0, line: 1, col: 1 });
	});

	test("no span, or one with no usable offsets, is null", () => {
		expect(spanInLine(undefined, 1, 0, 10)).toBeNull();
		expect(spanInLine({ start: Number.NaN, end: 1 }, 1, 0, 10)).toBeNull();
		expect(spanInLine({ start: 0, end: Number.POSITIVE_INFINITY }, 1, 0, 10)).toBeNull();
	});
});

describe("unit: lineFailureOf", () => {
	test("an EngineError keeps its code, message and span", () => {
		const error = ErrorFactory.parsing({ code: "NO_PREFIX_PARSELET", message: "m", span: { start: 1, end: 2 } });
		expect(lineFailureOf(error, 2, 3, 10)).toEqual({ code: "NO_PREFIX_PARSELET", message: "m", span: { start: 4, end: 5, line: 2, col: 5 } });
	});

	test("anything else thrown is normalised as every catch site does it", () => {
		expect(lineFailureOf(new TypeError("boom"), 1, 0, 5)).toEqual({ code: "UNEXPECTED_ERROR", message: "boom", span: null });
		expect(lineFailureOf("a string", 1, 0, 5)).toEqual({ code: "UNKNOWN_ERROR", message: "An unknown error occurred", span: null });
		expect(lineFailureOf(undefined, 1, 0, 5).code).toBe("UNKNOWN_ERROR");
		// An object shaped like an EngineError is not one, and is not trusted as one.
		expect(lineFailureOf({ code: "FORGED", message: "m" }, 1, 0, 5).code).toBe("UNKNOWN_ERROR");
	});
});

describe("unit: where an expression starts in its line", () => {
	test("expressionOffsetInLine finds a whole-line expression in its text", () => {
		expect(expressionOffsetInLine("  3 + * 4", "3 + * 4")).toBe(2);
		expect(expressionOffsetInLine("3 + * 4", "3 + * 4")).toBe(0);
		expect(expressionOffsetInLine("abc", "")).toBe(0);
		expect(expressionOffsetInLine("abc", "not there")).toBe(0);
		// The first occurrence, which is the one a whole line trimmed starts at.
		expect(expressionOffsetInLine("x x", "x")).toBe(0);
	});

	test("inlineExpressionOffset is two past the solve's opening s", () => {
		expect(inlineExpressionOffset(9)).toBe(11);
		expect(inlineExpressionOffset(0)).toBe(2);
	});
});

describe("unit: recordLineFailure and documentErrors", () => {
	test("recordLineFailure sets the three fields together", () => {
		const target: { error?: string | null; errorCode?: string | null; errorSpan?: unknown } = {};
		recordLineFailure(target as never, { code: "C", message: "m", span: null });
		expect(target).toEqual({ error: "m", errorCode: "C", errorSpan: null });
	});

	test("documentErrors lists thrown and returned failures, whole lines and inline solves, in order", () => {
		const lines = [
			{ lineNumber: 1, error: "thrown", result: null, inlineSolves: [] },
			{ lineNumber: 2, error: null, result: errorValue("X", "returned"), inlineSolves: [] },
			{ lineNumber: 3, error: null, result: numberValue(3), inlineSolves: [] },
			{ lineNumber: 4, error: null, result: null, inlineSolves: [{ error: "a" }, { result: errorValue("Y", "b") }, { result: numberValue(1) }] },
		];
		expect(documentErrors(lines)).toEqual(["Line 1: thrown", "Line 2: returned", "Line 4: a", "Line 4: b"]);
		expect(documentErrors([])).toEqual([]);
	});

	test("an error value without a message is listed by its code", () => {
		const value = errorValue("ONLY_A_CODE", "m");
		(value as unknown as { unit: unknown }).unit = undefined;
		expect(documentErrors([{ lineNumber: 1, error: null, result: value, inlineSolves: [] }])).toEqual(["Line 1: ONLY_A_CODE"]);
	});
});

describe("adversarial", () => {
	test("security: a prototype word that fails keeps its own code, and Object.prototype is untouched", () => {
		expectPrototypeUntouched(() => {
			const text = PROTOTYPE_WORDS.map((word) => `${word} * 2`).join("\n");
			const a = batch(text);
			const b = incremental(text);
			expect(failures(b)).toEqual(failures(a));
			for (const line of a.lines) if (line.error !== null) expect(line.errorCode).toMatch(/^[A-Z][A-Z_]+$/);
		});
	});

	test("security: three thousand failing lines are recorded within budget, the two lists agreeing", () => {
		const text = Array.from({ length: 3_000 }, (_, i) => (i % 2 === 0 ? `${i} + *` : `v${i} * 2`)).join("\n");
		const started = Date.now();
		const a = batch(text);
		const b = incremental(text);
		expect(Date.now() - started).toBeLessThan(30_000);
		expect(a.errors).toHaveLength(3_000);
		expect(b.errors).toEqual(a.errors);
	});

	test("security: invisible characters and markup in a failing line keep the span on the line's own offsets", () => {
		for (const line of ["​3 + * 4", "<b>3 + * 4</b>", "‮3 + * 4"]) {
			const a = batch(line);
			expect(failures(incremental(line))).toEqual(failures(a));
			const span = a.lines[0].errorSpan;
			if (span) expect(span.start).toBeLessThanOrEqual(line.length);
		}
	});

	test("realistic: leading space, a list marker, a label and CRLF, both passes agreeing on the span", () => {
		for (const text of ["   3 + * 4", "- 3 + * 4", "cost: 3 + * 4", "1\r\n3 + * 4\r\n"]) {
			expect(failures(incremental(text))).toEqual(failures(batch(text)));
		}
		const crlf = batch("1\r\n3 + * 4\r\n").lines[1];
		expect(crlf.errorSpan).toEqual({ start: 4, end: 5, line: 2, col: 5 });
	});

	test("realistic: a line reading a failed line refuses the same way through both passes", () => {
		const text = "3 + * 4\nline 1 + 1";
		const a = batch(text);
		expect(failures(incremental(text))).toEqual(failures(a));
		expect(String(a.lines[1].result?.value)).toBe("LINE_RESULT_ERROR");
	});

	test("realistic: evaluateLines carries the same fields", () => {
		const lines = newTrackedEngine().evaluateLines(["x = 1", "3 + * 4"]);
		expect(lines[1]).toMatchObject({ errorCode: "NO_PREFIX_PARSELET", errorSpan: { start: 4, end: 5, line: 2, col: 5 } });
	});

	test("realistic: a snapshot taken after failing lines restores, and the lines fail the same way", () => {
		const engine = newTrackedEngine();
		engine.parseDocument(DOC);
		const restored = ExpressionEngine.fromJSON(engine.toJSON(), { packages: BUILTIN_PACKAGES });
		try {
			expect(failures(restored.parseDocument(DOC))).toEqual(failures(batch(DOC)));
		} finally {
			restored.clear();
		}
	});

	test("edge: the document edges and text edges are handled honestly, and the passes agree", () => {
		for (const text of [...DOCUMENT_EDGES, ...TEXT_EDGES.map((edge) => `${edge}\n3 + * 4`)]) {
			expectHonestDocument(text);
		}
	});

	test("edge: an empty document and whitespace-only lines have no failures", () => {
		for (const text of ["", " ", "\n\n", "\t\n  \n"]) {
			expect(batch(text).errors).toEqual([]);
			expect(incremental(text).errors).toEqual([]);
		}
	});

	test("edge: a line past the thousandth still names its own line", () => {
		const text = [...Array.from({ length: 1_200 }, (_, i) => String(i)), "3 + * 4"].join("\n");
		expect(batch(text).lines[1_200].errorSpan?.line).toBe(1_201);
		expect(incremental(text).lines[1_200].errorSpan?.line).toBe(1_201);
	});
});

describe("hostile: an error thrown with a category the host did not expect", () => {
	test("an internal fault is recorded with its code, not hidden", () => {
		const fault = new EngineError(ErrorCategory.INTERNAL, { code: "STACK_UNDERFLOW", message: "m", recoverable: false });
		expect(lineFailureOf(fault, 1, 0, 1)).toEqual({ code: "STACK_UNDERFLOW", message: "m", span: null });
	});
});
