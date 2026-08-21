/**
 * Structured errors for the off-main-thread worker harness, and the pair of
 * functions that carry an {@link EngineError} across a `postMessage` boundary.
 *
 * A worker runs in another thread, so a failure there cannot be `throw`n back
 * into the caller's stack. It has to be encoded, posted, and rebuilt on the
 * main side, and it must arrive as a real structured error rather than a lost
 * promise or an opaque string. {@link serializeEngineError} projects an
 * `EngineError` onto a plain, clone-safe object; {@link deserializeEngineError}
 * rebuilds one from that object so the main-side `catch` sees the same
 * `code`/`category`/`message` it would have seen in-process.
 */

import { EngineError, ErrorCategory, ErrorFactory, type SourceSpan } from "./EngineError";

/**
 * Codes the worker harness owns, co-located here rather than unioned into the
 * core catalog, matching the convention `errors/ErrorCode.ts` documents for a
 * domain that keeps its own small code object.
 */
export const WorkerErrorCodes = {
	/** The caller aborted the request through its `AbortSignal`. */
	WORKER_CANCELLED: "WORKER_CANCELLED",
	/** The worker engine was torn down while a request was still in flight. */
	WORKER_TERMINATED: "WORKER_TERMINATED",
	/** The transport failed or the worker exited before answering. */
	WORKER_TRANSPORT_FAILED: "WORKER_TRANSPORT_FAILED",
	/** A request named a method the runtime does not expose. */
	WORKER_UNKNOWN_METHOD: "WORKER_UNKNOWN_METHOD",
	/** A request arrived before the runtime finished building its engine. */
	WORKER_NOT_INITIALISED: "WORKER_NOT_INITIALISED",
	/** An init named a package the runtime could not resolve. */
	WORKER_UNKNOWN_PACKAGE: "WORKER_UNKNOWN_PACKAGE",
} as const;

/**
 * A structured error flattened for transport.
 *
 * Every field is a string, a boolean, or an object of numbers, so the whole
 * thing survives both `structuredClone` (what `postMessage` uses) and
 * `JSON.stringify` (what a host may log). `context`, `cause` and `timestamp`
 * are deliberately dropped rather than posted: a context can hold a value that
 * is not clone-safe, and none of the three is part of what a main-side handler
 * branches on.
 */
export interface SerializedEngineError {
	name: string;
	category: ErrorCategory;
	code: string;
	message: string;
	expected?: string;
	found?: string;
	suggestion?: string;
	recoverable: boolean;
	span?: SourceSpan;
}

/** Flatten an {@link EngineError} into a clone-safe {@link SerializedEngineError}. */
export function serializeEngineError(error: EngineError): SerializedEngineError {
	const dto: SerializedEngineError = {
		name: error.name,
		category: error.category,
		code: error.code,
		message: error.message,
		recoverable: error.recoverable,
	};
	// Only the optional string fields that were actually set cross the wire, so
	// a rebuilt error has `undefined` exactly where the original did rather than
	// an explicit `undefined` property a deep-equal would trip on.
	if (error.expected !== undefined) dto.expected = error.expected;
	if (error.found !== undefined) dto.found = error.found;
	if (error.suggestion !== undefined) dto.suggestion = error.suggestion;
	// A span is character offsets (plain numbers), so it is safe to carry and
	// useful for a host that highlights the failing range.
	if (error.span !== undefined) dto.span = error.span;
	return dto;
}

/**
 * Rebuild an {@link EngineError} from its transported form.
 *
 * The category string round-trips straight back into the `ErrorCategory` enum
 * (its members ARE their own string values), so a main-side `catch` reads the
 * same category the worker raised. A malformed category (a message that was not
 * produced by {@link serializeEngineError}) falls back to `INTERNAL` rather than
 * constructing an error with an invalid category.
 */
export function deserializeEngineError(dto: SerializedEngineError): EngineError {
	const category = Object.values(ErrorCategory).includes(dto.category)
		? dto.category
		: ErrorCategory.INTERNAL;
	return new EngineError(category, {
		code: dto.code,
		message: dto.message,
		expected: dto.expected,
		found: dto.found,
		suggestion: dto.suggestion,
		recoverable: dto.recoverable,
		span: dto.span,
	});
}

/** The error a request rejects with when its caller aborts through an `AbortSignal`. */
export function workerCancelledError(method?: string): EngineError {
	return ErrorFactory.execution(
		WorkerErrorCodes.WORKER_CANCELLED,
		method
			? `The worker request "${method}" was cancelled`
			: "The worker request was cancelled",
		method ? { method } : undefined,
	);
}

/** The error every pending request rejects with when the worker engine is terminated. */
export function workerTerminatedError(): EngineError {
	return ErrorFactory.execution(
		WorkerErrorCodes.WORKER_TERMINATED,
		"The worker engine was terminated before this request completed",
	);
}

/** The error a request rejects with when the transport fails or the worker exits early. */
export function workerTransportError(detail: string): EngineError {
	return ErrorFactory.external(
		WorkerErrorCodes.WORKER_TRANSPORT_FAILED,
		`The worker transport failed: ${detail}`,
		{ detail },
	);
}
