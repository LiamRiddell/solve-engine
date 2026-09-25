import type { QueryClient } from "@tanstack/query-core";
import type { Token } from "@solve-js/lexer";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { IAsyncResolver, AsyncCheckResult } from "@solve-js/resolvers/ResolverRegistry";
import { getActiveQueryClient } from "@solve-js/services/DataQueryService";
import { createTimeoutSignal } from "@solve-js/utilities/TimeoutSignal";
import { createConcurrencyLimit, settledOrAborted } from "@solve-js/utilities/ConcurrencyLimit";
import { nextInstruction } from "@solve-js/parser/OperandWidth";

/**
 * Generic async resolver for the common "single query string in, single
 * `Value` out" shape, one `CALL_PLUGIN` opcode with exactly one preceding
 * `PUSH_STRING` argument, resolved via a live fetch and cached through
 * TanStack Query. {@link IAsyncResolver}'s own JSDoc names this exact
 * target ("currency rates, weather, stock prices, etc."); this factory is
 * the generalization of the pattern two existing implementations already
 * prove out by hand, `uom/CurrencyResolver.ts` (a currency-specific
 * dual-operand variant) and `examples/osrs/OsrsAsyncResolver.ts`
 * (`examples/osrs/OsrsVmHandler.ts` for the synchronous read-back half)
 * so a new query-based package (weather, stocks, a knowledge lookup) only
 * needs to supply the fetch call and the response-to-`Value` mapping,
 * not reimplement bytecode scanning, cache-key management, or
 * Suspense/timeout/cooldown plumbing again.
 *
 * Usage: call {@link createQueryResolver} once per package, register the
 * returned `resolver` via `IEnginePackage.asyncResolvers`, and register the
 * returned `pluginFunction` at `pluginFunctionIndex` via
 * `IEnginePackage.pluginFunctions` (the same `CALL_PLUGIN` dispatch every
 * other package function uses. See `allocatePluginFunctionIndex()` in
 * `vm/VMBuiltins.ts`).
 */
export interface QueryResolverOptions {
	/** Unique namespace for cache-key scoping and diagnostics (e.g. "weather"). */
	namespace: string;
	/**
	 * The `CALL_PLUGIN` index this resolver watches for, must be the same
	 * index the package's parselet emits and registers `pluginFunction`
	 * under (via `allocatePluginFunctionIndex()`).
	 */
	pluginFunctionIndex: number;
	/**
	 * Perform the live fetch for `query` and return the resolved `Value`.
	 * Receives an `AbortSignal` that fires on caller cancellation OR the
	 * `timeoutMs` deadline, whichever comes first, pass it to `fetch()`.
	 *
	 * The returned value is stamped with where it came from (see
	 * {@link provider}) unless it already carries `sources` of its own, which a
	 * package sets when it knows more than the resolver does: a historical
	 * figure's day, say.
	 */
	fetchQuery: (query: string, signal: AbortSignal) => Promise<Value>;
	/**
	 * Who supplies the data, recorded on every value this resolver fetches so a
	 * host can say where a figure came from and when (`"Open-Meteo"`, or the name
	 * of the provider a host plugged in). Defaults to {@link namespace}. See
	 * `vm/Provenance.ts`.
	 */
	provider?: string;
	/** TanStack Query staleTime in ms, how long a resolved value stays cached before a re-evaluation refetches it. Default 5 minutes. */
	staleTimeMs?: number;
	/**
	 * Cadence, in ms, for proactive background refresh: how often a value that
	 * is on screen refetches on its own, without the reader re-evaluating.
	 * Omit (the default) for a value that should never refresh in the background
	 * (an immutable historical close), or that should refresh only on the next
	 * pull. It has effect only when the host has enabled background refresh
	 * (`backgroundRefresh.enabled`); otherwise every value stays pull-only. This
	 * is independent of `staleTimeMs`, which continues to govern the pull path.
	 */
	refetchIntervalMs?: number;
	/**
	 * Hard timeout for `fetchQuery`, an unresponsive API must not block
	 * re-evaluation indefinitely. Default 10s. The clock starts when the fetch
	 * does, not while it waits for a slot (see {@link maxConcurrent}), and the
	 * wait ends at the deadline even for a `fetchQuery` that ignores its signal.
	 */
	timeoutMs?: number;
	/**
	 * The most fetches this resolver runs at once; the rest wait their turn, in
	 * the order they were asked for. Default 6, the number of connections a
	 * browser opens to one host. A positive whole number, or `Infinity` for no
	 * limit.
	 *
	 * A pasted or hostile document of 500 places used to start 500 requests to
	 * one service at once, all from the reader's own address (#696). This bounds
	 * how many run together, not how many run: the 500 still run, six at a time.
	 * A query asked for again while it waits shares the one fetch, and one whose
	 * signal aborts while it waits leaves the queue without fetching.
	 */
	maxConcurrent?: number;
	/**
	 * How long a FAILED fetch's error result stays cached before the next
	 * evaluation retries it. Without this, a transient outage would either
	 * retry on every keystroke (no cooldown) or stay failed for the full
	 * `staleTimeMs` (treating the error like real data). Default 30s.
	 */
	failureCooldownMs?: number;
	/**
	 * Build the `Value` a failed fetch resolves to. Defaults to an honest
	 * `errorValue()` (matching `UOM_CONVERT_TO`'s `CURRENCY_RATE_UNAVAILABLE`
	 * pattern in `vm/VM.ts`, never silently substitute a stale/wrong value
	 * for a real failure). Override for a package that prefers a graceful
	 * fallback value instead (e.g. OSRS's `0 gp` with a `timedOut` flag).
	 */
	onError?: (query: string, error: unknown) => Value;
}

/** A resolver paired with the plugin function that reads its results. */
export interface QueryResolverPackage {
	/** Register via `IEnginePackage.asyncResolvers`. */
	resolver: IAsyncResolver;
	/** Register via `IEnginePackage.pluginFunctions` at `pluginFunctionIndex`. */
	pluginFunction: (args: Value[], context?: LineExecutionContext) => Value;
}

function defaultOnError(namespace: string): (query: string, error: unknown) => Value {
	return (query, error) =>
		errorValue(
			`${namespace.toUpperCase()}_QUERY_FAILED`,
			`Failed to resolve "${query}": ${error instanceof Error ? error.message : String(error)}`
		);
}

/**
 * Build an async resolver and its plugin function together.
 *
 * The two halves have to agree on a cache key, and writing them separately is
 * how they drift. This returns a matched pair.
 *
 * @param config - Namespace, fetch function, and cache lifetime.
 * @returns The resolver and the plugin function to register alongside it.
 */
export function createQueryResolver(opts: QueryResolverOptions): QueryResolverPackage {
	const staleTimeMs = opts.staleTimeMs ?? 5 * 60 * 1000;
	const timeoutMs = opts.timeoutMs ?? 10_000;
	const failureCooldownMs = opts.failureCooldownMs ?? 30_000;
	const onError = opts.onError ?? defaultOnError(opts.namespace);
	// One limit per resolver, shared by every engine that registers the package.
	const slots = createConcurrencyLimit(opts.maxConcurrent ?? 6);

	const queryKeyFor = (query: string) => [opts.namespace, query] as const;

	const provider = opts.provider ?? opts.namespace;

	async function fetchAndCache(query: string, signal: AbortSignal, queryClient: QueryClient): Promise<Value> {
		let release: (() => void) | undefined;
		let cleanup = (): void => {};
		try {
			// A slot first, so the timeout below counts the fetch and not the wait.
			// A free one is taken in this turn, so an uncontended fetch starts
			// exactly when it did before the limit; only a full set waits.
			release = slots.tryAcquire() ?? (await slots.acquire(signal));
			const timed = createTimeoutSignal(signal, timeoutMs, `${opts.namespace} query`);
			cleanup = timed.cleanup;
			const value = await settledOrAborted(opts.fetchQuery(query, timed.signal), timed.signal);
			// Stamped once, as it arrives and before it is cached, so every line
			// that reads it gets the same record. A fault is not a figure and
			// carries none; a package that set its own sources keeps them.
			if (value.sources === undefined && value.type !== ValueType.Error && value.type !== ValueType.Pending) {
				value.sources = [{ provider, kind: "live", fetchedAt: Date.now(), subject: query }];
			}
			return value;
		} catch (error) {
			const failedValue = onError(query, error);
			// Bound the failure's lifetime in the cache separately from
			// staleTimeMs (which is tuned for successful results), without
			// this, a transient failure would either be retried on every
			// keystroke or persist as "the answer" for the full staleTime.
			const cooldownTimer = setTimeout(() => {
				const current = queryClient.getQueryData(queryKeyFor(query));
				if (current === failedValue) {
					queryClient.removeQueries({ queryKey: queryKeyFor(query), exact: true });
				}
			}, failureCooldownMs);

			// Node keeps its event loop alive for any pending timer, so without
			// this each failed query holds the process open for the length of
			// the cooldown. That is wrong on its own terms: evicting a cache
			// entry is not a reason to keep a program running, and if nothing
			// else is alive there is no cache left to evict from. It showed up
			// as a test run that passed every assertion and then hung.
			//
			// `unref` is Node-only; browsers return a number from setTimeout
			// and need no equivalent, since a pending timer there does not keep
			// anything alive.
			(cooldownTimer as unknown as { unref?: () => void }).unref?.();

			return failedValue;
		} finally {
			cleanup();
			release?.();
		}
	}

	const resolver: IAsyncResolver = {
		namespace: opts.namespace,

		// The scan below keys on the plugin call, so a program without one is
		// never this resolver's and the engine need not ask. See
		// IAsyncResolver.watchedOpcodes.
		watchedOpcodes: [OpCode.CALL_PLUGIN, OpCode.CALL_PLUGIN_WIDE],

		preflight(
			_tokens: Token[],
			bytecode: BytecodeProgram,
			packageId: string,
			signal: AbortSignal,
			queryClient: QueryClient
		): AsyncCheckResult | null {
			const { opcodes, strings } = bytecode;
			const len = opcodes.length;
			let i = 0;

			while (i < len) {
				const op = opcodes[i] as OpCode;

				if (op === OpCode.CALL_PLUGIN && i + 2 < len) {
					const fnIdx = opcodes[i + 1];
					const argCount = opcodes[i + 2];

					if (
						fnIdx === opts.pluginFunctionIndex &&
						argCount >= 1 &&
						i >= 2 &&
						opcodes[i - 2] === OpCode.PUSH_STRING
					) {
						const query = strings[opcodes[i - 1]];
						const key = queryKeyFor(query);
						if (queryClient.getQueryData(key) === undefined) {
							const resolverPromise = queryClient.fetchQuery({
								queryKey: key,
								queryFn: ({ signal: qSignal }) => fetchAndCache(query, qSignal, queryClient),
								staleTime: staleTimeMs,
							});
							const result: AsyncCheckResult = {
								queryKey: key.join(":"),
								resolver: resolverPromise,
								packageId,
								signal,
								metadata: { query },
							};
							// A resolver that declares a cadence also hands the engine a way
							// to refetch this exact query on its own (staleTime 0, so each
							// background tick genuinely refetches rather than reading the
							// cache). query-core dedupes an already-in-flight fetch, which is
							// the back-pressure a slow source needs.
							if (opts.refetchIntervalMs !== undefined) {
								result.refetchIntervalMs = opts.refetchIntervalMs;
								result.refetch = () =>
									queryClient.fetchQuery({
										queryKey: key,
										queryFn: ({ signal: qSignal }) => fetchAndCache(query, qSignal, queryClient),
										staleTime: 0,
									});
							}
							return result;
						}
					}
					i += 3;
					continue;
				}

				// Step over this instruction and its operands. Shared table, because
				// three hand-copied versions of this had already drifted.
				i = nextInstruction(opcodes, i);
			}

			return null;
		},

		destroy(): void {
			// Cache cleared by ResolverRegistry.unregister() via removeQueries({ queryKey: [namespace] }).
		},
	};

	const pluginFunction = (args: Value[], context?: LineExecutionContext): Value => {
		const query = args[0]?.value as string;
		const cached = getActiveQueryClient()?.getQueryData(queryKeyFor(query));
		if (cached !== undefined) return cached as Value;
		// With live data switched off the engine never ran this resolver's
		// preflight, so an empty cache is the expected state and the reader is
		// told which setting produced it.
		if (context?.networkEnabled === false) {
			return errorValue("NETWORK_DISABLED", `Live data is switched off for this engine (network.enabled is false), so "${query}" was not fetched`);
		}
		// Otherwise preflight() guarantees this is cached before the VM ever
		// runs the CALL_PLUGIN that reaches here. This is an honest "shouldn't
		// happen" fallback, not a real code path.
		return errorValue(`${opts.namespace.toUpperCase()}_NOT_PREFLIGHTED`, `No cached result for "${query}"`);
	};

	return { resolver, pluginFunction };
}
