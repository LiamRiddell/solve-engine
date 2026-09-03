/**
 * The allocation guard, for text.
 *
 * `ResourceGuardAllocation.spec.ts` covers the collections and matrices the
 * budget was written for. Text was the hole it had not closed: the two
 * operations that can make a string longer than any of their inputs allocated
 * outside the budget entirely, so `x repeated 400000000 times` asked for eight
 * hundred megabytes inside one opcode, where neither the instruction nor the
 * stack limit can see. The sizes here are chosen a few orders of magnitude
 * below that, so the counted refusal is all that happens.
 */

import { describe, expect, test } from "@jest/globals";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The `EngineError` a line throws, or `null` when it evaluated instead. */
function errorFrom(engine: ExpressionEngine, source: string, line = 1): EngineError | null {
	try {
		engine.evaluateLine(line, source);
		return null;
	} catch (thrown) {
		expect(thrown).toBeInstanceOf(EngineError);
		return thrown as EngineError;
	}
}

describe("repeating text", () => {
	test("a repetition larger than the budget is refused before it is built", () => {
		const error = errorFrom(newTrackedEngine(), '"ab" repeated 2000000 times');
		expect(error?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
		// The size is named, because "too big" without a number is nothing a
		// person can act on.
		expect(error?.message).toContain("4,000,000");
		expect(error?.message).toContain("characters");
	});

	test("a repetition within the budget is unchanged", () => {
		expect(newTrackedEngine().evaluateExpression('"ab" repeated 3 times').value).toBe("ababab");
	});
});

describe("replacing text", () => {
	test("a replacement that would grow past the budget is refused from its size", () => {
		const engine = newTrackedEngine();
		expect(errorFrom(engine, ':piece = "a" repeated 100000 times', 1)).toBeNull();
		expect(errorFrom(engine, ':filler = "b" repeated 100 times', 2)).toBeNull();
		// A hundred thousand matches, each growing the text by ninety-nine
		// characters: ten million, five times the budget.
		const error = errorFrom(engine, 'replace(piece, "a", filler)', 3);
		expect(error?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
	});

	test("a replacement that shrinks or holds the text is never refused", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression('replace("aaaa", "a", "")').value).toBe("");
		expect(engine.evaluateExpression('replace("cat", "a", "o")').value).toBe("cot");
	});
});
