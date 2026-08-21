---
"solve-engine": minor
---

A test kit for package authors, under `solve-engine/testing`.

A package author had no supported way to test a package. The engine's own suites are thorough and internal, so anyone writing a package either reached into internals or asserted on whatever bytecode a parselet emitted, which pins the implementation rather than the behaviour: a refactor that keeps every answer correct still breaks the tests.

The new entry point speaks in expressions. `createTestEngine` builds an engine with the built-ins and the package under test, and `expectExpression` evaluates a string and matches on the result or the failure code:

```ts
import { createTestEngine, expectExpression } from "solve-engine/testing";

const engine = createTestEngine([myPackage]);
expectExpression(engine, "2 gp + 3 gp").toEqual(5, "gp");
expectExpression(engine, "gp").toFailWith("UNDEFINED_VARIABLE");
```

`toFailWith` reads the same error code whether the engine threw it or a plugin returned it, so a package's own codes are matched the way the built-in ones are. `toEvaluate`, `toBeError` and `toBePending` cover the coarser cases, and `.value` exposes the raw result for anything the matchers do not.

`expectPackage` catches the three mistakes a package actually makes, from the descriptor alone, before an engine is built:

```ts
expectPackage(myPackage).notToShadow(["price", "in", "of"]);
expectPackage(myPackage).notToCollideWith(BUILTIN_PACKAGES);
expectPackage(myPackage).toDeclareCompatibleEngineVersion();
```

A trigger word that shadows ordinary prose, a keyword that collides with another package's vocabulary, and an `engineVersion` range that never resolves each had a documented failure mode and no way to test for it.

The kit is framework-agnostic and runtime dependency-free: an assertion that fails throws an `ExpectationError`, one that passes returns, so it drops into any runner or a plain script. `createTestEngine` registers the package under test through `registerPackage`, so a version-incompatible or colliding package throws rather than being logged and skipped the way the `ExpressionEngine` constructor contains it.

Resolving an async package result inside a matcher is left for a later slice: `toBePending` confirms the async path was taken, but the kit evaluates synchronously and does not drive a resolver to completion.
