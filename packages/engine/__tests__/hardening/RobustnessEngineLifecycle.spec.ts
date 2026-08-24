/**
 * What `clear()` releases, and what an engine is like after it.
 *
 * There is history in this area: a query cache armed a ten-minute
 * garbage-collection timer per cached query, engines were dropped without
 * being cleared, and the whole suite passed every assertion and then sat for
 * ten minutes because Node cannot exit with timers outstanding. That was
 * fixed by making `clear()` empty the query cache and by routing specs
 * through `newTrackedEngine`, but the fix is only as good as the definition of
 * what `clear()` covers, and nothing pinned that definition.
 *
 * So this file states it, store by store: the per-document state an engine
 * holds must be gone afterwards, the engine must still work afterwards, and
 * the one store that is deliberately process-wide must survive, because a
 * `clear()` that silently took the shared globals with it would be a
 * cross-document data-loss bug rather than a tidy-up.
 *
 * Everything here uses the default configuration and the public API only.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { EngineError } from "@solve-js/errors/EngineError";

describe("clear releases the per-document state", () => {
	test("local variables are gone", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":x = 41");
		expect(engine.evaluateLine(2, ":x + 1").toNumber()).toBe(42);

		engine.clear();
		expect(() => engine.evaluateLine(2, ":x + 1")).toThrow(EngineError);
	});

	test("user-defined functions are gone", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "double(x) = x*2");
		expect(engine.evaluateLine(2, "double(4)").toNumber()).toBe(8);

		engine.clear();
		expect(() => engine.evaluateLine(2, "double(4)")).toThrow(EngineError);
	});

	test("the line cache and the dependency graph are gone", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":base = 10");
		engine.evaluateLine(2, ":base * 2");
		expect(engine.getCacheSnapshot().lineCache.length).toBeGreaterThan(0);

		engine.clear();
		expect(engine.getCacheSnapshot().lineCache).toEqual([]);
		expect(engine.getCacheSnapshot().bytecode).toEqual([]);
		expect(engine.getDag().getAffectedLinesInOrder("base")).toEqual([]);
	});

	test("the async query cache is emptied, which is what the timers hang off", () => {
		// The specific store whose leftover garbage-collection timers used to
		// keep the process alive. Nothing here makes a real network call, so
		// the assertion is only that the snapshot is empty and stays empty.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "2+2");
		engine.clear();
		expect(engine.getCacheSnapshot().asyncCache).toEqual([]);
	});
});

describe("an engine is fully usable after clear", () => {
	test("plain arithmetic still evaluates", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":x = 5");
		engine.clear();
		expect(engine.evaluateExpression("2+2").toNumber()).toBe(4);
		expect(engine.evaluateExpression("(1+2)*(3+4)").toNumber()).toBe(21);
	});

	test("the same variable name can be defined again with a different value", () => {
		// The failure this guards against is a stale DAG edge or line-cache
		// entry surviving the clear and answering with the old value.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":x = 5");
		engine.evaluateLine(2, ":x * 2");
		engine.clear();
		engine.evaluateLine(1, ":x = 100");
		expect(engine.evaluateLine(2, ":x * 2").toNumber()).toBe(200);
	});

	test("clearing twice in a row is harmless", () => {
		// `newTrackedEngine` clears every engine it made in an afterEach, so a
		// spec that also clears its own engine calls this twice as a matter of
		// course. It must not throw the second time.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":x = 5");
		engine.clear();
		engine.clear();
		expect(engine.evaluateExpression("1+1").toNumber()).toBe(2);
	});

	test("clearing right after a failed line works too", () => {
		const engine = newTrackedEngine();
		expect(() => engine.evaluateLine(1, "1 + * 2")).toThrow(EngineError);
		engine.clear();
		expect(engine.evaluateExpression("1+1").toNumber()).toBe(2);
	});
});

describe("the one store that deliberately outlives a document", () => {
	test("a global variable survives clear, because it is process-wide by design", () => {
		// `GlobalVariableStore` is documented as the single deliberate
		// exception to per-document VM isolation, shared across every engine in
		// the realm. So this is not leaked state, and a `clear()` that dropped
		// it would silently break the cross-document feature. The name is
		// deliberately unusual: the store really is shared, so a common name
		// would reach into whatever other spec runs in the same worker.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "global :robustnessLifecycleProbe = 7");
		engine.clear();
		expect(engine.evaluateLine(1, "global :robustnessLifecycleProbe").toNumber()).toBe(7);
	});
});

describe("one engine reused the way a document reuses it", () => {
	test("two thousand lines in a row, each one still correct", () => {
		// An editor holds one engine for the lifetime of a note and re-runs
		// lines on every keystroke. The failure mode this catches is per-line
		// state that accumulates rather than resets: a VM stack that never
		// drains, a parser cursor left mid-stream, a cache keyed on something
		// that collides.
		const engine = newTrackedEngine();
		for (let line = 1; line <= 2000; line++) {
			expect(engine.evaluateLine(line, `${line} + ${line}`).toNumber()).toBe(line * 2);
		}
	});

	test("the same line re-evaluated a thousand times gives the same answer", () => {
		const engine = newTrackedEngine();
		for (let i = 0; i < 1000; i++) {
			expect(engine.evaluateLine(1, "(2+3)*(4+5)").toNumber()).toBe(45);
		}
	});

	test("a dependent line follows its producer through repeated edits", () => {
		const engine = newTrackedEngine();
		for (let value = 1; value <= 200; value++) {
			engine.evaluateLine(1, `:price = ${value}`);
			expect(engine.evaluateLine(2, ":price * 3").toNumber()).toBe(value * 3);
		}
	});

	test("failures interleaved with successes do not accumulate", () => {
		// Alternating a throwing line with a good one is the shape that finds
		// state left behind by the throw path specifically, which the all-good
		// loops above cannot reach.
		const engine = newTrackedEngine();
		for (let i = 0; i < 500; i++) {
			expect(() => engine.evaluateLine(1, "1 + * 2")).toThrow(EngineError);
			expect(engine.evaluateLine(2, "6*7").toNumber()).toBe(42);
		}
	});
});
