/**
 * Every live figure records where it came from, and the record travels with
 * every answer built from it (issue #512).
 *
 * A converted amount, a price or a temperature is true at one moment according
 * to one provider. The engine now says which, on the value itself
 * (`Value.sources`), so a host can show "reference rate, 23 Sep 16:02" beside
 * the line and beside every line computed from it. These specs cover where the
 * record is set (the exchange tables, `createQueryResolver`, historical
 * lookups), how arithmetic carries it, both document passes, and the worker
 * DTO. None of them reach the network: rates are primed, and every fetch is a
 * stub.
 */
import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createCryptoPackage } from "@solve-js/packages/crypto";
import { createStocksPackage } from "@solve-js/packages/stocks";
import { createCurrencyPackage } from "@solve-js/packages/currency";
import { currencyExchangeService, FRANKFURTER_PROVIDER } from "@solve-js/uom/CurrencyExchange";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { serializeValue } from "@solve-js/worker/serialize";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";
import type { ValueSource } from "@solve-js/vm/Provenance";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

const PUBLISHED = Date.parse("2026-09-23T16:02:00Z");

afterEach(() => {
	currencyExchangeService.clearRates();
});

function primeBank(gbp = 0.741): void {
	currencyExchangeService.primeRates("USD", { GBP: gbp, EUR: 0.9 }, { provider: "Test Bank", publishedAt: PUBLISHED });
}

const bankRecord = (subject: string): ValueSource => ({ provider: "Test Bank", kind: "primed", fetchedAt: PUBLISHED, subject });

/** Let a stubbed fetch resolve and the batcher re-run what was waiting on it. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** An engine whose batcher has a listener, as a host's would, so a landed value is not reported as unheard. */
function listeningEngine(options: Parameters<typeof newTrackedEngine>[0] = {}): ExpressionEngine {
	const engine = newTrackedEngine(options);
	engine.getBatcher().onLineResult = () => undefined;
	return engine;
}

function text(v: Value | null | undefined): string {
	return v ? formatValue(v).replace(/^=\s*/, "") : "(none)";
}

describe("a conversion records the rate it used", () => {
	test("a primed rate names the host's provider, the pair and the publication time", () => {
		primeBank();
		const engine = newTrackedEngine();
		const v = engine.evaluateExpression("10 USD in GBP");
		expect(text(v)).toBe("£7.41");
		expect(v.sources).toEqual([bankRecord("USD/GBP")]);
	});

	test("a rate the engine fetched from Frankfurter names Frankfurter as a live source", async () => {
		const originalFetch = global.fetch;
		const calls: string[] = [];
		global.fetch = ((url: string) => {
			calls.push(String(url));
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve([{ date: "2026-09-23", base: "USD", quote: "GBP", rate: 0.75 }]),
			});
		}) as unknown as typeof global.fetch;
		try {
			const engine = listeningEngine();
			const before = Date.now();
			expect(engine.evaluateLine(1, "10 USD in GBP").type).toBe(ValueType.Pending);
			await settle();
			const v = engine.evaluateLine(1, "10 USD in GBP");
			expect(calls).toHaveLength(1);
			expect(text(v)).toBe("£7.50");
			expect(v.sources).toHaveLength(1);
			const [source] = v.sources!;
			expect(source.provider).toBe(FRANKFURTER_PROVIDER);
			expect(source.kind).toBe("live");
			expect(source.subject).toBe("USD/GBP");
			expect(source.fetchedAt).toBeGreaterThanOrEqual(before);
		} finally {
			global.fetch = originalFetch;
		}
	});

	test("a same-currency or non-money conversion involves no rate and records nothing", () => {
		primeBank();
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("10 USD in USD").sources).toBeUndefined();
		expect(engine.evaluateExpression("5 km in m").sources).toBeUndefined();
		expect(engine.evaluateExpression("$10 + $5").sources).toBeUndefined();
	});
});

describe("arithmetic carries the record", () => {
	test("the issue's example: three times a converted amount is rate-dependent too", () => {
		primeBank();
		const engine = newTrackedEngine();
		const v = engine.evaluateExpression("(10 USD in GBP) * 3");
		expect(text(v)).toBe("£22.23");
		expect(v.sources).toEqual([bankRecord("USD/GBP")]);
	});

	test.each([
		["-(10 USD in GBP)", "USD/GBP"],
		["+(10 USD in GBP)", "USD/GBP"],
		["round(10 USD in GBP)", "USD/GBP"],
		["(10 USD in GBP) / 2", "USD/GBP"],
		["(10 USD in GBP) - 1 GBP", "USD/GBP"],
		["(10 USD in GBP) mod 3", "USD/GBP"],
		["(10 USD in GBP) as number", "USD/GBP"],
		["max(10 USD in GBP, 1 GBP)", "USD/GBP"],
		["(10 USD / 1 GBP) ^ 2", "GBP/USD"],
	])("%s keeps the record of the %s rate", (expression, subject) => {
		primeBank();
		const engine = newTrackedEngine();
		const v = engine.evaluateExpression(expression);
		expect(v.type).not.toBe(ValueType.Error);
		expect(v.sources?.map((s) => s.subject)).toEqual([subject]);
	});

	test("an operation that crosses currencies records the rate it crossed with", () => {
		primeBank();
		const engine = newTrackedEngine();
		const sum = engine.evaluateExpression("10 USD + 5 EUR");
		expect(text(sum)).toBe("$15.56");
		expect(sum.sources).toEqual([bankRecord("EUR/USD")]);
		const ratio = engine.evaluateExpression("10 USD / 1 GBP");
		expect(ratio.type).toBe(ValueType.Number);
		expect(ratio.sources).toEqual([bankRecord("GBP/USD")]);
	});

	test("two amounts through the same rate carry one record, two rates carry both", () => {
		primeBank();
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("(10 USD in GBP) + (5 USD in GBP)").sources).toEqual([bankRecord("USD/GBP")]);
		expect(engine.evaluateExpression("(10 USD in GBP) in EUR").sources).toEqual([bankRecord("USD/GBP"), bankRecord("GBP/EUR")]);
	});

	test("a plain number reaching the fast path from a sourced value keeps its record", () => {
		primeBank();
		const engine = newTrackedEngine();
		// The ratio is a bare Number, so `* 3` would take the plain-number fast
		// path if that path did not decline a sourced operand.
		const v = engine.evaluateExpression("(10 USD / 1 GBP) * 3");
		expect(v.type).toBe(ValueType.Number);
		expect(v.sources).toEqual([bankRecord("GBP/USD")]);
	});

	test("an aggregate over converted amounts carries every rate it used", () => {
		primeBank();
		const engine = newTrackedEngine();
		const v = engine.evaluateExpression("total of 10 USD, 5 EUR");
		expect(text(v)).toBe("$15.56");
		expect(v.sources).toEqual([bankRecord("EUR/USD")]);
	});

	test("arithmetic on what the reader typed records nothing, and does not share a record by accident", () => {
		primeBank();
		const engine = newTrackedEngine();
		for (const expression of ["2 + 3", "1/3 + 1/3", "10 GBP * 3", "(12.3 +/- 0.5) * 4", "today + 1 day"]) {
			expect(engine.evaluateExpression(expression).sources).toBeUndefined();
		}
	});

	test("a variable holding a converted amount hands its record to every line that reads it", () => {
		primeBank();
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":fee = 10 USD in GBP");
		const v = engine.evaluateLine(2, "fee * 12");
		expect(text(v)).toBe("£88.92");
		expect(v.sources).toEqual([bankRecord("USD/GBP")]);
	});
});

describe("the record reaches every line of a document", () => {
	const doc = [
		"10 USD in GBP #fx",
		"line 1 * 3",
		"5 USD in GBP #fx",
		"total of #fx",
		"",
		"2 + 2",
	].join("\n");

	function sourcesByLine(engine: ExpressionEngine, pass: "parse" | "evaluate"): (string | undefined)[] {
		const result = pass === "parse" ? engine.parseDocument(doc) : evaluateDocument(engine, doc);
		return result.lines.map((l) => l.result?.sources?.map((s) => `${s.provider}:${s.subject}`).join(","));
	}

	test("parseDocument and evaluateDocument agree, line for line", () => {
		primeBank();
		const expected = ["Test Bank:USD/GBP", "Test Bank:USD/GBP", "Test Bank:USD/GBP", "Test Bank:USD/GBP", undefined, undefined];
		expect(sourcesByLine(newTrackedEngine(), "parse")).toEqual(expected);
		expect(sourcesByLine(newTrackedEngine(), "evaluate")).toEqual(expected);
	});
});

describe("a package's fetched values carry their provider", () => {
	test("createQueryResolver stamps what it fetched with the package's provider, and arithmetic keeps it", async () => {
		const crypto = createCryptoPackage({ fetchPrice: async () => ({ price: 60_000 }), provider: "Test Exchange" });
		const engine = listeningEngine({ packages: [...BUILTIN_PACKAGES, crypto] });
		const before = Date.now();
		expect(engine.evaluateLine(1, 'crypto("BTC")').type).toBe(ValueType.Pending);
		await settle();
		const price = engine.evaluateLine(1, 'crypto("BTC")');
		expect(text(price)).toBe("$60,000.00");
		expect(price.sources).toHaveLength(1);
		const [source] = price.sources!;
		expect(source).toMatchObject({ provider: "Test Exchange", kind: "live", subject: "BTC" });
		expect(source.fetchedAt).toBeGreaterThanOrEqual(before);
		const half = engine.evaluateLine(2, '0.5 * crypto("BTC")');
		expect(text(half)).toBe("$30,000.00");
		expect(half.sources).toEqual(price.sources);
	});

	test("a failed fetch is an Error, which is not a figure and carries no record", async () => {
		const crypto = createCryptoPackage({ fetchPrice: async () => { throw new Error("offline"); }, provider: "Test Exchange" });
		const engine = listeningEngine({ packages: [...BUILTIN_PACKAGES, crypto] });
		engine.evaluateLine(1, 'crypto("BTC")');
		await settle();
		const v = engine.evaluateLine(1, 'crypto("BTC")');
		expect(v.type).toBe(ValueType.Error);
		expect(v.sources).toBeUndefined();
	});

	test("a historical close is recorded as historical, for the day it describes", async () => {
		const stocks = createStocksPackage({ fetchHistoricalQuote: async () => ({ close: 150 }), provider: "Test Quotes" });
		const engine = listeningEngine({ packages: [...BUILTIN_PACKAGES, stocks] });
		engine.evaluateLine(1, "stock(AAPL) on 2024-01-15");
		await settle();
		const v = engine.evaluateLine(1, "stock(AAPL) on 2024-01-15");
		expect(text(v)).toBe("$150.00");
		expect(v.sources).toHaveLength(1);
		expect(v.sources![0]).toMatchObject({ provider: "Test Quotes", kind: "historical", subject: "AAPL", asOf: "2024-01-15" });
	});

	test("a historical conversion names the host's provider and the day of the rate", async () => {
		const currency = createCurrencyPackage({ historicalRateProvider: async () => 0.79, historicalProviderName: "Test Archive" });
		const packages = BUILTIN_PACKAGES.map((p) => (p.name === "solve-currency" ? currency : p));
		const engine = listeningEngine({ packages });
		engine.evaluateLine(1, "100 USD in GBP on 2024-01-15");
		await settle();
		const v = engine.evaluateLine(1, "100 USD in GBP on 2024-01-15");
		expect(text(v)).toBe("£79.00");
		expect(v.sources).toHaveLength(1);
		expect(v.sources![0]).toMatchObject({ provider: "Test Archive", kind: "historical", subject: "USD/GBP", asOf: "2024-01-15" });
	});
});

describe("the record crosses the worker boundary", () => {
	test("the DTO carries the sources as plain data that survives JSON", () => {
		primeBank();
		const engine = newTrackedEngine();
		const dto = serializeValue(engine.evaluateExpression("(10 USD in GBP) * 3"));
		expect(dto.sources).toEqual([bankRecord("USD/GBP")]);
		expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
		expect(serializeValue(engine.evaluateExpression("2 + 2")).sources).toBeUndefined();
	});
});

describe("explainLine says where the figures came from", () => {
	test("a conversion gains a step naming the provider, the pair and the time", () => {
		primeBank();
		const engine = newTrackedEngine();
		const explanation = engine.explainLine("10 USD in GBP");
		expect(explanation.steps.map((s) => s.description)).toContain(
			"USD/GBP from Test Bank (supplied by the host), fetched 2026-09-23 16:02 UTC",
		);
	});

	test("a line with no live figure gains no such step", () => {
		const engine = newTrackedEngine();
		expect(engine.explainLine("2 + 3 * 4").steps.some((s) => s.description.includes("fetched"))).toBe(false);
	});
});
