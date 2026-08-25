import { describe, expect, test, jest } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import { ValueType, uomValue, stringValue, type Value } from "@solve-js/vm/Value";
import { setActiveQueryClient } from "@solve-js/services/DataQueryService";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createCurrencyPackage } from "@solve-js/packages/currency";
import {
	HistoricalCurrencyErrorCodes,
	historicalRateQueryKey,
	createHistoricalCurrencyPluginFunction,
} from "@solve-js/uom/HistoricalCurrency";

/**
 * Issue #140: a historical conversion of a variable source raised
 * NOT_PREFLIGHTED and never called the provider.
 *
 * `x = 100 USD` then `x in GBP on 2024-01-15` returned an internal
 * `HISTORICAL_RATE_NOT_PREFLIGHTED` error with a working provider configured.
 * The resolver's preflight recovers the source currency from a currency literal
 * in the bytecode, but a variable left operand carries no such literal, so
 * preflight fetched nothing and the runtime read hit the not-preflighted path.
 *
 * The fix lets the plugin function fetch the rate itself on that cache miss —
 * the source currency IS known at runtime (it is the amount's unit) — and return
 * the Promise, so the VM makes the line pending, the engine awaits and
 * re-evaluates, and the re-run reads the freshly cached rate. A literal source
 * still resolves through preflight and reads the cache synchronously.
 */
describe("Issue #140: a variable source currency resolves a historical conversion", () => {
	const ARGS = (): Value[] => [uomValue(100, "USD"), stringValue("GBP"), stringValue("2024-01-15")];

	describe("plugin function fetches on a runtime cache-miss", () => {
		test("returns a Promise (not a NOT_PREFLIGHTED error), fetches via the provider, then reads the cached rate", async () => {
			const qc = new QueryClient();
			setActiveQueryClient(qc);
			const provider = jest.fn(async () => 0.786);
			const fn = createHistoricalCurrencyPluginFunction(provider);

			const first = fn(ARGS());
			// Before the fix this branch returned a NOT_PREFLIGHTED error Value.
			expect(first).toBeInstanceOf(Promise);
			await first;
			expect(provider).toHaveBeenCalledTimes(1);
			expect(provider).toHaveBeenCalledWith("USD", "GBP", "2024-01-15", expect.anything());

			// The rate is now cached, so a second call reads it synchronously.
			const second = fn(ARGS());
			expect(second).not.toBeInstanceOf(Promise);
			const value = second as Value;
			expect(value.type).toBe(ValueType.Uom);
			expect(value.value).toBeCloseTo(78.6);
			expect(value.unit).toBe("GBP");

			setActiveQueryClient(null);
			qc.clear();
		});

		test("a cache-miss with no provider fetches to NOT_CONFIGURED, never NOT_PREFLIGHTED or today's rate", async () => {
			const qc = new QueryClient();
			setActiveQueryClient(qc);
			const fn = createHistoricalCurrencyPluginFunction(); // no provider

			const first = fn(ARGS());
			expect(first).toBeInstanceOf(Promise);
			const resolved = await (first as Promise<Value>);
			expect(resolved.type).toBe(ValueType.Error);
			expect(resolved.value).toBe(HistoricalCurrencyErrorCodes.NOT_CONFIGURED);

			setActiveQueryClient(null);
			qc.clear();
		});
	});

	describe("full engine — the reported repro", () => {
		function engineWithProvider(provider: (from: string, to: string, isoDate: string) => Promise<number>): ExpressionEngine {
			const currency = createCurrencyPackage({ historicalRateProvider: provider });
			const packages = [...BUILTIN_PACKAGES.filter((p) => p.name !== "solve-currency"), currency];
			return new ExpressionEngine({ packages });
		}

		test("`x in GBP on 2024-01-15` for `x = 100 USD` is pending, then resolves through the provider", async () => {
			const provider = jest.fn(async () => 0.786);
			const engine = engineWithProvider(provider);

			engine.evaluateLine(1, "x = 100 USD");
			const first = engine.evaluateLine(2, "x in GBP on 2024-01-15");
			// Was HISTORICAL_RATE_NOT_PREFLIGHTED (an Error) before the fix.
			expect(first.type).toBe(ValueType.Pending);

			// resolveAsync awaits the fetch and the batcher re-evaluates on a
			// microtask; give the pipeline a few ticks.
			for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

			expect(provider).toHaveBeenCalledTimes(1);
			expect(engine.queryClient.getQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"))).toBeDefined();

			const resolved = engine.reEvaluateLine(2, "x in GBP on 2024-01-15");
			expect(resolved?.type).toBe(ValueType.Uom);
			expect(resolved?.value).toBeCloseTo(78.6);
			expect(resolved?.unit).toBe("GBP");

			engine.clear();
		});

		test("a literal source is unaffected (still resolves to the same value)", async () => {
			const provider = jest.fn(async () => 0.786);
			const engine = engineWithProvider(provider);

			const first = engine.evaluateLine(1, "100 USD in GBP on 2024-01-15");
			expect(first.type).toBe(ValueType.Pending);

			for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

			const resolved = engine.reEvaluateLine(1, "100 USD in GBP on 2024-01-15");
			expect(resolved?.type).toBe(ValueType.Uom);
			expect(resolved?.value).toBeCloseTo(78.6);
			expect(resolved?.unit).toBe("GBP");

			engine.clear();
		});
	});
});
