/**
 * QueryClient factory for the solve-js engine.
 *
 * Creates a TanStack Query QueryClient with sensible defaults for
 * stale-while-revalidate, garbage collection, and retry behavior.
 * The QueryClient is injected into resolvers via the engine, so
 * no global singleton is needed.
 *
 * Removed in this refactor:
 * - DataQueryWorker (worker thread), doesn't solve anything in Obsidian's single-threaded env
 * - localCache (raw Map), replaced by TanStack Query's built-in cache
 * - pendingQueries (manual promise plumbing), TanStack Query handles dedup
 * - DataSourceHandle, registerDataSource, unregisterDataSource, no longer needed
 * - cleanupCache timer, TanStack Query's gc does this automatically
 * - cacheUpdateListeners / errorListeners, TanStack Query has its own observer API
 */

import { QueryClient } from "@tanstack/query-core";

// ── Active query client (deprecated hand-off) ─────────────────────────────
// A plugin function reads its engine's QueryClient from the line's execution
// context now (`LineExecutionContext.queryClient`, #710). This one slot for the
// whole process is kept for handlers written before that: the VM sets it to the
// running engine's client at every plugin call, so it names the right cache at
// the moment a handler reads it.

let _activeQueryClient: QueryClient | null = null;

/**
 * Publish a QueryClient in the module-level slot.
 *
 * @deprecated The engine hands its client to every plugin function in the
 * line's execution context (`context.queryClient`), and the VM keeps this slot
 * in step on its own. Removed in 3.0.
 */
export function setActiveQueryClient(qc: QueryClient | null): void {
  _activeQueryClient = qc;
}

/**
 * The QueryClient of the engine whose plugin function is running, if any.
 *
 * @deprecated Read `context.queryClient` from the `LineExecutionContext` a
 * plugin function is handed, which names that line's engine however many
 * engines share the process. Removed in 3.0.
 */
export function getActiveQueryClient(): QueryClient | null {
  return _activeQueryClient;
}

/**
 * Create a new TanStack Query QueryClient with project defaults.
 * Each engine instance gets its own client for isolation.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,       // 5 minutes
        gcTime: 10 * 60 * 1000,          // 10 minutes
        retry: 3,
        retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 5000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,       // Not relevant in Obsidian plugin context
      },
    },
  });
}
