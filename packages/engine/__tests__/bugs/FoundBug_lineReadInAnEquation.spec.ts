import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { solveEquationValues } from "@solve-js/vm/SymbolicOps";
import { ValueType, errorValue, numberValue, symbolicValue } from "@solve-js/vm/Value";
import { varNode } from "@solve-js/symbolic/SymbolicNode";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `5`, `x + ans = 7`, `x =>` answered "An equation side has no
 * exact value to solve with." A stored equation keeps its two sides as
 * programs and runs them when it is solved, and it ran them as the line
 * asking, so `ans` and `prev` read the line above the arrow: the equation's
 * own confirmation, which has no value. The reader wrote `ans` on the
 * equation's line and meant the answer above it.
 *
 * An equation's sides now run as the line that stored it (`equationLine`, the
 * owner line's current position on the incremental path, its stored line
 * number on a batch pass), so `x =>` gives 2 however many lines come between.
 * A side that is itself a refusal is now passed on rather than replaced by
 * "no exact value" (`solveEquationValues`), so `ans` at the top of a note says
 * what it says on its own. And outside a document, where `ans` has nothing to
 * read, the equation is refused where it is typed with the structured
 * `LINE_REF_NO_DOCUMENT` error (`equationNeedsDocument`), rather than
 * confirmed and left to fail at the arrow.
 */

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

/** One line of a live evaluator's pass. */
function readEvalLine(line: EvalLineResult): string {
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** A live evaluator over `lines`, evaluated once, with what each later step shows. */
function live(lines: readonly string[]): { doc: DocumentModel; evaluator: ThreeTierEvaluator; pass: () => string[] } {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	const pass = (): string[] => evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(readEvalLine);
	pass();
	return { doc, evaluator, pass };
}

const STORED = 'x stored as an equation: solve with "x =>"';

describe("the lines that exposed it", () => {
	test("ans and prev in an equation are the answer above the equation", () => {
		expect(both(["5", "x + ans = 7", "x =>"])).toEqual(["5", STORED, "2"]);
		expect(both(["5", "x + prev = 7", "x =>"])).toEqual(["5", STORED, "2"]);
	});

	test("however many lines come between the equation and the arrow", () => {
		expect(both(["5", "x + ans = 7", "100", "", "# a heading", "x =>"])).toEqual(["5", STORED, "100", "", "", "2"]);
		expect(both(["5", "x + ans = 7", "x =>", "ans"])).toEqual(["5", STORED, "2", "2"]);
	});

	test("a power, a product and a cross-line aggregate over the line above", () => {
		expect(both(["3", "2x = ans", "x =>"])).toEqual(["3", STORED, "1.5"]);
		expect(both(["4", "x^2 = ans", "x =>"])).toEqual(["4", STORED, "[-2, 2]"]);
		expect(both(["2", "3", "x * ans = total above", "x =>"])).toEqual(["2", "3", STORED, "5/3"]);
		expect(both(["5", "x + line 1 = 7", "x =>"])).toEqual(["5", STORED, "2"]);
	});

	test("a product of names reads the line above the equation too", () => {
		expect(both(["a = 2", "6", "a*x = ans", "x =>"])).toEqual(["2", "6", STORED, "3"]);
		expect(both(["6", "a = 2", "a*x = ans", "x =>"])).toEqual(["6", "2", STORED, "1"]);
	});

	test("ans at the top of a note says what it says on its own, not 'no exact value'", () => {
		const [, answer] = both(["x + ans = 7", "x =>", ""]);
		expect(answer).toMatch(/has not been evaluated yet/);
		expect(answer).not.toMatch(/no exact value/);
	});

	test("on its own, the equation is refused as needing a document", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateLine(1, "x + ans = 7");
		expect(value.type).toBe(ValueType.Error);
		expect(value.errorCode).toBe("LINE_REF_NO_DOCUMENT");
		expect(formatValue(value).toLowerCase()).toContain("document");
		const expression = newTrackedEngine().evaluateExpression("x + prev = 7");
		expect(expression.errorCode).toBe("LINE_REF_NO_DOCUMENT");
		// An equation that reads no other line is stored on its own as before.
		expect(formatValue(newTrackedEngine().evaluateLine(1, "x + 5 = 7"))).toBe(`= ${STORED}`);
	});
});

describe("the edits an editor makes", () => {
	test("changing the line above the equation re-solves it", () => {
		const { doc, evaluator, pass } = live(["5", "x + ans = 7", "x =>"]);
		try {
			doc.editLine(1, "6");
			expect(pass()).toEqual(["6", STORED, "1"]);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a line inserted between the equation and the arrow changes nothing", () => {
		const { evaluator, pass } = live(["5", "x + ans = 7", "x =>"]);
		try {
			evaluator.applyTransaction([{ startLine: 3, deleteCount: 0, insertLines: ["100"] }]);
			expect(pass()).toEqual(["5", STORED, "100", "2"]);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a line inserted above the equation is the new line above it", () => {
		const { evaluator, pass } = live(["5", "x + ans = 7", "x =>"]);
		try {
			evaluator.applyTransaction([{ startLine: 2, deleteCount: 0, insertLines: ["4"] }]);
			expect(pass()).toEqual(["5", "4", STORED, "3"]);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("deleting the equation leaves the arrow with nothing to solve", () => {
		const { evaluator, pass } = live(["5", "x + ans = 7", "x =>"]);
		try {
			evaluator.applyTransaction([{ startLine: 2, deleteCount: 1, insertLines: [] }]);
			expect(pass()).toEqual(["5", "x"]);
		} finally {
			evaluator.terminateWorker();
		}
	});
});

describe("the parts: solveEquationValues passes a refused side on", () => {
	test("ordinary: two values solve", () => {
		expect(formatValue(solveEquationValues(symbolicValue(varNode("x")), numberValue(2), "x"))).toBe("= 2");
	});

	test("boundary: a refusal on either side is the answer, unchanged", () => {
		const refusal = errorValue("LINE_REF_NO_DOCUMENT", "A line reference needs a document to read, and an expression evaluated on its own has none");
		expect(solveEquationValues(refusal, numberValue(7), "x")).toBe(refusal);
		expect(solveEquationValues(symbolicValue(varNode("x")), refusal, "x")).toBe(refusal);
	});

	test("hostile: an infinite side is still 'no exact value', and a prototype word as the unknown is a name", () => {
		expect(formatValue(solveEquationValues(symbolicValue(varNode("x")), numberValue(Number.POSITIVE_INFINITY), "x"))).toBe("An equation side has no exact value to solve with.");
		for (const word of PROTOTYPE_WORDS) {
			expectPrototypeUntouched(() => {
				expect(formatValue(solveEquationValues(symbolicValue(varNode(word)), numberValue(3), word))).toBe("= 3");
			});
		}
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.map((word) => `5\n${word} + ans = 7\n${word} =>`))("%j", (text) => {
		expectPrototypeUntouched(() => {
			expectHonestDocument(text);
		});
	});

	test("a prototype word as the unknown is solved with the line above", () => {
		expect(both(["5", "constructor + ans = 7", "constructor =>"])).toEqual(["5", 'constructor stored as an equation: solve with "constructor =>"', "2"]);
	});

	test("a look-alike of ans is an unknown of its own, so the equation has two", () => {
		// A Cyrillic а in ans.
		const [, line] = both(["5", "x + аns = 7"]);
		expect(line).toMatch(/2 unknowns|THREW/);
	});

	test("a thousand lines between the equation and the arrow are answered in time", () => {
		const lines = ["5", "x + ans = 7", ...Array.from({ length: 1_000 }, (_, i) => String(i)), "x =>"];
		const { batch } = expectHonestDocument(lines.join("\n"), { budgetMs: 10_000 });
		expect(batch[batch.length - 1]).toBe("= 2");
	});

	test.each(fill("5\nx + ans = 7 X\nx =>", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the equation: %j", (text) => {
		expectHonestDocument(text);
	});

	test("markup-shaped text before the equation is read as text", () => {
		expectHonestDocument("<b>5</b>\nx + ans = 7\nx =>");
		expectHonestDocument("5\nx + ans = 7 <script>\nx =>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("the line above is an error, prose, or a quantity", () => {
		expect(both(["1/0 km in kg", "x + ans = 7", "x =>"])[2]).toMatch(/has an error|cannot/);
		expectHonestDocument("this is prose\nx + ans = 7\nx =>");
		// An equation with a unit on a side is the parse error it always was
		// (the boundary on the solving-equations page), with ans or without.
		expect(both(["5 km", "x + ans = 7 km", "x =>"])[1]).toBe(both(["x + 5 km = 7 km"])[0]);
	});

	test("a check over the answer and a what-if through the line above", () => {
		expect(both(["5", "x + ans = 7", "x =>", "check line 3 == 2"])[3]).toMatch(/✓/);
		expectHonestDocument("a = 5\na\nx + ans = 7\nx =>\nline 4 with a = 6");
	});

	test("solve() over ans on a later line reads the line above it, as any line does", () => {
		expect(both(["5", "solve(x + ans = 7, x)"])).toEqual(["5", "2"]);
	});

	test("a second equation for the same unknown reads its own line above", () => {
		expect(both(["5", "x + ans = 7", "10", "x + ans = 12", "x =>"])).toEqual(["5", STORED, "10", STORED, "2"]);
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("X\nx + ans = 7\nx =>", NUMERIC_EDGES))("a numeric edge above the equation: %j", (text) => {
		expectHonestDocument(text, { allowNaN: text.includes("0/0") });
	});

	test("zero and negative zero above, and a 34-digit answer", () => {
		expect(both(["0", "x + ans = 7", "x =>"])[2]).toBe("7");
		expect(both(["-0", "x + ans = 7", "x =>"])[2]).toBe("7");
		expectHonestDocument("1234567890123456789012345678901234\nx + ans = 7\nx =>");
	});

	test("CRLF endings and a trailing newline", () => {
		expect(both(["5\r", "x + ans = 7\r", "x =>\r", ""])[2]).toBe("2");
	});

	test("an empty and a whitespace-only line above the equation", () => {
		expectHonestDocument("5\n\nx + ans = 7\nx =>");
		expectHonestDocument("5\n   \nx + ans = 7\nx =>");
	});
});
