/**
 * Off-main-thread evaluation, proven on one thread.
 *
 * The harness is a message-passing wrapper: a document parsed through the
 * worker proxy must come back exactly as the synchronous path produced it, only
 * as a serialisable DTO rather than a live `Value`. These tests run the whole
 * protocol over an in-process linked transport (which clones every message the
 * way `postMessage` does), so the round-trip, the DTO's clone-safety, and
 * cancellation are all deterministic, no real thread, timer, or network.
 *
 * The two properties that matter most:
 *   1. worker DTO deep-equals the synchronous result run through the same
 *      serialiser, so the boundary changes nothing but the representation, and
 *   2. that DTO survives both `structuredClone` and `JSON`, which a raw `Value`
 *      (BigInt, matrix objects, symbolic trees, exact sidecars) does not.
 */

import { describe, expect, test, afterEach } from "@jest/globals";
import {
	createWorkerEngine,
	startWorkerRuntime,
	createLinkedTransports,
	serializeValue,
	serializeParsedLine,
	serializeParsingResult,
	type WorkerEngine,
	type WorkerEngineOptions,
	type SerializedValue,
	type WorkerAsyncUpdate,
	type WorkerAsyncError,
} from "@solve-js/worker";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import {
	ValueType,
	bigIntValue,
	stringValue,
	boolValue,
	uomValue,
	matrixValue,
	rangeValue,
	numberValue,
	type Value,
} from "@solve-js/vm/Value";
import { EngineError, ErrorFactory, WorkerErrorCodes } from "@solve-js/errors";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";
import type { IAsyncResolver, AsyncCheckResult } from "@solve-js/resolvers/ResolverRegistry";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { allocatePluginFunctionIndex } from "@solve-js/vm/VMBuiltins";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

// ── Test harness: a client and runtime linked on one thread ─────────────

interface Harness {
	engine: WorkerEngine;
	dispose: () => void;
}

/** Spin up a linked client/runtime pair and wait for the engine to be ready. */
async function makeWorker(options: Partial<WorkerEngineOptions> = {}): Promise<Harness> {
	const { client, host } = createLinkedTransports();
	const stopRuntime = startWorkerRuntime(host);
	const engine = await createWorkerEngine({ transport: client, ...options });
	return {
		engine,
		// Terminating the client rejects any stragglers; stopping the runtime
		// clears its engine so no batcher or query timer outlives the test.
		dispose: () => {
			engine.terminate();
			stopRuntime();
		},
	};
}

/** Track the synchronous engines a test builds so they are all cleared afterwards. */
const syncEngines: ExpressionEngine[] = [];
function syncEngine(): ExpressionEngine {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	syncEngines.push(engine);
	return engine;
}

const disposers: Array<() => void> = [];
async function worker(options?: Partial<WorkerEngineOptions>): Promise<WorkerEngine> {
	const harness = await makeWorker(options);
	disposers.push(harness.dispose);
	return harness.engine;
}

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	for (const engine of syncEngines.splice(0)) engine.clear();
});

// A document deliberately spread across value kinds, and one deliberately
// broken line. Nothing here depends on the clock, randomness, or the network,
// so the two engines cannot disagree for any reason but a real bug.
const RICH_DOCUMENT = [
	"10 + 5 * 2",
	"100 - 42",
	"2 km in meters",
	"50% of 200",
	"[1, 2; 3, 4]",
	"[1, 2] + [3, 4]",
	"1:5",
	"5 > 3",
	'"hello"',
	"sqrt(2)",
	"1/3",
	"- 100 + 20",
	"s`2 + 3`",
	"2 +",
].join("\n");

// ── Serialiser: the DTO for each value kind ─────────────────────────────

describe("serializeValue produces a clone-safe DTO", () => {
	/** Every DTO must survive both structured clone and a JSON round-trip. */
	function expectPortable(dto: SerializedValue): void {
		expect(structuredClone(dto)).toEqual(dto);
		expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
	}

	test("a plain number", () => {
		const dto = serializeValue(numberValue(42));
		expect(dto.type).toBe(ValueType.Number);
		expect(dto.number).toBe(42);
		expect(dto.bigint).toBeUndefined();
		expectPortable(dto);
	});

	test("a bigint crosses as a base-ten string, not a BigInt", () => {
		const huge = 123456789012345678901234567890n;
		const dto = serializeValue(bigIntValue(huge));
		expect(dto.type).toBe(ValueType.BigInt);
		expect(dto.bigint).toBe(huge.toString());
		// The value that breaks a naive JSON.stringify is exactly the one the
		// DTO carries as a string, so the round-trip holds.
		expectPortable(dto);
	});

	test("a string", () => {
		const dto = serializeValue(stringValue("hello"));
		expect(dto.type).toBe(ValueType.String);
		expect(dto.text).toContain("hello");
		expectPortable(dto);
	});

	test("a boolean reads as 1 or 0 numerically", () => {
		expect(serializeValue(boolValue(true)).number).toBe(1);
		expect(serializeValue(boolValue(false)).number).toBe(0);
		expectPortable(serializeValue(boolValue(true)));
	});

	test("a unit-of-measurement value keeps its unit", () => {
		const dto = serializeValue(uomValue(5, "kg"));
		expect(dto.type).toBe(ValueType.Uom);
		expect(dto.unit).toBe("kg");
		expect(dto.number).toBe(5);
		expectPortable(dto);
	});

	test("a matrix flattens to shape and cells", () => {
		const dto = serializeValue(matrixValue(2, 2, [1, 3, 2, 4]));
		expect(dto.type).toBe(ValueType.Matrix);
		expect(dto.matrix).toEqual({ rows: 2, cols: 2, cells: [1, 3, 2, 4], hasSymbolic: false });
		expectPortable(dto);
	});

	test("a range carries its bounds", () => {
		const dto = serializeValue(rangeValue(1, 5));
		expect(dto.type).toBe(ValueType.Range);
		expect(dto.range).toEqual({ min: 1, max: 5 });
		expectPortable(dto);
	});
});

// ── Proxy round-trip: worker equals synchronous ─────────────────────────

describe("the worker proxy matches the synchronous path", () => {
	test("parseDocument returns the same result, as a DTO", async () => {
		const engine = await worker();
		const result = await engine.parseDocument(RICH_DOCUMENT);

		const expected = serializeParsingResult(syncEngine().parseDocument(RICH_DOCUMENT));
		expect(result).toEqual(expected);

		// The whole document survives both boundaries a host might send it across.
		expect(structuredClone(result)).toEqual(result);
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});

	test("parseDocument preserves per-line structure and the broken line's error", async () => {
		const engine = await worker();
		const result = await engine.parseDocument(RICH_DOCUMENT);

		expect(result.totalLines).toBe(14);
		expect(result.lines).toHaveLength(14);

		// "10 + 5 * 2" is a whole-line expression.
		const first = result.lines[0];
		expect(first.expression).toBe("10 + 5 * 2");
		expect(first.result?.number).toBe(20);

		// The inline-solve line carries its embedded expression (`s`2 + 3``),
		// not a whole-line one, and its result crosses inside the DTO.
		const inline = result.lines[12];
		expect(inline.hasInlineSolves).toBe(true);
		expect(inline.inlineSolves).toHaveLength(1);
		expect(inline.inlineSolves[0].expression).toBe("2 + 3");
		expect(inline.inlineSolves[0].result?.number).toBe(5);

		// "2 +" is a parse error surfaced on the line, and echoed in the top-level list.
		const broken = result.lines[13];
		expect(broken.error).not.toBeNull();
		expect(result.errors.some((message) => message.includes("Line 14"))).toBe(true);
	});

	test("evaluateExpression returns the result DTO", async () => {
		const engine = await worker();
		const value = await engine.evaluateExpression("2 + 2 * 10");
		expect(value.number).toBe(22);

		const expected = syncEngine().evaluateExpression("2 + 2 * 10");
		expect(value).toEqual(serializeValue(expected));
	});

	test("evaluateLines matches the synchronous per-line results", async () => {
		const lines = [":total = 10 + 5", "total * 2", "3 km in meters"];
		const engine = await worker();
		const result = await engine.evaluateLines(lines);

		const expected = syncEngine().evaluateLines(lines).map((line) => serializeParsedLine(line));
		expect(result).toEqual(expected);
		expect(structuredClone(result)).toEqual(result);
	});
});

// ── Cancellation maps onto the boundary ─────────────────────────────────

describe("cancellation", () => {
	test("aborting rejects the request with a structured cancelled error", async () => {
		const engine = await worker();
		const controller = new AbortController();
		const pending = engine.parseDocument(RICH_DOCUMENT, { signal: controller.signal });
		// Abort before the request is even delivered; the promise must still reject.
		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(EngineError);
		await expect(pending).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_CANCELLED });
	});

	test("an already-aborted signal rejects immediately", async () => {
		const engine = await worker();
		const aborted = AbortSignal.abort();
		await expect(engine.evaluateExpression("1 + 1", { signal: aborted })).rejects.toMatchObject({
			code: WorkerErrorCodes.WORKER_CANCELLED,
		});
	});

	test("an un-aborted signal lets the request complete normally", async () => {
		const engine = await worker();
		const controller = new AbortController();
		const value = await engine.evaluateExpression("6 * 7", { signal: controller.signal });
		expect(value.number).toBe(42);
	});
});

// ── Failures surface as structured errors, not lost promises ────────────

describe("worker-side failures", () => {
	test("a parse error rejects with an EngineError carrying its category", async () => {
		const engine = await worker();
		const rejection = engine.evaluateExpression("2 +");

		await expect(rejection).rejects.toBeInstanceOf(EngineError);
		await rejection.catch((error: EngineError) => {
			expect(error.category).toBe("PARSING");
			expect(error.code).toBeTruthy();
		});
	});

	test("a document over the line limit rejects rather than hanging", async () => {
		const engine = await worker({ config: { performance: { maxDocumentLines: 3 } } });
		await expect(engine.parseDocument("1\n2\n3\n4\n5")).rejects.toMatchObject({
			code: "DOCUMENT_TOO_LARGE",
		});
	});
});

// ── Request correlation and lifecycle ───────────────────────────────────

describe("request correlation", () => {
	test("concurrent requests each resolve to their own answer", async () => {
		const engine = await worker();
		const [a, b, doc] = await Promise.all([
			engine.evaluateExpression("2 + 2"),
			engine.evaluateExpression("10 * 10"),
			engine.parseDocument("7 + 1"),
		]);

		expect(a.number).toBe(4);
		expect(b.number).toBe(100);
		expect(doc.lines[0].result?.number).toBe(8);
	});
});

describe("lifecycle", () => {
	test("terminate rejects an in-flight request", async () => {
		const { engine, dispose } = await makeWorker();
		const controller = new AbortController();
		// Hold the request open with a signal, then tear the engine down.
		const pending = engine.parseDocument(RICH_DOCUMENT, { signal: controller.signal });
		engine.terminate();
		await expect(pending).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_TERMINATED });
		dispose();
	});

	test("a call after terminate rejects", async () => {
		const { engine, dispose } = await makeWorker();
		engine.terminate();
		await expect(engine.evaluateExpression("1 + 1")).rejects.toMatchObject({
			code: WorkerErrorCodes.WORKER_TERMINATED,
		});
		dispose();
	});
});

// ── Package selection crosses as names ──────────────────────────────────

describe("package selection", () => {
	test("selecting every built-in by name evaluates identically", async () => {
		const names = BUILTIN_PACKAGES.map((pkg) => pkg.name);
		const engine = await worker({ packages: names });
		const value = await engine.evaluateExpression("2 + 2 * 10");
		expect(value.number).toBe(22);
	});

	test("an unknown package name fails init with a structured error", async () => {
		const { client, host } = createLinkedTransports();
		const stopRuntime = startWorkerRuntime(host);
		try {
			await expect(
				createWorkerEngine({ transport: client, packages: ["NOT_A_REAL_PACKAGE"] }),
			).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_UNKNOWN_PACKAGE });
		} finally {
			stopRuntime();
		}
	});
});

// ── Async live-data resolutions stream across the boundary ──────────────
//
// The acid test for this feature: a value that resolves inside the worker AFTER
// a request already answered (a currency rate, weather, a historical FX rate)
// must reach the host. Everything below drives a stubbed async resolver to
// completion over the in-process linked transport, so the whole path (pending
// result home, resolution worker-side, re-evaluation, DTO back across, callback)
// runs with no real timer or network.

/**
 * A package whose one async function, `live price of <symbol>`, resolves through
 * a caller-supplied `fetchQuery`. Built on the same `createQueryResolver` +
 * `CALL_PLUGIN` machinery the real weather and stocks packages use, so the value
 * flows through the engine exactly as a production live-data value does: pending
 * on first evaluation, cached by the resolver, read back on re-evaluation.
 */
function livePriceParselet(pluginFnIdx: number): PrefixParselet {
	return {
		category: "LivePrice",
		parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
			// Consume the symbol word(s) after the trigger phrase, the same greedy
			// city-name consumption the weather parselet does.
			const words: string[] = [];
			while (parser.peek()?.type === "IDENT") words.push(parser.consume().value);
			if (words.length === 0) {
				throw ErrorFactory.parsing(
					"LIVEPRICE_EXPECTED_SYMBOL",
					`Expected a symbol after "${token.value}" (e.g. "${token.value} gold")`,
				);
			}
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(words.join(" "));
			builder.emitOpcode(OpCode.CALL_PLUGIN);
			builder.emitIndex(pluginFnIdx);
			builder.emitIndex(1);
		},
	};
}

function createLivePricePackage(fetchQuery: (query: string, signal: AbortSignal) => Promise<Value>): IEnginePackage {
	const fnIdx = allocatePluginFunctionIndex();
	const { resolver, pluginFunction } = createQueryResolver({
		namespace: "liveprice",
		pluginFunctionIndex: fnIdx,
		fetchQuery,
	});
	return {
		name: "solve-liveprice-test",
		phrases: { "live price of": "LIVE_PRICE_OF" },
		prefixParselets: [{ tokenType: "LIVE_PRICE_OF", parselet: livePriceParselet(fnIdx) }],
		pluginFunctions: [{ index: fnIdx, handler: pluginFunction }],
		asyncResolvers: [resolver],
	};
}

/**
 * A low-level resolver that returns a caller-controlled result for every line,
 * for the cases that need a resolver to REJECT (which `createQueryResolver`
 * never does, it turns a failed fetch into an error Value instead). The returned
 * `signal` is the engine's own preflight signal, so staleness works the way it
 * does for a real resolver.
 */
function createRejectingResolverPackage(queryKey: string, packageId: string, rejection: Promise<Value>): IEnginePackage {
	// Fire once, exactly as a real resolver does: it returns pending only while
	// data is missing and null once the outcome (here, a failure) is settled. A
	// resolver that returned pending on every preflight would make any re-evaluating
	// host re-trigger it in a loop, which is not a shape the engine supports.
	let fired = false;
	const resolver: IAsyncResolver = {
		namespace: "rejecting",
		preflight(_tokens, _bytecode, _packageId, signal): AsyncCheckResult | null {
			if (fired) return null;
			fired = true;
			return { queryKey, resolver: rejection, packageId, signal };
		},
		destroy() {},
	};
	return { name: "solve-rejecting-test", asyncResolvers: [resolver] };
}

/** Spin up a streaming worker over a linked transport with the given package registered. */
async function streamingWorker(pkg: IEnginePackage): Promise<WorkerEngine> {
	const { client, host } = createLinkedTransports();
	const stopRuntime = startWorkerRuntime(host, { packages: [pkg] });
	const engine = await createWorkerEngine({ transport: client });
	disposers.push(() => {
		engine.terminate();
		stopRuntime();
	});
	return engine;
}

/** A synchronous engine registered with one extra package, tracked for cleanup. */
function syncEngineWith(pkg: IEnginePackage): ExpressionEngine {
	const engine = new ExpressionEngine({ packages: [pkg] });
	syncEngines.push(engine);
	return engine;
}

/** Flush the microtask queue a few times, enough for a whole resolution to settle. */
async function flushMicrotasks(times = 8): Promise<void> {
	for (let i = 0; i < times; i++) await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe("async live-data resolutions stream back", () => {
	test("a resolved live value crosses the boundary through onResolved and matches the sync path", async () => {
		const RESOLVED = numberValue(1975.5);
		let release!: (value: Value) => void;
		const gate = new Promise<Value>((resolve) => {
			release = resolve;
		});
		const pkg = createLivePricePackage(() => gate);
		const engine = await streamingWorker(pkg);

		// The subscription is not tied to the parseDocument request that armed it.
		const firstUpdate = new Promise<WorkerAsyncUpdate[]>((resolve) => engine.onResolved(resolve));

		const doc = await engine.parseDocument("live price of gold");
		// The synchronous answer is pending: the value has not resolved yet.
		expect(doc.lines[0].result?.type).toBe(ValueType.Pending);

		// Drive the resolver to completion; the value now lands worker-side.
		release(RESOLVED);
		const lines = await firstUpdate;

		expect(lines).toHaveLength(1);
		expect(lines[0].lineNumber).toBe(1);
		expect(lines[0].value.number).toBe(1975.5);

		// The update survives both boundaries a host might send it across.
		expect(structuredClone(lines)).toEqual(lines);
		expect(JSON.parse(JSON.stringify(lines))).toEqual(lines);

		// It equals the value the synchronous path produces once the same data is
		// cached: the boundary changed the representation, nothing else.
		const sync = syncEngineWith(pkg);
		sync.queryClient.setQueryData(["liveprice", "gold"], RESOLVED);
		const [syncLine] = sync.evaluateLines(["live price of gold"]);
		expect(lines[0].value).toEqual(serializeValue(syncLine.result!));
	});

	test("a resolution across evaluateExpression reaches its -1 line", async () => {
		const RESOLVED = numberValue(42);
		let release!: (value: Value) => void;
		const gate = new Promise<Value>((resolve) => {
			release = resolve;
		});
		const engine = await streamingWorker(createLivePricePackage(() => gate));

		const firstUpdate = new Promise<WorkerAsyncUpdate[]>((resolve) => engine.onResolved(resolve));
		const pending = await engine.evaluateExpression("live price of silver");
		expect(pending.type).toBe(ValueType.Pending);

		release(RESOLVED);
		const lines = await firstUpdate;
		expect(lines[0].lineNumber).toBe(-1);
		expect(lines[0].value.number).toBe(42);
	});

	test("a failed live resolution crosses as a structured async-error", async () => {
		const rejection = Promise.reject(new Error("upstream returned 503"));
		// Swallow the top-level rejection; the engine awaits it and reports the
		// failure through its own error channel.
		rejection.catch(() => {});
		const pkg = createRejectingResolverPackage("err:key", "test-errpkg", rejection as Promise<Value>);
		const engine = await streamingWorker(pkg);

		const failure = new Promise<WorkerAsyncError>((resolve) => engine.onAsyncError(resolve));
		// Any line triggers this resolver's preflight; a bare number is enough.
		await engine.evaluateExpression("50");

		const error = await failure;
		expect(error.queryKey).toBe("err:key");
		expect(error.packageId).toBe("test-errpkg");
		expect(error.error).toBeInstanceOf(EngineError);
		expect(error.error.message).toContain("503");
	});

	test("a superseded document's stale resolution does not reach the host", async () => {
		const RESOLVED = numberValue(1975.5);
		let release!: (value: Value) => void;
		const gate = new Promise<Value>((resolve) => {
			release = resolve;
		});
		const engine = await streamingWorker(createLivePricePackage(() => gate));

		let updates = 0;
		engine.onResolved(() => {
			updates++;
		});

		// Document A uses the live value and goes pending.
		const docA = await engine.parseDocument("live price of gold");
		expect(docA.lines[0].result?.type).toBe(ValueType.Pending);

		// Document B supersedes A before A's value lands. B uses no live data.
		await engine.parseDocument("42");

		// A's fetch completes now, but A was superseded, so its resolution must be
		// dropped rather than delivered against the current document.
		release(RESOLVED);
		await flushMicrotasks();

		expect(updates).toBe(0);
	});

	test("a fresh document after a superseded one still streams its own resolution", async () => {
		// The other side of staleness: superseding must not wedge the pump. On the
		// SAME worker, document A is left pending when B supersedes it, and document
		// B's own live value still has to arrive. One fetchQuery routes each symbol
		// to its gate.
		let releaseGold!: (value: Value) => void;
		let releaseSilver!: (value: Value) => void;
		const goldGate = new Promise<Value>((resolve) => {
			releaseGold = resolve;
		});
		const silverGate = new Promise<Value>((resolve) => {
			releaseSilver = resolve;
		});
		const gateFor = (query: string): Promise<Value> => (query === "silver" ? silverGate : goldGate);
		const engine = await streamingWorker(createLivePricePackage((query) => gateFor(query)));

		await engine.parseDocument("live price of gold"); // pending

		const update = new Promise<WorkerAsyncUpdate[]>((resolve) => engine.onResolved(resolve));
		const doc = await engine.parseDocument("live price of silver"); // supersedes A
		expect(doc.lines[0].result?.type).toBe(ValueType.Pending);

		// Gold resolves too, but its document was superseded, so it is dropped;
		// silver belongs to the current document and comes through.
		releaseGold(numberValue(999));
		releaseSilver(numberValue(30.25));
		const lines = await update;
		expect(lines[0].lineNumber).toBe(1);
		expect(lines[0].value.number).toBe(30.25);
	});
});
