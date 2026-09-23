/**
 * The identity of a scope that owns cross-document cells (`global :name`).
 *
 * A scope is the answer to "whose value is this": a program executing under
 * scope S writes only cells owned by S, and a cross-scope read names the scope
 * it reaches into. Today the engine mints one anonymous scope per engine and
 * every line runs under it, so the concept is present but never distinguishes
 * one writer from another. It is the seam the workspace model in
 * `docs-internal/plans/CROSS_SCOPE_CELLS.md` builds on: Release D replaces the
 * realm-wide {@link GlobalVariableStore} with a scope-keyed store, at which
 * point two documents writing `global :total` stop clobbering because each owns
 * a distinct scope.
 *
 * The type is opaque on purpose. A `ScopeId` is minted by {@link mintScope} and
 * never constructed, compared or interpreted by a caller: the brand makes an
 * ordinary number that happens to share its value a type error, so nothing can
 * forge a scope or reach into one it was not handed. This mirrors the design's
 * "minted, never supplied" rule, where a host receives a handle it cannot look
 * inside.
 *
 * Distinct from `vm/ScopeManager.ts`, which is the unrelated lexical scope of a
 * document's own `:x` local variables.
 */
export type ScopeId = number & { readonly __cellScope: unique symbol };

/**
 * The next scope number this realm will hand out. Module-level so ids are
 * unique within a realm without a shared registry; a worker realm keeps its
 * own counter, which is correct, since its store is a separate realm's
 * singleton and its scopes are its own.
 *
 * Unlike the singletons the {@link EngineContext} migration is retiring, this
 * holds no engine state a second engine could observe: it only guarantees that
 * two mints never collide.
 */
let nextScopeNumber = 0;

/**
 * Mint a fresh scope, distinct from every scope minted before it in this realm.
 *
 * Called once per engine, from `createEngineContext`, to give the engine its
 * anonymous owning scope. It carries no meaning beyond identity: the number is
 * an implementation detail the {@link ScopeId} brand hides.
 */
export function mintScope(): ScopeId {
	nextScopeNumber += 1;
	return nextScopeNumber as ScopeId;
}
