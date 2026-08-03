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
 * This module deliberately has no runtime imports. It is imported by `vm/`,
 * which `engine/` imports in turn, so a runtime dependency in this direction
 * would close a cycle. Every type it needs comes in through `import type`,
 * which is erased before the code runs.
 */

import type { Value } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";

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
}

/**
 * Create a context with empty registries.
 *
 * @returns A context owned by exactly one engine.
 */
export function createEngineContext(): EngineContext {
	return {
		pluginFunctions: {},
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
