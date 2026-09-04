import type { QueryClient } from "@tanstack/query-core";
import type { Token } from "@solve-js/lexer";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import type { OpCode } from "@solve-js/parser/OpCode";
import { nextInstruction } from "@solve-js/parser/OperandWidth";
import type { Value } from "@solve-js/vm/Value";

/**
 * Result from a resolver's preflight() check.
 * Returned when async data is needed, the orchestrator uses this
 * to subscribe to the resolver and return a Pending value immediately.
 */
export interface AsyncCheckResult {
	/** Unique cache key for deduplication (e.g., "{packageId}:rates:USD:GBP") */
	queryKey: string;
	/** Promise that resolves to the final Value */
	resolver: Promise<Value>;
	/** Package owning this resolver */
	packageId: string;
	/** AbortSignal for stale-data prevention */
	signal: AbortSignal;
	/** Optional metadata for diagnostics */
	metadata?: Record<string, unknown>;
	/**
	 * Cadence, in ms, at which this value wants proactive background refresh
	 * (a live quote every minute, an FX rate every few minutes). Absent, or
	 * paired with no {@link refetch}, means pull-only: the value refreshes on
	 * re-evaluation, never on its own. Only acted on when the host has enabled
	 * background refresh; see {@link BackgroundRefreshConfig}.
	 */
	refetchIntervalMs?: number;
	/**
	 * Force a fresh fetch of this exact query, bypassing `staleTime`, and return
	 * the new value. Supplied alongside {@link refetchIntervalMs} so the engine
	 * can drive the background refresh without re-scanning bytecode.
	 */
	refetch?: () => Promise<Value>;
}

/**
 * Interface for async resolvers registered by packages/plugins.
 *
 * Each resolver handles a domain of async data (currency rates,
 * weather, stock prices, etc.). The preflight() method is called
 * BEFORE VM execution to check if all data is cached. If not,
 * it returns an AsyncCheckResult and the engine skips the VM,
 * returning a Pending value instead.
 */
export interface IAsyncResolver {
	/** Unique namespace for cache key scoping (e.g., "currency", "weather") */
	readonly namespace: string;

	/**
	 * True for a resolver that answers from engine state and never reaches a
	 * network: it waits on a value another line will produce, or reads a table
	 * the host loaded up front. Such a resolver keeps running when the host
	 * has switched live data off (`network.enabled: false`); every other
	 * resolver is skipped by that setting before its `preflight()` is called,
	 * so no request is ever started. Leave it unset (the default) for anything
	 * that fetches. The engine's own global-variable resolver is the built-in
	 * case that sets it.
	 */
	readonly local?: boolean;

	/**
	 * The opcodes this resolver's `preflight` keys on, when it keys on any.
	 *
	 * A preflight is a scan of a program for the instructions it can act on
	 * (a plugin call, a global read, a unit name pushed as a string), and it
	 * answers `null` for a program that has none of them. Naming those opcodes
	 * here lets the engine give that `null` without calling `preflight`, and
	 * lets a line no registered resolver could intercept skip the preflight,
	 * and the cancellation state it sets up, altogether. Six built-in packages
	 * register resolvers, so before this every plain line paid for seven scans.
	 *
	 * The declaration is a promise about `preflight`: for a program containing
	 * none of the listed opcodes it would have returned `null`. Where there is
	 * a choice, name the opcode an ordinary line does not carry: the currency
	 * resolver watches `PUSH_STRING`, which every unit name arrives as, rather
	 * than the `ADD` its scan also checks. Leave it unset (the default, and how
	 * an empty list is read) to be consulted for every program as before; the
	 * cost of not declaring is speed, never a missed lookup. A program that
	 * calls a plugin function is consulted with every resolver whatever it
	 * declared, see {@link ResolverRegistry.preflightAll}.
	 */
	readonly watchedOpcodes?: readonly OpCode[];

	/**
	 * Pre-flight check: called BEFORE VM execution.
	 *
	 * Returns null if all data for this expression is cached and ready.
	 * Returns an AsyncCheckResult if async work is needed.
	 *
	 * This method is synchronous, it only checks caches, never fetches.
	 * If data is missing, it creates a Promise and returns immediately.
	 *
	 * @param tokens - The lexed tokens for the expression
	 * @param bytecode - The compiled bytecode program
	 * @param pluginId - The plugin ID (for cache key scoping)
	 * @param signal - AbortSignal for the current evaluation
	 */
	preflight?(tokens: Token[], bytecode: BytecodeProgram, packageId: string, signal: AbortSignal, queryClient: QueryClient): AsyncCheckResult | null;

	/**
	 * Called when the resolver's namespace is being unregistered.
	 * Clean up any in-flight promises, clear caches, unsubscribe.
	 */
	destroy(): void;
}

/**
 * A resolver that has a `preflight`, with the mask of the opcodes it watches
 * over {@link ResolverRegistry}'s opcode bits, or 0 for one that declared none
 * and is consulted for every program.
 */
interface Preflighter {
	resolver: IAsyncResolver;
	mask: number;
}

/**
 * Registry of async resolvers, keyed by namespace.
 *
 * Plugins/packages register resolvers alongside their parselets
 * and opcode handlers. The engine calls preflightAll() before
 * VM execution to short-circuit async expressions.
 *
 * Lifecycle:
 * - register(), when a package is loaded
 * - unregister(), when a package is unloaded (clears cache entries)
 * - clear(), on document switch (clears all resolvers)
 */
export class ResolverRegistry {
	private resolvers = new Map<string, IAsyncResolver>();

	/**
	 * The resolvers with a preflight, in registration order, each with its
	 * opcode mask. Rebuilt with {@link opcodeBits} on every change to the map
	 * above, which happens at package registration and not per line, so the
	 * per-program question below is a table lookup.
	 */
	private preflighters: Preflighter[] = [];

	/** One bit per opcode some resolver watches, indexed by opcode value; 0 for an opcode none watches. */
	private opcodeBits = new Int32Array(256);

	/** How many preflighting resolvers declared no opcodes, and so are consulted for every program. */
	private consultedForEverything = 0;

	/**
	 * Register an async resolver.
	 *
	 * Each resolver must have a unique `namespace`. If a resolver with the
	 * same namespace is already registered, the old one is destroyed and
	 * replaced (with a console warning). Packages that need multiple async
	 * operations should use `asyncResolvers: [...]` with distinct namespaces
	 * (e.g., `"weather:current"`, `"weather:forecast"`).
	 */
	register(resolver: IAsyncResolver): void {
		// Clean up previous resolver with same namespace if any
		if (this.resolvers.has(resolver.namespace)) {
			console.warn(
				`[ResolverRegistry] Namespace "${resolver.namespace}" already registered. ` +
				`Destroying old resolver and overwriting. Use distinct namespaces ` +
				`(e.g., "${resolver.namespace}:sub1", "${resolver.namespace}:sub2") ` +
				`to avoid collisions when a package needs multiple async resolvers.`,
			);
			this.resolvers.get(resolver.namespace)!.destroy();
		}
		this.resolvers.set(resolver.namespace, resolver);
		this.rebuildIndex();
	}

	/**
	 * Unregister a resolver by namespace.
	 * Calls destroy() and clears all cache entries with that namespace prefix.
	 */
	unregister(namespace: string, queryClient?: QueryClient): void {
		const resolver = this.resolvers.get(namespace);
		if (resolver) {
			resolver.destroy();
			this.resolvers.delete(namespace);
			this.rebuildIndex();
		}
		// Clear all cache entries for this namespace via TanStack Query
		// Hierarchical keys: ["osrs"] clears all ["osrs", ...] queries
		if (queryClient) {
			queryClient.removeQueries({ queryKey: [namespace] });
		}
	}

	/**
	 * Rebuild the preflight index from the registered resolvers. Called on
	 * every registration change, never per line.
	 */
	private rebuildIndex(): void {
		const bits = new Int32Array(256);
		const preflighters: Preflighter[] = [];
		let nextBit = 0;
		let everything = 0;
		for (const resolver of this.resolvers.values()) {
			if (!resolver.preflight) continue;
			const watched = resolver.watchedOpcodes;
			if (!watched || watched.length === 0) {
				everything++;
				preflighters.push({ resolver, mask: 0 });
				continue;
			}
			let mask = 0;
			for (const op of watched) {
				if (bits[op] === 0) {
					// Thirty-two bits cover the handful of opcodes real resolvers
					// watch. Past that, every further opcode shares the last bit,
					// which only makes the skip less selective, never wrong.
					bits[op] = 1 << Math.min(nextBit++, 31);
				}
				mask |= bits[op];
			}
			preflighters.push({ resolver, mask });
		}
		this.opcodeBits = bits;
		this.preflighters = preflighters;
		this.consultedForEverything = everything;
	}

	/**
	 * The mask of watched opcodes `program` contains.
	 *
	 * Scanned on every call rather than remembered per program: a line is a
	 * dozen table reads, about the cost of one map lookup, and a per-program
	 * `WeakMap` measurably slowed the fresh-engine benchmarks, since every
	 * live entry is an ephemeron the collector has to visit.
	 */
	private programMask(program: BytecodeProgram): number {
		const { opcodes } = program;
		const bits = this.opcodeBits;
		let mask = 0;
		for (let i = 0; i < opcodes.length; i = nextInstruction(opcodes, i)) {
			mask |= bits[opcodes[i]];
		}
		return mask;
	}

	/**
	 * Whether any registered resolver could return a result for `program`:
	 * one that declared no opcodes is registered, or the program contains an
	 * opcode some resolver watches. False means {@link preflightAll} would
	 * consult nothing and answer null, so the caller can skip the preflight
	 * and the cancellation state it would arm. A plugin call is not special
	 * here; the engine forces the preflight for one itself.
	 *
	 * @param program - The compiled program about to execute.
	 * @returns True when a preflight could intercept it.
	 */
	mayIntercept(program: BytecodeProgram): boolean {
		if (this.consultedForEverything > 0) return true;
		if (this.preflighters.length === 0) return false;
		return this.programMask(program) !== 0;
	}

	/**
	 * Run the registered resolvers' preflight checks against compiled bytecode.
	 *
	 * Returns the first AsyncCheckResult found, or null if all data is ready.
	 * Short-circuits on first pending, subsequent pending ops will be
	 * discovered on re-evaluation when the first resolves.
	 *
	 * A resolver that declared {@link IAsyncResolver.watchedOpcodes} is asked
	 * only about a program containing one of them. A program that calls a
	 * plugin function (`hasAsync`) keeps the full pass whatever the resolvers
	 * declared: it is the one shape whose pending path the VM itself rests on,
	 * and the opcode gate exists to spare the plain line, not to trim a line
	 * that already does live work.
	 *
	 * With `networkEnabled` false, only resolvers that declare themselves
	 * {@link IAsyncResolver.local} are consulted. The skip happens here, before
	 * `preflight()` runs, because a resolver's preflight is what starts the
	 * fetch: refusing its promise afterwards would already be too late.
	 */
	preflightAll(tokens: Token[], bytecode: BytecodeProgram, packageId: string, signal: AbortSignal, queryClient: QueryClient, networkEnabled = true): AsyncCheckResult | null {
		// The watched opcodes this program carries, found on first need.
		let present: number | undefined;
		for (const { resolver, mask } of this.preflighters) {
			if (mask !== 0) {
				if (present === undefined) present = bytecode.hasAsync ? -1 : this.programMask(bytecode);
				if ((present & mask) === 0) continue;
			}
			if (!networkEnabled && !resolver.local) continue;
			// Read at call time rather than captured at registration, so a
			// resolver whose preflight is replaced afterwards is still honoured.
			if (!resolver.preflight) continue;
			const result = resolver.preflight(tokens, bytecode, packageId, signal, queryClient);
			if (result) return result;
		}
		return null;
	}

	/**
	 * Get a resolver by namespace.
	 * Returns undefined if no resolver is registered for that namespace.
	 */
	get(namespace: string): IAsyncResolver | undefined {
		return this.resolvers.get(namespace);
	}

	/** Number of registered resolvers. */
	get size(): number {
		return this.resolvers.size;
	}

	/**
	 * Check if a resolver is registered for the given namespace.
	 */
	has(namespace: string): boolean {
		return this.resolvers.has(namespace);
	}

	/**
	 * Clear all resolvers (document switch, engine reset).
	 * Calls destroy() on each resolver and clears the map.
	 */
	clear(): void {
		for (const resolver of this.resolvers.values()) {
			resolver.destroy();
		}
		this.resolvers.clear();
		this.rebuildIndex();
	}
}
