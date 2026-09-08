/**
 * Constructing an engine starts nothing.
 *
 * `AsyncResolutionBatcher` built its event stream in its constructor, so every
 * engine created one whether or not anything ever read it. A `ReadableStream`
 * is not free to build: its start algorithm queues promise reactions, and those
 * are only collected once the host yields to the microtask queue. A host that
 * builds engines in a synchronous loop, a batch job, a test suite, a fuzz
 * runner, a server rendering many documents in one turn, never yields, so the
 * reactions accumulated for the whole loop:
 *
 * | engines built in one synchronous loop | before  | now    |
 * | ---                                   | ---     | ---    |
 * | retained per engine                   | 12.5 KB | 0.1 KB |
 * | 6,400 engines                         | 78 MB   | 0.8 MB |
 *
 * Measured with `--expose-gc`, forcing a collection either side, so the figures
 * are what survives collection rather than what has yet to be collected. It was
 * found by a fuzz runner dying of it: a soak that constructs an engine per case
 * exhausted a 256 MB heap.
 *
 * The stream is built on first use now, and *use* is deliberately wider than
 * *subscribe*. The stream buffers up to its high-water mark with no reader
 * attached, so a consumer that subscribes after some events have already flowed
 * still receives them. Building it only when someone subscribes would have
 * dropped exactly those, so the emit path asks for it too, and the engine that
 * never resolves anything asynchronously and never subscribes is the only one
 * that never builds it. That is the common case, and the point.
 *
 * The boundary: this is about when the stream is built, not whether events are
 * delivered. Every delivery behaviour is unchanged and is covered in
 * `AsyncResolutionBatcher.spec.ts`, including the late subscriber above.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";

/** The batcher's private stream field, which is the thing being deferred. */
function streamOf(engine: ReturnType<typeof createEngine>): unknown {
	return (engine.getBatcher() as unknown as { _eventStream: unknown })._eventStream;
}

describe("constructing an engine", () => {
	test("builds no event stream", () => {
		const engine = createEngine();
		expect(streamOf(engine)).toBeNull();
	});

	test("still builds none after evaluating an ordinary expression", () => {
		// Nothing here resolves asynchronously, so nothing needs a stream. This
		// is the shape of almost every engine ever constructed.
		const engine = createEngine();
		expect(engine.evaluateExpression("2 + 2").toNumber()).toBe(4);
		expect(streamOf(engine)).toBeNull();
	});

	test("builds one as soon as a consumer asks for it", () => {
		const engine = createEngine();
		const stream = engine.getEventStream();
		expect(stream).toBeDefined();
		expect(streamOf(engine)).not.toBeNull();
	});

	test("hands back the same stream every time", () => {
		// A consumer that calls twice must not end up with two streams, one of
		// which receives nothing.
		const engine = createEngine();
		expect(engine.getEventStream()).toBe(engine.getEventStream());
	});

	test("reports no listeners without building one to find out", () => {
		// The count is asked for by hosts that are deciding whether to bother
		// subscribing, so it must not be the thing that creates the stream.
		const engine = createEngine();
		expect(engine.getBatcher().listenerCount).toBe(0);
		expect(streamOf(engine)).toBeNull();
	});

	test("a thousand engines in one synchronous loop stay cheap", () => {
		// The regression this exists to catch, stated as the invariant rather
		// than as a heap measurement: a loop that never yields must not leave a
		// thousand streams behind. Asserted on the engines themselves, because
		// a heap threshold in a shared Jest process is a flaky test, and what
		// went wrong was structural rather than gradual.
		const engines = Array.from({ length: 1000 }, () => createEngine());
		expect(engines.filter((engine) => streamOf(engine) !== null)).toHaveLength(0);
	});
});
