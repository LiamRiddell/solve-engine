/**
 * The compiled caches evict the entry that has gone longest without being
 * used, not the one inserted first.
 *
 * The bytecode cache, the front half remembered beside each program and the
 * failed-parse memory are all bounded by `performance.defaultCacheSize`, and
 * all three used to evict in insertion order. A document re-evaluated on every
 * keystroke touches its lines constantly, but insertion order does not know
 * that: once the cap was reached, every one-off expression (an inline solve, a
 * host's classification probe of a prose line) pushed out whichever line had
 * been compiled earliest, however hot it was. A hit now refreshes an entry's
 * place, so the victim is the entry nothing has asked for in the longest time.
 *
 * What is pinned: a hit refreshes the entry's place in the program cache; the
 * front half goes with its program, so an evicted line lexes again and a
 * refreshed one does not; the failed-parse memory follows the same rule; and
 * the cap itself is unchanged at 2,000 entries, which a whole document that
 * fits in it enjoys and one that does not still cycles through. Sizing the cap
 * to the document is a separate decision, deliberately not taken here.
 */

import { describe, expect, jest, test } from "@jest/globals";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

const CAP = 3;

/** An engine whose compiled caches hold three entries, so eviction is a few lines away. */
function smallEngine(): ExpressionEngine {
	return newTrackedEngine({ config: { performance: { defaultCacheSize: CAP } } });
}

/** Evaluate an expression that does not parse, returning the error's code. */
function failure(engine: ExpressionEngine, expression: string): string {
	try {
		engine.evaluateExpression(expression);
	} catch (thrown) {
		return (thrown as { code: string }).code;
	}
	throw new Error(`${expression} was expected to fail`);
}

describe("the program cache", () => {
	test("evicts the entry that has gone longest without a hit", () => {
		const engine = smallEngine();
		engine.evaluateExpression("1 + 1");
		engine.evaluateExpression("2 + 2");
		engine.evaluateExpression("3 + 3");
		// A hit on the oldest insertion makes it the most recently used.
		engine.evaluateExpression("1 + 1");
		engine.evaluateExpression("4 + 4");

		const cache = engine.getBytecodeCache();
		expect(cache.size).toBe(CAP);
		expect(cache.has("1 + 1")).toBe(true);
		expect(cache.has("2 + 2")).toBe(false);
		expect(cache.has("3 + 3")).toBe(true);
		expect(cache.has("4 + 4")).toBe(true);
	});

	test("the front half goes with its program: the evicted line lexes again, the refreshed one does not", () => {
		const engine = smallEngine();
		engine.evaluateExpression("1 + 1");
		engine.evaluateExpression("2 + 2");
		engine.evaluateExpression("3 + 3");
		engine.evaluateExpression("1 + 1");
		engine.evaluateExpression("4 + 4");

		const lex = jest.spyOn(engine.getLexer(), "resetExpression");
		expect(engine.evaluateExpression("1 + 1").toNumber()).toBe(2);
		expect(lex).not.toHaveBeenCalled();
		expect(engine.evaluateExpression("2 + 2").toNumber()).toBe(4);
		expect(lex).toHaveBeenCalledTimes(1);
	});

	test("a re-evaluation through the cached-line path counts as a hit too", () => {
		const engine = smallEngine();
		engine.evaluateLine(1, "1 + 1");
		engine.evaluateLine(2, "2 + 2");
		engine.evaluateLine(3, "3 + 3");
		expect(engine.reEvaluateLine(1, "1 + 1")?.toNumber()).toBe(2);
		engine.evaluateLine(4, "4 + 4");

		const cache = engine.getBytecodeCache();
		expect(cache.has("1 + 1")).toBe(true);
		expect(cache.has("2 + 2")).toBe(false);
	});
});

describe("the failed-parse memory", () => {
	test("evicts the failure that has gone longest without a hit", () => {
		const engine = smallEngine();
		expect(failure(engine, "(1 + ")).toBe("UNEXPECTED_END_OF_INPUT");
		failure(engine, "(2 + ");
		failure(engine, "(3 + ");
		// A hit on the oldest failure makes it the most recently used.
		failure(engine, "(1 + ");
		failure(engine, "(4 + ");

		const lex = jest.spyOn(engine.getLexer(), "resetExpression");
		failure(engine, "(1 + ");
		expect(lex).not.toHaveBeenCalled();
		failure(engine, "(2 + ");
		expect(lex).toHaveBeenCalledTimes(1);
	});
});

describe("the cap", () => {
	test("is 2,000 entries by default, and the program cache never exceeds it", () => {
		const engine = newTrackedEngine();
		const cap = engine.getConfig().performance.defaultCacheSize;
		expect(cap).toBe(2000);
		for (let i = 0; i <= cap; i++) engine.evaluateExpression(`${i} + 1`);
		expect(engine.getBytecodeCache().size).toBe(cap);
	});
});
