import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #617: the refusal parseDocument gave for goal seek said "The
 * single-expression entry point has no document to solve against", which is
 * wrong for a caller that passed a whole document. The batch pass has a
 * document; what it lacks is a way to re-run a line. The refusal now says which
 * of the two it is, and keeps its code.
 */

const NOTE = "price = 100\nprice * 1.2\nsolve line 2 for price = 150";

describe("the goal-seek refusal names the pass that gave it", () => {
	test("parseDocument: the batch pass cannot re-run a line, and evaluateDocument can", () => {
		const line = newTrackedEngine().parseDocument(NOTE).lines[2];
		const value = line.result!;
		expect(value.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
		expect(formatValue(value)).toBe(
			"Goal seek re-runs another line, which the batch pass (parseDocument) cannot do: it evaluates each line once. evaluateDocument and a live editor can solve it.",
		);
	});

	test("evaluateLine: there is no document at all", () => {
		const value = newTrackedEngine().evaluateLine(1, "solve line 2 for price = 150");
		expect(value.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
		expect(formatValue(value)).toBe(
			"Goal seek only works inside a document, since it re-runs another line. The single-expression entry point has no document to solve against.",
		);
	});

	test("evaluateDocument solves it", () => {
		const out = evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, NOTE).lines.map((l) => (l.result ? formatValue(l.result) : ""));
		expect(out[2]).toBe("= 125");
	});
});
