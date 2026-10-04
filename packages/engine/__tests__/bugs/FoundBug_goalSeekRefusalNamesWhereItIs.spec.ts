import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { goalSeekHandler, goalSeekNoRerunMessage } from "@solve-js/packages/goalseek/GoalSeekPluginFunctions";
import { numberValue, stringValue, type Value } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";

/**
 * Found bug: a goal-seek refusal on a line inside a document named a place the
 * line was not. A goal seek on a line that a what-if in the document re-runs
 * (`line 3 with x = 4`, where line 3 holds the goal seek) was told it was in
 * "the batch pass (parseDocument)", since a what-if's scenario is a batch pass
 * of its own; and the engine's own re-run primitive, reached only from a line
 * context built over a document, said "the single-expression entry point" when
 * the engine's model had been put back since.
 *
 * `goalSeekNoRerunMessage` now names the what-if (the line context says so,
 * `inWhatIf`), the batch pass, and the single-expression entry point, each
 * where it applies; the primitive's refusal says the line's document is no
 * longer being evaluated. The code stays `GOAL_SEEK_NO_DOCUMENT` throughout,
 * so a host reading it is unchanged. The boundary: `evaluateLine` at any line
 * number is still the single-expression entry point, since it is handed no
 * document, and says so (#617).
 */

const SINGLE = "Goal seek only works inside a document, since it re-runs another line. The single-expression entry point has no document to solve against.";
const BATCH = "Goal seek re-runs another line, which the batch pass (parseDocument) cannot do: it evaluates each line once. evaluateDocument and a live editor can solve it.";
const WHAT_IF = "Goal seek cannot run inside a what-if: the what-if works each line of its scenario out once, and a goal seek re-runs another line many times. Solve the line outside the what-if.";

function show(line: { result?: Value | null; error?: unknown }): string {
	if (line.error) return `ERROR ${String(line.error)}`;
	if (line.result?.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

function batch(text: string): string[] {
	return newTrackedEngine().parseDocument(text).lines.map(show);
}

function incremental(text: string): string[] {
	return evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }).lines.map(show);
}

const WHAT_IF_DOC = "x = 5\nx * 2\ny = solve line 2 for x = 3\nline 3 with x = 4";

describe("each place names itself", () => {
	test("single expression", () => {
		const value = newTrackedEngine().evaluateExpression("solve line 2 for x = 3");
		expect(value.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
		expect(value.errorMessage).toBe(SINGLE);
	});

	test("the batch pass", () => {
		expect(batch("x = 5\nx * 2\nsolve line 2 for x = 3")[2]).toBe(`ERROR ${BATCH}`);
	});

	test("a what-if that re-runs a goal-seek line, through the incremental pass", () => {
		const lines = incremental(WHAT_IF_DOC);
		expect(lines[2]).toBe("1.50");
		expect(lines[3]).toBe(`ERROR ${WHAT_IF}`);
		expect(lines[3]).not.toContain("single-expression");
		expect(lines[3]).not.toContain("parseDocument");
	});

	test("the same what-if through the batch pass is the what-if's refusal too", () => {
		expect(batch(WHAT_IF_DOC)[3]).toBe(`ERROR ${WHAT_IF}`);
	});

	test("the goal seek itself still solves where it can", () => {
		expect(incremental("x = 5\nx * 2\nsolve line 2 for x = 3")[2]).toBe("1.50");
	});
});

describe("the parts", () => {
	test("goalSeekNoRerunMessage: each context", () => {
		expect(goalSeekNoRerunMessage(undefined)).toBe(SINGLE);
		expect(goalSeekNoRerunMessage({})).toBe(SINGLE);
		expect(goalSeekNoRerunMessage({ getLineCount: () => 9 })).toBe(BATCH);
		expect(goalSeekNoRerunMessage({ getLineCount: () => 9, inWhatIf: true })).toBe(WHAT_IF);
	});

	test("goalSeekNoRerunMessage: boundary contexts", () => {
		expect(goalSeekNoRerunMessage({ inWhatIf: false })).toBe(SINGLE);
		expect(goalSeekNoRerunMessage({ inWhatIf: true })).toBe(WHAT_IF);
		expect(goalSeekNoRerunMessage({ getLineCount: () => 0 })).toBe(BATCH);
	});

	test("evaluateLine at a line number is still the single-expression entry point", () => {
		expect(newTrackedEngine().evaluateLine(4, "solve line 2 for x = 3").errorMessage).toBe(SINGLE);
	});

	test("goalSeekHandler returns the refusal as a structured error for each", () => {
		const args = [numberValue(2), stringValue("x"), numberValue(3)];
		for (const context of [undefined, { lineIndex: -1 }, { lineIndex: 3, getLineCount: () => 5 }, { lineIndex: 3, getLineCount: () => 5, inWhatIf: true }]) {
			const out = goalSeekHandler(args, context as LineExecutionContext | undefined);
			expect(out.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
			expect(String(out.errorMessage)).toBe(goalSeekNoRerunMessage(context as LineExecutionContext | undefined));
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words as the unknown, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`solve line 2 for ${word} = 3`);
				expectHonestDocument(`${word} = 5\n${word} * 2\ny = solve line 2 for ${word} = 3\nline 3 with ${word} = 4`, { agree: false });
			}
		});
	});

	test("security: look-alike and markup-shaped text as the target", () => {
		for (const line of fill("solve line 2 for x = X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a what-if over a line that reads the goal seek's answer", () => {
		const lines = incremental("x = 5\nx * 2\ns = solve line 2 for x = 3\ns * 2\nline 4 with x = 1");
		expect(lines[4]).toBe(`ERROR ${WHAT_IF}`);
	});

	test("edge: numeric edges as the target, in each place", () => {
		for (const target of NUMERIC_EDGES) {
			expectHonestLine(`solve line 2 for x = ${target}`, { allowNaN: true });
			expectHonestDocument(`x = 5\nx * 2\ny = solve line 2 for x = ${target}\nline 3 with x = 4`, { agree: false, allowNaN: true });
		}
	});
});
