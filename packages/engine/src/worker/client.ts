/**
 * The main-side half of the harness: an async proxy of the core evaluate
 * methods.
 *
 * {@link createWorkerEngine} performs the init handshake and resolves once the
 * worker's engine is built, so the returned {@link WorkerEngine} is ready to
 * call. Each call stamps a request id, tracks the pending promise, and settles
 * it when the matching answer arrives, so several requests can be outstanding at
 * once. An `AbortSignal` rejects the local promise and posts a `cancel` for the
 * same id, mapping keystroke-level cancellation onto the boundary rather than
 * re-inventing it.
 */

import type { EngineConfig } from "@solve-js/constants/Configuration";
import type { UnifiedParsingOptions } from "@solve-js/types/ParsingResult";
import type { FormattingSettings } from "@solve-js/format/FormattingSettings";
import type { EngineError } from "@solve-js/errors";
import {
	deserializeEngineError,
	workerCancelledError,
	workerTerminatedError,
} from "@solve-js/errors";
import type { WorkerTransport } from "./transport";
import type {
	WorkerMethod,
	WorkerRequestArgs,
	WorkerToMainMessage,
} from "./protocol";
import type {
	SerializedValue,
	SerializedParsedLine,
	SerializedParsingResult,
} from "./dto";

/** Configuration for {@link createWorkerEngine}. */
export interface WorkerEngineOptions {
	/** The channel to the worker runtime. See `worker/transport.ts` for adapters. */
	transport: WorkerTransport;
	/** Locale for keywords and number formatting; defaults to English worker-side. */
	localeCode?: string;
	/** Whether the worker builds its engine with diagnostics enabled. */
	diagnosticMode?: boolean;
	/** Partial engine configuration, merged with the defaults worker-side. */
	config?: Partial<EngineConfig>;
	/**
	 * Names of built-in packages the worker should register. Omitted registers
	 * them all. Names rather than the packages themselves, since a package
	 * carries functions that cannot cross a `postMessage` boundary; a host with
	 * a custom package bakes it into its own worker entry and selects it here by
	 * name.
	 */
	packages?: string[];
	/** Formatting settings the worker uses when it renders a DTO's display text. */
	formatting?: FormattingSettings;
}

/** Per-call options common to every proxied method. */
export interface WorkerCallOptions {
	/** Abort the request. Rejects the returned promise and cancels the work worker-side. */
	signal?: AbortSignal;
}

/**
 * One line whose result changed after a live value resolved worker-side, carried
 * as its freshly re-evaluated {@link SerializedValue}. The value the host renders
 * against `lineNumber`, recovered worker-side so the main thread needs no further
 * round-trip to display it.
 */
export interface WorkerAsyncUpdate {
	lineNumber: number;
	value: SerializedValue;
}

/**
 * A live-data resolution that failed worker-side. `error` is the same structured
 * {@link EngineError} an in-process resolver failure would surface, rebuilt from
 * its transported form, so a host branches on `code`/`category` as it always has.
 */
export interface WorkerAsyncError {
	queryKey: string;
	packageId: string;
	error: EngineError;
}

/**
 * An async proxy of {@link ExpressionEngine}'s core evaluate methods.
 *
 * Each method mirrors its synchronous counterpart but returns a Promise of the
 * serialisable DTO rather than a live `Value`, and accepts an `AbortSignal`.
 */
export interface WorkerEngine {
	/** Parse a whole document off-thread. Mirrors `ExpressionEngine.parseDocument`. */
	parseDocument(input: string, options?: UnifiedParsingOptions & WorkerCallOptions): Promise<SerializedParsingResult>;
	/** Evaluate an array of lines off-thread. Mirrors `ExpressionEngine.evaluateLines`. */
	evaluateLines(lines: string[], options?: WorkerCallOptions): Promise<SerializedParsedLine[]>;
	/** Evaluate a single expression off-thread. Mirrors `ExpressionEngine.evaluateExpression`. */
	evaluateExpression(expression: string, options?: WorkerCallOptions): Promise<SerializedValue>;
	/**
	 * Subscribe to live-data resolutions that land after a request already
	 * answered.
	 *
	 * A currency, weather or historical-rate value resolves inside the worker some
	 * time after `parseDocument` returned its pending result. When it does, the
	 * affected lines are re-evaluated worker-side and their fresh values arrive
	 * here as one batch. This is a subscription rather than a per-request promise
	 * because a resolution is tied to no single request: it belongs to whichever
	 * document is current when the value lands. Returns an unsubscribe function.
	 */
	onResolved(listener: (lines: WorkerAsyncUpdate[]) => void): () => void;
	/**
	 * Subscribe to live-data resolutions that failed. Returns an unsubscribe
	 * function. See {@link onResolved}; this is its failure channel.
	 */
	onAsyncError(listener: (error: WorkerAsyncError) => void): () => void;
	/** Reject every in-flight request and tear the transport down. Idempotent. */
	terminate(): void;
}

/** A promise awaiting one worker answer, plus the abort wiring to unhook when it settles. */
interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
}

class WorkerEngineClient implements WorkerEngine {
	private readonly transport: WorkerTransport;
	private nextId = 1;
	private readonly pending = new Map<number, PendingRequest>();
	// Broadcast subscribers for async resolutions. Sets, not one callback each, so
	// several views can watch the same worker; a resolution is not tied to a
	// request id, so these live outside `pending`.
	private readonly resolvedListeners = new Set<(lines: WorkerAsyncUpdate[]) => void>();
	private readonly asyncErrorListeners = new Set<(error: WorkerAsyncError) => void>();
	private terminated = false;

	constructor(transport: WorkerTransport) {
		this.transport = transport;
		this.transport.onMessage((raw) => this.onMessage(raw));
	}

	/** Perform the init handshake, resolving once the worker posts `ready`. */
	init(options: WorkerEngineOptions): Promise<void> {
		const id = this.nextId++;
		return new Promise<void>((resolve, reject) => {
			this.pending.set(id, { resolve: () => resolve(), reject });
			this.transport.postMessage({
				kind: "init",
				id,
				localeCode: options.localeCode,
				diagnosticMode: options.diagnosticMode,
				config: options.config,
				packages: options.packages,
				formatting: options.formatting,
			});
		});
	}

	parseDocument(
		input: string,
		options?: UnifiedParsingOptions & WorkerCallOptions,
	): Promise<SerializedParsingResult> {
		// The signal stays main-side and drives a `cancel`; only the parsing
		// options cross, so an AbortSignal never reaches `postMessage`.
		const { signal, ...parsing } = options ?? {};
		const parseOptions = Object.keys(parsing).length > 0 ? (parsing as UnifiedParsingOptions) : undefined;
		return this.call<SerializedParsingResult>("parseDocument", [input, parseOptions], signal);
	}

	evaluateLines(lines: string[], options?: WorkerCallOptions): Promise<SerializedParsedLine[]> {
		return this.call<SerializedParsedLine[]>("evaluateLines", [lines], options?.signal);
	}

	evaluateExpression(expression: string, options?: WorkerCallOptions): Promise<SerializedValue> {
		return this.call<SerializedValue>("evaluateExpression", [expression], options?.signal);
	}

	onResolved(listener: (lines: WorkerAsyncUpdate[]) => void): () => void {
		this.resolvedListeners.add(listener);
		return () => this.resolvedListeners.delete(listener);
	}

	onAsyncError(listener: (error: WorkerAsyncError) => void): () => void {
		this.asyncErrorListeners.add(listener);
		return () => this.asyncErrorListeners.delete(listener);
	}

	terminate(): void {
		if (this.terminated) return;
		this.terminated = true;
		const error = workerTerminatedError();
		for (const entry of this.pending.values()) {
			this.unhook(entry);
			entry.reject(error);
		}
		this.pending.clear();
		// No more resolutions can arrive across a torn-down transport, so drop the
		// subscribers rather than leaving them referenced for the client's lifetime.
		this.resolvedListeners.clear();
		this.asyncErrorListeners.clear();
		this.transport.terminate();
	}

	/** Dispatch one request and return the promise that settles on its answer. */
	private call<T>(method: WorkerMethod, args: WorkerRequestArgs, signal?: AbortSignal): Promise<T> {
		if (this.terminated) return Promise.reject(workerTerminatedError());
		if (signal?.aborted) return Promise.reject(workerCancelledError(method));

		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const entry: PendingRequest = { resolve: resolve as (value: unknown) => void, reject };

			if (signal) {
				const onAbort = (): void => {
					// Nothing to do if the answer already arrived and settled this id.
					if (!this.pending.has(id)) return;
					this.pending.delete(id);
					this.transport.postMessage({ kind: "cancel", id });
					reject(workerCancelledError(method));
				};
				entry.signal = signal;
				entry.onAbort = onAbort;
				signal.addEventListener("abort", onAbort, { once: true });
			}

			this.pending.set(id, entry);
			this.transport.postMessage({ kind: "request", id, method, args });
		});
	}

	/** Route one incoming message to the request that is waiting on its id. */
	private onMessage(raw: unknown): void {
		const message = raw as WorkerToMainMessage;
		switch (message.kind) {
			case "ready":
			case "result": {
				const value = message.kind === "result" ? message.value : undefined;
				this.settle(message.id, (entry) => entry.resolve(value));
				break;
			}
			case "error":
				this.settle(message.id, (entry) => entry.reject(deserializeEngineError(message.error)));
				break;
			case "async-update":
				// A broadcast, not an answer to a request: fan it out to every
				// subscriber. A copy of the listener set is iterated so a listener
				// that unsubscribes itself mid-callback cannot disturb the walk.
				for (const listener of [...this.resolvedListeners]) listener(message.lines);
				break;
			case "async-error":
				for (const listener of [...this.asyncErrorListeners]) {
					listener({
						queryKey: message.queryKey,
						packageId: message.packageId,
						error: deserializeEngineError(message.error),
					});
				}
				break;
		}
	}

	/** Remove a pending request by id and run the settle callback, if it is still pending. */
	private settle(id: number, apply: (entry: PendingRequest) => void): void {
		const entry = this.pending.get(id);
		if (!entry) return;
		this.pending.delete(id);
		this.unhook(entry);
		apply(entry);
	}

	/** Detach an entry's abort listener so a settled request leaves nothing on the signal. */
	private unhook(entry: PendingRequest): void {
		if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
	}
}

/**
 * Build a worker-backed engine and wait for it to be ready.
 *
 * ```ts
 * const { client, host } = createLinkedTransports();
 * startWorkerRuntime(host);
 * const engine = await createWorkerEngine({ transport: client });
 * const result = await engine.parseDocument(text);
 * ```
 *
 * In production `client` wraps a real `Worker` (see `eventTargetTransport` /
 * `messagePortTransport`), and `startWorkerRuntime` runs inside that worker.
 */
export async function createWorkerEngine(options: WorkerEngineOptions): Promise<WorkerEngine> {
	const client = new WorkerEngineClient(options.transport);
	await client.init(options);
	return client;
}
