import { describe, expect, jest, test } from "@jest/globals";
import { answeredOffline, keepOsrsOffline } from "@tools/offlineOsrs";

/**
 * The helper that keeps the OSRS example specs off the real Grand Exchange API
 * (tools/offlineOsrs.ts): it answers that one endpoint from a fixed table and
 * lets every other URL through to whatever `fetch` was there before.
 *
 * The stand-in for the real `fetch` is installed before the helper's hooks run
 * (they capture `fetch` in `beforeAll`), so the tests can see what reaches it.
 */

const reachedReal = jest.fn(async (input: string | URL | Request) => new Response(JSON.stringify({ real: String(input) }), { status: 200 }));
globalThis.fetch = reachedReal as unknown as typeof fetch;

keepOsrsOffline();

describe("keepOsrsOffline", () => {
	test("the OSRS price endpoint is answered from the table, in the shape the resolver reads", async () => {
		const response = await fetch("https://prices.runescape.wiki/api/v1/osrs/latest", { signal: new AbortController().signal });
		expect(response.ok).toBe(true);
		const json = (await response.json()) as { data: Record<string, { high: number; low: number }> };
		expect(Object.keys(json.data).length).toBeGreaterThan(0);
		for (const price of Object.values(json.data)) {
			expect(Number.isFinite(price.high)).toBe(true);
			expect(Number.isFinite(price.low)).toBe(true);
			expect(price.high).toBeGreaterThanOrEqual(price.low);
		}
		expect(reachedReal).not.toHaveBeenCalled();
		expect(answeredOffline).toContain("https://prices.runescape.wiki/api/v1/osrs/latest");
	});

	test("a URL object and a Request for the endpoint are answered too", async () => {
		await fetch(new URL("https://prices.runescape.wiki/api/v1/osrs/latest"));
		await fetch(new Request("https://prices.runescape.wiki/api/v1/osrs/latest"));
		expect(reachedReal).not.toHaveBeenCalled();
	});

	test("any other URL still reaches the real fetch, untouched", async () => {
		const response = await fetch("https://example.com/other");
		expect(((await response.json()) as { real: string }).real).toBe("https://example.com/other");
		expect(reachedReal).toHaveBeenCalledTimes(1);
	});

	test("adversarial: look-alike URLs are not the endpoint", async () => {
		reachedReal.mockClear();
		const lookalikes = [
			"https://prices.runescape.wiki/api/v1/osrs/latest?x=1",
			"https://prices.runescape.wiki/api/v1/osrs/latest/",
			"http://prices.runescape.wiki/api/v1/osrs/latest",
			"https://prices.runescape.wiki.evil.example/api/v1/osrs/latest",
			"https://evil.example/?u=https://prices.runescape.wiki/api/v1/osrs/latest",
			"",
		];
		for (const url of lookalikes) await fetch(url);
		expect(reachedReal).toHaveBeenCalledTimes(lookalikes.length);
	});

	test("adversarial: prototype words as URLs reach the real fetch and change nothing", async () => {
		reachedReal.mockClear();
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		for (const word of ["constructor", "__proto__", "toString", "hasOwnProperty"]) await fetch(word);
		expect(reachedReal).toHaveBeenCalledTimes(4);
		expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
	});
});
