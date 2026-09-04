/**
 * The async preflight runs only for a line a registered resolver could
 * intercept, and a plain line arms no cancellation state.
 *
 * Every line used to pay for every resolver's preflight, because the gate was
 * "any resolver registered", which `createEngine()` always satisfies: six
 * built-in packages register seven resolvers, so `10 + 20` ran seven opcode
 * scans and then allocated an AbortController and linked a keystroke listener
 * that nothing could ever fire. A resolver now names the opcodes it watches
 * (`IAsyncResolver.watchedOpcodes`), and a program containing none of them
 * skips the preflight, the controller and the listener.
 *
 * What is pinned: a resolver with a declared set is not asked about a line
 * without those opcodes and is asked about a line with them; a resolver that
 * declares nothing keeps today's behaviour and is asked about every line; a
 * plugin call (`program.hasAsync`) still forces the full preflight and a real
 * per-evaluation signal, which the VM's pending path relies on; a plain line
 * links nothing to the keystroke signal; the built-in shapes declare sets
 * that match what their scanners read; and the registry forgets a program's
 * scan when the resolver set changes.
 */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES, CURRENCY_PACKAGE, WEATHER_PACKAGE } from "@solve-js/packages/builtins";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";
import { ResolverRegistry, type IAsyncResolver } from "@solve-js/resolvers/ResolverRegistry";
import { numberValue, ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** A resolver whose preflight never intercepts, counting how often it is asked. */
function countingResolver(namespace: string, watchedOpcodes?: readonly OpCode[]): { resolver: IAsyncResolver; calls: () => number } {
	let calls = 0;
	const resolver: IAsyncResolver = {
		namespace,
		watchedOpcodes,
		preflight() {
			calls++;
			return null;
		},
		destroy() {},
	};
	return { resolver, calls: () => calls };
}

/** `PUSH_NUMBER 1; HALT`: a program nothing watches. */
function plainProgram(): BytecodeProgram {
	const b = new BytecodeBuilder();
	b.reset();
	b.emitOpcode(OpCode.PUSH_NUMBER);
	b.emitNumber(1);
	b.emitOpcode(OpCode.HALT);
	return b.build();
}

/** `LOAD_GLOBAL_VAR x; HALT`. */
function globalReadProgram(): BytecodeProgram {
	const b = new BytecodeBuilder();
	b.reset();
	b.emitOpcode(OpCode.LOAD_GLOBAL_VAR);
	b.emitString("x");
	b.emitOpcode(OpCode.HALT);
	return b.build();
}

/** `PUSH_NUMBER 1; STORE_VAR x; HALT`. */
function storeProgram(): BytecodeProgram {
	const b = new BytecodeBuilder();
	b.reset();
	b.emitOpcode(OpCode.PUSH_NUMBER);
	b.emitNumber(1);
	b.emitOpcode(OpCode.STORE_VAR);
	b.emitString("x");
	b.emitOpcode(OpCode.HALT);
	return b.build();
}

/** `PUSH_NUMBER 1; CALL_PLUGIN 250 1; HALT`, so `hasAsync` is set. */
function pluginCallProgram(): BytecodeProgram {
	const b = new BytecodeBuilder();
	b.reset();
	b.emitOpcode(OpCode.PUSH_NUMBER);
	b.emitNumber(1);
	b.emitOpcode(OpCode.CALL_PLUGIN);
	b.emitByte(250);
	b.emitByte(1);
	b.emitOpcode(OpCode.HALT);
	return b.build();
}

describe("a resolver that names the opcodes it watches", () => {
	test("is not asked about a line without them, and is about a line with them", () => {
		const engine = newTrackedEngine();
		const { resolver, calls } = countingResolver("gate-store", [OpCode.STORE_VAR]);
		engine.registerPackage({ name: "gate-store-test", asyncResolvers: [resolver] });

		expect(engine.evaluateLine(1, "10 + 20").toNumber()).toBe(30);
		expect(calls()).toBe(0);

		expect(engine.evaluateLine(2, ":gate = 5").toNumber()).toBe(5);
		expect(calls()).toBe(1);
	});

	test("a resolver that declares nothing is asked about every line, as before", () => {
		const engine = newTrackedEngine();
		const { resolver, calls } = countingResolver("gate-everything");
		engine.registerPackage({ name: "gate-everything-test", asyncResolvers: [resolver] });

		engine.evaluateLine(1, "10 + 20");
		expect(calls()).toBe(1);
	});

	test("a plugin call is preflighted by every resolver, whatever it declared", () => {
		const engine = newTrackedEngine();
		const { resolver, calls } = countingResolver("gate-store", [OpCode.STORE_VAR]);
		engine.registerPackage({ name: "gate-store-test", asyncResolvers: [resolver] });

		// `prev` compiles to a plugin call (program.hasAsync) and reaches the
		// preflight without a document; it answers with an error Value there.
		engine.evaluateLine(1, "prev");
		expect(calls()).toBe(1);
	});
});

describe("cancellation state", () => {
	test("a plain line runs under one shared, never-aborted signal", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "10 + 20");
		const first = engine.getVM().activeSignal;
		engine.evaluateLine(2, "30 + 40");
		expect(engine.getVM().activeSignal).toBe(first);
		expect(first?.aborted).toBe(false);
	});

	test("a plugin call gets a fresh signal on every evaluation", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "10 + 20");
		const shared = engine.getVM().activeSignal;
		engine.evaluateLine(2, "prev");
		const first = engine.getVM().activeSignal;
		engine.evaluateLine(3, "prev");
		const second = engine.getVM().activeSignal;
		expect(first).not.toBe(shared);
		expect(second).not.toBe(shared);
		expect(second).not.toBe(first);
	});

	test("a plain line links nothing to the keystroke signal; a plugin call links and unlinks", () => {
		const engine = newTrackedEngine();
		const keystroke = new AbortController();
		const add = jest.spyOn(keystroke.signal, "addEventListener");
		const remove = jest.spyOn(keystroke.signal, "removeEventListener");
		engine.setKeystrokeSignal(keystroke.signal);
		try {
			engine.evaluateLine(1, "10 + 20");
			expect(add).not.toHaveBeenCalled();
			expect(remove).not.toHaveBeenCalled();

			// The preflight and the execution each link once and, since the
			// call settles synchronously, each unlink once.
			engine.evaluateLine(2, "prev");
			expect(add.mock.calls.length).toBeGreaterThan(0);
			expect(remove.mock.calls.length).toBe(add.mock.calls.length);
		} finally {
			engine.setKeystrokeSignal(null);
		}
	});

	test("a cached plugin-call line keeps its full preflight and signal on re-evaluation", () => {
		const engine = newTrackedEngine();
		const { resolver, calls } = countingResolver("gate-store", [OpCode.STORE_VAR]);
		engine.registerPackage({ name: "gate-store-test", asyncResolvers: [resolver] });

		engine.evaluateLine(1, "prev");
		expect(calls()).toBe(1);
		expect(engine.reEvaluateLine(1, "prev")).toBeDefined();
		expect(calls()).toBe(2);

		engine.evaluateLine(2, "10 + 20");
		expect(engine.reEvaluateLine(2, "10 + 20")?.toNumber()).toBe(30);
		expect(calls()).toBe(2);
	});
});

describe("the built-in resolver shapes declare what their scanners read", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	test("createQueryResolver watches the plugin-call opcodes", () => {
		const { resolver } = createQueryResolver({
			namespace: "gate-query",
			pluginFunctionIndex: 250,
			fetchQuery: async () => numberValue(1),
		});
		expect(resolver.watchedOpcodes).toEqual([OpCode.CALL_PLUGIN, OpCode.CALL_PLUGIN_WIDE]);
	});

	test("the currency resolver watches PUSH_STRING, which every unit name arrives as", () => {
		const engine = newTrackedEngine();
		const [live, historical] = CURRENCY_PACKAGE.asyncResolvers!.map((r) => jest.spyOn(r, "preflight").mockReturnValue(null));

		engine.evaluateLine(1, "10 + 20");
		expect(live).not.toHaveBeenCalled();
		expect(historical).not.toHaveBeenCalled();

		// Both conversion shapes its scan handles reach it; the historical
		// resolver watches the plugin call its own grammar emits, so neither
		// of these is its business.
		engine.evaluateLine(2, "100 USD in GBP");
		engine.evaluateLine(3, "0.01 BTC + 1 ETH");
		expect(live).toHaveBeenCalledTimes(2);
		expect(historical).not.toHaveBeenCalled();
	});

	test("a query resolver is reached by its own syntax and by nothing else", () => {
		const engine = newTrackedEngine();
		const spy = jest.spyOn(WEATHER_PACKAGE.asyncResolvers![0], "preflight").mockReturnValue(null);

		engine.evaluateLine(1, "10 + 20");
		// A unit literal carries PUSH_STRING, which opens the preflight for the
		// currency resolver but not for one that watches the plugin call.
		engine.evaluateLine(2, "5 km + 3 m");
		expect(spy).not.toHaveBeenCalled();

		engine.evaluateLine(3, "weather in London");
		expect(spy).toHaveBeenCalledTimes(1);
	});

	test("a global read is still intercepted before the VM", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateLine(1, "global :gateNeverDeclared").type).toBe(ValueType.Pending);
	});

	test("a diagnostic run reports the skipped preflight with the real resolver count", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES, diagnostics: true });
		try {
			const result = engine.evaluateLineWithDebug(1, "10 + 20");
			const stage = result.diagnostic!.stages.find((s) => s.stage === "async_preflight");
			const output = stage!.output as { skippedGuard: boolean; resolverCount: number };
			expect(output.skippedGuard).toBe(true);
			expect(output.resolverCount).toBeGreaterThan(0);
		} finally {
			engine.clear();
		}
	});
});

describe("the registry", () => {
	function preflightAll(registry: ResolverRegistry, program: BytecodeProgram, client: QueryClient) {
		return registry.preflightAll([], program, "_engine", new AbortController().signal, client);
	}

	test("an empty registry, or one holding only a resolver without a preflight, intercepts nothing", () => {
		const registry = new ResolverRegistry();
		expect(registry.mayIntercept(plainProgram())).toBe(false);
		registry.register({ namespace: "passive", destroy() {} });
		expect(registry.mayIntercept(globalReadProgram())).toBe(false);
	});

	test("a resolver that declares nothing may intercept any program", () => {
		const registry = new ResolverRegistry();
		registry.register(countingResolver("everything").resolver);
		expect(registry.mayIntercept(plainProgram())).toBe(true);
	});

	test("a declared resolver may intercept only a program carrying one of its opcodes", () => {
		const registry = new ResolverRegistry();
		registry.register(countingResolver("globals", [OpCode.LOAD_GLOBAL_VAR]).resolver);
		expect(registry.mayIntercept(plainProgram())).toBe(false);
		expect(registry.mayIntercept(globalReadProgram())).toBe(true);
	});

	test("a program's scan is forgotten when the resolver set changes", () => {
		const registry = new ResolverRegistry();
		const program = globalReadProgram();
		registry.register(countingResolver("globals", [OpCode.LOAD_GLOBAL_VAR]).resolver);
		expect(registry.mayIntercept(program)).toBe(true);

		registry.unregister("globals");
		expect(registry.mayIntercept(program)).toBe(false);

		registry.register(countingResolver("stores", [OpCode.STORE_VAR]).resolver);
		expect(registry.mayIntercept(program)).toBe(false);
		expect(registry.mayIntercept(storeProgram())).toBe(true);

		registry.clear();
		expect(registry.mayIntercept(storeProgram())).toBe(false);
	});

	test("preflightAll asks only the resolvers a program could belong to", () => {
		const registry = new ResolverRegistry();
		const client = new QueryClient();
		try {
			const globals = countingResolver("globals", [OpCode.LOAD_GLOBAL_VAR]);
			const stores = countingResolver("stores", [OpCode.STORE_VAR]);
			const everything = countingResolver("everything");
			registry.register(globals.resolver);
			registry.register(stores.resolver);
			registry.register(everything.resolver);

			expect(preflightAll(registry, globalReadProgram(), client)).toBeNull();
			expect([globals.calls(), stores.calls(), everything.calls()]).toEqual([1, 0, 1]);

			expect(preflightAll(registry, plainProgram(), client)).toBeNull();
			expect([globals.calls(), stores.calls(), everything.calls()]).toEqual([1, 0, 2]);
		} finally {
			client.clear();
		}
	});

	test("preflightAll asks every resolver about a plugin call", () => {
		const registry = new ResolverRegistry();
		const client = new QueryClient();
		try {
			const stores = countingResolver("stores", [OpCode.STORE_VAR]);
			registry.register(stores.resolver);
			expect(preflightAll(registry, pluginCallProgram(), client)).toBeNull();
			expect(stores.calls()).toBe(1);
		} finally {
			client.clear();
		}
	});
});
