/**
 * The network switch: `network.enabled: false` means no request leaves the
 * engine, and every live-data form says so by name.
 *
 * Before the switch existed, a city name or a currency pair in a line reached a
 * public endpoint as soon as the line evaluated, with no host opt-out short of
 * assembling a package list without those packages. The contract pinned here:
 *
 * - With the switch off, no `fetch` is made for weather or currency, and the
 *   line answers `NETWORK_DISABLED` with the setting's name in the message.
 * - Rates a host primes by hand keep working with the switch off.
 * - A global variable still waits for the line that declares it: that resolver
 *   reads engine state, not a network, and declares itself `local`.
 * - A plugin function that returns a promise is not awaited. Its request, if it
 *   started one, cannot be recalled, which is the documented boundary.
 * - The default is on, so an engine constructed as before behaves as before.
 */

import { afterEach, describe, expect, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

const realFetch = globalThis.fetch;

/** Every URL a fetch was attempted for since the last stub. */
let requests: string[] = [];

/** A fetch that records the attempt and fails, so no test depends on a network. */
function stubFetch(): void {
	requests = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		requests.push(String(input));
		throw new Error("offline");
	}) as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = realFetch;
	currencyExchangeService.clearRates();
});

function offlineEngine(extraPackages: IEnginePackage[] = []) {
	return newTrackedEngine({
		packages: [...BUILTIN_PACKAGES, ...extraPackages],
		config: { network: { enabled: false } },
	});
}

describe("with network.enabled false", () => {
	test("a weather lookup is refused by name, and no request is made", () => {
		stubFetch();
		const value = offlineEngine().evaluateExpression("weather in London");

		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("NETWORK_DISABLED");
		expect(String(value.unit)).toContain("network.enabled");
		expect(requests).toEqual([]);
	});

	test("a currency conversion is refused by name, and works from primed rates", () => {
		stubFetch();
		const engine = offlineEngine();

		const refused = engine.evaluateExpression("100 GBP in USD");
		expect(refused.type).toBe(ValueType.Error);
		expect(refused.value).toBe("NETWORK_DISABLED");
		expect(String(refused.unit)).toContain("network.enabled");
		expect(requests).toEqual([]);

		// An offline host with its own rate table is exactly who switches the
		// network off, so a primed rate has to keep converting.
		currencyExchangeService.primeRates("GBP", { USD: 1.25 });
		const converted = engine.evaluateExpression("100 GBP in USD");
		expect(converted.type).toBe(ValueType.Uom);
		expect(converted.value).toBe(125);
		expect(converted.unit).toBe("USD");
		expect(requests).toEqual([]);
	});

	test("a global variable still waits for the line that declares it", () => {
		/*
		 * The global-variable resolver is an async resolver like the fetching
		 * ones, but it reads engine state. It declares itself `local`, so the
		 * switch leaves it running: the read is Pending, which is the resolver
		 * doing its job, not an error saying it was skipped.
		 */
		const engine = offlineEngine();
		const waiting = engine.evaluateExpression("global :networkGateProbe");
		expect(waiting.type).toBe(ValueType.Pending);

		// Declare it, so the subscription the read opened is released.
		engine.evaluateExpression("global :networkGateProbe = 1");
	});

	test("a plugin function that returns a promise is refused rather than awaited", async () => {
		let settled = false;
		const slowParselet: PrefixParselet = {
			category: "TestSlow",
			parse(_parser, _token, builder): void {
				builder.emitPluginCall("slow", 0);
			},
		};
		const SLOW_PACKAGE: IEnginePackage = {
			name: "test-slow",
			lexerVocabulary: { keywords: { slowcall: "SLOW_CALL" } },
			prefixParselets: { SLOW_CALL: slowParselet },
			pluginFunctions: {
				slow: () =>
					new Promise((_resolve, reject) => {
						setTimeout(() => {
							settled = true;
							reject(new Error("late"));
						}, 0);
					}),
			},
		};

		const value = offlineEngine([SLOW_PACKAGE]).evaluateExpression("slowcall");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("NETWORK_DISABLED");

		// The discarded promise rejects later; an unhandled rejection here would
		// fail the run, so reaching the assertion is the proof it was caught.
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(settled).toBe(true);
	});
});

describe("with the default", () => {
	test("the switch is on", () => {
		expect(newTrackedEngine().getConfig().network.enabled).toBe(true);
	});

	test("a weather lookup reaches the network, as it always has", async () => {
		stubFetch();
		const value = newTrackedEngine().evaluateExpression("weather in London");
		expect(value.type).toBe(ValueType.Pending);

		// The fetch is started by the resolver's preflight on a microtask.
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(requests.length).toBeGreaterThan(0);
	});
});
