import { afterEach, describe, expect, jest, test } from "@jest/globals";

/**
 * Proactive background refresh (issue #212).
 *
 * The engine's async resolution is pull-based: a live value refetches only when
 * a line is re-evaluated and it has gone stale, so a note left open ages. This
 * suite covers the opt-in feature that closes that gap:
 *
 * - the {@link BackgroundRefreshManager} in isolation (the timers, change
 *   detection, liveness, back-pressure and teardown that are the whole of the
 *   new logic),
 * - the resolver surface (`refetchIntervalMs` producing a working `refetch`),
 * - and the engine wiring (off by default, present only when enabled, and
 *   stopped on clear).
 *
 * The two paths are independent by design: `staleTimeMs` still governs the pull
 * path, `refetchIntervalMs` adds the push path, and a resolver may set either or
 * both.
 */
import { BackgroundRefreshManager } from "@solve-js/engine/BackgroundRefreshManager";
import type { DependencyGraph } from "@solve-js/vm/DependencyGraph";
import { QueryClient } from "@tanstack/query-core";
import { setActiveQueryClient } from "@solve-js/services/DataQueryService";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { IAsyncResolver } from "@solve-js/resolvers/ResolverRegistry";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { AsyncResolutionEvent, LinesUpdatedEvent } from "@solve-js/engine/AsyncResolutionBatcher";
import { Value, numberValue } from "@solve-js/vm/Value";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

// ── Helpers ────────────────────────────────────────────────────────────

/** A dependency graph stub whose liveness answer is controlled by `isLive`. */
function fakeDag(isLive: () => boolean): DependencyGraph {
	return {
		getAffectedLinesByDataSource: () => (isLive() ? new Set([1]) : new Set<number>()),
	} as unknown as DependencyGraph;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Builds PUSH_STRING(query), CALL_PLUGIN(fnIdx, 1), HALT — the shape createQueryResolver's preflight scans for. */
function buildQueryBytecode(query: string, fnIdx: number) {
	const builder = new BytecodeBuilder();
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(query);
	builder.emitOpcode(OpCode.CALL_PLUGIN);
	builder.emitByte(fnIdx);
	builder.emitByte(1);
	builder.emitOpcode(OpCode.HALT);
	return builder.build();
}

// ══════════════════════════════════════════════════════════════════════════
// §1  The manager in isolation
// ══════════════════════════════════════════════════════════════════════════

describe("BackgroundRefreshManager", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	test("refetches on the interval and re-renders only when the value changes", async () => {
		jest.useFakeTimers();
		const values = [numberValue(1), numberValue(2), numberValue(2), numberValue(3)];
		let i = 0;
		const refetch = jest.fn(async () => values[Math.min(i++, values.length - 1)]);
		const enqueue = jest.fn();
		const mgr = new BackgroundRefreshManager(fakeDag(() => true), enqueue);

		mgr.register({ packageId: "_engine", queryKey: "test:q", intervalMs: 100, refetch });
		expect(mgr.size).toBe(1);

		await jest.advanceTimersByTimeAsync(100); // 1: first value → re-render
		expect(refetch).toHaveBeenCalledTimes(1);
		expect(enqueue).toHaveBeenCalledWith("_engine", "test:q");

		await jest.advanceTimersByTimeAsync(100); // 2: changed → re-render
		expect(enqueue).toHaveBeenCalledTimes(2);

		await jest.advanceTimersByTimeAsync(100); // 2 again: unchanged → NO re-render
		expect(refetch).toHaveBeenCalledTimes(3);
		expect(enqueue).toHaveBeenCalledTimes(2);

		mgr.clearAll();
	});

	test("stops refreshing a value no line references any more, without touching the network", async () => {
		jest.useFakeTimers();
		let live = true;
		const refetch = jest.fn(async () => numberValue(1));
		const mgr = new BackgroundRefreshManager(fakeDag(() => live), jest.fn());

		mgr.register({ packageId: "_engine", queryKey: "test:q", intervalMs: 100, refetch });
		await jest.advanceTimersByTimeAsync(100);
		expect(refetch).toHaveBeenCalledTimes(1);

		live = false; // the reader edited the live line away
		await jest.advanceTimersByTimeAsync(100); // this tick finds it dead: stop, no fetch
		expect(mgr.size).toBe(0);
		await jest.advanceTimersByTimeAsync(300);
		expect(refetch).toHaveBeenCalledTimes(1);
	});

	test("skips a tick while its own previous refetch is still in flight", async () => {
		jest.useFakeTimers();
		let release: (v: Value) => void = () => {};
		let slow = new Promise<Value>((r) => (release = r));
		const refetch = jest.fn(() => slow);
		const mgr = new BackgroundRefreshManager(fakeDag(() => true), jest.fn());

		mgr.register({ packageId: "_engine", queryKey: "test:q", intervalMs: 100, refetch });
		await jest.advanceTimersByTimeAsync(100); // tick 1: starts the slow fetch
		await jest.advanceTimersByTimeAsync(100); // tick 2: in flight → skipped
		expect(refetch).toHaveBeenCalledTimes(1);

		release(numberValue(1)); // let it finish
		await Promise.resolve();
		slow = Promise.resolve(numberValue(2));
		await jest.advanceTimersByTimeAsync(100); // tick 3: free again → refetch
		expect(refetch).toHaveBeenCalledTimes(2);

		mgr.clearAll();
	});

	test("a failing refetch is swallowed and polling continues", async () => {
		jest.useFakeTimers();
		let call = 0;
		const refetch = jest.fn(async () => {
			call++;
			if (call === 1) throw new Error("network down");
			return numberValue(call);
		});
		const enqueue = jest.fn();
		const mgr = new BackgroundRefreshManager(fakeDag(() => true), enqueue);

		mgr.register({ packageId: "_engine", queryKey: "test:q", intervalMs: 100, refetch });
		await jest.advanceTimersByTimeAsync(100); // throws → swallowed
		expect(enqueue).not.toHaveBeenCalled();
		expect(mgr.size).toBe(1);
		await jest.advanceTimersByTimeAsync(100); // recovers → re-render
		expect(enqueue).toHaveBeenCalledTimes(1);

		mgr.clearAll();
	});

	test("clearAll stops every timer", async () => {
		jest.useFakeTimers();
		const refetch = jest.fn(async () => numberValue(1));
		const mgr = new BackgroundRefreshManager(fakeDag(() => true), jest.fn());
		mgr.register({ packageId: "_engine", queryKey: "a", intervalMs: 100, refetch });
		mgr.register({ packageId: "_engine", queryKey: "b", intervalMs: 100, refetch });
		expect(mgr.size).toBe(2);

		mgr.clearAll();
		expect(mgr.size).toBe(0);
		await jest.advanceTimersByTimeAsync(300);
		expect(refetch).not.toHaveBeenCalled();
	});

	test("reconcile drops dead keys at once, and register ignores a non-positive interval and is idempotent", () => {
		let live = true;
		const mgr = new BackgroundRefreshManager(fakeDag(() => live), jest.fn());

		mgr.register({ packageId: "_engine", queryKey: "zero", intervalMs: 0, refetch: async () => numberValue(1) });
		expect(mgr.size).toBe(0); // a non-positive cadence is not a schedule

		mgr.register({ packageId: "_engine", queryKey: "q", intervalMs: 100, refetch: async () => numberValue(1) });
		mgr.register({ packageId: "_engine", queryKey: "q", intervalMs: 100, refetch: async () => numberValue(2) });
		expect(mgr.size).toBe(1); // idempotent per key

		live = false;
		mgr.reconcile();
		expect(mgr.size).toBe(0);
	});
});

// ══════════════════════════════════════════════════════════════════════════
// §2  The resolver surface
// ══════════════════════════════════════════════════════════════════════════

describe("createQueryResolver background-refresh surface", () => {
	test("a cadence produces a refetch that forces a fresh fetch past staleTime", async () => {
		const qc = new QueryClient();
		setActiveQueryClient(qc);
		let n = 0;
		const { resolver } = createQueryResolver({
			namespace: "bg",
			pluginFunctionIndex: 0,
			fetchQuery: async () => numberValue(++n),
			staleTimeMs: 5 * 60 * 1000,
			refetchIntervalMs: 60_000,
		});

		const check = resolver.preflight!([], buildQueryBytecode("AAPL", 0), "_engine", new AbortController().signal, qc);
		expect(check).not.toBeNull();
		expect(check!.refetchIntervalMs).toBe(60_000);
		expect(typeof check!.refetch).toBe("function");

		await check!.resolver; // initial fetch → 1
		const fresh = await check!.refetch!(); // background refetch, staleTime 0 → genuinely refetches → 2
		expect(fresh.toNumber()).toBe(2);

		qc.clear();
	});

	test("no cadence stays pull-only (no refetch surfaced)", async () => {
		const qc = new QueryClient();
		setActiveQueryClient(qc);
		const { resolver } = createQueryResolver({
			namespace: "pull",
			pluginFunctionIndex: 0,
			fetchQuery: async () => numberValue(1),
		});
		const check = resolver.preflight!([], buildQueryBytecode("q", 0), "_engine", new AbortController().signal, qc);
		expect(check!.refetchIntervalMs).toBeUndefined();
		expect(check!.refetch).toBeUndefined();
		await check!.resolver; // settle the in-flight fetch before clearing, or query-core cancels it into an unhandled rejection
		qc.clear();
	});
});

// ══════════════════════════════════════════════════════════════════════════
// §3  Engine wiring
// ══════════════════════════════════════════════════════════════════════════

/** A resolver that fires once (cache-miss shape), declaring a cadence and a distinct background value. */
function oneShotBackgroundResolver(queryKey: string, backgroundValue: Value, intervalMs: number): IAsyncResolver {
	let fired = false;
	return {
		namespace: "bg-test",
		preflight() {
			if (fired) return null; // resolved: let the line settle, keeping its DAG dependency
			fired = true;
			return {
				queryKey,
				resolver: Promise.resolve(numberValue(1)),
				packageId: "_engine",
				signal: new AbortController().signal,
				refetchIntervalMs: intervalMs,
				refetch: async () => backgroundValue,
			};
		},
		destroy() {},
	};
}

function backgroundPackage(resolver: IAsyncResolver): IEnginePackage {
	return { name: "test-bg", asyncResolvers: [resolver] };
}

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("ExpressionEngine background-refresh wiring", () => {
	test("off by default: an async value registers nothing to refresh", async () => {
		const engine = new ExpressionEngine({
			packages: [backgroundPackage(oneShotBackgroundResolver("bg:q", numberValue(99), 1000))],
		});
		engine.evaluateLine(1, "50");
		await tick();
		await tick();
		expect(engine.getBackgroundRefreshCount()).toBe(0);
		engine.clear();
	});

	test("enabled: a value with a cadence is registered, and clear() stops it", async () => {
		const engine = new ExpressionEngine({
			packages: [backgroundPackage(oneShotBackgroundResolver("bg:q", numberValue(99), 1000))],
			config: { backgroundRefresh: { enabled: true } },
		});
		engine.evaluateLine(1, "50");
		await tick();
		await tick();
		expect(engine.getBackgroundRefreshCount()).toBe(1);

		engine.clear();
		expect(engine.getBackgroundRefreshCount()).toBe(0);
	});

	test("enabled: a background refetch pushes a fresh value to the event stream", async () => {
		const engine = new ExpressionEngine({
			packages: [backgroundPackage(oneShotBackgroundResolver("bg:q", numberValue(99), 30))],
			config: { backgroundRefresh: { enabled: true } },
		});
		const events: AsyncResolutionEvent[] = [];
		// Synchronous capture hook the async suite uses; see AsyncPipelineIntegration.
		engine.getBatcher()._testCaptures = events;

		engine.evaluateLine(1, "50");
		await tick();
		await tick();
		expect(engine.getBackgroundRefreshCount()).toBe(1);

		// Let the 30ms cadence fire at least once and the batcher flush.
		await delay(90);
		await tick();

		const updates = events.filter((e) => e.type === "lines-updated") as LinesUpdatedEvent[];
		expect(updates.some((e) => e.affectedQueryKeys.includes("bg:q"))).toBe(true);

		engine.getBatcher()._testCaptures = null;
		engine.clear();
	});
});
