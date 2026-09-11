/**
 * The allocation guard, extended to the values that grow without being a
 * collection.
 *
 * `ResourceGuardAllocation.spec.ts` covers the matrix product, where a single
 * opcode allocates more than the budget. This file covers the other shape of the
 * same hole: a value that DOUBLES each time an operator touches it, so a function
 * that squares or concatenates its argument, nested a few dozen deep, builds a
 * near-gigabyte value from a ninety-character document. Three value kinds grow
 * this way and none of them is a collection the existing ceilings could see:
 *
 *   d(s) = s + s   then   d(d(...d("ab")...))     a string, doubling in length
 *   b(n) = n * n   then   b(b(...b(9n)...))        a bigint, doubling in size
 *   m(x) = x * x   then   m(m(...m($9)...))        the exact decimal behind money
 *
 * Each is now charged against the running tally on birth, the same backstop
 * `matrixValue()` already had, so the doubling chain is stopped long before it is
 * fatal. `^` and `<<` on a bigint refuse at their own bit ceiling before they ever
 * reach here; multiply, which has no such ceiling, is what this charge bounds.
 *
 * Every size below trips the DEFAULT budget (2,000,000), so these are the
 * out-of-the-box guarantee a host relies on, not a lowered-limit contrivance.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The `EngineError` a line throws, or `null` when it evaluated instead. */
function errorFrom(engine: ReturnType<typeof newTrackedEngine>, source: string, line: number): EngineError | null {
	try {
		engine.evaluateLine(line, source);
		return null;
	} catch (thrown) {
		expect(thrown).toBeInstanceOf(EngineError);
		return thrown as EngineError;
	}
}

describe("a value that doubles each call is charged like any other allocation", () => {
	test("a string joined to itself is bounded, and short strings are not", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "d(s) = s + s");
			const tower = `${"d(".repeat(28)}"ab"${")".repeat(28)}`;
			expect(errorFrom(engine, tower, 2)?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
			// A handful of doublings is a few dozen characters, nowhere near the budget.
			expect(engine.evaluateLine(3, 'd(d(d("ab")))').type).toBe(ValueType.String);
		} finally {
			engine.clear();
		}
	});

	test("a bigint multiplied by itself is bounded, and small bigints are not", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "b(n) = n * n");
			const tower = `${"b(".repeat(28)}9n${")".repeat(28)}`;
			expect(errorFrom(engine, tower, 2)?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
			expect(engine.evaluateLine(3, "b(b(9n))").type).toBe(ValueType.BigInt);
		} finally {
			engine.clear();
		}
	});

	test("the exact decimal behind same-currency money is bounded, and ordinary money is not", () => {
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "m(x) = x * x");
			const tower = `${"m(".repeat(28)}$9${")".repeat(28)}`;
			expect(errorFrom(engine, tower, 2)?.code).toBe("ALLOCATION_LIMIT_EXCEEDED");
			// The exact-money arithmetic people actually write stays exact and cheap.
			expect(engine.evaluateLine(3, "$0.10 + $0.20").toNumber()).toBeCloseTo(0.3, 10);
		} finally {
			engine.clear();
		}
	});

	test("the refusal is recoverable: the engine keeps working after a doubling chain is stopped", () => {
		// The property a host depends on. Overshooting the budget describes one
		// line, not the engine, so it must not tear the document down.
		const engine = newTrackedEngine();
		try {
			engine.evaluateLine(1, "d(s) = s + s");
			const error = errorFrom(engine, `${"d(".repeat(28)}"ab"${")".repeat(28)}`, 2);
			expect(error?.recoverable).toBe(true);
			expect(error?.isFatal()).toBe(false);
			expect(engine.evaluateLine(3, "2 + 2").toNumber()).toBe(4);
		} finally {
			engine.clear();
		}
	});

	test("the everyday forms of each kind are untouched", () => {
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression('"foo" + " bar"').value).toBe("foo bar");
			expect(engine.evaluateExpression("12345678901234567890n + 1").type).toBe(ValueType.BigInt);
			expect(engine.evaluateExpression("$2.50 * 3").toNumber()).toBeCloseTo(7.5, 10);
		} finally {
			engine.clear();
		}
	});
});
