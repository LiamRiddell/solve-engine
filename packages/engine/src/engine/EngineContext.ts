/**
 * Per-engine state that used to live in module-level singletons.
 *
 * Two {@link ExpressionEngine} instances in one process could not be isolated
 * from each other, because the registries they depend on were module globals
 * shared by every instance. Registering a package mutated state that another
 * engine was already reading. Tests worked only because they cleared those
 * globals by hand, and per-document engines were safe only because
 * registration happened to be idempotent.
 *
 * An `EngineContext` is created by the `ExpressionEngine` constructor and owned
 * by that engine. Anything that needs one of these registries receives the
 * context rather than importing a singleton.
 *
 * Runtime imports here are restricted to leaf modules of `vm/`. This file is
 * imported by `vm/`, which `engine/` imports in turn, so pulling in anything
 * that reaches back into `engine/` would close a cycle. `OpRegistry` is safe
 * because it imports only types plus the error factory. Everything else arrives
 * through `import type`, which is erased before the code runs.
 */

import type { Value } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { OpRegistry } from "@solve-js/vm/OpRegistry";

/**
 * A function a package contributes to the VM, reachable from bytecode through
 * `CALL_PLUGIN`.
 *
 * Returning a promise puts the line into the pending state rather than
 * blocking: the engine resolves it and re-executes.
 */
export type PluginFunctionHandler = (
	args: Value[],
	context?: LineExecutionContext,
) => Value | Promise<Value>;

/**
 * The registries one engine instance owns.
 *
 * Members are added here as each former singleton is migrated. The migration
 * order is deliberate and recorded in `docs-internal/plans`: plugin functions,
 * then the opcode registry, the variable resolver, the lexer, and finally
 * currency exchange. The lexer comes near the end because package registration
 * writes vocabularies into it, so moving it early would churn every package.
 *
 * Currency exchange is deliberately NOT migrated, which is a departure from
 * that plan. `CurrencyExchangeService` holds a cache of live market rates with
 * a fifteen minute freshness window and no per-engine configuration. Sharing is
 * the correct behaviour there: giving each engine its own would make two
 * engines in one process fetch the same public endpoint independently, and let
 * them disagree about the rate for one currency pair at one moment. The
 * singleton rationale, that one engine's registration should not be visible to
 * another, does not apply to a cache of state that is global in the real world.
 *
 * If a host ever needs per-engine rates, for a what-if scenario against
 * historical figures, the answer is an optional override on the context that
 * falls back to the shared cache, not a private copy per engine.
 */
export interface EngineContext {
	/**
	 * Package-contributed VM functions, keyed by the index the bytecode
	 * carries.
	 *
	 * Indices come from `allocatePluginFunctionIndex()`. Two packages picking
	 * the same number by hand would silently overwrite one another, which is
	 * why the allocator exists and why nothing should hardcode an index.
	 */
	readonly pluginFunctions: Record<number, PluginFunctionHandler>;

	/**
	 * Custom opcode handlers a package registered.
	 *
	 * Largely vestigial: packages reach the VM through `CALL_PLUGIN` and
	 * {@link EngineContext.pluginFunctions} now, and nothing in the built-in
	 * set registers an opcode. It moves here anyway because the VM interface
	 * still requires a registry, and one shared instance would put any future
	 * registration back into every engine at once.
	 */
	readonly opRegistry: OpRegistry;

	/**
	 * Which package registered each plugin function index.
	 *
	 * The VM emits a pending result when a plugin function returns a promise,
	 * and that result carries the owning package so diagnostics and the error
	 * surface can name it. Without this the VM had nothing to report and sent an
	 * empty string, so every async failure looked as though it came from
	 * nowhere.
	 */
	readonly pluginFunctionOwners: Record<number, string>;

	/**
	 * Whether this engine may fetch live data, from `network.enabled` in the
	 * engine's configuration.
	 *
	 * Lives on the context rather than only on the engine because the VM is
	 * where a plugin function's promise is first seen and where a currency
	 * conversion discovers it has no rate. Both need to answer "live data is
	 * switched off" rather than "no rate available" or "result discarded", and
	 * the context is the one object every VM already holds.
	 */
	readonly networkEnabled: boolean;
}

/** What {@link createEngineContext} takes: the settings a context carries on the engine's behalf. */
export interface EngineContextOptions {
	/** Whether live data may be fetched. Defaults to true, the historic behaviour. See `NetworkConfig`. */
	networkEnabled?: boolean;
}

/**
 * Create a context with empty registries.
 *
 * @param options - Settings the context carries for the VM; see {@link EngineContextOptions}.
 * @returns A context owned by exactly one engine.
 */
export function createEngineContext(options: EngineContextOptions = {}): EngineContext {
	return {
		pluginFunctions: {},
		opRegistry: new OpRegistry(),
		pluginFunctionOwners: {},
		networkEnabled: options.networkEnabled ?? true,
	};
}

/**
 * The context backing the deprecated module-level exports.
 *
 * Exists so the `shared*` singletons can keep working, against real state,
 * while callers move across one at a time. It is not a fallback for an engine
 * that forgot to make its own: an engine always creates its own context, and
 * anything reaching for this one is code that has not been migrated yet.
 *
 * @deprecated Take an {@link EngineContext} instead. This is removed once the
 * migration finishes.
 */
export const defaultEngineContext: EngineContext = createEngineContext();
