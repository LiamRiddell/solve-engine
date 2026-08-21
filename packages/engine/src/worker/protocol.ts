/**
 * The message protocol spoken across the worker boundary.
 *
 * One request-id space runs both directions: the main side stamps every
 * `init`, `request` and `cancel` with an id, and the worker echoes that id back
 * on the matching `ready`, `result` or `error`, so a caller can correlate an
 * answer with the call that asked for it even with several requests in flight.
 * Every payload here is clone-safe by construction (strings, numbers, plain
 * option objects, and the DTOs from `worker/dto.ts`), so the whole protocol
 * survives `postMessage`.
 */

import type { EngineConfig } from "@solve-js/constants/Configuration";
import type { UnifiedParsingOptions } from "@solve-js/types/ParsingResult";
import type { FormattingSettings } from "@solve-js/format/FormattingSettings";
import type { SerializedEngineError } from "@solve-js/errors/WorkerError";

/** The core evaluate methods the harness proxies. */
export type WorkerMethod = "parseDocument" | "evaluateLines" | "evaluateExpression";

/** Build the worker engine, sent once before any request. */
export interface InitMessage {
	kind: "init";
	id: number;
	/** Locale for keywords and number formatting; defaults to English worker-side. */
	localeCode?: string;
	/** Whether to build the engine with its diagnostic pipeline enabled. */
	diagnosticMode?: boolean;
	/** Partial engine configuration, merged with the defaults worker-side. */
	config?: Partial<EngineConfig>;
	/**
	 * Names of built-in packages to register, resolved against the runtime's
	 * available set. Omitted registers them all. Names rather than the packages
	 * themselves, since an `IEnginePackage` carries functions that cannot cross
	 * a `postMessage` boundary.
	 */
	packages?: string[];
	/** Formatting settings the runtime uses when it renders a DTO's display text. */
	formatting?: FormattingSettings;
}

/** Invoke one proxied method. `args` positionally matches the method's own signature. */
export interface RequestMessage {
	kind: "request";
	id: number;
	method: WorkerMethod;
	args: WorkerRequestArgs;
}

/**
 * The positional arguments for each method, kept as a union so a request is
 * type-checked against the method it names. An `AbortSignal` is never in here:
 * it stays main-side and drives a {@link CancelMessage} instead.
 */
export type WorkerRequestArgs =
	| [input: string, options?: UnifiedParsingOptions]
	| [lines: string[]]
	| [expression: string];

/** Ask the worker to abort the request with this id. */
export interface CancelMessage {
	kind: "cancel";
	id: number;
}

/** Everything the main side sends. */
export type MainToWorkerMessage = InitMessage | RequestMessage | CancelMessage;

/** The engine finished building and is ready to serve requests. */
export interface ReadyMessage {
	kind: "ready";
	id: number;
}

/** A request or init succeeded; `value` is the serialised DTO for that method. */
export interface ResultMessage {
	kind: "result";
	id: number;
	value: unknown;
}

/** A request or init failed; `error` is the structured failure, flattened for transport. */
export interface ErrorMessage {
	kind: "error";
	id: number;
	error: SerializedEngineError;
}

/** Everything the worker sends back. */
export type WorkerToMainMessage = ReadyMessage | ResultMessage | ErrorMessage;
