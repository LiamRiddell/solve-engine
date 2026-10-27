/**
 * Jest Setup — Node.js test environment polyfills.
 *
 * Worker source files (`.worker.ts`) use `self.onmessage` at module level,
 * which crashes in Node.js where `self` is not defined. While the
 * moduleNameMapper in jest.config.js redirects worker imports to a mock,
 * some environments (watch mode, esbuild-based runners) can bypass the
 * mapper. This setup file ensures `self` is always available as a
 * reference to the global object, matching the behaviour of jsdom and
 * web workers.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).self = globalThis;

/**
 * Unit tests do not use the real network.
 *
 * Twenty-two spec files reach a live service through a resolver (Frankfurter
 * for exchange rates, CoinGecko, Open-Meteo, the Grand Exchange prices)
 * without meaning to: a line such as `100 USD in EUR` starts a fetch, and the
 * spec asserts only that it goes pending or falls back. Each request left a
 * keep-alive socket behind, and on Node 26 the socket's idle timeout surfaced
 * seconds later as an `InformationalError`, failing whichever unrelated suite
 * was running in that worker by then. `Issue694` took the blame on main, on
 * three pull requests, and on a retry.
 *
 * So a request to anything but this machine is refused here, the way a network
 * that is down refuses it: `fetch` rejects with a `TypeError` whose cause says
 * why, and no socket is opened. Code that handles an offline network, which
 * every resolver must, takes its fallback path. A spec that installs its own
 * `fetch` stands in front of this one and is unaffected, and a request to
 * `localhost` still goes through for a spec that runs a server of its own.
 *
 * `SOLVE_LIVE_NETWORK=1` turns the guard off. The live-network workflow sets
 * it, and runs the cases that need a real service.
 */
if (process.env.SOLVE_LIVE_NETWORK !== "1" && typeof globalThis.fetch === "function") {
	const realFetch = globalThis.fetch;
	const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;
	const hostOf = (input: unknown): string | null => {
		try {
			const text = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string }).url;
			return new URL(String(text)).hostname;
		} catch {
			return null;
		}
	};
	globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		const host = hostOf(input);
		if (host !== null && LOCAL.test(host)) return realFetch(input, init);
		const cause = Object.assign(new Error("The unit tests do not use the real network (set SOLVE_LIVE_NETWORK=1 to allow it)"), { code: "ENETUNREACH" });
		const refusal = new TypeError("fetch failed");
		(refusal as { cause?: unknown }).cause = cause;
		throw refusal;
	}) as typeof fetch;
}
