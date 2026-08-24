import { describe, expect, test, jest } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import { ValueType, numberValue } from "@solve-js/vm/Value";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createCurrencyPackage } from "@solve-js/packages/currency";
import { createHistoricalCurrencyResolver, historicalRateQueryKey } from "@solve-js/uom/HistoricalCurrency";

/**
 * Issue #155: a cancelled-out currency literal in a subexpression source made
 * preflight fetch a phantom pair.
 *
 * `(100 USD * (5 JPY / 5 JPY)) in GBP on <date>` resolves to `100 USD in GBP`,
 * but the JPY ratio still leaves a JPY string in the bytecode. Preflight
 * recovered the source from the nearest preceding currency string (JPY) and
 * fetched JPY->GBP — a wasted call (and, against a real provider, a failing one)
 * — while the runtime plugin separately fetched the correct USD->GBP. The value
 * was right; the extra fetch was not.
 *
 * The fix fetches ahead only when the operand strings name exactly one distinct
 * currency, deferring a mixed-currency subexpression to the runtime plugin.
 */
describe("Issue #155: an ambiguous subexpression source defers to a single runtime fetch", () => {
  function engineWithProvider(provider: (from: string, to: string, isoDate: string) => Promise<number>): ExpressionEngine {
    const currency = createCurrencyPackage({ historicalRateProvider: provider });
    const packages = [...BUILTIN_PACKAGES.filter((p) => p.name !== "solve-currency"), currency];
    return new ExpressionEngine("en", false, undefined, undefined, packages);
  }

  test("`(100 USD * (5 JPY / 5 JPY)) in GBP on <date>` fetches once, for USD only", async () => {
    // A from-sensitive provider: the JPY pair would give a different, wrong rate,
    // so a phantom JPY fetch is observable both in the call list and the value.
    const provider = jest.fn(async (from: string) => (from === "USD" ? 0.8 : 0.006));
    const engine = engineWithProvider(provider);

    const first = engine.evaluateLine(1, "(100 USD * (5 JPY / 5 JPY)) in GBP on 2024-01-15");
    expect(first[0].type).toBe(ValueType.Pending);

    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));

    // Only the amount's real source currency is fetched — never the cancelled JPY.
    const froms = provider.mock.calls.map((c) => c[0]);
    expect(froms).toEqual(["USD"]);
    expect(engine.queryClient.getQueryData(historicalRateQueryKey("JPY", "GBP", "2024-01-15"))).toBeUndefined();

    const resolved = engine.reEvaluateLine(1, "(100 USD * (5 JPY / 5 JPY)) in GBP on 2024-01-15");
    expect(resolved?.type).toBe(ValueType.Uom);
    expect(resolved?.value).toBeCloseTo(80, 6); // 100 * 0.8, the USD rate
    expect(resolved?.unit).toBe("GBP");

    engine.clear();
  });

  test("a plain single-currency literal still fetches ahead of the VM (unchanged)", () => {
    // Preflight resolves an unambiguous source, so seeding the cache means the
    // line evaluates synchronously with no pending round-trip.
    const provider = jest.fn(async () => 0.786);
    const engine = engineWithProvider(provider);
    engine.queryClient.setQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"), numberValue(0.786));

    const r = engine.evaluateLineWithDebug(1, "100 USD in GBP on 2024-01-15");
    expect(r.value.type).toBe(ValueType.Uom);
    expect(r.value.value).toBeCloseTo(78.6, 6);
    expect(r.value.unit).toBe("GBP");

    engine.clear();
  });

  test("the resolver's preflight fires for a single-currency amount and defers a two-currency one", async () => {
    const provider = jest.fn(async () => 0.8);
    const resolver = createHistoricalCurrencyResolver(provider);
    const qc = new QueryClient();

    // Build "100 USD in GBP on <date>" through the engine's own compiler, then a
    // mixed-currency subexpression, and check which one preflight acts on.
    const compileEngine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
    const single = compileEngine.evaluateLineWithDebug(1, "100 USD in GBP on 2024-01-15").program;
    const mixed = compileEngine.evaluateLineWithDebug(2, "(100 USD * (5 JPY / 5 JPY)) in GBP on 2024-01-15").program;

    // Single, unambiguous source: preflight returns a fetch.
    const singleCheck = resolver.preflight!([], single, "t", new AbortController().signal, qc);
    expect(singleCheck).not.toBeNull();
    // Await the fetch it started so the query settles rather than being cancelled
    // as an unhandled rejection when the client is cleared.
    await singleCheck!.resolver.catch(() => undefined);
    // Ambiguous (USD + JPY) source: preflight defers, no fetch to await.
    expect(resolver.preflight!([], mixed, "t", new AbortController().signal, qc)).toBeNull();

    qc.clear();
    compileEngine.clear();
  });
});
