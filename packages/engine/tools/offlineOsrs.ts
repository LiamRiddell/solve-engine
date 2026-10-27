import { afterAll, beforeAll } from "@jest/globals";

/**
 * Keeps a spec of the OSRS example package off the real Grand Exchange API.
 *
 * The package's resolver fetches `prices.runescape.wiki` for any item price,
 * and three specs reached it through lines such as `price of abyssal whip`.
 * A request left an idle keep-alive socket behind, and on Node 26 the socket
 * idle timeout surfaced as `InformationalError` seconds later, failing
 * whichever suite was running in that worker by then (Issue694, #901, #914 and
 * main's own run), though that suite never made a request.
 *
 * Install this in a spec's top level: the endpoint is answered with a small,
 * well-formed price table for the length of the file, and every other URL
 * still reaches the real `fetch`. Set `SOLVE_LIVE_NETWORK=1` to leave the real
 * API in place, as the live weather cases do.
 *
 * What the specs assert is that a price goes pending and then resolves or
 * falls back, never a particular price, so a fixed table is faithful.
 */

/** The endpoint the example package reads. */
const OSRS_URL = "https://prices.runescape.wiki/api/v1/osrs/latest";

/** A few item ids with a high and a low price, the shape the API answers in. */
const PRICES = { data: { "4151": { high: 2_500_000, low: 2_400_000 }, "2": { high: 160, low: 150 } } };

/** The requests answered here, so a spec can prove the real API was not reached. */
export const answeredOffline: string[] = [];

/**
 * Answers the OSRS price endpoint from a fixed table for the current spec file.
 *
 * @returns Nothing; registers `beforeAll` and `afterAll` hooks.
 */
export function keepOsrsOffline(): void {
	if (process.env.SOLVE_LIVE_NETWORK === "1") return;
	let realFetch: typeof fetch | undefined;
	beforeAll(() => {
		realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url !== OSRS_URL) return realFetch!(input, init);
			answeredOffline.push(url);
			return new Response(JSON.stringify(PRICES), { status: 200, headers: { "content-type": "application/json" } });
		}) as typeof fetch;
	});
	afterAll(() => {
		if (realFetch) globalThis.fetch = realFetch;
	});
}
