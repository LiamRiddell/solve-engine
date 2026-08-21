export {
	ErrorCategory,
	EngineError,
	ErrorFactory,
	normalizeUnknownError,
	ok,
	err,
	isOk,
	isErr,
	map,
	mapErr,
	andThen,
	unwrapOr,
	match,
	combine,
	throwIfErr,
	tryCatch,
	tryCatchAsync,
	CoreErrorCodes,
} from "./UnifiedErrorFramework";
export type { EngineErrorInit, SourceSpan, Result, ErrorCode, CoreErrorCode } from "./UnifiedErrorFramework";

export {
	WorkerErrorCodes,
	serializeEngineError,
	deserializeEngineError,
	workerCancelledError,
	workerTerminatedError,
	workerTransportError,
} from "./WorkerError";
export type { SerializedEngineError } from "./WorkerError";
