/**
 * A value that cannot be fetched settles, and does not starve the event loop.
 *
 * The re-evaluate loop the async guide tells hosts to write is: read the event
 * stream, and re-evaluate the lines each event names. Against a resolver whose
 * value never becomes ready that was unbounded, and worse than unbounded: every
 * hop of it is a microtask (the resolver's await, the batcher's flush, the
 * stream write, the host's read, the re-evaluation, the next preflight), and the
 * microtask queue is drained to empty before a single timer runs.
 *
 * Measured before the fix: 3,000 rounds in 41 ms, 1,501 preflights, and a
 * `setTimeout(..., 0)` armed before the loop that had still not fired. No
 * watchdog, deadline or test timeout could have interrupted it.
 *
 * Two things fixed it, and the spec pins both, because either alone leaves half
 * the problem: the batcher hands a flush to a macrotask once flushes have
 * chained without the event loop getting a turn, and a value that has failed
 * repeatedly stops being announced, which is what ends the round trip.
 */
import { describe, expect, test, jest } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { IAsyncResolver } from "@solve-js/resolvers/ResolverRegistry";

jest.setTimeout(60_000);

/** A resolver whose value never becomes ready: every preflight starts another failing fetch. */
function neverReadyPackage(counters: { preflights: number }): IEnginePackage {
	const resolver: IAsyncResolver = {
		namespace: "neverready",
		preflight() {
			counters.preflights++;
			return {
				queryKey: "neverready:always-down",
				resolver: Promise.reject(new Error("upstream is down")),
				packageId: "neverready",
				signal: new AbortController().signal,
			};
		},
		destroy() {},
	};
	return { name: "test-neverready", asyncResolvers: [resolver] };
}

/**
 * Run the documented host loop against `engine`, capped so a regression fails
 * the assertion rather than hanging the suite.
 */
async function runHostLoop(engine: ExpressionEngine, cap: number): Promise<{ rounds: number; timerFired: boolean }> {
	let timerFired = false;
	setTimeout(() => { timerFired = true; }, 0);

	try { engine.evaluateLine(1, "2 + 2"); } catch { /* the pending path is the point */ }

	const reader = engine.getEventStream().getReader();
	let rounds = 0;
	while (rounds < cap) {
		// A bounded read, so a stream that has gone quiet ends the loop.
		const next = await Promise.race([
			reader.read(),
			new Promise<{ value: undefined; done: true }>((resolve) =>
				setTimeout(() => resolve({ value: undefined, done: true }), 250),
			),
		]);
		if (next.done || next.value === undefined) break;
		const event = next.value as { type: string; lineNumbers?: number[] };
		if (event.type === "lines-updated") {
			for (const line of event.lineNumbers ?? []) {
				try { engine.reEvaluateLine(line, "2 + 2"); } catch { /* expected */ }
			}
		}
		rounds++;
	}
	return { rounds, timerFired };
}

describe("a resolver that never becomes ready", () => {
	test("the host loop ends instead of running forever", async () => {
		const counters = { preflights: 0 };
		const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, neverReadyPackage(counters)] });
		try {
			const { rounds } = await runHostLoop(engine, 500);
			// Three attempts plus the announcements around them; the cap was
			// reached every time before this, so any double-digit result is a
			// regression rather than a threshold worth tuning.
			expect(rounds).toBeLessThan(20);
			expect(counters.preflights).toBeLessThan(20);
		} finally {
			engine.clear();
		}
	});

	test("and timers still fire while it is running", async () => {
		const counters = { preflights: 0 };
		const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, neverReadyPackage(counters)] });
		try {
			const { timerFired } = await runHostLoop(engine, 500);
			// The whole point: a `setTimeout(..., 0)` armed before the loop must
			// have run by the end of it. It did not before the batcher yielded.
			expect(timerFired).toBe(true);
		} finally {
			engine.clear();
		}
	});

	test("a rejected fetch does not surface as an unhandled rejection", async () => {
		// The promise is awaited rather than abandoned when the bound is
		// reached. Returning before the await left it unhandled, which in a host
		// process is a crash rather than a log line.
		const rejections: unknown[] = [];
		const onRejection = (reason: unknown): void => { rejections.push(reason); };
		process.on("unhandledRejection", onRejection);
		const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, neverReadyPackage({ preflights: 0 })] });
		try {
			await runHostLoop(engine, 500);
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(rejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", onRejection);
			engine.clear();
		}
	});
});

describe("a resolver that works is unaffected", () => {
	test("a value that resolves is announced as it always was", async () => {
		let attempts = 0;
		const resolver: IAsyncResolver = {
			namespace: "works",
			preflight() {
				attempts++;
				if (attempts > 1) return null; // resolved, so the sync path takes over
				return {
					queryKey: "works:fine",
					resolver: Promise.resolve({ type: 0, value: 42 } as never),
					packageId: "works",
					signal: new AbortController().signal,
				};
			},
			destroy() {},
		};
		const engine = new ExpressionEngine({
			packages: [...BUILTIN_PACKAGES, { name: "test-works", asyncResolvers: [resolver] }],
		});
		try {
			const events: string[] = [];
			const reader = engine.getEventStream().getReader();
			try { engine.evaluateLine(1, "2 + 2"); } catch { /* pending */ }
			const next = await Promise.race([
				reader.read(),
				new Promise<{ value: undefined; done: true }>((resolve) =>
					setTimeout(() => resolve({ value: undefined, done: true }), 500),
				),
			]);
			if (!next.done && next.value !== undefined) events.push((next.value as { type: string }).type);
			// A success still reaches the host: the bound only ever declines to
			// announce a repeated failure.
			expect(events.length).toBeGreaterThan(0);
		} finally {
			engine.clear();
		}
	});
});
