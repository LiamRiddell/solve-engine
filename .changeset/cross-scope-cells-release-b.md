---
"solve-engine": patch
---

Cross-document cells carry the scope that owns them, and notify outside the value arena

Internal groundwork for the workspace model in `docs-internal/plans/CROSS_SCOPE_CELLS.md`, with no change a caller can observe. Two seams land together.

Every line now executes under a scope: the owner of a `global :name` cell it writes. The engine mints one anonymous scope per instance, carried on the execution context and set everywhere a context is built, the per-pass context, the fresh context a goal-seek probe allocates, and the hand-built context the async pipeline re-runs a settled line under. A run with no context of its own, a warm-up, the worker, a lone `evaluateExpression`, falls back to the engine's own scope. Nothing keys on the scope yet: the store stays realm-wide and keyed on the bare name, so two documents writing `global :total` still share one cell, exactly as before.

A cell's notification now waits. During an evaluation pass the write still lands in the store at once, so a later line reads what an earlier one wrote, but the notification to listeners, a document's dirty marking and an async read's first-write promise, is staged and replayed in write order once the pass leaves the value arena, rather than firing synchronously mid-dispatch from inside it. A document's own dependents are marked through the dependency graph regardless, and another document re-evaluates on its own cadence after the pass returns either way, so the move is invisible. What it buys is a listener that may legitimately drive another pass, which a callback firing from inside the arena window cannot.

The boundary: this is the seam, not the feature. Keying the store by scope so two documents' cells stop sharing, refusing a write to a foreign scope, and staging the writes rather than only their notifications, are the workspace model (Release D), not this change.

## Verification

`npm run verify:ci` passes: 9,506 tests across 486 suites. The scope seam and the buffered notification are proven inert three ways. Every existing assertion is unchanged. The document differential fuzz reports zero disagreements over 2,400 sessions, the incremental path, where the staged notification lives, agreeing with a settled from-scratch oracle after every edit. New unit tests pin the staging order, read-your-writes during a pass, nested-pass flushing, and one anonymous scope per engine.
