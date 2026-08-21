---
"solve-engine": minor
---

Snapshot and restore engine state. A session can be persisted and warm-started rather than re-evaluated.

Everything a session builds up, its named variables, its user-defined functions, and its per-line result and bytecode caches, lived only in memory, so a host that wanted to persist a document, warm-start a process, or move a document between contexts had to re-evaluate the whole thing. That gets slower with the document, and it re-runs every async resolver as a side effect.

`engine.toJSON()` now captures that state as a plain object, and `ExpressionEngine.fromJSON(state, { packages })` restores it onto a fresh engine that answers later expressions exactly as the one that evaluated the document would have:

```ts
const state = engine.toJSON();
const engine = ExpressionEngine.fromJSON(state, { packages });
```

The snapshot is plain JSON and survives `JSON.stringify`/`JSON.parse` unchanged: a `bigint` is written as a string, a non-finite number (`Infinity`, `NaN`) is named rather than turned into `null`, and the compiled bytecode is carried as ordinary arrays. Exact money and exact fractions keep their sidecars, so `$0.10 + $0.20` is still exactly `$0.30` and `1/3 + 1/3 + 1/3` is still exactly `1` after a restore.

What is carried: variables, user-defined functions, the line cache (each line's result, bytecode, and the variables it reads and writes, so incremental re-evaluation still works), and the expression-keyed bytecode cache.

What is deliberately not carried: **resolved async values**. Weather, stock and currency results are point-in-time and must be re-fetched, not restored stale, so every line backed by an async resolver is dropped from the snapshot, along with any variable whose most recent definition came from one. Package-contributed state is not carried either (core engine state only for now, a package opt-in is planned), and symbolic algebra values are deferred: a variable holding one makes `toJSON()` throw a clear, coded error rather than dropping it silently, and a cached line whose result is symbolic is skipped and re-evaluates on restore.

Every snapshot carries a format version. `fromJSON` restores only the version it was built for and refuses anything else, or any object that is not a snapshot, with a coded `SNAPSHOT_VERSION_MISMATCH` error rather than restoring it wrongly. Restoring requires the same package set the snapshot was taken with, since the carried bytecode's plugin indices and operators line up against the packages that were present when it was written.
