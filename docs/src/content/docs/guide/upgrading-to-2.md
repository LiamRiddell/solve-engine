---
title: Upgrading to 2.0
description: Every breaking change in solve-engine 2.0, and the one edit each takes.
---

2.0 redesigns the public API: how you construct an engine, what an evaluation
returns, how you detect a failure, and which packages ship by default. Every
change below is mechanical to adopt, and each is shown as `before / now`. The
evaluation grammar itself, the expressions your users type, is unchanged.

If you only do one thing: swap `new ExpressionEngine(...)` for `createEngine()`
and drop the `[0]` off every `evaluateExpression`/`evaluateLine` result. That
covers the two changes almost every consumer hits.

## Packages are explicit now

The constructor used to register every built-in package. It now registers only
the packages you give it, so a bundler can drop the built-ins you never import.
A bare engine therefore recognises nothing: `2 + 2` on it is an undefined-token
parse error, not `4`.

For the "I want everything" case, `createEngine()` is batteries-included:

```typescript
// before
const engine = new ExpressionEngine();
// now
import { createEngine } from "solve-engine";
const engine = createEngine();
```

For a slim bundle, pass the packages you want. Import them individually from
`solve-engine/packages` so the rest tree-shake away, rather than filtering
`BUILTIN_PACKAGES` (which pulls the whole set into your bundle):

```typescript
import { ExpressionEngine } from "solve-engine";
import { ARITHMETIC_PACKAGE, UOM_PACKAGE } from "solve-engine/packages";
const engine = new ExpressionEngine({ packages: [ARITHMETIC_PACKAGE, UOM_PACKAGE] });
```

To add your own package on top of the built-ins, `createEngine` takes
`extraPackages`:

```typescript
const engine = createEngine({ extraPackages: [myPackage] });
```

## The constructor takes an options object

The five positional parameters
(`locale`, `diagnosticMode`, `config`, `diagnosticPipeline`, `packages`) become
a single `EngineOptions` object, and every field is optional:

```typescript
// before
new ExpressionEngine("en", false, config, undefined, packages);
// now
new ExpressionEngine({ locale: "en", diagnostics: false, config, packages });
```

The fields are `locale`, `packages`, `config` and `diagnostics`. The fourth
positional slot, an internal diagnostic-pipeline injection point no consumer
set, is gone. `fromJSON` (via `EngineRestoreOptions`) and the off-thread worker
runtime take the same shape.

## `config` is merged per section, so drop the spread

`config` now takes an `EngineConfigOverride`, a per-section deep partial merged
over the defaults. Name only the field you are changing; every other field in
that section keeps its default. The old shallow `Partial<EngineConfig>` needed
you to spread `DEFAULT_CONFIG` into any section you touched:

```typescript
// before
new ExpressionEngine("en", false, {
  vm: { ...DEFAULT_CONFIG.vm, maxCollectionSize: 1_000 },
});
// now
new ExpressionEngine({ config: { vm: { maxCollectionSize: 1_000 } } });
```

## `evaluateLine` and `evaluateExpression` return a Value

Both returned a single-element `Value[]`, an array kept only for API stability.
They now return the `Value` itself:

```typescript
// before
const [value] = engine.evaluateExpression("2 + 2 * 10");
// now
const value = engine.evaluateExpression("2 + 2 * 10");
value.toNumber(); // 22
```

Drop the destructuring or the `[0]` index wherever you read a result. The
`evaluateLineDetailed` method and the `LineEvaluation` and `EvalResults` types
are removed; `evaluateLine`/`evaluateExpression` are the surface.

The off-thread worker client mirrors this: its `evaluateExpression` now resolves
to a single `SerializedValue` rather than a `SerializedValue[]`.

## Faults are detectable, and `evaluateNumber` returns NaN

An `Error` or a `Pending` value reads as the number `0` through `toNumber()`,
so a caller that reached for the number without checking the type could not tell
a fault apart from a real zero. `Value` now carries the guards to make that
distinction, the same ones the engine uses internally:

```typescript
const value = engine.evaluateExpression("5 kg to m"); // an impossible conversion
value.isError();     // true
value.errorCode;     // "INCOMPATIBLE_UNITS"
value.errorMessage;  // "a mass cannot be converted to a length"
```

`isPending()` marks a value still waiting on async data, and `isFault()` covers
either. Check one before `toNumber()`.

`evaluateNumber` applies the same guard, and this is a behaviour change: a
faulted expression now returns `NaN` where it used to return a silent `0`.

| expression | `evaluateNumber`, before | now |
| --- | --- | --- |
| `5 kg to m` | `0` | `NaN` |

## Removed surface

Three groups of exports that registered into state nothing evaluated against, or
duplicated a canonical one, are gone.

**Package-provided variables.** `IEnginePackage.variableSources` (and
`IVariableSource`, `VariableResolver`, `IPackageRegistry.registerVariableSource`,
and the `solve-engine/variables` subpath) are removed. A source's variables were
registered into a resolver no evaluation path ever queried, so they were never
found during evaluation. A package that needs to expose a value contributes a
`pluginFunctions` entry instead.

**The global registration singleton.** The `PackageRegistry` class, the
`packageRegistry` singleton and the `IPackageRegistry` interface are removed.
They wrote into process-wide state no engine reads. Register on an engine:

```typescript
// before
import { packageRegistry } from "solve-engine";
packageRegistry.registerPackage(myPackage);
// now
engine.registerPackage(myPackage);
// or, at construction:
const engine = createEngine({ extraPackages: [myPackage] });
```

The `IEnginePackage` descriptor type is unchanged apart from the dropped
`variableSources` field, so a package that used only the other fields needs no
change.

**`symbolToCurrency`.** This backward-compatibility re-export of the currency
symbol alias table is removed; the table lives in `uom/CurrencyAliases.ts`.

## Snapshots carry their packages

A snapshot's compiled bytecode only lines up against the packages present when
it was written, and `fromJSON` registers no packages by default, exactly like
the constructor. Restore with the same set the snapshot was taken with:

```typescript
// a snapshot from a full engine
const restored = ExpressionEngine.fromJSON(state, { packages: BUILTIN_PACKAGES });
```

`fromJSON` also accepts `config`, `diagnostics` and a `locale` override, all
matching the constructor's option names (the option is `diagnostics`, not the
old `diagnosticMode`).

## Checklist

- [ ] `new ExpressionEngine(...)` → `createEngine()` or `new ExpressionEngine({ packages })`
- [ ] Drop `[0]` / destructuring off `evaluateExpression` and `evaluateLine` results
- [ ] Drop the `DEFAULT_CONFIG` spread from `config` overrides
- [ ] Replace `packageRegistry.registerPackage(...)` with `engine.registerPackage(...)`
- [ ] Remove any `variableSources` from your packages; expose values via `pluginFunctions`
- [ ] Pass `packages` to `fromJSON` when restoring a snapshot
- [ ] Check faults with `isError()`/`isFault()`, and expect `NaN` (not `0`) from `evaluateNumber` on a failure
