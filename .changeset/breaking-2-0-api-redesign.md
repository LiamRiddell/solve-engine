---
"solve-engine": major
---

The public API is redesigned for 2.0: an options-object constructor, a bare-value return, first-class fault detection, and the removal of long-dead surface.

## The constructor takes an options object

`ExpressionEngine` had five positional parameters, so a call that only wanted to pass a package list still had to spell out every slot before it. It now takes a single `EngineOptions` object, and every field is optional.

```typescript
// before
new ExpressionEngine("en", false, undefined, undefined, [ARITHMETIC_PACKAGE]);
// now
new ExpressionEngine({ packages: [ARITHMETIC_PACKAGE] });
```

The fields are `locale`, `packages`, `config` and `diagnostics`. `config` takes an `EngineConfigOverride`, a per-section partial merged over the defaults, so overriding one validation limit no longer means restating a whole config section. The fourth positional slot, an internal diagnostic-pipeline injection point no consumer set, is gone. `createEngine`, `fromJSON` and the worker runtime take the same shape.

## `evaluateLine` and `evaluateExpression` return a Value

Both methods returned a single-element `Value[]`, an array kept only for API stability. They now return the `Value` itself.

```typescript
// before
const [value] = engine.evaluateExpression("2 + 2 * 10");
// now
const value = engine.evaluateExpression("2 + 2 * 10");
value.toNumber(); // 22
```

`evaluateLineDetailed`, the `LineEvaluation` and `EvalResults` types are removed. The off-thread worker client's `evaluateExpression` collapses the same way, from `Promise<SerializedValue[]>` to `Promise<SerializedValue>`, so the two surfaces mirror each other.

## Faults are detectable, and no longer read as a silent zero

An `Error` or a `Pending` value reads as the number `0` through `toNumber()`, so a caller that reached for the number without checking the type could not tell a fault apart from a real zero. `Value` now carries the guards the engine already used internally:

```
expression            result
5 kg to m             isError() → true, errorCode → the conversion error
live price of silver  isPending() → true
2 + 2                 isFault() → false
```

`isError()`, `isPending()`, `isFault()` and the `errorCode` / `errorMessage` accessors make the distinction the engine makes. `evaluateNumber` applies it too: an impossible conversion returns `NaN` rather than the `0` that `toNumber()` would have handed back.

| expression | evaluateNumber, before | now |
| --- | --- | --- |
| `5 kg to m` | `0` | `NaN` |

## Removed long-dead surface

Three exports that registered into state nothing evaluated against are removed:

- `IEnginePackage.variableSources` (with `IVariableSource`, `VariableResolver`, `IPackageRegistry.registerVariableSource` and the `solve-engine/variables` subpath): a package's named-variable sources were registered into a resolver no evaluation path ever queried, so a variable a source declared was never found. A package that needs to expose a value contributes a `pluginFunctions` entry instead.
- The `PackageRegistry` class, its `packageRegistry` singleton and the `IPackageRegistry` interface: they wrote into process-wide singletons an engine does not read, since an engine builds its own parselet registry and its own lexer and classifies lines vocabulary-independently. Register on an engine instead, with `engine.registerPackage(pkg)` or `createEngine({ extraPackages })`.
- `symbolToCurrency`: a backward-compatibility re-export of the currency-symbol alias table, which has lived in `uom/CurrencyAliases.ts` since.

The `IEnginePackage` descriptor type is unchanged apart from the dropped `variableSources` field.

## Verification

- The whole engine suite runs against the new API: 7,787 tests in 342 suites, including the options-object construction, the bare-value return (its `Value[]` shape assertions inverted to assert a bare `Value`), the fault guards, and the package-unregistration lifecycle moved off the removed `variableSources` onto `completionItems`.
- Every construction and call site across the suite, the tools, the worker runtimes, the package smoke checks and the consumer-e2e probe was migrated; the destructures and `[0]` unwraps were verified type-clean before the runtime run.
- `npm run verify` (typecheck, `test:ci`, build, smoke, the bundled-consumer contract), plus `lint`, `lint:docs`, `lint:comments` and `lint:size`, all pass. Tree-shaking still holds: importing the engine plus one package bundles well under the full built-in set.
