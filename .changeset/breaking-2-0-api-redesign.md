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

## Package descriptors are keyed, not lists

A package's parselets and plugin functions were declared as arrays of little wrapper objects, and every plugin function carried a hand-allocated numeric index the author had to mint and thread through to the parselet that emitted it. Both are now keyed records, and the index is gone from the author's hands.

`prefixParselets` and `infixParselets` move from an array of `{ tokenType, parselet }` to a record keyed by token type:

```typescript
// before
prefixParselets: [{ tokenType: "COLOUR_CALL", parselet: new ColourCallParselet() }],
// now
prefixParselets: { COLOUR_CALL: new ColourCallParselet() },
```

`pluginFunctions` moves from an array of `{ index, handler }` to a record keyed by a package-local name. The engine assigns each name a `CALL_PLUGIN` index at registration, and a parselet emits the call by that name through the new `builder.emitPluginCall(name, argCount)`, never touching a numeric index:

```typescript
// before
const LIGHTEN_FN_IDX = allocatePluginFunctionIndex();
pluginFunctions: [{ index: LIGHTEN_FN_IDX, handler: lightenHandler }],
// in the parselet:
builder.emitOpcode(OpCode.CALL_PLUGIN);
builder.emitIndex(LIGHTEN_FN_IDX);
builder.emitIndex(argCount);

// now
pluginFunctions: { lighten: lightenHandler },
// in the parselet:
builder.emitPluginCall("lighten", argCount);
```

The old shape leaked an engine-internal detail, a process-global index counter, into every package author's code, and made a whole class of mistakes possible: two functions sharing an index, a parselet emitting an index its descriptor never registered, an index registered but never emitted. Naming the function once and letting the engine own the index removes all of them; a name a parselet emits but no descriptor declares is now a registration-time error, not a silent mis-dispatch. Two packages naming a function the same is a `checkPackageCompatibility` warning, resolved by the later registration, exactly as the other cross-package collisions already are.

The boundary: an async resolver that scans *compiled* bytecode still works in numeric indices, because that is what bytecode is. Such a resolver looks its own function's index up by the qualified name the engine files it under (`pluginFunctionIndexFor("<package>:<name>")`) rather than owning a constant, so it reads the same index the engine assigned. The `examples/osrs` Grand Exchange resolver is the worked example.

## Verification

- The whole engine suite runs against the new API: 7,787 tests in 342 suites, including the options-object construction, the bare-value return (its `Value[]` shape assertions inverted to assert a bare `Value`), the fault guards, and the package-unregistration lifecycle moved off the removed `variableSources` onto `completionItems`.
- Every construction and call site across the suite, the tools, the worker runtimes, the package smoke checks and the consumer-e2e probe was migrated; the destructures and `[0]` unwraps were verified type-clean before the runtime run.
- `npm run verify` (typecheck, `test:ci`, build, smoke, the bundled-consumer contract), plus `lint`, `lint:docs`, `lint:comments` and `lint:size`, all pass. Tree-shaking still holds: importing the engine plus one package bundles well under the full built-in set.
