/**
 * `VariableResolver`, published through the `solve-engine/variables` subpath.
 *
 * Three of its eight methods (`set`, `invalidateAll`, `setCacheEnabled`) were
 * unreached, and `sharedVariableResolver` was not referenced by any test at
 * all. `IEnginePackage.variableSources` is documented as having no effect on
 * evaluation today, so what is under test here is the resolver as a host uses
 * it directly, not the package field.
 *
 * The cache is the part worth guarding. It sits in front of every source and
 * is only correct if it is invalidated on the events that can change an
 * answer, so a missing invalidation shows up as a stale value that looks
 * exactly like a correct one.
 */

import { describe, expect, test } from "@jest/globals";
import type { IVariableSource } from "@solve-js/variables/IVariableSource";
import { VariableResolver, sharedVariableResolver } from "@solve-js/variables/VariableResolver";

/** A source backed by a plain object, counting the reads and writes it sees. */
function source(
	name: string,
	priority: number,
	values: Record<string, number | string> = {},
): IVariableSource & { reads: string[]; writes: Array<[string, number | string]> } {
	const store = { ...values };
	return {
		name,
		priority,
		reads: [] as string[],
		writes: [] as Array<[string, number | string]>,
		async get(key: string) {
			this.reads.push(key);
			return store[key];
		},
		async set(key: string, value: number | string) {
			this.writes.push([key, value]);
			store[key] = value;
		},
	};
}

describe("resolution order", () => {
	test("the lower priority number is consulted first", () => {
		/*
		 * "Lower numbers = higher priority" is the interface's own wording,
		 * and it is the opposite of the reading most people reach for, so it
		 * is exactly the kind of thing that gets inverted in a refactor. A
		 * host layering frontmatter over document variables depends on it.
		 */
		const resolver = new VariableResolver();
		resolver.registerSource(source("low-priority", 10, { rate: 1 }));
		resolver.registerSource(source("high-priority", 1, { rate: 99 }));

		return expect(resolver.resolve("rate")).resolves.toBe(99);
	});

	test("registration order does not matter, only priority", () => {
		// The sort runs on registration, so the same two sources added the
		// other way round must give the same answer.
		const resolver = new VariableResolver();
		resolver.registerSource(source("high-priority", 1, { rate: 99 }));
		resolver.registerSource(source("low-priority", 10, { rate: 1 }));

		return expect(resolver.resolve("rate")).resolves.toBe(99);
	});

	test("a source without the name is passed over rather than ending the search", () => {
		/*
		 * "Not found here" and "found, and the value is nothing" have to be
		 * different, or the first source registered would shadow every one
		 * behind it for every name it does not have.
		 */
		const resolver = new VariableResolver();
		const empty = source("empty", 1);
		resolver.registerSource(empty);
		resolver.registerSource(source("has-it", 5, { rate: 42 }));

		return expect(resolver.resolve("rate")).resolves.toBe(42);
	});

	test("a name no source has resolves to undefined, not a throw", () => {
		// An unknown variable is an ordinary outcome, and the caller decides
		// what it means.
		const resolver = new VariableResolver();
		resolver.registerSource(source("only", 1, { known: 1 }));

		return expect(resolver.resolve("unknown")).resolves.toBeUndefined();
	});

	test("a resolver with no sources resolves to undefined", () => {
		return expect(new VariableResolver().resolve("anything")).resolves.toBeUndefined();
	});
});

describe("the lookup cache", () => {
	test("a second read of the same name does not reach the source again", async () => {
		/*
		 * The reason the cache exists: a source may be an async round-trip to
		 * a file or a plugin store, and one document can reference the same
		 * variable on many lines.
		 */
		const resolver = new VariableResolver();
		const backing = source("backing", 1, { rate: 5 });
		resolver.registerSource(backing);

		await resolver.resolve("rate");
		await resolver.resolve("rate");

		expect(backing.reads).toEqual(["rate"]);
	});

	test("invalidate takes one name out and leaves the rest cached", () => {
		/*
		 * Per-name invalidation is what lets a host react to one variable
		 * changing without paying to re-resolve the whole document.
		 */
		const resolver = new VariableResolver();
		const backing = source("backing", 1, { a: 1, b: 2 });
		resolver.registerSource(backing);

		return (async () => {
			await resolver.resolve("a");
			await resolver.resolve("b");
			resolver.invalidate("a");
			await resolver.resolve("a");
			await resolver.resolve("b");

			expect(backing.reads).toEqual(["a", "b", "a"]);
		})();
	});

	test("invalidateAll drops every cached name", async () => {
		const resolver = new VariableResolver();
		const backing = source("backing", 1, { a: 1, b: 2 });
		resolver.registerSource(backing);

		await resolver.resolve("a");
		await resolver.resolve("b");
		resolver.invalidateAll();
		await resolver.resolve("a");
		await resolver.resolve("b");

		expect(backing.reads).toEqual(["a", "b", "a", "b"]);
	});

	test("an invalidated name picks up the source's new value", async () => {
		// The point of invalidating, rather than just the read count.
		const resolver = new VariableResolver();
		const backing = source("backing", 1, { rate: 1 });
		resolver.registerSource(backing);

		expect(await resolver.resolve("rate")).toBe(1);
		await backing.set("rate", 2);
		expect(await resolver.resolve("rate")).toBe(1);

		resolver.invalidate("rate");
		expect(await resolver.resolve("rate")).toBe(2);
	});

	test("with the cache disabled every read goes to the sources", async () => {
		/*
		 * The escape hatch for a host whose variables can change under it
		 * with no event to invalidate on. If it still served cached values,
		 * turning it off would do nothing and the host would have no way to
		 * get a fresh read at all.
		 */
		const resolver = new VariableResolver();
		const backing = source("backing", 1, { rate: 1 });
		resolver.registerSource(backing);
		resolver.setCacheEnabled(false);

		await resolver.resolve("rate");
		await backing.set("rate", 7);
		expect(await resolver.resolve("rate")).toBe(7);
		expect(backing.reads).toEqual(["rate", "rate"]);
	});

	test("unregistering a source clears the cache, since answers may now differ", async () => {
		/*
		 * Removing the winning source has to change what the next resolve
		 * answers. A cache that survived would keep serving the departed
		 * source's value indefinitely, which is the shape of bug that
		 * outlives the code that caused it.
		 */
		const resolver = new VariableResolver();
		const primary = source("primary", 1, { rate: 99 });
		resolver.registerSource(primary);
		resolver.registerSource(source("fallback", 10, { rate: 1 }));

		expect(await resolver.resolve("rate")).toBe(99);

		resolver.unregisterSource(primary);

		expect(await resolver.resolve("rate")).toBe(1);
	});

	test("unregistering something never registered is a harmless no-op", () => {
		const resolver = new VariableResolver();
		const registered = source("registered", 1, { rate: 1 });
		resolver.registerSource(registered);

		expect(() => resolver.unregisterSource(source("stranger", 1))).not.toThrow();

		return expect(resolver.resolve("rate")).resolves.toBe(1);
	});
});

describe("set", () => {
	test("writes through to every registered source", async () => {
		/*
		 * Writing to only the highest-priority source would leave the others
		 * holding a value the resolver no longer reports, and which would
		 * resurface the moment the winner was unregistered.
		 */
		const resolver = new VariableResolver();
		const first = source("first", 1);
		const second = source("second", 10);
		resolver.registerSource(first);
		resolver.registerSource(second);

		await resolver.set("rate", 12);

		expect(first.writes).toEqual([["rate", 12]]);
		expect(second.writes).toEqual([["rate", 12]]);
	});

	test("the new value is what the next read returns, without a source round-trip", async () => {
		// A write the resolver just made is the one value it can be certain
		// about, so re-reading it from the source would be pure cost.
		const resolver = new VariableResolver();
		const backing = source("backing", 1, { rate: 1 });
		resolver.registerSource(backing);

		await resolver.resolve("rate");
		await resolver.set("rate", 50);

		expect(await resolver.resolve("rate")).toBe(50);
		expect(backing.reads).toEqual(["rate"]);
	});

	test("accepts strings as well as numbers", async () => {
		// The interface's value type is `number | string`, and a host storing
		// a currency code or a label is an ordinary use.
		const resolver = new VariableResolver();
		const backing = source("backing", 1);
		resolver.registerSource(backing);

		await resolver.set("currency", "GBP");
		expect(await resolver.resolve("currency")).toBe("GBP");
	});
});

describe("sharedVariableResolver", () => {
	test("is a VariableResolver, and the same instance every time", () => {
		/*
		 * It is a module-level singleton that `PackageRegistry` writes into.
		 * Two imports resolving to two instances would mean registrations
		 * landing somewhere nothing reads, which is a failure mode this
		 * codebase has already documented for the registry as a whole.
		 */
		expect(sharedVariableResolver).toBeInstanceOf(VariableResolver);
		expect(sharedVariableResolver).toBe(sharedVariableResolver);
	});

	test("is not the resolver a freshly built one starts as", () => {
		// A new VariableResolver has to be independent of the shared one, or
		// a host building its own would silently join the global.
		const own = new VariableResolver();
		expect(own).not.toBe(sharedVariableResolver);
	});
});
