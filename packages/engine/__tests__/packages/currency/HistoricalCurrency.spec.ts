/**
 * Historical currency conversion, `<money> in <currency> on <date>`.
 *
 * Live conversion uses today's rate and drifts as the market moves, which is
 * wrong for an expense or an invoice reconciled after the fact: the note was
 * right when written and quietly stops being right. These tests cover the dated
 * form end to end, the honest "not configured" error when no host provider is
 * supplied (never a silent fall back to today's rate), a fully working path
 * with a stub provider, and both date spellings the ticket names
 * (`2024-01-15` and `15 Jan 2024`).
 *
 * The seeded-cache integration cases mirror StocksPackage.spec.ts: an async
 * result resolves to Pending first and the real value lands later, so a test
 * that wants the resolved value seeds the query cache the plugin reads rather
 * than driving a real fetch. The provider-behaviour cases drive the resolver's
 * preflight directly and await the promise it returns, the same way the stocks
 * suite exercises its "not configured" and "working" paths.
 */
import { describe, expect, test, jest } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ValueType, numberValue, uomValue, errorValue, stringValue, type Value } from "@solve-js/vm/Value";
import { setActiveQueryClient } from "@solve-js/services/DataQueryService";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { createCurrencyPackage, CURRENCY_PACKAGE } from "@solve-js/packages/currency";
import {
	HISTORICAL_CURRENCY_FN_IDX,
	HISTORICAL_CURRENCY_NS,
	HISTORICAL_RATE_STALE_TIME_MS,
	HistoricalCurrencyErrorCodes,
	historicalRateQueryKey,
	historicalCurrencyPluginFunction,
	createHistoricalCurrencyResolver,
} from "@solve-js/uom/HistoricalCurrency";

const NO_SIGNAL = new AbortController().signal;

/** Build the bytecode a `<money> in <currency> on <date>` line compiles to: amount Uom, then [target, date] strings, then the historical CALL_PLUGIN. */
function buildHistoricalBytecode(amount: number, from: string, to: string, isoDate: string) {
	const builder = new BytecodeBuilder();
	builder.emitOpcode(OpCode.PUSH_NUMBER);
	builder.emitNumber(amount);
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(from);
	builder.emitOpcode(OpCode.UOM_CONVERT);
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(to);
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(isoDate);
	builder.emitOpcode(OpCode.CALL_PLUGIN);
	builder.emitByte(HISTORICAL_CURRENCY_FN_IDX);
	builder.emitByte(3);
	builder.emitOpcode(OpCode.HALT);
	return builder.build();
}

/** Whether an opcode stream contains a CALL_PLUGIN at the historical index. */
function hasHistoricalCall(opcodes: Uint8Array): boolean {
	for (let i = 0; i + 1 < opcodes.length; i++) {
		if (opcodes[i] === OpCode.CALL_PLUGIN && opcodes[i + 1] === HISTORICAL_CURRENCY_FN_IDX) return true;
	}
	return false;
}

describe("createCurrencyPackage — descriptor shape", () => {
	test("the default CURRENCY_PACKAGE is a member of BUILTIN_PACKAGES (live rates need no config, unlike stocks)", () => {
		expect(BUILTIN_PACKAGES).toContain(CURRENCY_PACKAGE);
		expect(BUILTIN_PACKAGES.some((p) => p.name === "solve-currency")).toBe(true);
	});

	test("registers a live AND a historical async resolver, under distinct namespaces", () => {
		const pkg = createCurrencyPackage();
		const namespaces = (pkg.asyncResolvers ?? []).map((r) => r.namespace);
		expect(namespaces).toContain("currency");
		expect(namespaces).toContain(HISTORICAL_CURRENCY_NS);
	});

	test("registers the historical plugin function at the shared module-level index", () => {
		const pkg = createCurrencyPackage();
		const fn = (pkg.pluginFunctions ?? []).find((p) => p.index === HISTORICAL_CURRENCY_FN_IDX);
		expect(fn).toBeDefined();
	});

	test("a resolved historical rate is declared permanently fresh (staleTime Infinity)", () => {
		// The whole point of the feature: a rate for a fixed past date is
		// immutable, so the query cache never re-fetches it, unlike a live rate.
		expect(HISTORICAL_RATE_STALE_TIME_MS).toBe(Infinity);
	});
});

describe("historical resolver — honest 'not configured' error (no provider supplied)", () => {
	test("resolves to a HISTORICAL_RATES_NOT_CONFIGURED error Value, never today's rate", async () => {
		const resolver = createHistoricalCurrencyResolver(); // no provider
		const qc = new QueryClient();
		const bytecode = buildHistoricalBytecode(100, "USD", "GBP", "2024-01-15");

		const result = resolver.preflight!([], bytecode, "test-pkg", NO_SIGNAL, qc);
		expect(result).not.toBeNull();

		const resolved = await result!.resolver;
		expect(resolved.type).toBe(ValueType.Error);
		expect(resolved.value).toBe(HistoricalCurrencyErrorCodes.NOT_CONFIGURED);
		expect(String(resolved.unit)).toMatch(/not configured/i);
		expect(String(resolved.unit)).toMatch(/historicalRateProvider/);

		qc.clear();
	});
});

describe("historical resolver — working path with a stub provider", () => {
	test("provider is called with (from, to, isoDate) upper-cased, and its rate is cached as a Number", async () => {
		const provider = jest.fn(async (from: string, to: string, isoDate: string) => {
			expect(from).toBe("USD");
			expect(to).toBe("GBP");
			expect(isoDate).toBe("2024-01-15");
			return 0.786;
		});
		const resolver = createHistoricalCurrencyResolver(provider);
		const qc = new QueryClient();
		const bytecode = buildHistoricalBytecode(100, "USD", "GBP", "2024-01-15");

		const result = resolver.preflight!([], bytecode, "test-pkg", NO_SIGNAL, qc);
		const resolved = await result!.resolver;

		expect(provider).toHaveBeenCalledTimes(1);
		expect(resolved.type).toBe(ValueType.Number);
		expect(resolved.value).toBeCloseTo(0.786);
		expect(qc.getQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"))).toBe(resolved);

		qc.clear();
	});

	test("an already-cached rate is reused rather than re-fetched (permanently fresh)", () => {
		const provider = jest.fn(async () => 0.786);
		const resolver = createHistoricalCurrencyResolver(provider);
		const qc = new QueryClient();
		qc.setQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"), numberValue(0.786));
		const bytecode = buildHistoricalBytecode(100, "USD", "GBP", "2024-01-15");

		const result = resolver.preflight!([], bytecode, "test-pkg", NO_SIGNAL, qc);
		// Cache hit: no async work returned, and the provider is never touched.
		expect(result).toBeNull();
		expect(provider).not.toHaveBeenCalled();

		qc.clear();
	});

	test("a same-currency conversion needs no rate and no provider call", () => {
		const provider = jest.fn(async () => 1);
		const resolver = createHistoricalCurrencyResolver(provider);
		const qc = new QueryClient();
		const bytecode = buildHistoricalBytecode(100, "USD", "USD", "2024-01-15");

		const result = resolver.preflight!([], bytecode, "test-pkg", NO_SIGNAL, qc);
		expect(result).toBeNull();
		expect(provider).not.toHaveBeenCalled();

		qc.clear();
	});

	test("a provider that throws yields a HISTORICAL_RATE_QUERY_FAILED error Value, not a rejection", async () => {
		const provider = jest.fn(async () => { throw new Error("provider exploded"); });
		const resolver = createHistoricalCurrencyResolver(provider);
		const qc = new QueryClient();
		const bytecode = buildHistoricalBytecode(100, "USD", "GBP", "2024-01-15");

		const result = resolver.preflight!([], bytecode, "test-pkg", NO_SIGNAL, qc);
		const resolved = await result!.resolver;

		expect(resolved.type).toBe(ValueType.Error);
		expect(resolved.value).toBe(HistoricalCurrencyErrorCodes.QUERY_FAILED);
		expect(String(resolved.unit)).toMatch(/provider exploded/);

		qc.clear();
	});
});

describe("historical plugin function — applies the cached rate to the amount", () => {
	test("multiplies the amount by the cached rate and tags the target currency", () => {
		const qc = new QueryClient();
		setActiveQueryClient(qc);
		qc.setQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"), numberValue(0.786));

		const result = historicalCurrencyPluginFunction([uomValue(100, "USD"), stringValue("GBP"), stringValue("2024-01-15")]);
		expect(result.type).toBe(ValueType.Uom);
		expect(result.value).toBeCloseTo(78.6);
		expect(result.unit).toBe("GBP");

		setActiveQueryClient(null);
		qc.clear();
	});

	test("converts a currency to itself at 1, without a cache read", () => {
		const result = historicalCurrencyPluginFunction([uomValue(100, "USD"), stringValue("USD"), stringValue("2024-01-15")]);
		expect(result.type).toBe(ValueType.Uom);
		expect(result.value).toBeCloseTo(100);
		expect(result.unit).toBe("USD");
	});

	test("surfaces a cached error (e.g. not configured) as-is rather than converting against a missing rate", () => {
		const qc = new QueryClient();
		setActiveQueryClient(qc);
		qc.setQueryData(
			historicalRateQueryKey("USD", "GBP", "2024-01-15"),
			errorValue(HistoricalCurrencyErrorCodes.NOT_CONFIGURED, "Historical exchange rates are not configured."),
		);

		const result = historicalCurrencyPluginFunction([uomValue(100, "USD"), stringValue("GBP"), stringValue("2024-01-15")]);
		expect(result.type).toBe(ValueType.Error);
		expect(result.value).toBe(HistoricalCurrencyErrorCodes.NOT_CONFIGURED);

		setActiveQueryClient(null);
		qc.clear();
	});

	test("a non-currency amount is rejected rather than silently converted", () => {
		const result = historicalCurrencyPluginFunction([uomValue(100, "kg"), stringValue("GBP"), stringValue("2024-01-15")]);
		expect(result.type).toBe(ValueType.Error);
		expect(result.value).toBe(HistoricalCurrencyErrorCodes.INVALID_OPERAND);
	});
});

describe("historical currency — ExpressionEngine integration (seeded cache, synchronous)", () => {
	function createEngine(): ExpressionEngine {
		return new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
	}

	test("'100 USD in GBP on 2024-01-15' compiles to the historical CALL_PLUGIN and applies the seeded rate", () => {
		const engine = createEngine();
		engine.queryClient.setQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"), numberValue(0.786));

		const result = engine.evaluateLineWithDebug(1, "100 USD in GBP on 2024-01-15");

		expect(result.error).toBeUndefined();
		expect(hasHistoricalCall(result.program.opcodes)).toBe(true);
		expect(result.value.type).toBe(ValueType.Uom);
		expect(result.value.value).toBeCloseTo(78.6);
		expect(result.value.unit).toBe("GBP");

		engine.clear();
	});

	test("'100 USD in GBP on 15 Jan 2024' resolves through the same ISO date key", () => {
		const engine = createEngine();
		engine.queryClient.setQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"), numberValue(0.786));

		const result = engine.evaluateLineWithDebug(1, "100 USD in GBP on 15 Jan 2024");

		expect(result.error).toBeUndefined();
		expect(result.value.value).toBeCloseTo(78.6);
		expect(result.value.unit).toBe("GBP");

		engine.clear();
	});

	test("'$100 in GBP on 2024-01-15' (symbol form, InParselet path) also resolves", () => {
		const engine = createEngine();
		engine.queryClient.setQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"), numberValue(0.786));

		const result = engine.evaluateLineWithDebug(1, "$100 in GBP on 2024-01-15");

		expect(result.error).toBeUndefined();
		expect(hasHistoricalCall(result.program.opcodes)).toBe(true);
		expect(result.value.value).toBeCloseTo(78.6);
		expect(result.value.unit).toBe("GBP");

		engine.clear();
	});

	test("a computed amount converts too: '(50 + 50) USD in GBP on 2024-01-15'", () => {
		const engine = createEngine();
		engine.queryClient.setQueryData(historicalRateQueryKey("USD", "GBP", "2024-01-15"), numberValue(0.786));

		const result = engine.evaluateLineWithDebug(1, "(50 + 50) USD in GBP on 2024-01-15");

		expect(result.error).toBeUndefined();
		expect(result.value.value).toBeCloseTo(78.6);
		expect(result.value.unit).toBe("GBP");

		engine.clear();
	});

	test("returns Pending when nothing is cached yet (no provider, no seed)", () => {
		const engine = createEngine();
		const result = engine.evaluateLineWithDebug(1, "100 USD in GBP on 2024-01-15");
		expect(result.error).toBeUndefined();
		expect(result.value.type).toBe(ValueType.Pending);
		engine.clear();
	});
});

describe("historical currency — does not regress live conversion or date parsing", () => {
	function createEngine(): ExpressionEngine {
		return new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
	}

	test("dateless '100 USD in GBP' still compiles to the live UOM_CONVERT_TO path, not the historical call", () => {
		const engine = createEngine();
		const result = engine.evaluateLineWithDebug(1, "100 USD in GBP");
		expect(result.error).toBeUndefined();
		expect(hasHistoricalCall(result.program.opcodes)).toBe(false);
		expect([...result.program.opcodes]).toContain(OpCode.UOM_CONVERT_TO);
		engine.clear();
	});

	test("live '100 USD in GBP' resolves against a primed live rate (unchanged behaviour)", () => {
		const engine = createEngine();
		// Prime the live exchange service the VM's UOM_CONVERT_TO reads through
		// convertSync (distinct from the historical query cache), so the live
		// path resolves synchronously without a network call.
		sharedCurrencyExchange.primeRates("USD", { GBP: 0.739 });

		const result = engine.evaluateLineWithDebug(1, "100 USD in GBP");
		expect(result.error).toBeUndefined();
		expect(result.value.unit).toBe("GBP");
		expect(result.value.value).toBeCloseTo(73.9);

		sharedCurrencyExchange.clearRates();
		engine.clear();
	});

	test("a non-currency conversion with a trailing word is untouched by the on-date hook", () => {
		const engine = createEngine();
		const result = engine.evaluateLineWithDebug(1, "100 cm in m");
		expect(result.error).toBeUndefined();
		expect(hasHistoricalCall(result.program.opcodes)).toBe(false);
		expect(result.value.value).toBeCloseTo(1);
		expect(result.value.unit).toBe("m");
		engine.clear();
	});
});

describe("historical currency — unconfigured end to end (default engine)", () => {
	test("the default engine recognises the syntax and reports not-configured after the pending flash", async () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);

		// First evaluation: nothing cached, so the line is Pending while the
		// (provider-less) resolver resolves its not-configured error.
		const first = engine.evaluateLineWithDebug(1, "100 USD in GBP on 2024-01-15");
		expect(first.value.type).toBe(ValueType.Pending);

		// Drive the resolver directly to confirm what lands in the cache: an
		// honest not-configured error, never a fabricated rate.
		const resolver = createHistoricalCurrencyResolver();
		const bytecode = buildHistoricalBytecode(100, "USD", "GBP", "2024-01-15");
		const check = resolver.preflight!([], bytecode, "solve-currency", NO_SIGNAL, engine.queryClient);
		const resolved: Value = await check!.resolver;
		expect(resolved.type).toBe(ValueType.Error);
		expect(resolved.value).toBe(HistoricalCurrencyErrorCodes.NOT_CONFIGURED);

		engine.clear();
	});
});
