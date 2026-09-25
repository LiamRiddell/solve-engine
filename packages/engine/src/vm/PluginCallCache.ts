import { Value, errorValue, persistentValue } from "@solve-js/vm/Value";

/** How many asynchronous plugin calls one engine keeps, settled or in flight, before the oldest is dropped. */
export const PLUGIN_CALLS_KEPT = 1_000;

/** One asynchronous plugin call: the promise the handler returned and, once it settles, what it settled to. */
export interface PluginCall {
	readonly promise: Promise<Value>;
	settled?: Value;
	/**
	 * Set when the handler, called again after the promise settled, returned
	 * another promise rather than an answer: it keeps no cache of its own, so
	 * the settled value is its answer and it is not called again (#660).
	 */
	promiseOnly?: boolean;
}

/**
 * What each asynchronous plugin call has settled to, or the promise still in
 * flight, for one engine (#660).
 *
 * A plugin function may return a promise, and the contract says the engine
 * resolves it and re-executes. Nothing kept what the promise settled to, so the
 * re-execution called the handler again, got a new promise, and the line stayed
 * pending for good: `slowdouble(21)` was still pending after sixteen
 * evaluations and thirty-one handler calls. The VM now records the promise here
 * under the key it already builds for the call (the function's index and each
 * argument's type, value and unit), and hands a run that comes before the
 * promise settles the same promise rather than calling the handler again.
 * After it settles, the handler is asked once more: an answer it gives then
 * (from a cache of its own) is used, and a new promise means the settled value
 * is the answer from then on (see VM.ts's callPlugin).
 *
 * Only a function that has returned a promise is looked up here, so a
 * synchronous handler builds no key and pays for no lookup. A rejection settles
 * to a `PLUGIN_CALL_FAILED` error, and a promise that resolves to something that
 * is not a Value settles to `PLUGIN_RESULT_NOT_A_VALUE`, so the line reports
 * the failure rather than waiting again. A settled answer is kept for the
 * engine's life, up to {@link PLUGIN_CALLS_KEPT} calls: a raw handler has no
 * refresh cadence, and a value that must refresh belongs in
 * `createQueryResolver`, which pairs a resolver with its cache.
 */
export class PluginCallCache {
	private readonly asyncIndices = new Set<number>();
	private readonly calls = new Map<string, PluginCall>();

	/** @param limit - How many calls to keep before the oldest is dropped. */
	constructor(private readonly limit = PLUGIN_CALLS_KEPT) {}

	/** Whether the function at `index` has returned a promise, so its calls are worth looking up. */
	isAsync(index: number): boolean {
		return this.asyncIndices.has(index);
	}

	/** The call recorded under `key`, settled or still in flight. */
	lookup(key: string): PluginCall | undefined {
		return this.calls.get(key);
	}

	/**
	 * Record a promise a handler returned, and settle the entry when it does.
	 *
	 * @param index - The plugin function's index, marked as one that returns promises.
	 * @param key - The call's key: the index and its arguments.
	 * @param promise - What the handler returned.
	 */
	track(index: number, key: string, promise: Promise<Value>): void {
		this.asyncIndices.add(index);
		const call: PluginCall = { promise };
		this.calls.delete(key);
		this.calls.set(key, call);
		if (this.calls.size > this.limit) {
			const oldest = this.calls.keys().next().value;
			if (oldest !== undefined) this.calls.delete(oldest);
		}
		promise.then(
			(value) => {
				call.settled = value instanceof Value
					? persistentValue(value)
					: errorValue("PLUGIN_RESULT_NOT_A_VALUE", `A plugin function's promise resolved to ${describe(value)}, not a value`);
			},
			(reason) => {
				call.settled = errorValue("PLUGIN_CALL_FAILED", reason instanceof Error ? reason.message : String(reason));
			},
		);
	}

	/** Drop every call to the function at `index`, when its package is unregistered. */
	forget(index: number): void {
		if (!this.asyncIndices.delete(index)) return;
		const prefix = `plugin:${index}:`;
		for (const key of [...this.calls.keys()]) {
			if (key.startsWith(prefix)) this.calls.delete(key);
		}
	}

	/** How many calls are kept. */
	get size(): number {
		return this.calls.size;
	}
}

/** A short description of a non-Value resolution, for the error message. */
function describe(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "an array";
	return typeof value === "object" ? "an object" : `the ${typeof value} ${String(value)}`;
}
