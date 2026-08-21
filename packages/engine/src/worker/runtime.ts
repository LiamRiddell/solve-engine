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

	const post = (message: WorkerToMainMessage): void => transport.postMessage(message);

	const fail = (id: number, error: unknown): void => {
		post({ kind: "error", id, error: serializeEngineError(normalizeUnknownError(error)) });
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

		// Wire this request's signal in as the keystroke signal so a later
		// `cancel` aborts the async work this evaluation fires, the same
		// mechanism a host uses on the main thread.
		const controller = new AbortController();
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
		for (const controller of inFlight.values()) controller.abort();
		inFlight.clear();
		engine?.clear();
		engine = null;
		transport.terminate();
	};
}
