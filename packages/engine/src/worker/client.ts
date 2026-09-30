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

import { DEFAULT_CONFIG, type EngineConfigOverride } from "@solve-js/constants/Configuration";
import { resolveDateOrderPolicy } from "@solve-js/packages/datetime/DateReading";
import type { UnifiedParsingOptions } from "@solve-js/types/ParsingResult";
import type { FormattingOverrides } from "@solve-js/format/FormattingSettings";
import type { EngineError } from "@solve-js/errors";
import {
	deserializeEngineError,
	workerArgumentError,
	workerCancelledError,
	workerTerminatedError,
} from "@solve-js/errors";
import type { SemanticToken, CompletionItem } from "@solve-js/language/LanguageService";
import type {
	DocumentPosition,
	LineShift,
	LineShiftResult,
	RenameResult,
	VariableReference,
} from "@solve-js/language/DocumentReferences";
import type { WorkerTransport } from "./transport";
import type {
	WorkerMethod,
	WorkerRequestArgs,
	WorkerToMainMessage,
	WorkerWhatIfOverrides,
} from "./protocol";
import type {
	SerializedWorkerValue,
	SerializedParsedLine,
	SerializedParsingResult,
	SerializedExplanation,
	SerializedLineTrace,
} from "./dto";

/** Configuration for {@link createWorkerEngine}. */
export interface WorkerEngineOptions {
	/** The channel to the worker runtime. See `worker/transport.ts` for adapters. */
	transport: WorkerTransport;
	/** Locale for keywords and number formatting; defaults to English worker-side. */
	localeCode?: string;
	/** Whether the worker builds its engine with diagnostics enabled. */
	diagnostics?: boolean;
	/** A seed for reproducible random draws, as the engine's own `random` option. */
	random?: { seed: number | string };
	/** Config overrides, merged per section over the defaults worker-side. */
	config?: EngineConfigOverride;
	/**
	 * Names of built-in packages the worker should register. Omitted registers
	 * them all. Names rather than the packages themselves, since a package
	 * carries functions that cannot cross a `postMessage` boundary; a host with
	 * a custom package bakes it into its own worker entry and selects it here by
	 * name.
	 */
	packages?: string[];
	/** Formatting the worker writes a DTO's display text with, merged group by group over the worker engine's own settings (its calendar and its locale's numbers). A calendar backend cannot cross the boundary; give it to the worker runtime instead. */
	formatting?: FormattingOverrides;
}

/** Per-call options common to every proxied method. */
export interface WorkerCallOptions {
	/** Abort the request. Rejects the returned promise and cancels the work worker-side. */
	signal?: AbortSignal;
}

/**
 * One line whose result changed after a live value resolved worker-side, carried
 * as its freshly re-evaluated {@link SerializedWorkerValue}. The value the host renders
 * against `lineNumber`, recovered worker-side so the main thread needs no further
 * round-trip to display it.
 */
export interface WorkerAsyncUpdate {
	lineNumber: number;
	value: SerializedWorkerValue;
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
	evaluateExpression(expression: string, options?: WorkerCallOptions): Promise<SerializedWorkerValue>;
	/**
	 * Evaluate a whole document off-thread through the incremental pass, which
	 * can re-run a line, so goal seek resolves. Mirrors the `evaluateDocument`
	 * helper from `solve-engine/engine`, and answers value for value as it does
	 * on the main thread.
	 */
	evaluateDocument(input: string, options?: WorkerCallOptions): Promise<SerializedParsingResult>;
	/**
	 * Re-run a document with some inputs changed, off-thread. Mirrors
	 * `ExpressionEngine.whatIf`. Each override is a finite number or text the
	 * worker evaluates on its own (`"$120"`); a `Value` cannot cross the
	 * boundary with its type, so send its text instead.
	 */
	whatIf(input: string, overrides: WorkerWhatIfOverrides, options?: WorkerCallOptions): Promise<SerializedParsingResult>;
	/** The derivation of how a line reached its answer. Mirrors `ExpressionEngine.explainLine`. */
	explainLine(expression: string, options?: WorkerCallOptions): Promise<SerializedExplanation>;
	/**
	 * Where line `lineNumber` of `input` got its answer. Mirrors
	 * `ExpressionEngine.traceLine`, reading the document through the incremental
	 * pass (the one just evaluated, when `input` is the same text).
	 */
	traceLine(
		input: string,
		lineNumber: number,
		options?: { maxDepth?: number; maxLines?: number } & WorkerCallOptions,
	): Promise<SerializedLineTrace>;
	/**
	 * Wait until the worker's in-flight live values have settled. Mirrors
	 * `ExpressionEngine.settle`: rejects with `SETTLE_TIMEOUT` at the deadline,
	 * and the settled values arrive through {@link onResolved} as ever.
	 */
	settle(options?: { timeoutMs?: number } & WorkerCallOptions): Promise<void>;
	/** Highlighting for one line. Mirrors `LanguageService.getSemanticTokens` on the worker's engine. */
	getSemanticTokens(lineText: string, lineNumber: number, options?: WorkerCallOptions): Promise<SemanticToken[]>;
	/** Completions at a cursor. Mirrors `LanguageService.getCompletions` on the worker's engine. */
	getCompletions(lineText: string, cursorOffset: number, options?: WorkerCallOptions): Promise<CompletionItem[]>;
	/** Every place the variable at `position` is named. Mirrors `LanguageService.findReferences`. */
	findReferences(text: string, position: DocumentPosition, options?: WorkerCallOptions): Promise<VariableReference[]>;
	/** The definition the variable at `position` reads. Mirrors `LanguageService.getDefinition`. */
	getDefinition(text: string, position: DocumentPosition, options?: WorkerCallOptions): Promise<VariableReference | null>;
	/** Rename the variable at `position`. Mirrors `LanguageService.rename`, refusals included. */
	rename(text: string, position: DocumentPosition, newName: string, options?: WorkerCallOptions): Promise<RenameResult>;
	/** The edits that keep `line N` references in place after lines move. Mirrors `LanguageService.shiftLineReferences`. */
	shiftLineReferences(text: string, change: LineShift, options?: WorkerCallOptions): Promise<LineShiftResult>;
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

/**
 * Replaces `date.inputOrder: 'locale'` with the order this side resolves it
 * to, before the config crosses to the worker.
 *
 * `'locale'` means "ask the reader's machine", and the reader's machine is
 * this one. A worker re-inferring it would be asking a different environment
 * the same question: a worker thread can carry different `Intl` data (a
 * bundler-provided shim, a small-ICU runtime), so the same document could be
 * read day-first on the main thread and month-first in the worker with nothing
 * to show for it. The resolved order crosses instead, so both sides read the
 * document the same way, and `date.inputLocale` is dropped with it because it
 * has already done its work.
 *
 * Anything else passes through untouched, including an absent config.
 */
function resolveDateOrderForWorker(config: EngineConfigOverride | undefined): EngineConfigOverride | undefined {
	if (config?.date?.inputOrder !== "locale") return config;
	const date = { ...config.date, inputOrder: resolveDateOrderPolicy({ ...DEFAULT_CONFIG.date, ...config.date }).order };
	delete date.inputLocale;
	return { ...config, date };
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
				diagnostics: options.diagnostics,
				config: resolveDateOrderForWorker(options.config),
				packages: options.packages,
				formatting: options.formatting,
				random: options.random,
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

	evaluateExpression(expression: string, options?: WorkerCallOptions): Promise<SerializedWorkerValue> {
		return this.call<SerializedWorkerValue>("evaluateExpression", [expression], options?.signal);
	}

	evaluateDocument(input: string, options?: WorkerCallOptions): Promise<SerializedParsingResult> {
		return this.call<SerializedParsingResult>("evaluateDocument", [input], options?.signal);
	}

	whatIf(input: string, overrides: WorkerWhatIfOverrides, options?: WorkerCallOptions): Promise<SerializedParsingResult> {
		return this.call<SerializedParsingResult>("whatIf", [input, overrides], options?.signal);
	}

	explainLine(expression: string, options?: WorkerCallOptions): Promise<SerializedExplanation> {
		return this.call<SerializedExplanation>("explainLine", [expression], options?.signal);
	}

	traceLine(
		input: string,
		lineNumber: number,
		options?: { maxDepth?: number; maxLines?: number } & WorkerCallOptions,
	): Promise<SerializedLineTrace> {
		const { signal, ...bounds } = options ?? {};
		return this.call<SerializedLineTrace>("traceLine", [input, lineNumber, bounds], signal);
	}

	async settle(options?: { timeoutMs?: number } & WorkerCallOptions): Promise<void> {
		const { signal, ...wait } = options ?? {};
		await this.call<null>("settle", [wait], signal);
	}

	getSemanticTokens(lineText: string, lineNumber: number, options?: WorkerCallOptions): Promise<SemanticToken[]> {
		return this.call<SemanticToken[]>("getSemanticTokens", [lineText, lineNumber], options?.signal);
	}

	getCompletions(lineText: string, cursorOffset: number, options?: WorkerCallOptions): Promise<CompletionItem[]> {
		return this.call<CompletionItem[]>("getCompletions", [lineText, cursorOffset], options?.signal);
	}

	findReferences(text: string, position: DocumentPosition, options?: WorkerCallOptions): Promise<VariableReference[]> {
		return this.call<VariableReference[]>("findReferences", [text, position], options?.signal);
	}

	getDefinition(text: string, position: DocumentPosition, options?: WorkerCallOptions): Promise<VariableReference | null> {
		return this.call<VariableReference | null>("getDefinition", [text, position], options?.signal);
	}

	rename(text: string, position: DocumentPosition, newName: string, options?: WorkerCallOptions): Promise<RenameResult> {
		return this.call<RenameResult>("rename", [text, position, newName], options?.signal);
	}

	shiftLineReferences(text: string, change: LineShift, options?: WorkerCallOptions): Promise<LineShiftResult> {
		return this.call<LineShiftResult>("shiftLineReferences", [text, change], options?.signal);
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
			try {
				this.transport.postMessage({ kind: "request", id, method, args });
			} catch (error) {
				// `postMessage` copies its argument, and refuses what it cannot copy
				// (a function, a symbol) by throwing where the caller never sees a
				// code. Nothing was sent, so the request ends here, coded.
				this.pending.delete(id);
				this.unhook(entry);
				reject(workerArgumentError(method, error instanceof Error ? error.message : String(error)));
			}
		});
	}

	/** Route one incoming message to the request that is waiting on its id. */
	private onMessage(raw: unknown): void {
		const message = raw as WorkerToMainMessage;
		switch (message.kind) {
			case "ready":
			case "result": {
				const value = message.kind === "result" ? message.value : undefined;
				this.settleRequest(message.id, (entry) => entry.resolve(value));
				break;
			}
			case "error":
				this.settleRequest(message.id, (entry) => entry.reject(deserializeEngineError(message.error)));
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
	private settleRequest(id: number, apply: (entry: PendingRequest) => void): void {
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
