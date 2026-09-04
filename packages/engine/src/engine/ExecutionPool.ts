/**
 * ExecutionPool, manages a pool of execution workers for offloading
 * VM bytecode re-execution when AsyncResolutionBatcher.flush() has >50
 * affected lines.
 *
 * Workers are created lazily (on first dispatch). Each worker runs
 * executeBytecode() with its own isolated VM, no shared state between
 * worker and main thread, no scope leakage.
 *
 * Design decisions:
 * - Pool size: Math.min(navigator.hardwareConcurrency ?? 4, 4). Capped at
 *   4 to avoid excessive thread creation on high-core machines.
 * - Round-robin dispatch distributes batches evenly across workers.
 * - Workers are terminated on pool.clear() (engine clear) and recreated
 *   lazily on next dispatch.
 * - A worker that hangs past the batch timeout, or that raises an error, is
 *   terminated and replaced in place, and every batch it was holding resolves
 *   to one Error result per line. It used to stay in the rotation with its
 *   batches answered as empty arrays, so one bad input degraded a quarter of
 *   the pool for the rest of the process and a crash was indistinguishable
 *   from "nothing to report".
 * - Falls back to synchronous main-thread execution when Worker is
 *   unavailable (Node.js, SSR, testing without jsdom worker support).
 *
 * Transferable protocol (shares engine.worker.ts with CompilationWorkerManager):
 * - Main thread clones bytecode ArrayBuffers via .slice() per entry
 * - Transfers cloned buffers to worker (zero-copy, detached on main side)
 * - Worker receives buffers, reconstructs TypedArrays, executes, returns
 *   serialized results (plain objects with numbers/strings)
 *
 * Message protocol:
 *   Pool → Worker: { type: "EXECUTE_BATCH", id, items: ExecuteItem[] }
 *   Worker → Pool: { id, type: "EXECUTE_RESULT", results: ExecuteResult[] }
 */

import type { LineCacheEntry } from "@solve-js/cache/LineCache";
import { ValueType } from "@solve-js/vm/Value";
import { numberValue, uomValue, hexValue, bigIntValue, stringValue, boolValue, datetimeValue, percentageValue, errorValue, pendingValue } from "@solve-js/vm/Value";
import type { Value } from "@solve-js/vm/Value";

/** Timeout for worker batch execution (30s). Past it the worker is replaced and its batches resolve to Error results. */
const WORKER_BATCH_TIMEOUT_MS = 30_000;

// ── Static import of the inline worker factory ────────────────────────────
// esbuild-plugin-inline-worker transforms this into a function that
// returns Worker (using blob URL or equivalent). At build time it's a
// factory; at dev time it throws.
import { engineWorkerFactory } from "@solve-js/workers/WorkerFactory";

// ── Worker message types (mirrors the EXECUTE_* shapes in engine.worker.ts) ──

interface ExecuteItem {
	lineNumber: number;
	opcodesBuffer: ArrayBuffer;
	numbersBuffer: ArrayBuffer;
	opcodesLength: number;
	numbersLength: number;
	strings: string[];
}

/** One line's result as it comes back from a worker, in the flat shape the worker can post. */
export interface ExecuteResult {
	lineNumber: number;
	valueType: ValueType;
	value: number;
	unit?: string;
	isPending: boolean;
	queryKey?: string;
	/**
	 * For an Error result the pool raised itself (a timed-out or crashed
	 * worker) rather than one the worker's VM produced: the code to carry.
	 * Absent for a worker-produced error, which reads as `WORKER_EXECUTION_ERROR`.
	 */
	errorCode?: string;
}

// ── Batch tracking ────────────────────────────────────────────────────────

interface PendingBatch {
	/** Correlation ID sent to the worker. */
	id: number;
	/** The line numbers actually posted, in order. Used for result correlation and for the per-line Error results a failure answers with. */
	lineNumbers: number[];
	/** Index into `workers` of the worker this batch was posted to, so a failure on that worker resolves its batches and no other's. */
	workerIndex: number;
	/** Resolve when results arrive. */
	resolve: (results: ExecuteResult[]) => void;
}

/** Number of affected lines before we offload to worker pool. */
export const WORKER_OFFLOAD_THRESHOLD = 50;

// ── Pool ──────────────────────────────────────────────────────────────────

/**
 * Runs bytecode on background workers instead of the main thread.
 *
 * Used for scroll-driven batches, where evaluating a screenful of lines on the
 * main thread would drop frames. Degrades to the main thread when workers are
 * unavailable, which is the normal case in Node and in any bundle not built
 * with esbuild-plugin-inline-worker. See {@link ExecutionPool.isAvailable}.
 */
export class ExecutionPool {
	private workers: Worker[] = [];
	private nextWorker = 0;
	private nextId = 1;
	private pendingBatches = new Map<number, PendingBatch>();
	private terminated = false;
	private poolSize: number;

	constructor(poolSize?: number) {
		this.poolSize = Math.min(poolSize ?? this.defaultPoolSize(), 4);
	}

	private defaultPoolSize(): number {
		if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
			return Math.min(navigator.hardwareConcurrency, 4);
		}
		return 2;
	}

	// ── Public API ────────────────────────────────────────────────────────

	/** Cached availability flag. Checked once; createExecutionWorker never called again. */
	private _available: boolean | null = null;

	/**
	 * Whether worker-based execution is available.
	 * Returns false in Node.js / jsdom test environments where Worker
	 * may be polyfilled but execution workers aren't functional.
	 */
	isAvailable(): boolean {
		if (this.terminated) return false;
		if (this._available !== null) return this._available;
		if (typeof Worker === "undefined") {
			this._available = false;
			return false;
		}
		try {
			// Create a test worker, then immediately terminate it.
			const factory = engineWorkerFactory();
			if (factory === null) {
				this._available = false;
				return false;
			}
			const w = factory();
			w.terminate();
			this._available = true;
			return true;
		} catch {
			this._available = false;
			return false;
		}
	}

	/**
	 * Execute a batch of line entries via the worker pool.
	 *
	 * Takes ordered line numbers and their LineCache entries. Clones bytecode
	 * ArrayBuffers for transfer, dispatches to workers round-robin, and
	 * returns the serialized results. A worker that does not answer within
	 * the batch timeout is replaced, and the batch resolves to one Error
	 * result per line (code `WORKER_TIMEOUT`) rather than to nothing.
	 *
	 * Falls back to undefined when workers are unavailable, caller should
	 * use the main-thread path.
	 *
	 * @returns ExecuteResult[] on success, undefined if workers unavailable.
	 */
	executeBatch(
		orderedLineNumbers: number[],
		entries: Map<number, LineCacheEntry | undefined>,
	): Promise<ExecuteResult[]> | undefined {
		if (!this.isAvailable()) return undefined;
		if (orderedLineNumbers.length === 0) return Promise.resolve([]);

		// Lazy-initialize workers
		this.ensureWorkers();

		// Clone bytecode buffers for transfer. Each worker needs its own
		// copy because transfer detaches the ArrayBuffer on the sender side.
		const items: ExecuteItem[] = [];
		for (const lineNumber of orderedLineNumbers) {
			const entry = entries.get(lineNumber);
			if (!entry || entry.bytecode.opcodes.length === 0) continue;

			const opcodes = entry.bytecode.opcodes;
			const numbers = entry.bytecode.numbers;

			// Clone the exact used slice of each ArrayBuffer for transfer.
			// After transfer, the clone is detached on the main thread
			// the original LineCache entry's buffers are untouched.
			const opcodesClone = opcodes.buffer.slice(
				opcodes.byteOffset,
				opcodes.byteOffset + opcodes.byteLength,
			) as ArrayBuffer;
			const numbersClone = numbers.buffer.slice(
				numbers.byteOffset,
				numbers.byteOffset + numbers.byteLength,
			) as ArrayBuffer;

			items.push({
				lineNumber,
				opcodesBuffer: opcodesClone,
				numbersBuffer: numbersClone,
				opcodesLength: opcodes.length,
				numbersLength: numbers.length,
				strings: [...entry.bytecode.strings],
			});
		}

		if (items.length === 0) return Promise.resolve([]);

		// Collect transferable ArrayBuffers for zero-copy postMessage.
		const transferList: ArrayBuffer[] = [];
		for (const item of items) {
			if (item.opcodesBuffer.byteLength > 0) transferList.push(item.opcodesBuffer);
			if (item.numbersBuffer.byteLength > 0) transferList.push(item.numbersBuffer);
		}

		const batchId = this.nextId++;
		const workerIndex = this.nextWorkerIndex();
		const worker = this.workers[workerIndex];

		return new Promise<ExecuteResult[]>((resolve) => {
			// Timeout guard: a worker that has not answered by now is stuck (an
			// infinite loop the VM's instruction limit could not see, a crashed
			// realm). Nothing it answers later can be trusted, so it is
			// replaced rather than waited on, and the batches queued behind it
			// on that worker fail with it: they were never going to run.
			const timeoutId = setTimeout(() => {
				if (!this.pendingBatches.has(batchId)) return;
				this.failWorker(
					workerIndex,
					"WORKER_TIMEOUT",
					`Evaluation did not finish within ${WORKER_BATCH_TIMEOUT_MS / 1000} seconds; the worker was replaced`,
				);
			}, WORKER_BATCH_TIMEOUT_MS);

			this.pendingBatches.set(batchId, {
				id: batchId,
				lineNumbers: items.map((item) => item.lineNumber),
				workerIndex,
				resolve: (results: ExecuteResult[]) => {
					clearTimeout(timeoutId);
					resolve(results);
				},
			});

			worker.postMessage(
				{ type: "EXECUTE_BATCH", id: batchId, items },
				transferList,
			);
		});
	}

	/**
	 * Clean up all workers and pending batches. Called on engine clear.
	 * Workers are recreated lazily on next dispatch.
	 */
	clear(): void {
		// Resolve every pending batch empty: the engine that asked is
		// discarding its caches, so there is nothing to patch a result into.
		for (const [, batch] of this.pendingBatches) {
			batch.resolve([]);
		}
		this.pendingBatches.clear();

		// Terminate all workers
		for (const w of this.workers) {
			w.terminate();
		}
		this.workers = [];
		this.nextWorker = 0;
	}

	/**
	 * Full teardown. After destroy(), the pool is permanently unusable.
	 */
	destroy(): void {
		this.terminated = true;
		this.clear();
	}

	// ── Private ────────────────────────────────────────────────────────────

	private ensureWorkers(): void {
		if (this.workers.length > 0) return;
		for (let i = 0; i < this.poolSize; i++) {
			this.spawnWorker(i);
		}
	}

	/**
	 * Create the worker for slot `index`, wired so that its failures are
	 * attributed to that slot. Used both to fill the pool and to replace a
	 * worker that {@link failWorker} took out of it.
	 */
	private spawnWorker(index: number): void {
		// Never null here: every path into the pool goes through isAvailable(),
		// which returns false when no host has registered a factory. Checked
		// rather than asserted, because a host may unregister at any time.
		const factory = engineWorkerFactory();
		if (factory === null) return;
		const worker = factory();
		worker.onmessage = (event: MessageEvent) => {
			this.handleWorkerMessage(event.data);
		};
		worker.onerror = (err: ErrorEvent) => {
			console.error(`[ExecutionPool] Worker ${index} error:`, err.message);
			this.failWorker(index, "WORKER_EXECUTION_ERROR", `Worker failed: ${err.message}`);
		};
		this.workers[index] = worker;
	}

	/**
	 * Retire the worker in slot `index` and put a fresh one in its place.
	 *
	 * Every batch posted to that worker resolves to one Error result per line
	 * carrying `code` and `message`, so the host sees a failure on each line
	 * rather than a Pending state that never clears. Batches on the other
	 * workers are untouched: they are running on healthy threads and will
	 * answer in their own time.
	 */
	private failWorker(index: number, code: string, message: string): void {
		// Already cleared or destroyed: the batches were resolved by clear().
		if (this.workers.length === 0) return;

		this.workers[index]?.terminate();
		if (!this.terminated) this.spawnWorker(index);

		for (const [id, batch] of this.pendingBatches) {
			if (batch.workerIndex !== index) continue;
			this.pendingBatches.delete(id);
			batch.resolve(errorResults(batch.lineNumbers, code, message));
		}
	}

	private nextWorkerIndex(): number {
		const index = this.nextWorker;
		this.nextWorker = (this.nextWorker + 1) % this.workers.length;
		return index;
	}

	private handleWorkerMessage(data: { id: number; type: string; results: ExecuteResult[] }): void {
		if (data.type !== "EXECUTE_RESULT") return;

		const batch = this.pendingBatches.get(data.id);
		if (!batch) return;

		this.pendingBatches.delete(data.id);
		batch.resolve(data.results);
	}
}

/** One Error result per line, for a batch whose worker will never answer. */
function errorResults(lineNumbers: number[], code: string, message: string): ExecuteResult[] {
	return lineNumbers.map((lineNumber) => ({
		lineNumber,
		valueType: ValueType.Error,
		value: 0,
		unit: message,
		isPending: false,
		errorCode: code,
	}));
}

// ── Value reconstruction helpers ──────────────────────────────────────────

/**
 * Reconstruct a Value object from a serialized ExecuteResult.
 *
 * Called on the main thread after worker execution completes.
 * Maps ValueType → appropriate constructor function.
 */
export function reconstructValue(result: ExecuteResult): Value {
	switch (result.valueType) {
		case ValueType.Number:
			return numberValue(result.value);
		case ValueType.Hex:
			return hexValue(result.value);
		case ValueType.BigInt:
			return bigIntValue(BigInt(result.value));
		case ValueType.String:
			return stringValue(String(result.value));
		case ValueType.Datetime:
			return datetimeValue(result.value);
		case ValueType.Percentage:
			return percentageValue(result.value);
		case ValueType.Uom:
			return uomValue(result.value, result.unit ?? "");
		case ValueType.Matrix:
			// Pre-existing simplification carried over from the old Array
			// type: the worker-pool's {valueType, value, unit} serialization
			// has no slot for MatrixData's rows/cols/data shape, so a Matrix
			// result degrades to a plain number here rather than round-
			// tripping intact. Not fixed as part of Matrix support. This
			// gap already existed for vectors before this rename.
			return numberValue(result.value);
		case ValueType.Boolean:
			return boolValue(result.value !== 0);
		case ValueType.Pending:
			return pendingValue(result.queryKey ?? "");
		case ValueType.Error:
			return errorValue(result.errorCode ?? "WORKER_EXECUTION_ERROR", result.unit ?? "Unknown worker error");
		default:
			return numberValue(result.value);
	}
}
