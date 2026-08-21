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
} from "@solve-js/vm/Value";
import { EngineError, WorkerErrorCodes } from "@solve-js/errors";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";

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
	const engine = new ExpressionEngine("en", false);
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

	test("evaluateExpression returns a one-element DTO array", async () => {
		const engine = await worker();
		const [value] = await engine.evaluateExpression("2 + 2 * 10");
		expect(value.number).toBe(22);

		const [expected] = syncEngine().evaluateExpression("2 + 2 * 10");
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
		const [value] = await engine.evaluateExpression("6 * 7", { signal: controller.signal });
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

		expect(a[0].number).toBe(4);
		expect(b[0].number).toBe(100);
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
		const [value] = await engine.evaluateExpression("2 + 2 * 10");
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
