/**
 * The seam between the harness and whatever actually carries messages.
 *
 * Both the client (`worker/client.ts`) and the runtime (`worker/runtime.ts`)
 * talk to a {@link WorkerTransport} and nothing more, so the same code drives a
 * browser `Worker`, a Node `worker_threads` port, or an in-process pair. The
 * three factory functions below adapt each of those onto the interface; a host
 * with a transport this file does not cover can implement the three methods
 * directly.
 */

/**
 * A bidirectional message channel with a single receive handler.
 *
 * `onMessage` registers the one handler the harness needs; calling it again
 * replaces the previous handler. `terminate` tears the channel down and is safe
 * to call more than once.
 */
export interface WorkerTransport {
	/** Send one message to the other end. The message must be clone-safe. */
	postMessage(message: unknown): void;
	/** Register the handler that receives messages from the other end. */
	onMessage(handler: (message: unknown) => void): void;
	/** Tear the channel down. Idempotent. */
	terminate(): void;
}

/**
 * Clone a message the way `postMessage` would, so an in-process transport has
 * the same value semantics as a real one.
 *
 * The harness protocol is clone-safe by construction, so the `JSON` fallback
 * (for a runtime without a global `structuredClone`) is lossless here; the
 * structured-clone path is preferred because it is what a real worker uses and
 * because it throws loudly if a non-clone-safe value ever reaches it, which is
 * exactly the mistake the DTO layer exists to prevent.
 *
 * A function, not a module-level const, so this module does no work at load
 * time and stays deletable under the package's `sideEffects: false` claim; the
 * `typeof` probe runs once per message, which is free next to the clone itself.
 */
function cloneMessage<T>(value: T): T {
	return typeof globalThis.structuredClone === "function"
		? globalThis.structuredClone(value)
		: JSON.parse(JSON.stringify(value));
}

/**
 * A pair of linked in-process transports.
 *
 * `client` and `host` are two ends of one channel: a message posted on either
 * is cloned at post time and delivered to the other on a microtask, so delivery
 * is asynchronous (as a real worker's is) but deterministic (no timers, no I/O).
 * Wire `client` into {@link createWorkerEngine} and `host` into
 * {@link startWorkerRuntime} to run the whole protocol, DTO serialisation and
 * cancellation included, without a second thread. This is the transport tests
 * use, and a fit for a host that wants the message-passing shape on one thread.
 */
export function createLinkedTransports(): { client: WorkerTransport; host: WorkerTransport } {
	let clientHandler: ((message: unknown) => void) | null = null;
	let hostHandler: ((message: unknown) => void) | null = null;
	let alive = true;

	// The handler is read at delivery time rather than post time so setup order
	// (post before the other end has registered) cannot drop a message.
	const deliver = (target: () => ((message: unknown) => void) | null, message: unknown): void => {
		const cloned = cloneMessage(message);
		queueMicrotask(() => {
			if (!alive) return;
			target()?.(cloned);
		});
	};

	const client: WorkerTransport = {
		postMessage: (message) => deliver(() => hostHandler, message),
		onMessage: (handler) => {
			clientHandler = handler;
		},
		terminate: () => {
			alive = false;
		},
	};

	const host: WorkerTransport = {
		postMessage: (message) => deliver(() => clientHandler, message),
		onMessage: (handler) => {
			hostHandler = handler;
		},
		terminate: () => {
			alive = false;
		},
	};

	return { client, host };
}

/** The `postMessage`/`onmessage`/event-listener shape a browser `Worker`, a worker's `self`, or a DOM `MessagePort` presents. */
interface EventTargetLike {
	postMessage(message: unknown): void;
	addEventListener?(type: "message", handler: (event: { data: unknown }) => void): void;
	onmessage?: ((event: { data: unknown }) => void) | null;
	terminate?(): void;
	close?(): void;
	start?(): void;
}

/**
 * Adapt a browser-style message target onto a {@link WorkerTransport}.
 *
 * Covers the main-side `Worker`, the worker global `self`, and a DOM
 * `MessagePort`: each posts with `postMessage` and receives a `MessageEvent`
 * whose `data` is the payload. A `MessagePort` is `start`ed here so it begins
 * dispatching. On the main side pass a `Worker`; inside a browser worker pass
 * `self`.
 */
export function eventTargetTransport(target: EventTargetLike): WorkerTransport {
	return {
		postMessage: (message) => target.postMessage(message),
		onMessage: (handler) => {
			const listener = (event: { data: unknown }): void => handler(event.data);
			if (typeof target.addEventListener === "function") {
				target.addEventListener("message", listener);
			} else {
				target.onmessage = listener;
			}
			target.start?.();
		},
		// A main-side Worker terminates; a worker's own `self` closes. Calling
		// whichever exists keeps one adapter usable from both ends.
		terminate: () => {
			target.terminate?.();
			target.close?.();
		},
	};
}

/** The `postMessage`/`on("message")` shape a Node `worker_threads` `Worker`, `parentPort`, or `MessagePort` presents. */
interface MessagePortLike {
	postMessage(message: unknown): void;
	on(event: "message", handler: (message: unknown) => void): void;
	terminate?(): void;
	close?(): void;
}

/**
 * Adapt a Node `worker_threads` port onto a {@link WorkerTransport}.
 *
 * Covers the main-side `Worker`, the worker's `parentPort`, and a
 * `worker_threads` `MessagePort`: each posts with `postMessage` and emits a
 * `"message"` event whose argument IS the payload (no `.data` wrapper, unlike
 * the DOM). On the main side pass the `Worker`; inside the worker pass
 * `parentPort`.
 */
export function messagePortTransport(port: MessagePortLike): WorkerTransport {
	return {
		postMessage: (message) => port.postMessage(message),
		onMessage: (handler) => {
			port.on("message", (message) => handler(message));
		},
		terminate: () => {
			port.terminate?.();
			port.close?.();
		},
	};
}
