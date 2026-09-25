import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #668: `ans`, the previous answer in Numi, Numbr and SpeedCrunch, was an
 * undefined variable, and a bare `sum` or `total` under a column said only that
 * the word was undefined. `ans` is now the line above when nothing is named
 * `ans`, exactly as `prev` reads it, and a bare `sum` or `total` points at
 * `total above`.
 */

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));
}
const both = (lines: string[]) => {
	const text = lines.join("\n");
	const batch = read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
	const incremental = read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));
	// The two passes carry a failed line's own error differently (a line error
	// and an error value), so the comparison reads the text.
	expect(incremental.map((a) => a.replace(/^ERROR: /, ""))).toEqual(batch.map((a) => a.replace(/^ERROR: /, "")));
	return batch;
};

describe("ans", () => {
	test("reads the line above", () => {
		expect(both(["10", "ans * 2"])).toEqual(["= 10", "= 20"]);
		expect(both(["10", "ans + ans"])[1]).toBe("= 20");
	});

	test("a variable named ans is the variable", () => {
		expect(both(["ans = 5", "ans * 2"])).toEqual(["= 5", "= 10"]);
		expect(both([":ans = 5", "ans"])).toEqual(["= 5", "= 5"]);
	});

	test("an edit to the line above reaches it in a live editor", () => {
		const doc = new DocumentModel();
		doc.setDocument("10\nans * 2");
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluate({ startLine: 1, endLine: 2 });
			doc.editLine(1, "50");
			const pass = evaluator.evaluate({ startLine: 1, endLine: 2 });
			expect(formatValue(pass.lines[1].result!)).toBe("= 100");
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("outside a document it refuses as prev does", () => {
		const value = newTrackedEngine().evaluateExpression("ans * 2");
		expect(value.value).toBe("LINE_REF_NO_DOCUMENT");
	});
});

describe("adversarial: ans where prev has nothing to read gives prev's answer", () => {
	test.each([
		["the first line", ["ans"]],
		["after a blank line", ["10", "", "ans"]],
		["after a heading", ["10", "# h", "ans"]],
		["after a line that failed", ["x + 1", "ans"]],
	])("%s", (_label, lines) => {
		const withPrev = lines.map((text) => (text === "ans" ? "prev" : text));
		expect(both(lines)).toEqual(both(withPrev));
	});

	test("an ans defined below its first use: the first use is still the line above", () => {
		expect(both(["10", "ans * 2", ":ans = 1", "ans"])).toEqual(["= 10", "= 20", "= 1", "= 1"]);
	});

	test("Ans and ANS are ordinary names, as other variables are", () => {
		expect(both(["10", "Ans"])[1]).toMatch(/Undefined variable: Ans/);
	});
});

describe("a bare sum or total points at total above", () => {
	test.each(["sum", "total", "Total", "SUM"])("%s", (word) => {
		expect(both(["10", "20", word])[2]).toBe(`ERROR: Undefined variable: ${word}. To add up the lines above, write "total above".`);
	});

	test("a defined sum or total is the variable", () => {
		expect(both(["sum = 5", "sum"])).toEqual(["= 5", "= 5"]);
		expect(both([":total = 7", "total * 2"])).toEqual(["= 7", "= 14"]);
	});

	test("a near miss of another word keeps its own suggestion", () => {
		expect(both([":budget = 5", "budgte"])[1]).toMatch(/Did you mean budget\?/);
	});
});
