# Architecture improvements

This file has two parts. The first records where each item of the original
improvement plan stands, against the tree as it is. The second is the order the
remaining structural work is done in for the rest of 2.x, and what is held for
3.0.

The original plan was written while the engine still lived inside the Obsidian
plugin, so its paths (`src/solve-js`, `src/app`, `@/solve-js/...`) and several of
its tasks described code that is now in another repository or no longer exists.
The engine is `packages/engine/src`; the playground's shared glue is
`packages/playground-bridge/src`; the plugin is `obsidian-solve`, which tracks its
own work. Where a row below names no commit, the change predates the history
this repository keeps (the retained log starts at #493), and the row cites the
file that shows it instead.

`CROSS_SCOPE_CELLS.md` beside this file is a separate, current plan (document
scoped cells, replacing the flat `global :name` store). It is linked from here,
not merged: its Release D completes one part of L1.

## Part I: status of the original items

| Item | What it asked for | Status | Settled by |
| --- | --- | --- | --- |
| Task 1 | One evaluation pipeline instead of three copies in `ExpressionEngine` | Partly done | Step 1 shipped: `prepareExpression()` backs both `evaluateWithTokens()` and `compileExpression()`. Step 2 did not: `evaluateExpressionWithDiagnostic()` is still its own path, and it is the one `evaluateLine()` runs (through `evaluateLineWithDebug()`), not a diagnostics-only copy. What remains is folding it onto `prepareExpression()`, with every early exit enumerated first. |
| Task 2 | Unregistering a package removes what it registered | Done | `ExpressionEngine.unregisterPackage()`; the registries it cleans up are per-engine since L1's first steps, so nothing leaks into another engine. |
| Task 3 | One engine per editor pane rather than a process-wide `EngineProvider` | Moved | Plugin-side (`EngineProvider`, `MarkdownEditorViewPlugin`): belongs in obsidian-solve's tracker. The engine half, two engines in one process not interfering, is L1. |
| Task 4 | Deduplicate the playground's two engine bridges | Done | The shared assembly lives in `packages/playground-bridge/src/engineShared.ts`. The playground files the plan named (`playground/src/engine.ts`, `playground/src/engineShared.ts`) do not exist. |
| Task 5 | Replace `EvalResults`' hidden `errors` property with an explicit type | Dropped | Superseded. `evaluateLine()` returns one `Value` and throws a coded `EngineError`; a document line's failure is `ParsedLine.error` with `errorCode` and `errorSpan` (#709, 1f253f6). There is no `EvalResults` left to replace. |
| Task 6 | Commit commands stop driving edits through DOM clicks | Moved | Plugin-side: belongs in obsidian-solve's tracker. |
| Task 7 | No hard-coded offline currency rates | Done | `CurrencyExchangeService` serves a fetched rate synchronously for `RATE_FRESHNESS_MS` (15 minutes) and otherwise falls through to the async path; the fallback table is gone (`uom/CurrencyExchange.ts`). |
| Task 8 | The batcher patches line results directly | Done | `AsyncResolutionBatcher.onLineResult`. |
| Task 9 | Typed batcher metrics | Done | `pendingCount`, `listenerCount` and `workerOffloadCount` accessors, read by `getBatcherMetrics()`. |
| L1 | `EngineContext`: per-engine state instead of module globals | Partly done | `engine/EngineContext.ts` exists and is created and owned by the `ExpressionEngine` constructor. Plugin functions, the opcode registry, plugin-call results, the network switch, the calendar and the cell scope are on it. What remains is #710: `as` converters, token categories, plugin indices and the query client hand-off (`setActiveQueryClient`) are still process-wide, and the `global :name` store is realm-wide until `CROSS_SCOPE_CELLS.md` Release D. Currency exchange stays shared on purpose (the header of `EngineContext.ts` gives the reason). The deprecated aliases `pluginFunctionRegistry` and `sharedOpRegistry` are removed in 3.0. |
| L2 | One reactive line-result store | Not planned for 2.x | Task 8 removed the cost that motivated it. The three stores (`LineCache`, `DocumentModel`, the query cache) remain; unifying them is a maintainability project with no reader-facing fault attached, and is reconsidered for 3.0 only if the evaluator seams (#761) make it necessary. |
| L3 | Bundle diet | Done, in the engine's own terms | The plugin-era half (`main.js`, `moment`, `animate.css`) belongs to obsidian-solve. For the engine: `sideEffects: false` with `smoke:bundled` proving it, `size-limit` and `lint:size` holding the figures, and per-package chunks (#766, c2b39b5). |
| L4 | CI adoption | Done | `.github/workflows/` holds `ci.yml`, `publish.yml`, `benchmarks.yml`, `fuzz.yml`, `coverage.yml`, `codeql.yml`, `live-network.yml` and `pages.yml`; `lint:ci-parity` keeps `verify:ci` and the pull-request jobs in step. The plan's release that attached `main.js`, `styles.css` and `manifest.json` was the plugin's; the engine publishes to npm from a GitHub Release (see the releasing page). |
| L5 | Value immutability guard | Done | `freezeIfDev()` (`vm/Value.ts`), applied at the evaluation boundary. The lint half stays not done, for the reason recorded at the time: a syntax-only rule cannot tell a `Value` from other `.value` fields. |
| L6 | One worker file and one pool | Partly done | One `workers/engine.worker.ts`. `CompilationWorkerManager` and `ExecutionPool` keep their own pooling policy, deliberately; the internal offload's correctness fault is fixed (#661). |
| L7 | Structured errors reach the host | Done | A failed line keeps its code and span (`ParsedLine.errorCode`, `errorSpan`), parse errors are worded in the reader's terms, and every code is catalogued (#709, #836, #768, #769, 1f253f6). |

## Part II: the rest of 2.x, in order

Each phase is its own change with its own spec, in the order below; a later
phase depends on an earlier one where it says so. Items the survey placed in
this list that have since shipped are marked, so the order still reads whole.

1. **Snapshot format v2.** Shipped: `SNAPSHOT_VERSION` is 2, naming the plugin
   function behind every compiled call, and a version 1 snapshot still restores
   (#658, def27fc).
2. **Structured diagnostics on document lines.** Shipped with L7 (#709).
3. **One per-pass work budget.** Shipped: a note has a work budget and a ceiling
   on what it keeps (#711, #694, 0c9cd59).
4. **Per-package chunks.** Shipped (#766, c2b39b5).
5. **Finish L1** (#710). Move `as` converters, token categories and plugin
   indices onto `EngineContext`, and retire the `setActiveQueryClient`
   hand-off, so two engines in one process share nothing a package registered.
   Before 6, because the seams it hides include these registries.
6. **Hide the evaluator seams** (#761). `ExpressionEngine` stops publishing live
   internals (`getBytecodeCache()` hands out the live `Map`, and one write to it
   changes what `2 + 2` answers). Task 1 step 2 is done in the same phase, since
   the diagnostic path is the main reader of those seams.
7. **An interval index for span dependencies** (#733). A span aggregate
   (`total above`, a line range) stores one dependency edge per line it reads;
   an index over line intervals replaces the edges, so a long note of totals
   does not hold hundreds of megabytes through `evaluateDocument`.
8. **The internal worker offload.** Its correctness fault is fixed (#661); what
   remains is deciding whether it stays on by default once 7 lands, measured by
   the benchmarks rather than assumed.
9. **A word-alias extension point.** A package can give an existing function or
   phrase another name without writing a parselet, documented with its own
   guide under `packages/` as the developer-side rule requires.

## What 3.0 carries

- The removals the deprecations already name: `pluginFunctionRegistry` and
  `sharedOpRegistry`, and `createVM()`'s registry parameter.
- The cross-scope cells of `CROSS_SCOPE_CELLS.md`, whose spelling change is a
  break for notes that use `global :name` today.
- L2, if 6 shows the three result stores cannot be kept consistent behind a
  closed surface.

## Deliberately not planned

- Alternate evaluation backends or a JIT: no measurement shows the VM is the
  bottleneck.
- Plugin-side work (Tasks 3 and 6, the plugin's bundle and release): tracked in
  obsidian-solve.

## The gate

Each phase runs `npm run verify:ci`, the list continuous integration runs. The
test and suite counts are in `docs/src/data/testStats.json`, regenerated by
`npm run stats:tests`, rather than typed here.
