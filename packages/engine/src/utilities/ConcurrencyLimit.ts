/**
 * At most a fixed number of tasks at once, the rest waiting in arrival order.
 *
 * Built for `createQueryResolver`, whose fetches used to start as soon as they
 * were asked for: a document of 500 places opened 500 connections to one
 * weather service at once, all from the reader's address (#696).
 */
export interface ConcurrencyLimit {
	/**
	 * Wait for a slot, then hold it until the returned release is called.
	 *
	 * Rejects with the signal's reason, and leaves the queue, if the signal
	 * aborts before a slot is free; a task that was never started holds nothing.
	 * Calling the release more than once gives the slot back once.
	 *
	 * @param signal - Cancels the wait while queued.
	 */
	acquire(signal: AbortSignal): Promise<() => void>;
	/**
	 * A slot at once, or null when none is free. Synchronous, so a task that
	 * finds one starts in the same turn it was asked for, as it did before any
	 * limit: {@link acquire} would wait a microtask even for a free slot.
	 */
	tryAcquire(): (() => void) | null;
	/** Tasks holding a slot now. */
	readonly active: number;
	/** Tasks waiting for one. */
	readonly queued: number;
}

/**
 * A new limit.
 *
 * @param limit - Slots, a positive whole number, or `Infinity` for no limit.
 * @throws RangeError when `limit` is neither.
 */
export function createConcurrencyLimit(limit: number): ConcurrencyLimit {
	if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) {
		throw new RangeError(`A concurrency limit is a positive whole number or Infinity, not ${String(limit)}`);
	}
	let active = 0;
	// A Set rather than an array: a queued task that aborts leaves from the
	// middle, and iteration keeps arrival order.
	const waiting = new Set<() => void>();

	const release = (): void => {
		active--;
		const next = waiting.values().next();
		if (!next.done) {
			waiting.delete(next.value);
			next.value();
		}
	};

	const grant = (): (() => void) => {
		active++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			release();
		};
	};

	return {
		tryAcquire(): (() => void) | null {
			return active < limit ? grant() : null;
		},
		acquire(signal: AbortSignal): Promise<() => void> {
			if (signal.aborted) return Promise.reject(signal.reason);
			if (active < limit) return Promise.resolve(grant());
			return new Promise((resolve, reject) => {
				const onAbort = (): void => {
					waiting.delete(start);
					reject(signal.reason);
				};
				const start = (): void => {
					signal.removeEventListener("abort", onAbort);
					resolve(grant());
				};
				waiting.add(start);
				signal.addEventListener("abort", onAbort, { once: true });
			});
		},
		get active() {
			return active;
		},
		get queued() {
			return waiting.size;
		},
	};
}

/**
 * `promise`, or a rejection with the signal's reason as soon as it aborts,
 * whichever comes first.
 *
 * For a fetch that does not honour its signal: the caller stops waiting at the
 * deadline, so a slot it holds is given back, although the request itself
 * cannot be recalled.
 *
 * @param promise - The work.
 * @param signal - The deadline or cancellation.
 */
export function settledOrAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		promise.catch(() => undefined);
		return Promise.reject(signal.reason);
	}
	return new Promise<T>((resolve, reject) => {
		const onAbort = (): void => {
			promise.catch(() => undefined);
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}
