import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createCurrencyPackage } from "@solve-js/packages/currency";
import { ValueType, type Value } from "@solve-js/vm/Value";
import {
	HistoricalCurrencyErrorCodes,
	normaliseHistoricalRate,
	type HistoricalRateProvider,
} from "@solve-js/uom/HistoricalCurrency";
import {
	ECB_REFERENCE_RATES_BEGIN,
	FRANKFURTER_RATES_URL,
	createFrankfurterHistoricalRateProvider,
	readFrankfurterHistoricalRate,
	refuseFrankfurterHistorical,
} from "@solve-js/uom/FrankfurterHistoricalRates";

/**
 * Issue #699: `100 USD in GBP on 2024-01-15` reported
 * HISTORICAL_RATES_NOT_CONFIGURED on a default engine, on the claim that no
 * free, keyless historical exchange-rate service exists. Frankfurter, the
 * endpoint the live rate already calls, answers a dated request with no key.
 * The default currency package now asks it, a host's own provider still takes
 * precedence, `null` switches the dated form off, `network.enabled: false`
 * still answers NETWORK_DISABLED, and a day before 4 January 1999 (the ECB
 * reference rates' first day), a day after today, and a currency the ECB does
 * not quote are refused by name before any request.
 *
 * Every request here goes to a stubbed fetch, never the live endpoint. The
 * rate 0.78441 is the one api.frankfurter.dev/v2 returned for USD to GBP on
 * 2024-01-15, as recorded in the issue; the live check of that figure is
 * `packages/currency/FrankfurterHistoricalLive.spec.ts`, which runs only with
 * SOLVE_LIVE_NETWORK=1.
 */

/** USD to GBP on 2024-01-15, from api.frankfurter.dev/v2 as recorded in issue #699. */
const USD_GBP_2024_01_15 = 0.78441;

/** A fixed "now" for the refusals: 2026-09-30T12:00:00Z. */
const NOW = Date.UTC(2026, 8, 30, 12);

afterEach(() => {
	jest.restoreAllMocks();
});

type Answer = { status?: number; body: unknown } | "reject" | "not-json";

/**
 * Replace the global fetch with one that answers like Frankfurter's v2 rates
 * endpoint: the pair and day asked for, at `rate`, unless `answer` says
 * otherwise. Records every URL requested.
 */
function stubFrankfurter(answer?: (url: URL) => Answer) {
	const urls: string[] = [];
	const spy = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = new URL(String(input));
		urls.push(url.toString());
		const a: Answer = answer?.(url) ?? {
			body: [{ date: url.searchParams.get("date"), base: url.searchParams.get("base"), quote: url.searchParams.get("quotes"), rate: USD_GBP_2024_01_15 }],
		};
		if (a === "reject") throw new TypeError("fetch failed");
		if (a === "not-json") return new Response("<html>busy</html>", { status: 200 });
		return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
	});
	return { urls, spy };
}

const settle = async (): Promise<void> => {
	for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** An engine whose batcher has a listener, as a host's would. */
function listening(options: Parameters<typeof newTrackedEngine>[0] = {}): ExpressionEngine {
	const engine = newTrackedEngine(options);
	engine.getBatcher().onLineResult = () => undefined;
	return engine;
}

/** The built-in packages with the currency package built from `config`. */
function withCurrency(config: Parameters<typeof createCurrencyPackage>[0]) {
	const currency = createCurrencyPackage(config);
	return BUILTIN_PACKAGES.map((p) => (p.name === "solve-currency" ? currency : p));
}

/** Evaluate a line, let its fetch land, and evaluate it again. */
async function settled(line: string, engine: ExpressionEngine = listening()): Promise<Value> {
	engine.evaluateLine(1, line);
	await settle();
	return engine.evaluateLine(1, line);
}

function shown(v: Value): string {
	return formatValue(v).replace(/^=\s*/, "");
}

describe("a default engine converts at the day's rate from Frankfurter", () => {
	test("the issue's line is £78.44, asked of the v2 endpoint with the pair and the day", async () => {
		const { urls } = stubFrankfurter();
		const v = await settled("100 USD in GBP on 2024-01-15");
		expect(shown(v)).toBe("£78.44");
		expect(urls).toEqual([`${FRANKFURTER_RATES_URL}?base=USD&quotes=GBP&date=2024-01-15`]);
	});

	test("the symbol form and the written date reach the same rate", async () => {
		stubFrankfurter();
		expect(shown(await settled("$100 in GBP on 15 Jan 2024"))).toBe("£78.44");
	});

	test("the rate's provenance names Frankfurter, as the live rate's does, and the day", async () => {
		stubFrankfurter();
		const v = await settled("100 USD in GBP on 2024-01-15");
		expect(v.sources).toHaveLength(1);
		expect(v.sources![0]).toMatchObject({ provider: "Frankfurter", kind: "historical", subject: "USD/GBP", asOf: "2024-01-15" });
	});

	test("a source currency known only at run time fetches once and converts", async () => {
		const { urls } = stubFrankfurter();
		const engine = listening();
		engine.evaluateLine(1, "x = 100 USD");
		expect(engine.evaluateLine(2, "x in GBP on 2024-01-15").type).toBe(ValueType.Pending);
		await settle();
		expect(shown(engine.evaluateLine(2, "x in GBP on 2024-01-15"))).toBe("£78.44");
		expect(urls).toHaveLength(1);
	});

	test("a weekend day is answered with the last rate before it, and the provenance says which day", async () => {
		// 2024-01-13 is a Saturday; the endpoint answers with Friday's rate.
		stubFrankfurter((url) => ({ body: [{ date: "2024-01-12", base: "USD", quote: url.searchParams.get("quotes"), rate: 0.78 }] }));
		const v = await settled("100 USD in GBP on 2024-01-13");
		expect(shown(v)).toBe("£78.00");
		expect(v.sources![0]).toMatchObject({ provider: "Frankfurter", asOf: "2024-01-12" });
	});

	test("a currency converted to itself needs no request", async () => {
		const { urls } = stubFrankfurter();
		expect(shown(await settled("100 GBP in GBP on 2024-01-15"))).toBe("£100.00");
		expect(urls).toEqual([]);
	});
});

describe("the host's choice comes first", () => {
	test("a host's provider takes precedence, and Frankfurter is never asked", async () => {
		const { spy } = stubFrankfurter();
		const provider = jest.fn(async () => 0.79);
		const v = await settled("100 USD in GBP on 2024-01-15", listening({ packages: withCurrency({ historicalRateProvider: provider }) }));
		expect(shown(v)).toBe("£79.00");
		expect(v.sources![0]).toMatchObject({ provider: "host" });
		expect(provider).toHaveBeenCalledTimes(1);
		expect(spy).not.toHaveBeenCalled();
	});

	test("null switches the dated form off: HISTORICAL_RATES_NOT_CONFIGURED, no request", async () => {
		const { spy } = stubFrankfurter();
		const v = await settled("100 USD in GBP on 2024-01-15", listening({ packages: withCurrency({ historicalRateProvider: null }) }));
		expect(v.errorCode).toBe(HistoricalCurrencyErrorCodes.NOT_CONFIGURED);
		expect(spy).not.toHaveBeenCalled();
	});

	test("a host provider that throws is a failed query, not a crash", async () => {
		stubFrankfurter();
		const provider: HistoricalRateProvider = async () => {
			throw new RangeError("archive offline");
		};
		const v = await settled("100 USD in GBP on 2024-01-15", listening({ packages: withCurrency({ historicalRateProvider: provider }) }));
		expect(v.errorCode).toBe(HistoricalCurrencyErrorCodes.QUERY_FAILED);
		expect(v.errorMessage).toMatch(/USD to GBP on 2024-01-15: archive offline/);
	});

	test.each([NaN, 0, -0.8, Infinity, "0.79", null])("a host provider answering %p is refused rather than converted through", async (answer) => {
		stubFrankfurter();
		const provider = (async () => answer) as unknown as HistoricalRateProvider;
		const v = await settled("100 USD in GBP on 2024-01-15", listening({ packages: withCurrency({ historicalRateProvider: provider }) }));
		expect(v.errorCode).toBe(HistoricalCurrencyErrorCodes.QUERY_FAILED);
		expect(v.errorMessage).toMatch(/not a positive number/);
	});
});

describe("live data switched off", () => {
	const off = () => listening({ config: { network: { enabled: false } } });

	test("a literal source answers NETWORK_DISABLED and makes no request", async () => {
		const { spy } = stubFrankfurter();
		const v = await settled("100 USD in GBP on 2024-01-15", off());
		expect(v.errorCode).toBe("NETWORK_DISABLED");
		expect(spy).not.toHaveBeenCalled();
	});

	test("a run-time source answers NETWORK_DISABLED without starting the request", async () => {
		const { spy } = stubFrankfurter();
		const engine = off();
		engine.evaluateLine(1, "x = 100 USD");
		const v = engine.evaluateLine(2, "x in GBP on 2024-01-15");
		await settle();
		expect(v.errorCode).toBe("NETWORK_DISABLED");
		expect(spy).not.toHaveBeenCalled();
	});
});

describe("refusals by name, before any request", () => {
	test.each([
		["100 USD in GBP on 1998-06-01", HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE, /begin on 4 January 1999/],
		["100 USD in GBP on 1999-01-03", HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE, /begin on 4 January 1999/],
		["100 USD in GBP on 2090-01-01", HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE, /after today/],
		["1 BTC in USD on 2024-01-15", HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY, /BTC has no rate there/],
		["$100 in ETH on 2024-01-15", HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY, /ETH has no rate there/],
	])("%s", async (line, code, message) => {
		const { spy } = stubFrankfurter();
		const v = await settled(line);
		expect(v.errorCode).toBe(code);
		expect(v.errorMessage).toMatch(message);
		expect(spy).not.toHaveBeenCalled();
	});

	test("the first day of the ECB reference rates is answered", async () => {
		const { urls } = stubFrankfurter();
		expect(shown(await settled(`100 USD in GBP on ${ECB_REFERENCE_RATES_BEGIN}`))).toBe("£78.44");
		expect(urls).toHaveLength(1);
	});
});

describe("what the endpoint can answer with", () => {
	test.each<[string, (url: URL) => Answer, string, RegExp]>([
		["a 404 with a message body", () => ({ status: 404, body: { message: "not found" } }), HistoricalCurrencyErrorCodes.QUERY_FAILED, /Frankfurter returned 404/],
		["a 500", () => ({ status: 500, body: {} }), HistoricalCurrencyErrorCodes.QUERY_FAILED, /Frankfurter returned 500/],
		["a list without the quote", () => ({ body: [{ date: "2024-01-15", base: "USD", quote: "EUR", rate: 0.91 }] }), HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY, /published no USD to GBP rate/],
		["an empty list", () => ({ body: [] }), HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY, /published no USD to GBP rate/],
		["a rate that is a string", () => ({ body: [{ date: "2024-01-15", quote: "GBP", rate: "0.78441" }] }), HistoricalCurrencyErrorCodes.QUERY_FAILED, /not a positive number/],
		["a rate that is null", () => ({ body: [{ date: "2024-01-15", quote: "GBP", rate: null }] }), HistoricalCurrencyErrorCodes.QUERY_FAILED, /not a positive number/],
		["a 200 with a message and no rates", () => ({ body: { message: "not found" } }), HistoricalCurrencyErrorCodes.QUERY_FAILED, /holds no rates/],
		["a body that is not JSON", () => "not-json", HistoricalCurrencyErrorCodes.QUERY_FAILED, /not JSON/],
		["a failed request", () => "reject", HistoricalCurrencyErrorCodes.QUERY_FAILED, /fetch failed/],
	])("%s", async (_label, answer, code, message) => {
		stubFrankfurter(answer);
		const v = await settled("100 USD in GBP on 2024-01-15");
		expect(v.errorCode).toBe(code);
		expect(v.errorMessage).toMatch(message);
	});

	test("a request stopped by its timeout is a failed query that says so", async () => {
		// The resolver's timeout aborts the fetch through the signal it passes;
		// a fetch aborted that way rejects with this DOMException.
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("Historical currency rate fetch timed out after 10000ms", "TimeoutError"));
		const v = await settled("100 USD in GBP on 2024-01-15");
		expect(v.errorCode).toBe(HistoricalCurrencyErrorCodes.QUERY_FAILED);
		expect(v.errorMessage).toMatch(/timed out/);
	});

	test("an aborted signal reaches the fetch, which stops", async () => {
		const controller = new AbortController();
		const fetchStub = ((_input: string | URL | Request, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
			})) as typeof fetch;
		const provider = createFrankfurterHistoricalRateProvider({ fetch: fetchStub, now: () => NOW });
		const attempt = provider("USD", "GBP", "2024-01-15", controller.signal);
		controller.abort();
		await expect(attempt).rejects.toMatchObject({ name: "AbortError" });
	});
});

describe("refuseFrankfurterHistorical", () => {
	const refusal = (from: string, to: string, day: string, now = NOW): string | null => {
		try {
			refuseFrankfurterHistorical(from, to, day, now);
			return null;
		} catch (e) {
			return e instanceof EngineError ? e.code : `raw ${String(e)}`;
		}
	};

	test("an ordinary pair on an ordinary day goes ahead", () => {
		expect(refusal("USD", "GBP", "2024-01-15")).toBeNull();
		expect(refusal("eur", "jpy", "2010-06-30")).toBeNull();
	});

	test("the boundaries: the first ECB day, the day before it, today and tomorrow (UTC)", () => {
		expect(refusal("USD", "GBP", "1999-01-04")).toBeNull();
		expect(refusal("USD", "GBP", "1999-01-03")).toBe(HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE);
		expect(refusal("USD", "GBP", "2026-09-30")).toBeNull();
		expect(refusal("USD", "GBP", "2026-10-01")).toBe(HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE);
		// Just before midnight UTC, the next day is still in the future.
		expect(refusal("USD", "GBP", "2026-10-01", Date.UTC(2026, 8, 30, 23, 59, 59))).toBe(HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE);
		expect(refusal("USD", "GBP", "2024-02-29")).toBeNull();
	});

	test("a code that is not an ISO 4217 currency is refused by name", () => {
		for (const code of ["BTC", "XAU", "XXX", "US", "USDD", "", "U​D", "ＵＳＤ"]) {
			expect(refusal(code, "GBP", "2024-01-15")).toBe(HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY);
		}
	});

	test("hostile codes and days are refused without a raw error", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(refusal(word, "GBP", "2024-01-15")).toBe(HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY);
				expect(refusal("USD", "GBP", word)).toBe(HistoricalCurrencyErrorCodes.QUERY_FAILED);
			}
		});
		for (const day of ["", "2024-1-15", "２０２４-01-15", "2024-01-15T00:00", "<script>", "x".repeat(100_000)]) {
			expect(refusal("USD", "GBP", day)).toBe(HistoricalCurrencyErrorCodes.QUERY_FAILED);
		}
	});

	test("a hostile code is clipped in the message rather than echoed whole", () => {
		try {
			refuseFrankfurterHistorical("A".repeat(10_000), "GBP", "2024-01-15", NOW);
		} catch (e) {
			expect((e as EngineError).message.length).toBeLessThan(400);
		}
	});
});

describe("readFrankfurterHistoricalRate", () => {
	test("reads the v2 list, matching the quote in any case, and its published day", () => {
		expect(readFrankfurterHistoricalRate([{ date: "2024-01-15", base: "USD", quote: "gbp", rate: 0.78441 }], "USD", "GBP", "2024-01-15")).toEqual({ rate: 0.78441, asOf: "2024-01-15" });
		expect(readFrankfurterHistoricalRate([null, 3, { quote: "EUR", rate: 1 }, { quote: "GBP", rate: 0.5 }], "USD", "GBP", "2024-01-15")).toEqual({ rate: 0.5, asOf: "2024-01-15" });
	});

	test("reads the v1 object shape too, as the live path does", () => {
		expect(readFrankfurterHistoricalRate({ date: "2024-01-12", rates: { GBP: 0.78643 } }, "USD", "GBP", "2024-01-13")).toEqual({ rate: 0.78643, asOf: "2024-01-12" });
	});

	test("a malformed published day falls back to the day asked about", () => {
		expect(readFrankfurterHistoricalRate([{ date: "<b>1</b>", quote: "GBP", rate: 1.5 }], "USD", "GBP", "2024-01-15").asOf).toBe("2024-01-15");
	});

	test("the smallest and largest positive doubles are rates; zero, negatives and non-finite are not", () => {
		expect(readFrankfurterHistoricalRate([{ quote: "GBP", rate: Number.MIN_VALUE }], "USD", "GBP", "2024-01-15").rate).toBe(Number.MIN_VALUE);
		expect(readFrankfurterHistoricalRate([{ quote: "GBP", rate: Number.MAX_VALUE }], "USD", "GBP", "2024-01-15").rate).toBe(Number.MAX_VALUE);
		for (const rate of [0, -0, -1, NaN, Infinity, "1", true, {}]) {
			expect(() => readFrankfurterHistoricalRate([{ quote: "GBP", rate }], "USD", "GBP", "2024-01-15")).toThrow(/not a positive number/);
		}
	});

	test("a quote spelt like an inherited name never reaches Object.prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const body = JSON.parse(`{"rates":{}}`);
				let code: string | undefined;
				try {
					readFrankfurterHistoricalRate(body, "USD", word, "2024-01-15");
				} catch (e) {
					code = (e as EngineError).code;
				}
				expect(code).toBe(HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY);
			}
			// A body carrying a __proto__ key is data, not a prototype.
			const hostile = JSON.parse(`{"rates":{"__proto__":{"GBP":2}}}`);
			expect(() => readFrankfurterHistoricalRate(hostile, "USD", "GBP", "2024-01-15")).toThrow(EngineError);
		});
	});

	test("a body that holds no rates is a query failure", () => {
		for (const body of [null, "rates", 42, { message: "not found" }, { rates: null }]) {
			let code: string | undefined;
			try {
				readFrankfurterHistoricalRate(body, "USD", "GBP", "2024-01-15");
			} catch (e) {
				code = (e as EngineError).code;
			}
			expect(code).toBe(HistoricalCurrencyErrorCodes.QUERY_FAILED);
		}
	});
});

describe("createFrankfurterHistoricalRateProvider", () => {
	test("sends one GET with base, quotes and date, passing the caller's signal through", async () => {
		const seen: { url: string; signal?: AbortSignal | null }[] = [];
		const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
			seen.push({ url: String(input), signal: init?.signal });
			return new Response(JSON.stringify([{ date: "2024-01-15", base: "USD", quote: "GBP", rate: USD_GBP_2024_01_15 }]));
		}) as typeof fetch;
		const signal = new AbortController().signal;
		const provider = createFrankfurterHistoricalRateProvider({ fetch: fetchStub, now: () => NOW });
		await expect(provider("usd", "gbp", "2024-01-15", signal)).resolves.toEqual({ rate: USD_GBP_2024_01_15, asOf: "2024-01-15" });
		expect(seen).toEqual([{ url: `${FRANKFURTER_RATES_URL}?base=USD&quotes=GBP&date=2024-01-15`, signal }]);
	});

	test("a refusal never calls the fetch", async () => {
		const fetchStub = jest.fn(async () => new Response("[]")) as unknown as typeof fetch;
		const provider = createFrankfurterHistoricalRateProvider({ fetch: fetchStub, now: () => NOW });
		await expect(provider("USD", "GBP", "1990-01-01", new AbortController().signal)).rejects.toMatchObject({ code: HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE });
		await expect(provider("BTC", "GBP", "2024-01-15", new AbortController().signal)).rejects.toMatchObject({ code: HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY });
		expect(fetchStub).not.toHaveBeenCalled();
	});

	test("a query-shaped code cannot add a parameter to the request", async () => {
		const fetchStub = jest.fn(async () => new Response("[]")) as unknown as typeof fetch;
		const provider = createFrankfurterHistoricalRateProvider({ fetch: fetchStub, now: () => NOW });
		await expect(provider("USD&x=1", "GBP", "2024-01-15", new AbortController().signal)).rejects.toMatchObject({ code: HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY });
		await expect(provider("USD", "GBP", "2024-01-15&base=EUR", new AbortController().signal)).rejects.toMatchObject({ code: HistoricalCurrencyErrorCodes.QUERY_FAILED });
		expect(fetchStub).not.toHaveBeenCalled();
	});
});

describe("normaliseHistoricalRate", () => {
	test("a positive number, or a rate with its day", () => {
		expect(normaliseHistoricalRate(0.786, "2024-01-15")).toEqual({ rate: 0.786, asOf: "2024-01-15" });
		expect(normaliseHistoricalRate({ rate: 0.78, asOf: "2024-01-12" }, "2024-01-13")).toEqual({ rate: 0.78, asOf: "2024-01-12" });
		expect(normaliseHistoricalRate({ rate: 0.78 }, "2024-01-13")).toEqual({ rate: 0.78, asOf: "2024-01-13" });
		expect(normaliseHistoricalRate({ rate: 0.78, asOf: "last Friday" }, "2024-01-13")).toEqual({ rate: 0.78, asOf: "2024-01-13" });
	});

	test("anything that is not a finite, positive rate is null", () => {
		for (const answer of [0, -0, -1, NaN, Infinity, -Infinity, "0.78", null, undefined, {}, { rate: "1" }, { rate: NaN }, [], true]) {
			expect(normaliseHistoricalRate(answer, "2024-01-15")).toBeNull();
		}
	});

	test("an inherited name on the answer is not read as a rate", () => {
		expectPrototypeUntouched(() => {
			expect(normaliseHistoricalRate(Object.create({ rate: 1 }), "2024-01-15")).toEqual({ rate: 1, asOf: "2024-01-15" });
			expect(normaliseHistoricalRate(JSON.parse(`{"__proto__":{"rate":1}}`), "2024-01-15")).toBeNull();
		});
	});
});

describe("adversarial lines, through the stubbed endpoint", () => {
	test.each([
		...PROTOTYPE_WORDS.map((w) => `100 USD in ${w} on 2024-01-15`),
		...PROTOTYPE_WORDS.map((w) => `${w} in GBP on 2024-01-15`),
		"100 USD in GBP on ２０２４-01-15",
		"100 USD in GBP on 2024-01-15‮",
		"100 USD in G​BP on 2024-01-15",
		"<img src=x onerror=alert(1)> in GBP on 2024-01-15",
		"100 USD in GBP on 2023-02-29",
		"100 kg in GBP on 2024-01-15",
		"100 USD in GBP on",
		"100 USD in GBP on on 2024-01-15",
	])("%s is answered honestly", (line) => {
		stubFrankfurter();
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test.each([
		["0 USD in GBP on 2024-01-15", "£0.00"],
		["-5 USD in GBP on 2024-01-15", "-£3.92"],
		["100 USD in GBP on 2024-02-29", "£78.44"],
		["(100 USD in GBP on 2024-01-15) + £1", "£79.44"],
		["100 USD in GBP on 2024-01-15 frozen", "£78.44"],
	])("%s is %s", async (line, expected) => {
		stubFrankfurter();
		expect(shown(await settled(line))).toBe(expected);
	});

	test("a thousand lines of one dated conversion make one request", async () => {
		const { urls } = stubFrankfurter();
		const doc = Array.from({ length: 1000 }, () => "100 USD in GBP on 2024-01-15").join("\n");
		const engine = listening();
		const started = performance.now();
		engine.parseDocument(doc);
		await settle();
		const lines = engine.parseDocument(doc).lines;
		expect(performance.now() - started).toBeLessThan(15_000);
		expect(urls).toHaveLength(1);
		expect(lines.every((l) => l.result !== null && shown(l.result) === "£78.44")).toBe(true);
	});

	test("the two document passes agree once the rate has landed, with CRLF and a trailing newline", async () => {
		stubFrankfurter();
		const doc = "x = 100 USD\r\nx in GBP on 2024-01-15\r\nprev * 2\n";
		const batchEngine = listening();
		batchEngine.parseDocument(doc);
		await settle();
		const batch = batchEngine.parseDocument(doc).lines.map((l) => (l.result ? shown(l.result) : ""));
		const incEngine = listening();
		evaluateDocument(incEngine, doc);
		await settle();
		const incremental = evaluateDocument(incEngine, doc).lines.map((l) => (l.result ? shown(l.result) : ""));
		expect(batch.slice(0, 3)).toEqual(["$100.00", "£78.44", "£156.88"]);
		expect(incremental.slice(0, 3)).toEqual(batch.slice(0, 3));
	});

	test("an edit to the date asks for the new day and keeps the old one cached", async () => {
		const { urls } = stubFrankfurter();
		const engine = listening();
		await settled("100 USD in GBP on 2024-01-15", engine);
		engine.evaluateLine(1, "100 USD in GBP on 2024-01-16");
		await settle();
		await settled("100 USD in GBP on 2024-01-15", engine);
		expect(urls.map((u) => new URL(u).searchParams.get("date"))).toEqual(["2024-01-15", "2024-01-16"]);
	});

	test("an ErrorCode from the provider never reads as an internal name", async () => {
		stubFrankfurter(() => ({ status: 404, body: { message: "not found" } }));
		const v = await settled("100 USD in GBP on 2024-01-15");
		expect(v.type).toBe(ValueType.Error);
		expect(shown(v)).not.toMatch(/\[object|undefined|TypeError/);
	});
});
