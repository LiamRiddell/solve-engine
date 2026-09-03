/**
 * Off-main-thread evaluation: a message-passing wrapper around the core
 * evaluate methods.
 *
 * Import `createWorkerEngine` on the main side and `startWorkerRuntime` inside
 * the worker; wire them together with a {@link WorkerTransport}. Results cross
 * as the serialisable DTOs in `worker/dto.ts`, never as raw `Value` instances.
 * This barrel is side-effect free: nothing here binds a global handler or spins
 * a thread, so a bundle that never imports it pays nothing, and a host controls
 * exactly where the runtime starts.
 *
 * @packageDocumentation
 */

export { createWorkerEngine } from "./client";
export type {
	WorkerEngine,
	WorkerEngineOptions,
	WorkerCallOptions,
	WorkerAsyncUpdate,
	WorkerAsyncError,
} from "./client";

export { startWorkerRuntime } from "./runtime";
export type { WorkerRuntimeOptions } from "./runtime";

export {
	createLinkedTransports,
	eventTargetTransport,
	messagePortTransport,
} from "./transport";
export type { WorkerTransport } from "./transport";

export {
	serializeValue,
	serializeParsedLine,
	serializeParsingResult,
} from "./serialize";

export type {
	SerializedWorkerValue,
	SerializedValue,
	SerializedMatrix,
	SerializedInlineSolve,
	SerializedParsedLine,
	SerializedParsingResult,
} from "./dto";

export type {
	WorkerMethod,
	WorkerRequestArgs,
	MainToWorkerMessage,
	WorkerToMainMessage,
	InitMessage,
	RequestMessage,
	CancelMessage,
	ReadyMessage,
	ResultMessage,
	ErrorMessage,
	AsyncResolvedLine,
	AsyncUpdateMessage,
	AsyncErrorMessage,
} from "./protocol";
