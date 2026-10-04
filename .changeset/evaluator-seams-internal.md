---
"solve-engine": minor
---

The engine's evaluator seams are marked internal and named in one contract, and the getters that handed out live internals return copies or are deprecated

The published `ExpressionEngine` declaration carried the seams its own incremental evaluator needs as ordinary public members, most on no docs page, and some getters handed out live internals (#761). `getBytecodeCache()` returned the map the engine compiles through, so one `set` on it made `2 + 2` answer 9 through `evaluateExpression` and `parseDocument` both. `getConfig()` copied only its top level, so `getConfig().performance.maxDocumentLines = 1` set the engine's own limit.

The seams are named once, in `EVALUATOR_SEAMS` and the `EvaluatorHost` type in `engine/EvaluatorHost.ts`, and `ThreeTierEvaluator` and `evaluateDocument` hold the engine as that type. Each seam, and the plumbing the language service shares, is marked `@internal` in its doc comment. `getBytecodeCache()` returns a copy, which no engine path reads, and `getConfig()` a copy all the way down. The getters that must stay live because the evaluator runs on them, `getLineCache()`, `getDag()` and `getVM()`, are deprecated, with `getLexer()`, `getNormalizer()`, `getParser()`, `getScopeManager()`, `getDiagnosticPipeline()`, `getDocumentModel()` and `getBytecodeCache()`, each naming what to use instead. [Embedding](/guide/embedding/#the-rest-of-the-engine) gains a table of the members a host may call, and [versioning and support](/guide/versioning-and-support/) says what `@internal` means for the promise.

| after | before | now |
| --- | --- | --- |
| `engine.getBytecodeCache().set(<2 + 2>, <program of 4 + 5>)`, then `2 + 2` | `9` | `4` |
| the same, then `parseDocument("2 + 2")` | `9` | `4` |
| `engine.getConfig().performance.maxDocumentLines = 1`, then a three-line document | refused as too large | three answers |

A spec reads the class with the TypeScript compiler and fails when a public member of `ExpressionEngine` has neither a mention on a docs page nor `@internal`, so a new member is documented or marked when it lands.

The boundary: the seams stay in the published types in 2.x, marked, since removing them removes public surface; turning on `stripInternal` and deleting the deprecated getters is 3.0, and the seam list is what that change keeps reachable to the evaluator. A copy of the bytecode cache shares its programs with the engine's, as a copy of any map of objects does. `ExpressionEngine` is not split into collaborators.

## Verification

`Issue761_evaluatorSeams.spec.ts` holds 96 tests: the issue's run through both entry points, twelve getters each mutated (set, delete, clear, overwrite) with the engine's next answers through `evaluateExpression` and `parseDocument` unchanged, the contract (every seam a method, every seam but `evaluateLine` and `getBatcher` marked `@internal`, the evaluator reaching the engine only through the seams, `evaluateDocument` agreeing with `parseDocument`), the surface check over every public member, the deprecations, unit tests of `copyPlain` with ordinary, boundary and hostile arguments (an own `__proto__` key, a thousand-deep tree), and the adversarial cases.

The full suite (`npm run test:full`) passed, 23,820 of 23,824 tests in 709 suites with 4 skipped, as did `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords` and `lint:dispatch-size` (`executeBytecode` at 46,484 bytecode bytes). `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
