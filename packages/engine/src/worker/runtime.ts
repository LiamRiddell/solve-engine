/**
 * The worker-side half of the harness: it owns an {@link ExpressionEngine} and
 * answers the protocol.
 *
 * {@link startWorkerRuntime} is transport-agnostic, so the same function runs
 * behind a browser `Worker`, a Node `worker_threads` port, or an in-process
 * link. A host's worker entry file is two lines: adapt the environment onto a
 * {@link WorkerTransport} and call this.
 *
 * The runtime never posts a raw {@link Value}. Every result is projected onto a
 * DTO first (`worker/serialize.ts`), and every failure is caught and flattened
 * into a structured error, so a worker-side throw reaches the caller as an
 * `EngineError` rather than a lost promise.
 */

import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { AsyncResolutionEvent } from "@solve-js/engine/AsyncResolutionBatcher";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { FormattingSettings } from "@solve-js/format/FormattingSettings";
import {
	ErrorFactory,
	normalizeUnknownError,
	serializeEngineError,
	WorkerErrorCodes,
} from "@solve-js/errors";
import { serializeParsingResult, serializeParsedLine, serializeValue } from "./serialize";
import type { WorkerTransport } from "./transport";
import type {
	MainToWorkerMessage,
	InitMessage,
	RequestMessage,
	WorkerToMainMessage,
	AsyncResolvedLine,
} from "./protocol";

/** Options a host bakes into its own worker entry, chiefly its custom packages. */
export interface WorkerRuntimeOptions {
	/**
	 * The packages available to register, defaulting to {@link BUILTIN_PACKAGES}.
	 * A host with its own package authors a worker entry that passes them here,
	 * then selects among them by name from the main side. This is how a
	 * function-carrying package reaches the worker: baked into its bundle, never
	 * posted across the boundary.
	 */
	packages?: IEnginePackage[];
}

/**
 * Resolve the requested package names against the available set.
 *
 * Undefined names means "all of them". A name with no match is a configuration
 * failure the caller must see, not a silent omission that would leave a feature
 * quietly missing from every result.
 */
function resolvePackages(available: IEnginePackage[], names: string[] | undefined): IEnginePackage[] {
	if (names === undefined) return available;
	const byName = new Map(available.map((pkg) => [pkg.name, pkg]));
	const resolved: IEnginePackage[] = [];
	for (const name of names) {
		const pkg = byName.get(name);
		if (!pkg) {
			throw ErrorFactory.config(
				WorkerErrorCodes.WORKER_UNKNOWN_PACKAGE,
				`No package named "${name}" is available in this worker runtime`,
				{ name, available: [...byName.keys()] },
			);
		}
		resolved.push(pkg);
	}
	return resolved;
}

/**
 * Attach the runtime to a transport and start serving.
 *
 * Returns a teardown function that clears the engine and detaches, for a host
 * that reuses a transport or shuts a worker down cleanly.
 */
export function startWorkerRuntime(transport: WorkerTransport, options: WorkerRuntimeOptions = {}): () => void {
	const available = options.packages ?? BUILTIN_PACKAGES;

	let engine: ExpressionEngine | null = null;
	let formatting: FormattingSettings | undefined;
	// One AbortController per in-flight request, so a `cancel` can map onto the
	// engine's keystroke signal for exactly the request the caller aborted.
	const inFlight = new Map<number, AbortController>();

	// The line texts of the current document, keyed by the line number the engine
	// evaluates them under (1-based for a document, -1 for a lone expression). An
	// async resolution names the lines whose result changed but not the new value,
	// so this is what the event pump re-reads a line from to recover it.
	let retainedLines = new Map<number, string>();

	// The current document's abort controller, kept alive past the request that
	// created it so this document's async resolutions can still land. Aborted when
	// a new document supersedes it: aborting drops the old document's in-flight
	// resolutions at the engine's own staleness guard (an aborted signal is
	// discarded before it reaches the batcher), so a stale value never reaches the
	// host as if it were current. See {@link handleRequest}.
	let documentController: AbortController | null = null;

	// Cancels the event-stream reader on teardown. Null until the pump starts.
	let stopEventPump: (() => void) | null = null;

	const post = (message: WorkerToMainMessage): void => transport.postMessage(message);

	const fail = (id: number, error: unknown): void => {
		post({ kind: "error", id, error: serializeEngineError(normalizeUnknownError(error)) });
	};

	/**
	 * Record the line texts a request evaluates, so a later async resolution can
	 * re-read exactly the lines it names. A whole document splits into 1-based
	 * lines; a lone `evaluateExpression` maps onto the engine's `-1` sentinel, the
	 * same line number the engine registers and later reports for it.
	 */
	const retainLines = (message: RequestMessage): Map<number, string> => {
		const map = new Map<number, string>();
		if (message.method === "parseDocument") {
			(message.args[0] as string).split("\n").forEach((text, index) => map.set(index + 1, text));
		} else if (message.method === "evaluateLines") {
			(message.args[0] as string[]).forEach((text, index) => map.set(index + 1, text));
		} else {
			map.set(-1, message.args[0] as string);
		}
		return map;
	};

	/**
	 * Turn one async resolution event into a message home.
	 *
	 * A `lines-updated` event names the lines whose result changed; the resolved
	 * value lives in the engine's cache, so each named line is re-evaluated (which
	 * now reads the settled value from that cache rather than starting a fresh
	 * fetch) and serialised. A line the current document no longer retains belongs
	 * to a superseded document and is skipped. An `error` event carries the failed
	 * query straight across as a structured error.
	 */
	const handleAsyncEvent = (eng: ExpressionEngine, event: AsyncResolutionEvent): void => {
		if (event.type === "error") {
			post({
				kind: "async-error",
				queryKey: event.queryKey,
				packageId: event.packageId,
				error: serializeEngineError(normalizeUnknownError(event.error)),
			});
			return;
		}

		const lines: AsyncResolvedLine[] = [];
		for (const lineNumber of event.lineNumbers) {
			const text = retainedLines.get(lineNumber);
			if (text === undefined) continue;
			try {
				const value = eng.evaluateLine(lineNumber, text)[0];
				if (value) lines.push({ lineNumber, value: serializeValue(value, formatting) });
			} catch {
				// A line that resolved into an error re-throws on re-evaluation; the
				// batcher's own `error` event is the channel for that, so this keeps
				// the update to the lines that produced a value rather than posting a
				// second, half-formed failure here.
			}
		}
		if (lines.length > 0) post({ kind: "async-update", lines });
	};

	/**
	 * Drain the engine's async-resolution event stream for the life of the
	 * runtime, posting each event home. Started once the engine exists; the reader
	 * loop ends when the stream closes (engine cleared) or the returned canceller
	 * runs at teardown.
	 */
	const startEventPump = (eng: ExpressionEngine): void => {
		stopEventPump?.();
		const reader = eng.getEventStream().getReader();
		stopEventPump = () => void reader.cancel();
		void (async () => {
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) return;
					handleAsyncEvent(eng, value);
				}
			} catch {
				// The stream errored or was cancelled (teardown); the loop is done.
			}
		})();
	};

	const handleInit = (message: InitMessage): void => {
		try {
			const packages = resolvePackages(available, message.packages);
			engine = new ExpressionEngine(
				message.localeCode ?? "en",
				message.diagnosticMode ?? false,
				message.config,
				undefined,
				packages,
			);
			formatting = message.formatting;
			// Drain live-data resolutions for the engine's whole lifetime, so a
			// value that settles after a request already answered still reaches the
			// host. Started here, after the engine exists, and torn down with it.
			startEventPump(engine);
			post({ kind: "ready", id: message.id });
		} catch (error) {
			// A build failure leaves no engine; the caller's `createWorkerEngine`
			// promise rejects with this rather than hanging on a `ready` that
			// never comes.
			fail(message.id, error);
		}
	};

	const runMethod = (eng: ExpressionEngine, message: RequestMessage): unknown => {
		const { method, args } = message;
		switch (method) {
			case "parseDocument":
				return serializeParsingResult(eng.parseDocument(args[0] as string, args[1] as never), formatting);
			case "evaluateLines":
				return eng.evaluateLines(args[0] as string[]).map((line) => serializeParsedLine(line, formatting));
			case "evaluateExpression":
				return eng.evaluateExpression(args[0] as string).map((value) => serializeValue(value, formatting));
			default:
				throw ErrorFactory.execution(
					WorkerErrorCodes.WORKER_UNKNOWN_METHOD,
					`The worker runtime has no method named "${String(method)}"`,
					{ method },
				);
		}
	};

	const handleRequest = (message: RequestMessage): void => {
		const eng = engine;
		if (!eng) {
			fail(
				message.id,
				ErrorFactory.execution(
					WorkerErrorCodes.WORKER_NOT_INITIALISED,
					"The worker received a request before its engine finished initialising",
				),
			);
			return;
		}

		// Supersede the previous document: abort its controller so any resolution
		// still in flight for it is dropped at the engine's staleness guard rather
		// than posted home as if it belonged to this request's document. The old
		// retained lines go with it. Every evaluate call shares one engine and one
		// document context, so the most recent call is the live one.
		documentController?.abort();

		// This request's controller doubles as the document controller: wired in as
		// the keystroke signal so a later `cancel` (or the next supersede) aborts
		// the async work this evaluation fires, the same mechanism a host uses on
		// the main thread. It is deliberately NOT aborted when the request settles,
		// so this document's live values can still resolve and stream back.
		const controller = new AbortController();
		documentController = controller;
		retainedLines = retainLines(message);
		inFlight.set(message.id, controller);
		eng.setKeystrokeSignal(controller.signal);

		try {
			const value = runMethod(eng, message);
			post({ kind: "result", id: message.id, value });
		} catch (error) {
			fail(message.id, error);
		} finally {
			inFlight.delete(message.id);
			eng.setKeystrokeSignal(null);
		}
	};

	transport.onMessage((raw) => {
		const message = raw as MainToWorkerMessage;
		switch (message.kind) {
			case "init":
				handleInit(message);
				break;
			case "request":
				handleRequest(message);
				break;
			case "cancel":
				// Abort maps onto the keystroke signal for the named request; a
				// cancel that arrives after the request already settled finds no
				// controller and is a harmless no-op.
				inFlight.get(message.id)?.abort();
				break;
		}
	});

	return () => {
		stopEventPump?.();
		stopEventPump = null;
		documentController?.abort();
		documentController = null;
		retainedLines = new Map();
		for (const controller of inFlight.values()) controller.abort();
		inFlight.clear();
		engine?.clear();
		engine = null;
		transport.terminate();
	};
}
