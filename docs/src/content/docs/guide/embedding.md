---
title: Embedding the engine
description: Creating an engine, configuring it, and reading results.
---

```ts
import { createEngine } from "solve-engine";

const engine = createEngine({ locale: "en" });
```

The `locale` option decides decimal and thousands separators and the ambiguous
date order.

## Configuration

The `diagnostics` and `config` options enable diagnostics and override
configuration. Both are optional.

```ts
const engine = createEngine({
  config: {
    validation: {
      maxExpressionLength: 1000,
      maxComplexity: 500,
    },
  },
});
```

`config` is an `EngineConfigOverride`, merged per section over the defaults: name
only the fields you change and every other field keeps its default.

One section is a policy rather than a limit: `network.enabled`, on by default,
is the switch a host uses to stop every live-data fetch (weather, currency, and
any package resolver). With it off, those forms answer with an error naming the
setting instead of making a request. See
[switching live data off](/guide/async-and-live-data/#switching-live-data-off).

One option is a component rather than a setting: `calendar`, the backend the
engine computes dates with (which local day an instant falls on, what a month
later is, how a date is written out). It defaults to the built-in `Date`
backend, read in the process's time zone, and leaving it unset changes nothing.
It is the seam for a `Temporal` backend, shipped by a later release, that
carries a time zone of its own; see
[one calendar backend](/architecture/design-decisions/#one-calendar-backend-with-date-as-the-default).

Safety limits exist because the engine is designed to run on untrusted input as
someone types. They bound expression length, parse complexity, instruction
count, stack depth, and how many elements a range or matrix may be expanded to
by `map`/`reduce` (`vm.maxCollectionSize`, 100000 by default, which is what
stops a typo like `sum(x, 1:100000000)` from allocating until the host runs out
of memory). Each produces a clear error rather than hanging.

## Reading a result

```ts
import { ValueType } from "solve-engine/vm";

const value = engine.evaluateExpression("2 + 2");

value.type;        // ValueType.Number
value.toNumber();  // 4
value.unit;        // undefined
```

## Clearing state

An engine accumulates variables and cached results. Call `clear()` to reset it
between documents rather than constructing a new one, which is cheaper.

```ts
engine.clear();
```

## Snapshotting and restoring state

That accumulated state, the variables, the user-defined functions, and the
per-line result and bytecode caches, lives only in memory. `toJSON()` captures
it as a plain object, and `fromJSON()` restores it onto a fresh engine, so a
host can persist a session, warm-start a process, or move a document between
contexts without re-evaluating the whole thing from scratch.

```ts
import { createEngine, ExpressionEngine } from "solve-engine";
import { BUILTIN_PACKAGES } from "solve-engine/packages";

const engine = createEngine({ locale: "en" });
engine.parseDocument(":price = 100\ndouble(x) = x * 2\n:total = double(price)");

const state = engine.toJSON(); // a plain, JSON-safe object
const json = JSON.stringify(state); // store it anywhere

// Later, in another process:
const restored = ExpressionEngine.fromJSON(JSON.parse(json), { packages: BUILTIN_PACKAGES });
restored.evaluateExpression("double(total)"); // 400, with no re-evaluation
```

The snapshot is plain JSON. It survives `JSON.stringify` and `JSON.parse`
unchanged: `bigint`s are written as strings, non-finite numbers (`Infinity`,
`NaN`) are named rather than turned into `null`, and the compiled bytecode is
carried as ordinary arrays.

### Passing the same packages back

`fromJSON` rebuilds the engine with the snapshot's own locale but, by default,
no packages, exactly as the constructor does. Always pass the **same** `packages`
set the snapshot was taken with (`BUILTIN_PACKAGES` for a full engine): a snapshot
carries compiled bytecode whose plugin indices and operators only line up against
the packages that were present when it was written.

```ts
const restored = ExpressionEngine.fromJSON(state, { packages: myPackages });
```

`fromJSON` also accepts `config`, `diagnostics`, `calendar` and a `locale` override, all
matching the constructor.

### What is and is not carried

- **Carried:** variables, user-defined functions, the line cache (each line's
  result, compiled bytecode, and the variables it reads and writes, so
  incremental re-evaluation still works), and the expression-keyed bytecode
  cache.
- **Not carried: resolved async values.** Weather, stock, and currency results
  are point-in-time and must be re-fetched, not restored stale (see
  [Async and live data](/guide/async-and-live-data/)). Every line backed by an
  async resolver is dropped from the snapshot, along with any variable whose
  most recent definition came from one, so a restored engine re-fetches rather
  than serving a value from another moment.
- **Not carried: package-contributed state.** Only core engine state is
  snapshotted for now; a package opt-in is planned.
- **Deferred: symbolic (algebra) values.** A variable holding one makes
  `toJSON()` throw a clear, coded error rather than dropping it silently; a
  cached line whose result is symbolic is skipped and simply re-evaluates on
  restore.

### Refusing an incompatible snapshot

Every snapshot carries a format version. `fromJSON` restores only the version it
was built for and refuses anything else, or any object that is not a snapshot at
all, with a coded `SNAPSHOT_VERSION_MISMATCH` error rather than restoring it
wrongly.

```ts
import { EngineError } from "solve-engine/errors";

try {
  ExpressionEngine.fromJSON(fromAnOlderEngine);
} catch (e) {
  if (e instanceof EngineError && e.code === "SNAPSHOT_VERSION_MISMATCH") {
    // Regenerate the snapshot, or re-evaluate the document from source.
  }
}
```
