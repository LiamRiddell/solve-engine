import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { CurrencyExchangeService, currencyExchangeService, COINGECKO_PROVIDER, FRANKFURTER_PROVIDER } from "@solve-js/uom/CurrencyExchange";

/**
 * Issue #649: both fetch paths stored their result under the source currency
 * and replaced whatever table was there. `$100 in EUR` fetched Frankfurter's
 * USD table and `$100 in BTC` CoinGecko's USD to BTC pair, and whichever landed
 * second replaced the other, so one line of the two went on reporting
 * CURRENCY_RATE_UNAVAILABLE. A host's primed table was lost the same way. Each
 * source keeps its own table now, and a pair is served by the rule the single
 * table per base gave: the base stored first, and within a base the table
 * stored most recently.
 *
 * Every fetch here is a stub: Frankfurter answers USD to EUR at 0.9 (or the
 * rate a test sets) and CoinGecko prices bitcoin at $50,000 and ether at
 * $2,500.
 */

let original: typeof global.fetch;
let euroRate = 0.9;
let failCoinGecko = false;
const calls: string[] = [];

beforeEach(() => {
	original = global.fetch;
	euroRate = 0.9;
	failCoinGecko = false;
	calls.length = 0;
	global.fetch = ((url: string) => {
		const text = String(url);
		calls.push(text);
		if (text.includes("frankfurter")) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve([{ date: "2026-09-25", base: "USD", quote: "EUR", rate: euroRate }, { date: "2026-09-25", base: "USD", quote: "GBP", rate: 0.75 }]) });
		}
		if (failCoinGecko) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ bitcoin: { usd: 50_000 }, ethereum: { usd: 2_500 } }) });
	}) as unknown as typeof global.fetch;
});

afterEach(() => {
	global.fetch = original;
	currencyExchangeService.clearRates();
	jest.restoreAllMocks();
});

describe("a fiat table and a crypto pair for one base both stay", () => {
	test("fiat first, then crypto", async () => {
		const fx = new CurrencyExchangeService();
		await fx.getRate("USD", "EUR");
		await fx.getRate("USD", "BTC");
		expect(fx.getRateSync("USD", "EUR")).toBe(0.9);
		expect(fx.getRateSync("USD", "BTC")).toBe(0.00002);
	});

	test("crypto first, then fiat", async () => {
		const fx = new CurrencyExchangeService();
		await fx.getRate("USD", "BTC");
		await fx.getRate("USD", "EUR");
		expect(fx.getRateSync("USD", "BTC")).toBe(0.00002);
		expect(fx.getRateSync("USD", "EUR")).toBe(0.9);
	});

	test("two crypto pairs from one base, and a crypto-to-crypto pair beside a fiat one", async () => {
		const fx = new CurrencyExchangeService();
		await fx.getRate("USD", "BTC");
		await fx.getRate("USD", "ETH");
		await fx.getRate("BTC", "ETH");
		await fx.getRate("USD", "EUR");
		expect(fx.getRateSync("USD", "BTC")).toBe(0.00002);
		expect(fx.getRateSync("USD", "ETH")).toBe(0.0004);
		expect(fx.getRateSync("BTC", "ETH")).toBe(20);
		expect(fx.getRateSync("USD", "EUR")).toBe(0.9);
	});

	test("each conversion's provenance names its own provider", async () => {
		const fx = new CurrencyExchangeService();
		await fx.getRate("USD", "EUR");
		await fx.getRate("USD", "BTC");
		expect(fx.rateSourcesSync("USD", "EUR")?.[0].provider).toBe(FRANKFURTER_PROVIDER);
		expect(fx.rateSourcesSync("USD", "BTC")?.[0].provider).toBe(COINGECKO_PROVIDER);
	});
});

describe("a host's primed table", () => {
	test("is kept beside a live crypto fetch for the same base", async () => {
		const fx = new CurrencyExchangeService();
		fx.primeRates("USD", { EUR: 0.85 }, { provider: "Test Bank" });
		await fx.getRate("USD", "BTC");
		expect(fx.getRateSync("USD", "EUR")).toBe(0.85);
		expect(fx.rateSourcesSync("USD", "EUR")?.[0].provider).toBe("Test Bank");
		expect(fx.getRateSync("USD", "BTC")).toBe(0.00002);
	});

	test("primed after a live table for its base serves the pairs both hold, as replacing it did", async () => {
		const fx = new CurrencyExchangeService();
		await fx.getRate("USD", "EUR");
		fx.primeRates("USD", { EUR: 0.85 });
		expect(fx.getRateSync("USD", "EUR")).toBe(0.85);
		// The live table is still there for the pair only it holds.
		expect(fx.getRateSync("USD", "GBP")).toBe(0.75);
	});

	test("priming the same provider and base again replaces its own table", () => {
		const fx = new CurrencyExchangeService();
		fx.primeRates("USD", { EUR: 0.85, JPY: 150 }, { provider: "Test Bank" });
		fx.primeRates("USD", { EUR: 0.8 }, { provider: "Test Bank" });
		expect(fx.getRateSync("USD", "EUR")).toBe(0.8);
		expect(fx.getRateSync("USD", "JPY")).toBeNull();
	});
});

describe("the precedence the single table per base gave is kept", () => {
	test("a pair two bases both cover is served by the base stored first", async () => {
		const fx = new CurrencyExchangeService();
		fx.primeRates("USD", { EUR: 0.8, GBP: 0.5 });
		fx.primeRates("GBP", { EUR: 2 });
		// Through USD: 0.8 / 0.5 = 1.6, not the GBP table's 2.
		expect(fx.getRateSync("GBP", "EUR")).toBeCloseTo(1.6, 12);
	});
});

describe("freshness and failures", () => {
	test("a table that goes stale is not served while the other source's pair stays fresh", async () => {
		const fx = new CurrencyExchangeService();
		const start = Date.now();
		const now = jest.spyOn(Date, "now").mockReturnValue(start);
		await fx.getRate("USD", "EUR");
		now.mockReturnValue(start + 10 * 60 * 1000);
		await fx.getRate("USD", "BTC");
		now.mockReturnValue(start + 20 * 60 * 1000);
		expect(fx.getRateSync("USD", "EUR")).toBeNull();
		expect(fx.getRateSync("USD", "BTC")).toBe(0.00002);
	});

	test("a failed fetch from one provider leaves the other's rates alone", async () => {
		const fx = new CurrencyExchangeService();
		await fx.getRate("USD", "EUR");
		failCoinGecko = true;
		await expect(fx.getRate("USD", "BTC")).rejects.toThrow();
		expect(fx.getRateSync("USD", "EUR")).toBe(0.9);
		expect(fx.getRateSync("USD", "BTC")).toBeNull();
	});

	test("clearRates drops every source's tables", async () => {
		const fx = new CurrencyExchangeService();
		await fx.getRate("USD", "EUR");
		fx.primeRates("USD", { JPY: 150 });
		fx.clearRates();
		expect(fx.getRateSync("USD", "EUR")).toBeNull();
		expect(fx.getRateSync("USD", "JPY")).toBeNull();
		expect(fx.getAllRates()).toBeNull();
	});

	test("getAllRates lists every fresh pair, the newest store winning within a base", async () => {
		const fx = new CurrencyExchangeService();
		await fx.getRate("USD", "EUR");
		await fx.getRate("USD", "BTC");
		fx.primeRates("USD", { EUR: 0.85 });
		const all = fx.getAllRates()!;
		expect(all["USD:EUR"]).toBe(0.85);
		expect(all["USD:GBP"]).toBe(0.75);
		expect(all["USD:BTC"]).toBe(0.00002);
	});

	test("a provider named like an inherited property is only a name", () => {
		expectPrototypeUntouched(() => {
			const fx = new CurrencyExchangeService();
			fx.primeRates("USD", { EUR: 0.85 }, { provider: "__proto__" });
			fx.primeRates("USD", { GBP: 0.7 }, { provider: "constructor" });
			expect(fx.getRateSync("USD", "EUR")).toBe(0.85);
			expect(fx.getRateSync("USD", "GBP")).toBe(0.7);
		});
	});
});

/** Let a stubbed fetch resolve and the batcher re-run what was waiting on it. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function texts(lines: readonly { result: unknown }[]): string[] {
	return lines.map((line) => (line.result ? formatValue(line.result as never) : "(none)"));
}

describe("one note converting to a fiat currency and to a crypto one", () => {
	test.each([
		["$100 in EUR\n$100 in BTC", ["= €90.00", "= 0.002 BTC"]],
		["$100 in BTC\n$100 in EUR", ["= 0.002 BTC", "= €90.00"]],
	])("%s: both lines resolve, and both passes agree", async (note, expected) => {
		const engine = newTrackedEngine();
		engine.getBatcher().onLineResult = () => undefined;
		engine.parseDocument(note);
		await settle();
		expect(texts(engine.parseDocument(note).lines)).toEqual(expected);
		await settle();
		expect(texts(engine.parseDocument(note).lines)).toEqual(expected);
		expect(texts(evaluateDocument(engine as unknown as ExpressionEngine, note).lines)).toEqual(expected);
	});

	test("with a host's primed table, the crypto fetch no longer costs the host its rate", async () => {
		currencyExchangeService.primeRates("USD", { EUR: 0.9 }, { provider: "host" });
		euroRate = 0.8;
		const engine = newTrackedEngine();
		engine.getBatcher().onLineResult = () => undefined;
		const note = "$100 in EUR\n$100 in BTC";
		engine.parseDocument(note);
		await settle();
		engine.parseDocument(note);
		await settle();
		expect(texts(engine.parseDocument(note).lines)).toEqual(["= €90.00", "= 0.002 BTC"]);
		expect(calls.some((url) => url.includes("frankfurter"))).toBe(false);
	});
});
