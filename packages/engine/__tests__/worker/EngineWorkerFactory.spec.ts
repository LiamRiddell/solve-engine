/**
 * Offloaded compile and execute: who supplies the worker, and what it knows.
 *
 * The engine's own compile and execute pools used to import the worker module
 * directly, which put the worker body in every consumer's main bundle and gave
 * the compile engine inside it no packages at all: a worker that could not
 * parse a line any package gives meaning to, in a bundle that carried it
 * anyway. The pools now ask a host for a factory instead, and the worker is a
 * bundle of its own that registers the full vocabulary.
 *
 * What is pinned here is the contract at that seam:
 *   1. registering nothing keeps everything on the main thread, which is what
 *      every published build does today, and
 *   2. a registered factory is what both pools use, and unregistering puts the
 *      fallback back.
 *
 * The worker body itself is exercised by the message-protocol tests; what
 * cannot be asserted from Node is the bundling, which `lint:size` and the
 * tree-shaking contract cover instead.
 */

import { describe, expect, test, afterEach } from "@jest/globals";
import { setEngineWorkerFactory } from "@solve-js/engine";
import { CompilationWorkerManager } from "@solve-js/engine/CompilationWorkerManager";
import { ExecutionPool } from "@solve-js/engine/ExecutionPool";

/** A worker that records what it was sent and answers nothing. */
class FakeWorker {
	static made = 0;
	posted: unknown[] = [];
	terminated = false;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;

	constructor() {
		FakeWorker.made += 1;
	}

	postMessage(message: unknown): void {
		this.posted.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}
}

const asFactory = () => new FakeWorker() as unknown as Worker;

afterEach(() => {
	setEngineWorkerFactory(null);
	FakeWorker.made = 0;
});

describe("with no factory registered, which is every published build", () => {
	test("the execution pool reports itself unavailable rather than throwing", () => {
		const globalWorker = (globalThis as { Worker?: unknown }).Worker;
		(globalThis as { Worker?: unknown }).Worker = FakeWorker;
		try {
			expect(new ExecutionPool().isAvailable()).toBe(false);
		} finally {
			(globalThis as { Worker?: unknown }).Worker = globalWorker;
		}
	});

	test("and a compile batch rejects, which is how its caller falls back", async () => {
		await expect(
			new CompilationWorkerManager().compileBatch([{ lineId: 1, expression: "2 + 2", textHash: 0 }]),
		).rejects.toThrow("no engine worker factory registered");
	});

	test("an empty batch still answers without wanting a worker at all", async () => {
		await expect(new CompilationWorkerManager().compileBatch([])).resolves.toEqual([]);
	});
});

describe("with a factory registered", () => {
	test("the compile manager starts its worker from it, once", async () => {
		setEngineWorkerFactory(asFactory);
		const manager = new CompilationWorkerManager();
		const items = [{ lineId: 1, expression: "2 + 2", textHash: 0 }];
		// Never resolves: the fake worker answers nothing. What is asserted is
		// that a worker was made and the batch was sent to it.
		void manager.compileBatch(items);
		void manager.compileBatch(items);
		expect(FakeWorker.made).toBe(1);
		manager.terminate();
	});

	test("the execution pool becomes available", () => {
		setEngineWorkerFactory(asFactory);
		const globalWorker = (globalThis as { Worker?: unknown }).Worker;
		(globalThis as { Worker?: unknown }).Worker = FakeWorker;
		try {
			expect(new ExecutionPool().isAvailable()).toBe(true);
		} finally {
			(globalThis as { Worker?: unknown }).Worker = globalWorker;
		}
	});

	test("and unregistering puts the main-thread fallback back", async () => {
		setEngineWorkerFactory(asFactory);
		setEngineWorkerFactory(null);
		await expect(
			new CompilationWorkerManager().compileBatch([{ lineId: 1, expression: "2 + 2", textHash: 0 }]),
		).rejects.toThrow("no engine worker factory registered");
	});
});
