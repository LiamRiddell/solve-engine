/**
 * Where a host says how to start an engine worker.
 *
 * The engine's offloaded compile and execute paths need a `Worker`, and a
 * library cannot make one on its own: the file a worker runs has to be a URL
 * the host's bundler produced, and every bundler spells that differently. So
 * the engine asks rather than guesses. A host that wants the offload registers
 * a factory once, and both paths use it; a host that registers nothing gets the
 * main thread, which is what every published build does today and what the
 * fallbacks were always written for.
 *
 * This module deliberately imports nothing. It is the whole reason the worker
 * body, and the vocabulary it registers, stay out of a consumer's main bundle:
 * `ExecutionPool` and `CompilationWorkerManager` reach the worker through this
 * hook instead of importing the worker module, so nothing but a host that opts
 * in ever pulls it in.
 *
 * @module WorkerFactory
 */

/** Makes a `Worker` running the engine's worker entry. */
export type EngineWorkerFactory = () => Worker;

let registered: EngineWorkerFactory | null = null;

/**
 * Register how to start an engine worker, or pass null to go back to the main
 * thread.
 *
 * The factory must return a `Worker` running the engine's worker entry
 * (`solve-engine/engine-worker`), which is a bundle of its own carrying the
 * full package vocabulary. Registering is a whole-process switch rather than a
 * per-engine option, because the pools that use it are shared.
 *
 * @param factory - Makes a worker, or null to unregister.
 * @example
 * ```ts
 * import { setEngineWorkerFactory } from "solve-engine";
 *
 * setEngineWorkerFactory(() => new Worker(new URL("solve-engine/engine-worker", import.meta.url), { type: "module" }));
 * ```
 */
export function setEngineWorkerFactory(factory: EngineWorkerFactory | null): void {
	registered = factory;
}

/**
 * The registered factory, or null when a host has not registered one.
 *
 * Null is the ordinary case and means "run on the main thread", not an error.
 */
export function engineWorkerFactory(): EngineWorkerFactory | null {
	return registered;
}
