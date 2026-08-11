/**
 * `ResolverRegistry`, the async half of the package SDK, tested against its
 * own documented contract rather than through a package that happens to use
 * it.
 *
 * It is published through the `solve-engine/resolvers` subpath and it is what
 * a third party registering `IEnginePackage.asyncResolvers` is handing its
 * resolver to. Before this file it was 88% covered with three of its eight
 * functions never called: the namespace-collision path, the cache eviction on
 * unregister, and `clear()`. Each of those three is a lifecycle promise the
 * registry makes to a package author, and none of them is exercised by the
 * built-in packages, which register once and never collide.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import { ResolverRegistry, type AsyncCheckResult, type IAsyncResolver } from "@solve-js/resolvers/ResolverRegistry";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import type { Token } from "@solve-js/lexer/Token";
import { numberValue, type Value } from "@solve-js/vm/Value";

/** The smallest thing that satisfies IAsyncResolver, with its calls recorded. */
function stubResolver(
	namespace: string,
	preflightResult: AsyncCheckResult | null = null,
): IAsyncResolver & { destroyed: number; preflights: number } {
	const resolver = {
		namespace,
		destroyed: 0,
		preflights: 0,
		preflight(): AsyncCheckResult | null {
			resolver.preflights++;
			return preflightResult;
		},
		destroy(): void {
			resolver.destroyed++;
		},
	};
	return resolver;
}

/** A pending result of the shape a real preflight would hand back. */
function pending(queryKey: string, packageId: string): AsyncCheckResult {
	return {
		queryKey,
		resolver: Promise.resolve(numberValue(1) as Value),
		packageId,
		signal: new AbortController().signal,
	};
}

const NO_TOKENS: Token[] = [];
const NO_BYTECODE = {
	opcodes: new Uint8Array(),
	numbers: new Float64Array(),
	strings: [],
	constants: new Map(),
	hasAsync: false,
} as unknown as BytecodeProgram;

function runPreflight(registry: ResolverRegistry, client: QueryClient): AsyncCheckResult | null {
	return registry.preflightAll(
		NO_TOKENS,
		NO_BYTECODE,
		"test-package",
		new AbortController().signal,
		client,
	);
}

describe("registration and lookup", () => {
	test("a registered resolver is findable by its namespace", () => {
		const registry = new ResolverRegistry();
		const weather = stubResolver("weather");

		registry.register(weather);

		expect(registry.has("weather")).toBe(true);
		expect(registry.get("weather")).toBe(weather);
		expect(registry.size).toBe(1);
	});

	test("an unknown namespace is absent rather than an error", () => {
		// A host asking whether a package is loaded must be able to ask
		// without a try/catch around it.
		const registry = new ResolverRegistry();
		expect(registry.has("nothing")).toBe(false);
		expect(registry.get("nothing")).toBeUndefined();
		expect(registry.size).toBe(0);
	});

	test("distinct namespaces coexist, which is what makes one package able to have several", () => {
		/*
		 * The doc comment tells a package with more than one async operation
		 * to use "weather:current" and "weather:forecast" rather than one
		 * monolithic preflight. That advice is only sound if the registry
		 * really is keyed on the full namespace string.
		 */
		const registry = new ResolverRegistry();
		registry.register(stubResolver("weather:current"));
		registry.register(stubResolver("weather:forecast"));

		expect(registry.size).toBe(2);
		expect(registry.has("weather:current")).toBe(true);
		expect(registry.has("weather:forecast")).toBe(true);
	});
});

describe("a namespace collision", () => {
	test("destroys the resolver being replaced, rather than orphaning it", () => {
		/*
		 * The replaced resolver may hold in-flight promises, a timer, or a
		 * subscription. Dropping the reference without calling destroy()
		 * leaves all of that running with nothing able to reach it again,
		 * which is the shape of leak that keeps a Node process alive after
		 * its work is done.
		 */
		const registry = new ResolverRegistry();
		const first = stubResolver("prices");
		const second = stubResolver("prices");
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

		try {
			registry.register(first);
			registry.register(second);

			expect(first.destroyed).toBe(1);
			expect(second.destroyed).toBe(0);
			expect(registry.get("prices")).toBe(second);
			expect(registry.size).toBe(1);
		} finally {
			warn.mockRestore();
		}
	});

	test("warns, naming the namespace and suggesting the fix", () => {
		/*
		 * Two packages silently overwriting each other is the failure mode
		 * this warning exists for: the losing package keeps working right up
		 * to the point where its data is needed. The message has to name the
		 * namespace, since that is the only thing either author can act on.
		 */
		const registry = new ResolverRegistry();
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

		try {
			registry.register(stubResolver("prices"));
			registry.register(stubResolver("prices"));

			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0][0])).toContain("prices");
		} finally {
			warn.mockRestore();
		}
	});

	test("the first registration of a namespace is silent", () => {
		// The warning must be about collisions specifically. A warning on
		// every registration would be noise a host learns to ignore.
		const registry = new ResolverRegistry();
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

		try {
			registry.register(stubResolver("prices"));
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

describe("unregistration", () => {
	test("destroys the resolver and forgets it", () => {
		const registry = new ResolverRegistry();
		const weather = stubResolver("weather");
		registry.register(weather);

		registry.unregister("weather");

		expect(weather.destroyed).toBe(1);
		expect(registry.has("weather")).toBe(false);
		expect(registry.size).toBe(0);
	});

	test("evicts the namespace's cached query results, and only those", async () => {
		/*
		 * Cache keys are hierarchical, so removing ["weather"] must take
		 * ["weather", "London"] with it. This is the difference between
		 * unloading a package and unloading a package whose stale answers
		 * keep being served to whatever loads next under the same name.
		 *
		 * The sibling namespace is here because `removeQueries` with a
		 * prefix key is easy to get wrong in the other direction, and
		 * clearing another package's cache on unload would be worse than
		 * leaving your own.
		 */
		const registry = new ResolverRegistry();
		const client = new QueryClient();
		try {
			registry.register(stubResolver("weather"));
			client.setQueryData(["weather", "London"], 12);
			client.setQueryData(["weather", "Paris"], 15);
			client.setQueryData(["stocks", "AAPL"], 190);

			registry.unregister("weather", client);

			expect(client.getQueryData(["weather", "London"])).toBeUndefined();
			expect(client.getQueryData(["weather", "Paris"])).toBeUndefined();
			expect(client.getQueryData(["stocks", "AAPL"])).toBe(190);
		} finally {
			client.clear();
		}
	});

	test("unregistering an unknown namespace is a no-op, not a throw", () => {
		// Package teardown runs on paths that may already have torn down, so
		// this has to be safe to call twice.
		const registry = new ResolverRegistry();
		expect(() => registry.unregister("never-registered")).not.toThrow();

		const weather = stubResolver("weather");
		registry.register(weather);
		registry.unregister("weather");
		expect(() => registry.unregister("weather")).not.toThrow();
		expect(weather.destroyed).toBe(1);
	});
});

describe("clear", () => {
	test("destroys every resolver, not just the map entries", () => {
		/*
		 * `clear()` runs on a document switch. Emptying the map without
		 * destroying would leak one resolver's worth of timers and in-flight
		 * work per document the host opens.
		 */
		const registry = new ResolverRegistry();
		const weather = stubResolver("weather");
		const stocks = stubResolver("stocks");
		registry.register(weather);
		registry.register(stocks);

		registry.clear();

		expect(weather.destroyed).toBe(1);
		expect(stocks.destroyed).toBe(1);
		expect(registry.size).toBe(0);
		expect(registry.has("weather")).toBe(false);
	});

	test("clearing an empty registry is harmless", () => {
		const registry = new ResolverRegistry();
		expect(() => registry.clear()).not.toThrow();
		expect(registry.size).toBe(0);
	});
});

describe("preflightAll", () => {
	test("returns null when every resolver says its data is ready", () => {
		// null is what lets the engine run the VM. Anything else and the line
		// goes pending, so a resolver returning a truthy "nothing to do"
		// would strand every line in the document.
		const registry = new ResolverRegistry();
		const client = new QueryClient();
		try {
			registry.register(stubResolver("weather"));
			registry.register(stubResolver("stocks"));

			expect(runPreflight(registry, client)).toBeNull();
		} finally {
			client.clear();
		}
	});

	test("short-circuits on the first resolver that needs data", () => {
		/*
		 * Documented behaviour, and load bearing: the line is about to be
		 * suspended anyway, so asking the remaining resolvers costs work
		 * whose answer is discarded. The rest are discovered on the
		 * re-evaluation the first one triggers when it settles.
		 */
		const registry = new ResolverRegistry();
		const client = new QueryClient();
		try {
			const first = stubResolver("weather", pending("weather:London", "weather-pkg"));
			const second = stubResolver("stocks");
			registry.register(first);
			registry.register(second);

			const result = runPreflight(registry, client);

			expect(result?.queryKey).toBe("weather:London");
			expect(first.preflights).toBe(1);
			expect(second.preflights).toBe(0);
		} finally {
			client.clear();
		}
	});

	test("a resolver with no preflight at all is skipped, not called", () => {
		/*
		 * `preflight` is optional on IAsyncResolver. A resolver that only
		 * needs the destroy() lifecycle hook is a legal package
		 * contribution, and calling undefined would take the whole
		 * evaluation down.
		 */
		const registry = new ResolverRegistry();
		const client = new QueryClient();
		try {
			const passive: IAsyncResolver = { namespace: "passive", destroy() {} };
			const active = stubResolver("active");
			registry.register(passive);
			registry.register(active);

			expect(runPreflight(registry, client)).toBeNull();
			expect(active.preflights).toBe(1);
		} finally {
			client.clear();
		}
	});

	test("an empty registry preflights to null", () => {
		const registry = new ResolverRegistry();
		const client = new QueryClient();
		try {
			expect(runPreflight(registry, client)).toBeNull();
		} finally {
			client.clear();
		}
	});
});
