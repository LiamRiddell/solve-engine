/**
 * StocksPackage integration tests.
 *
 * Stocks has NO free/keyless provider (unlike Weather's Open-Meteo), so
 * these tests never hit a real network endpoint — they exercise the
 * "honest not-configured error" path (no fetch functions supplied) AND a
 * fully working path using a TEST-PROVIDED mock fetch function, matching
 * the "no silent wrong answers" principle established elsewhere in this
 * codebase (see e.g. packages/finance/parselets/SalesTaxParselet.ts's doc
 * comment on never hardcoding an assumed rate).
 */
import { describe, expect, test } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { ValueType, stringValue, uomValue, numberValue } from "@solve-js/vm/Value";
import { setActiveQueryClient } from "@solve-js/services/DataQueryService";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createStocksPackage } from "@solve-js/packages/stocks";

// StocksPackage.ts keys its two pluginFunctions by these names under the package
// name "solve-stocks", and the parselets emit their plugin calls by the same
// names. The engine assigns each an index at registration under the qualified
// `${PACKAGE_NAME}:${name}`; recover the same indices here (deterministic and
// cached) so hand-built bytecode and descriptor assertions match the engine.
const PACKAGE_NAME = "solve-stocks";
const CURRENT_FN = "stock";
const HISTORICAL_FN = "stockhistorical";
const CURRENT_FN_IDX = pluginFunctionIndexFor(`${PACKAGE_NAME}:${CURRENT_FN}`);
const HISTORICAL_FN_IDX = pluginFunctionIndexFor(`${PACKAGE_NAME}:${HISTORICAL_FN}`);

function buildQueryBytecode(query: string, fnIdx: number) {
	const builder = new BytecodeBuilder();
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(query);
	builder.emitOpcode(OpCode.CALL_PLUGIN);
	builder.emitByte(fnIdx);
	builder.emitByte(1);
	builder.emitOpcode(OpCode.HALT);
	return builder.build();
}

describe("createStocksPackage — descriptor shape", () => {
	test("is NOT included in BUILTIN_PACKAGES (needs host configuration to do anything useful)", () => {
		const pkg = createStocksPackage();
		expect(BUILTIN_PACKAGES).not.toContain(pkg);
		expect(BUILTIN_PACKAGES.some((p) => p.name === "solve-stocks")).toBe(false);
	});

	test("bare-ticker grammar is OFF by default — no STOCK_TICKER parselet, no normalizer rule", () => {
		const pkg = createStocksPackage();
		expect(Object.keys(pkg.prefixParselets!).includes("STOCK_TICKER")).toBe(false);
		expect(pkg.normalizerRules).toHaveLength(0);
	});

	test("enableBareTickerRecognition:true registers the STOCK_TICKER parselet + normalizer rule", () => {
		const pkg = createStocksPackage({ enableBareTickerRecognition: true });
		expect(Object.keys(pkg.prefixParselets!).includes("STOCK_TICKER")).toBe(true);
		expect(pkg.normalizerRules).toHaveLength(1);
	});

	test("two independent CALL_PLUGIN indices (current vs. historical) and two async resolvers", () => {
		const pkg = createStocksPackage();
		expect(Object.keys(pkg.pluginFunctions!)).toHaveLength(2);
		expect(pkg.asyncResolvers).toHaveLength(2);
		const [currentName, historicalName] = Object.keys(pkg.pluginFunctions!);
		const currentIdx = pluginFunctionIndexFor(`${PACKAGE_NAME}:${currentName}`);
		const historicalIdx = pluginFunctionIndexFor(`${PACKAGE_NAME}:${historicalName}`);
		expect(currentIdx).not.toBe(historicalIdx);
	});

	test("plugin-function identity is by name: independent createStocksPackage() instances expose the same two distinct names, each resolving to its own engine index", () => {
		// Under the descriptor API the engine assigns a function's CALL_PLUGIN
		// index at registration, keyed by `${package}:${name}`, so identity is
		// by NAME, not a per-instance allocation. Two instances therefore expose
		// the same two named functions, and the two functions never share an
		// index (no self-collision), which is the invariant the dispatch relies on.
		const pkgA = createStocksPackage();
		const pkgB = createStocksPackage();
		const namesA = Object.keys(pkgA.pluginFunctions!);
		const namesB = Object.keys(pkgB.pluginFunctions!);
		expect(namesA).toEqual([CURRENT_FN, HISTORICAL_FN]);
		expect(namesB).toEqual([CURRENT_FN, HISTORICAL_FN]);
		const [currentIdx, historicalIdx] = namesA.map((n) => pluginFunctionIndexFor(`${PACKAGE_NAME}:${n}`));
		expect(currentIdx).not.toBe(historicalIdx);
	});
});

describe("createStocksPackage — honest 'not configured' error (no fetch functions supplied)", () => {
	test("current-price query resolves to a STOCKS_NOT_CONFIGURED error Value, never a fake price", async () => {
		const pkg = createStocksPackage(); // no config at all
		const qc = new QueryClient();
		const currentFnIdx = CURRENT_FN_IDX;
		const resolver = pkg.asyncResolvers![0]; // "stocks-current"

		const bytecode = buildQueryBytecode("AAPL", currentFnIdx);
		const result = resolver.preflight!([], bytecode, "test-pkg", new AbortController().signal, qc);
		expect(result).not.toBeNull();

		const resolved = await result!.resolver;
		expect(resolved.type).toBe(ValueType.Error);
		expect(resolved.value).toBe("STOCKS_NOT_CONFIGURED");
		expect(String(resolved.unit)).toMatch(/not configured/i);
		expect(String(resolved.unit)).toMatch(/fetchQuote/);

		qc.clear();
	});

	test("historical query resolves to a STOCKS_NOT_CONFIGURED error Value", async () => {
		const pkg = createStocksPackage();
		const qc = new QueryClient();
		const historicalFnIdx = HISTORICAL_FN_IDX;
		const resolver = pkg.asyncResolvers![1]; // "stocks-historical"

		const bytecode = buildQueryBytecode("close:AAPL:2005-04-12", historicalFnIdx);
		const result = resolver.preflight!([], bytecode, "test-pkg", new AbortController().signal, qc);
		const resolved = await result!.resolver;
		expect(resolved.type).toBe(ValueType.Error);
		expect(resolved.value).toBe("STOCKS_NOT_CONFIGURED");
		expect(String(resolved.unit)).toMatch(/fetchHistoricalQuote/);

		qc.clear();
	});
});

describe("createStocksPackage — working path with a test-provided mock fetch function", () => {
	test("fetchQuote is called with the upper-cased ticker and its result becomes a USD Uom Value", async () => {
		const fetchQuote = jest.fn(async (ticker: string) => {
			expect(ticker).toBe("AAPL");
			return { price: 192.53 };
		});
		const pkg = createStocksPackage({ fetchQuote });
		const qc = new QueryClient();
		const currentFnIdx = CURRENT_FN_IDX;
		const resolver = pkg.asyncResolvers![0];

		const bytecode = buildQueryBytecode("AAPL", currentFnIdx);
		const result = resolver.preflight!([], bytecode, "test-pkg", new AbortController().signal, qc);
		const resolved = await result!.resolver;

		expect(fetchQuote).toHaveBeenCalledTimes(1);
		expect(resolved.type).toBe(ValueType.Uom);
		expect(resolved.value).toBeCloseTo(192.53);
		expect(resolved.unit).toBe("USD");

		qc.clear();
	});

	test("fetchHistoricalQuote 'close' field returns the close price as a Uom Value", async () => {
		const fetchHistoricalQuote = jest.fn(async (ticker: string, isoDate: string) => {
			expect(ticker).toBe("AAPL");
			expect(isoDate).toBe("2005-04-12");
			return { close: 1.42, volume: 123_456_789 };
		});
		const pkg = createStocksPackage({ fetchHistoricalQuote });
		const qc = new QueryClient();
		const historicalFnIdx = HISTORICAL_FN_IDX;
		const resolver = pkg.asyncResolvers![1];

		const bytecode = buildQueryBytecode("close:AAPL:2005-04-12", historicalFnIdx);
		const result = resolver.preflight!([], bytecode, "test-pkg", new AbortController().signal, qc);
		const resolved = await result!.resolver;

		expect(resolved.type).toBe(ValueType.Uom);
		expect(resolved.value).toBeCloseTo(1.42);
		expect(resolved.unit).toBe("USD");

		qc.clear();
	});

	test("fetchHistoricalQuote 'volume' field returns a plain Number Value", async () => {
		const fetchHistoricalQuote = jest.fn(async () => ({ close: 1.42, volume: 123_456_789 }));
		const pkg = createStocksPackage({ fetchHistoricalQuote });
		const qc = new QueryClient();
		const historicalFnIdx = HISTORICAL_FN_IDX;
		const resolver = pkg.asyncResolvers![1];

		const bytecode = buildQueryBytecode("volume:AAPL:2005-04-12", historicalFnIdx);
		const result = resolver.preflight!([], bytecode, "test-pkg", new AbortController().signal, qc);
		const resolved = await result!.resolver;

		expect(resolved.type).toBe(ValueType.Number);
		expect(resolved.value).toBe(123_456_789);

		qc.clear();
	});
});

describe("createStocksPackage — ExpressionEngine integration (seeded cache, synchronous)", () => {
	function createEngine(config: Parameters<typeof createStocksPackage>[0] = {}) {
		const pkg = createStocksPackage(config);
		const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, pkg] });
		return { engine, pkg };
	}

	test("'stock(AAPL)' produces PUSH_STRING(AAPL) + CALL_PLUGIN(currentFnIdx) bytecode", () => {
		const { engine } = createEngine();
		const currentFnIdx = CURRENT_FN_IDX;
		engine.queryClient.setQueryData(["stocks-current", "AAPL"], uomValue(192.53, "USD"));

		const result = engine.evaluateLineWithDebug(1, "stock(AAPL)");

		expect(result.error).toBeUndefined();
		expect(result.program.opcodes[0]).toBe(OpCode.PUSH_STRING);
		expect(result.program.opcodes[2]).toBe(OpCode.CALL_PLUGIN);
		expect(result.program.opcodes[3]).toBe(currentFnIdx);
		expect(result.program.strings[0]).toBe("AAPL");
		expect(result.value.type).toBe(ValueType.Uom);
		expect(result.value.value).toBeCloseTo(192.53);
		expect(result.value.unit).toBe("USD");

		engine.clear();
	});

	test("'10 stock(AAPL)' implicit-multiplies quantity by the resolved price", () => {
		const { engine } = createEngine();
		engine.queryClient.setQueryData(["stocks-current", "AAPL"], uomValue(10, "USD"));

		const result = engine.evaluateLineWithDebug(1, "10 * stock(AAPL)");
		expect(result.error).toBeUndefined();
		expect(result.value.value).toBeCloseTo(100);
		expect(result.value.unit).toBe("USD");

		engine.clear();
	});

	test("'stock(AAPL) * 2' — genuine multiplication AFTER the call still works (not swallowed by the 'on <date>' suffix check)", () => {
		// Regression coverage: the implicit-multiply normalizer rule inserts
		// a STAR between `)` and a following bare word (so it can also
		// insert one before "on"/"close"/"volume" — see
		// StockParselet.ts's finishStockExpression() doc). The suffix
		// parser must peek past a STAR to tell "phantom, about to see our
		// suffix" apart from "real multiplication", and correctly finish
		// compiling the latter itself.
		const { engine } = createEngine();
		engine.queryClient.setQueryData(["stocks-current", "AAPL"], uomValue(10, "USD"));

		const result = engine.evaluateLineWithDebug(1, "stock(AAPL) * 2");
		expect(result.error).toBeUndefined();
		expect(result.value.value).toBeCloseTo(20);
		expect(result.value.unit).toBe("USD");

		engine.clear();
	});

	test("'stock(AAPL) on April 12, 2005' routes to the historical resolver with the parsed ISO date", () => {
		const { engine } = createEngine();
		const historicalFnIdx = HISTORICAL_FN_IDX;
		engine.queryClient.setQueryData(["stocks-historical", "close:AAPL:2005-04-12"], uomValue(1.42, "USD"));

		const result = engine.evaluateLineWithDebug(1, "stock(AAPL) on April 12, 2005");

		expect(result.error).toBeUndefined();
		expect(result.program.opcodes[3]).toBe(historicalFnIdx);
		expect(result.program.strings[0]).toBe("close:AAPL:2005-04-12");
		expect(result.value.value).toBeCloseTo(1.42);

		engine.clear();
	});

	test("returns Pending when nothing is cached yet (no config, no seed)", () => {
		const { engine } = createEngine();
		const result = engine.evaluateLineWithDebug(1, "stock(AAPL)");
		expect(result.error).toBeUndefined();
		expect(result.value.type).toBe(ValueType.Pending);
		engine.clear();
	});

	test("bare 'AAPL' is just a variable read (IDENT) unless enableBareTickerRecognition is set", () => {
		const { engine } = createEngine({ enableBareTickerRecognition: false });
		const result = engine.evaluateLineWithDebug(1, "AAPL");
		// No STOCK_TICKER fusion — "AAPL" stays IDENT and is NOT a CALL_PLUGIN.
		expect(result.tokens[0].type).not.toBe("STOCK_TICKER");
		engine.clear();
	});

	test("bare 'AAPL' resolves via the allow-list when enableBareTickerRecognition is true", () => {
		const { engine } = createEngine({ enableBareTickerRecognition: true });
		engine.queryClient.setQueryData(["stocks-current", "AAPL"], uomValue(192.53, "USD"));

		const result = engine.evaluateLineWithDebug(1, "AAPL");
		expect(result.error).toBeUndefined();
		expect(result.tokens[0].type).toBe("STOCK_TICKER");
		expect(result.value.value).toBeCloseTo(192.53);

		engine.clear();
	});
});
