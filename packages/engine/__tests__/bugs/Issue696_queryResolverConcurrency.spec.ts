import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { numberValue, type Value } from "@solve-js/vm/Value";
import { setActiveQueryClient } from "@solve-js/services/DataQueryService";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";
import { createConcurrencyLimit, settledOrAborted } from "@solve-js/utilities/ConcurrencyLimit";
import { PROTOTYPE_WORDS } from "@tools/adversarial";

/**
 * Issue #696: `createQueryResolver` started every fetch the moment it was asked
 * for, so a document of 500 places opened 500 requests to one service at once.
 * The resolver now runs at most `maxConcurrent` fetches together (default 6),
 * the rest queued in order; a fetch's timeout starts when it does, a queued
 * query whose signal aborts leaves without fetching, and a fetch that ignores
 * its signal still gives its slot back at the deadline.
 */

const FN = 251;

function program(query: string) {
	const builder = new BytecodeBuilder();
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(query);
	builder.emitOpcode(OpCode.CALL_PLUGIN);
	builder.emitByte(FN);
	builder.emitByte(1);
	builder.emitOpcode(OpCode.HALT);
	return builder.build();
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stub fetch that records how many run at once and answers after `ms`. */
function stubFetch(ms: number) {
	const stats = { started: 0, inFlight: 0, most: 0, order: [] as string[] };
	const fetchQuery = async (query: string): Promise<Value> => {
		stats.started++;
		stats.inFlight++;
		stats.most = Math.max(stats.most, stats.inFlight);
		stats.order.push(query);
		try {
			await later(ms);
			return numberValue(query.length);
		} finally {
			stats.inFlight--;
		}
	};
	return { stats, fetchQuery };
}

describe("createConcurrencyLimit", () => {
	test("hands out at most its limit, then serves waiters in arrival order", async () => {
		const limit = createConcurrencyLimit(2);
		const signal = new AbortController().signal;
		const a = await limit.acquire(signal);
		const b = await limit.acquire(signal);
		const order: string[] = [];
		const c = limit.acquire(signal).then((r) => (order.push("c"), r));
		const d = limit.acquire(signal).then((r) => (order.push("d"), r));
		expect([limit.active, limit.queued]).toEqual([2, 2]);
		a();
		(await c)();
		b();
		(await d)();
		expect(order).toEqual(["c", "d"]);
		expect([limit.active, limit.queued]).toEqual([0, 0]);
	});

	test("tryAcquire takes a free slot in the same turn, and none when all are held", () => {
		const limit = createConcurrencyLimit(1);
		const release = limit.tryAcquire();
		expect(release).not.toBeNull();
		expect(limit.tryAcquire()).toBeNull();
		release!();
		expect(limit.tryAcquire()).not.toBeNull();
	});

	test("an uncontended fetch starts in the turn it is asked for, as it did before the limit", async () => {
		let started = false;
		const { resolver } = createQueryResolver({
			namespace: "t696i",
			pluginFunctionIndex: FN,
			fetchQuery: () => {
				started = true;
				return Promise.resolve(numberValue(1));
			},
		});
		const qc = new QueryClient();
		const result = resolver.preflight!([], program("now"), "_engine", new AbortController().signal, qc)!;
		expect(started).toBe(true);
		await result.resolver;
		qc.clear();
	});

	test("a release called twice gives the slot back once", async () => {
		const limit = createConcurrencyLimit(1);
		const signal = new AbortController().signal;
		const release = await limit.acquire(signal);
		release();
		release();
		expect(limit.active).toBe(0);
		await limit.acquire(signal);
		expect(limit.active).toBe(1);
	});

	test("a waiter whose signal aborts leaves the queue and is rejected with the reason", async () => {
		const limit = createConcurrencyLimit(1);
		const held = await limit.acquire(new AbortController().signal);
		const controller = new AbortController();
		const waiting = limit.acquire(controller.signal);
		controller.abort(new Error("gone"));
		await expect(waiting).rejects.toThrow("gone");
		expect(limit.queued).toBe(0);
		held();
		expect(limit.active).toBe(0);
	});

	test("an already-aborted signal never takes a slot", async () => {
		const limit = createConcurrencyLimit(1);
		const controller = new AbortController();
		controller.abort(new Error("already"));
		await expect(limit.acquire(controller.signal)).rejects.toThrow("already");
		expect(limit.active).toBe(0);
	});

	test("Infinity is no limit, and a limit that is not a positive whole number is refused", async () => {
		const open = createConcurrencyLimit(Infinity);
		const signal = new AbortController().signal;
		for (let i = 0; i < 1000; i++) await open.acquire(signal);
		expect(open.active).toBe(1000);
		for (const bad of [0, -1, 1.5, NaN, -Infinity]) {
			expect(() => createConcurrencyLimit(bad)).toThrow(RangeError);
		}
	});
});

describe("settledOrAborted", () => {
	test("passes a result or a failure through", async () => {
		const signal = new AbortController().signal;
		await expect(settledOrAborted(Promise.resolve(3), signal)).resolves.toBe(3);
		await expect(settledOrAborted(Promise.reject(new Error("no")), signal)).rejects.toThrow("no");
	});

	test("stops waiting at the abort for a promise that never settles", async () => {
		const controller = new AbortController();
		const waiting = settledOrAborted(new Promise<number>(() => {}), controller.signal);
		controller.abort(new Error("deadline"));
		await expect(waiting).rejects.toThrow("deadline");
	});
});

describe("createQueryResolver runs at most maxConcurrent fetches", () => {
	let qc: QueryClient;
	beforeEach(() => {
		qc = new QueryClient();
		setActiveQueryClient(qc);
	});
	afterEach(() => {
		qc.clear();
	});

	function ask(resolver: ReturnType<typeof createQueryResolver>["resolver"], query: string, signal = new AbortController().signal) {
		return resolver.preflight!([], program(query), "_engine", signal, qc);
	}

	test("a thousand distinct queries run six at a time by default, in order, and all answer", async () => {
		const { stats, fetchQuery } = stubFetch(2);
		const { resolver, pluginFunction } = createQueryResolver({ namespace: "t696a", pluginFunctionIndex: FN, fetchQuery });
		const queries = Array.from({ length: 1000 }, (_, i) => `place${i}`);
		const results = queries.map((q) => ask(resolver, q)!);
		await tick();
		expect(stats.inFlight).toBeLessThanOrEqual(6);
		await Promise.all(results.map((r) => r.resolver));
		expect(stats.started).toBe(1000);
		expect(stats.most).toBe(6);
		expect(stats.order.slice(0, 6)).toEqual(queries.slice(0, 6));
		expect(pluginFunction([{ value: "place999" } as Value]).toNumber()).toBe(8);
	});

	test("maxConcurrent sets the limit", async () => {
		const { stats, fetchQuery } = stubFetch(2);
		const { resolver } = createQueryResolver({ namespace: "t696b", pluginFunctionIndex: FN, fetchQuery, maxConcurrent: 2 });
		await Promise.all(Array.from({ length: 20 }, (_, i) => ask(resolver, `q${i}`)!.resolver));
		expect(stats.most).toBe(2);
	});

	test("a fetch's timeout starts when it does, so a long queue does not time out requests that never ran", async () => {
		const { stats, fetchQuery } = stubFetch(20);
		const { resolver } = createQueryResolver({ namespace: "t696c", pluginFunctionIndex: FN, fetchQuery, maxConcurrent: 1, timeoutMs: 60 });
		const values = await Promise.all(Array.from({ length: 6 }, (_, i) => ask(resolver, `slow${i}`)!.resolver));
		expect(stats.started).toBe(6);
		expect(values.every((v) => !v.isError())).toBe(true);
	});

	test("a fetch that never settles holds its slot until the timeout, then gives it back", async () => {
		let calls = 0;
		const { resolver } = createQueryResolver({
			namespace: "t696d",
			pluginFunctionIndex: FN,
			maxConcurrent: 1,
			timeoutMs: 30,
			fetchQuery: (query) => {
				calls++;
				return query === "stuck" ? new Promise<Value>(() => {}) : Promise.resolve(numberValue(1));
			},
		});
		const stuck = ask(resolver, "stuck")!;
		const next = ask(resolver, "next")!;
		const stuckValue = await stuck.resolver;
		expect(stuckValue.isError()).toBe(true);
		expect(String(stuckValue.errorMessage)).toMatch(/timed out after 30ms/);
		expect((await next.resolver).toNumber()).toBe(1);
		expect(calls).toBe(2);
	});

	test("the same query asked twice while it waits shares one fetch", async () => {
		const { stats, fetchQuery } = stubFetch(5);
		const { resolver } = createQueryResolver({ namespace: "t696e", pluginFunctionIndex: FN, fetchQuery, maxConcurrent: 1 });
		const first = ask(resolver, "busy")!;
		const queued = ask(resolver, "twice")!;
		const again = ask(resolver, "twice");
		await Promise.all([first.resolver, queued.resolver, again?.resolver]);
		expect(stats.order.filter((q) => q === "twice")).toHaveLength(1);
	});

	test("a queued query cancelled before its turn never fetches", async () => {
		const { stats, fetchQuery } = stubFetch(10);
		const { resolver } = createQueryResolver({ namespace: "t696f", pluginFunctionIndex: FN, fetchQuery, maxConcurrent: 1 });
		const first = ask(resolver, "first")!;
		const doomed = ask(resolver, "doomed")!;
		await qc.cancelQueries({ queryKey: ["t696f", "doomed"] });
		await first.resolver;
		await doomed.resolver.catch(() => undefined);
		await later(20);
		expect(stats.order).toEqual(["first"]);
	});

	test("an invalid maxConcurrent is refused when the package is built", () => {
		const { fetchQuery } = stubFetch(1);
		for (const bad of [0, -3, 2.5]) {
			expect(() => createQueryResolver({ namespace: "t696g", pluginFunctionIndex: FN, fetchQuery, maxConcurrent: bad })).toThrow(RangeError);
		}
	});

	test("adversarial: prototype-named queries queue and answer like any other", async () => {
		const { stats, fetchQuery } = stubFetch(1);
		const { resolver } = createQueryResolver({ namespace: "t696h", pluginFunctionIndex: FN, fetchQuery, maxConcurrent: 2 });
		const results = PROTOTYPE_WORDS.map((w) => ask(resolver, w)).filter((r) => r !== null);
		await Promise.all(results.map((r) => r!.resolver));
		expect(stats.most).toBeLessThanOrEqual(2);
		expect(stats.started).toBe(new Set(PROTOTYPE_WORDS).size);
	});
});

describe("through the weather package", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("a document of 60 places keeps at most six requests in flight, and every place answers", async () => {
		const stats = { inFlight: 0, most: 0, geocodes: 0, forecasts: 0 };
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			stats.inFlight++;
			stats.most = Math.max(stats.most, stats.inFlight);
			try {
				await later(3);
				if (url.includes("geocoding")) {
					stats.geocodes++;
					return new Response(JSON.stringify({ results: [{ latitude: 51.5, longitude: -0.1, name: "Town" }] }));
				}
				stats.forecasts++;
				return new Response(JSON.stringify({
					current: { temperature_2m: 12, apparent_temperature: 11, weather_code: 3 },
					daily: { temperature_2m_max: [14], temperature_2m_min: [9] },
				}));
			} finally {
				stats.inFlight--;
			}
		}) as typeof fetch;

		const { newTrackedEngine } = await import("@tools/trackedEngine");
		const { evaluateDocument } = await import("@solve-js/engine/evaluateDocument");
		const engine = newTrackedEngine();
		const text = Array.from({ length: 60 }, (_, i) => `weather in Place696x${i}`).join("\n");
		evaluateDocument(engine, text, { inputType: "markdown" });
		for (let i = 0; i < 400 && stats.forecasts < 60; i++) await later(5);
		expect(stats.geocodes).toBe(60);
		expect(stats.forecasts).toBe(60);
		expect(stats.most).toBeLessThanOrEqual(6);
	});
});
