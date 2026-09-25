import { afterEach, describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import { GlobalVariableAsyncResolver } from "@solve-js/vm/GlobalVariableAsyncResolver";
import { OpCode } from "@solve-js/parser/OpCode";
import { numberValue } from "@solve-js/vm/Value";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import type { QueryClient } from "@tanstack/query-core";

/**
 * Issue #695: every `global :name` read that no note had declared subscribed
 * its own listener to the process-wide store, and the resolver, one instance
 * shared by every engine, kept each waiting promise in a map of its own. So
 * 40,000 reads left 40,000 listeners that every later write called, and the
 * promises carried the engine's continuation, so a dropped engine was never
 * collected. The resolver now holds one subscription, dispatching by name, and
 * keeps each engine's waits keyed weakly by that engine's query client.
 */

function listenerCount(): number {
	return (sharedGlobalVariableStore as unknown as { listeners: Set<unknown> }).listeners.size;
}

function reads(names: string[]): BytecodeProgram {
	const opcodes: number[] = [];
	names.forEach((_, i) => opcodes.push(OpCode.LOAD_GLOBAL_VAR, i));
	opcodes.push(OpCode.HALT);
	return { opcodes: new Uint8Array(opcodes), numbers: new Float64Array([]), strings: names } as BytecodeProgram;
}

const NO_SIGNAL = new AbortController().signal;
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
const owner = (): QueryClient => ({}) as QueryClient;

afterEach(() => {
	sharedGlobalVariableStore.clear();
});

describe("one subscription however many names are waited on", () => {
	test("a thousand undeclared names in one engine add one listener", () => {
		const resolver = new GlobalVariableAsyncResolver();
		const before = listenerCount();
		const client = owner();
		for (let i = 0; i < 1000; i++) resolver.preflight([], reads([`u${i}`]), "_engine", NO_SIGNAL, client);
		expect(listenerCount()).toBe(before + 1);
	});

	test("and several engines share it", () => {
		const resolver = new GlobalVariableAsyncResolver();
		const before = listenerCount();
		for (let e = 0; e < 5; e++) resolver.preflight([], reads(["shared", `own${e}`]), "_engine", NO_SIGNAL, owner());
		expect(listenerCount()).toBe(before + 1);
	});

	test("the subscription goes when nothing is left to wait for", async () => {
		const resolver = new GlobalVariableAsyncResolver();
		const before = listenerCount();
		const result = resolver.preflight([], reads(["only"]), "_engine", NO_SIGNAL, owner())!;
		expect(listenerCount()).toBe(before + 1);
		sharedGlobalVariableStore.set("only", numberValue(1));
		await result.resolver;
		expect(listenerCount()).toBe(before);
	});
});

describe("the waits behave as they did", () => {
	test("lines of one engine waiting on one name share one promise", () => {
		const resolver = new GlobalVariableAsyncResolver();
		const client = owner();
		const first = resolver.preflight([], reads(["x"]), "_engine", NO_SIGNAL, client)!;
		const second = resolver.preflight([], reads(["x"]), "_engine", NO_SIGNAL, client)!;
		expect(first.resolver).toBe(second.resolver);
	});

	test("a write settles every engine's wait on the name, and no other", async () => {
		const resolver = new GlobalVariableAsyncResolver();
		const a = resolver.preflight([], reads(["x"]), "_engine", NO_SIGNAL, owner())!;
		const b = resolver.preflight([], reads(["x"]), "_engine", NO_SIGNAL, owner())!;
		const other = resolver.preflight([], reads(["y"]), "_engine", NO_SIGNAL, owner())!;
		let otherSettled = false;
		void other.resolver.then(() => (otherSettled = true));
		sharedGlobalVariableStore.set("x", numberValue(7));
		expect((await a.resolver).toNumber()).toBe(7);
		expect((await b.resolver).toNumber()).toBe(7);
		await new Promise((r) => setTimeout(r, 0));
		expect(otherSettled).toBe(false);
	});

	test("one engine's teardown ends no other engine's wait", async () => {
		const resolver = new GlobalVariableAsyncResolver();
		const kept = resolver.preflight([], reads(["x"]), "_engine", NO_SIGNAL, owner())!;
		resolver.destroy();
		sharedGlobalVariableStore.set("x", numberValue(3));
		expect((await kept.resolver).toNumber()).toBe(3);
	});

	test("a wait survives the store being reset under it, as a test reset does", async () => {
		const resolver = new GlobalVariableAsyncResolver();
		resolver.preflight([], reads(["before"]), "_engine", NO_SIGNAL, owner());
		sharedGlobalVariableStore.clear();
		const after = resolver.preflight([], reads(["after"]), "_engine", NO_SIGNAL, owner())!;
		sharedGlobalVariableStore.set("after", numberValue(9));
		expect((await after.resolver).toNumber()).toBe(9);
	});

	test("a name nobody declares still pends", async () => {
		const resolver = new GlobalVariableAsyncResolver();
		const result = resolver.preflight([], reads(["never"]), "_engine", NO_SIGNAL, owner())!;
		let settled = false;
		void result.resolver.then(() => (settled = true));
		sharedGlobalVariableStore.set("something else", numberValue(1));
		await new Promise((r) => setTimeout(r, 0));
		expect(settled).toBe(false);
	});
});

describe("through real engines", () => {
	test("forty thousand undeclared reads add one listener, and another engine's write still settles its wait", async () => {
		const before = listenerCount();
		const reader = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const lines = Array.from({ length: 40_000 }, (_, i) => `global :u${i}`).join("\n");
		reader.parseDocument(lines, { inputType: "markdown" });
		expect(listenerCount()).toBeLessThanOrEqual(before + 2);
		const writer = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		writer.evaluateExpression("global :u0 = 5");
		expect(sharedGlobalVariableStore.get("u0")?.toNumber()).toBe(5);
		writer.clear();
		reader.clear();
	});

	const gc = (globalThis as { gc?: () => void }).gc;
	(typeof gc === "function" ? test : test.skip)("a dropped engine waiting on an undeclared name is collected, and its waits leave the store", async () => {
		const before = listenerCount();
		let ref: WeakRef<object> | undefined;
		(() => {
			const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
			engine.parseDocument(Array.from({ length: 100 }, (_, i) => `global :dropped${i}`).join("\n"), { inputType: "markdown" });
			ref = new WeakRef(engine);
		})();
		for (let i = 0; i < 10 && ref!.deref() !== undefined; i++) {
			await new Promise((r) => setTimeout(r, 0));
			gc!();
		}
		expect(ref!.deref()).toBeUndefined();
		// The finalizers that prune the name index run after a collection, on
		// their own schedule; give them a few turns.
		for (let i = 0; i < 20 && listenerCount() > before; i++) {
			gc!();
			await later(10);
		}
		expect(listenerCount()).toBe(before);
	});
});
