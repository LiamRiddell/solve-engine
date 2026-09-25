---
"solve-engine": minor
---

The helpers the package guides name are exported, and `createQueryResolver` takes the function it answers for by name

A package author follows the guides under `packages/` and `guide/`, and five of the helpers they name were exported from no public subpath, so an author outside this repository could not follow them (#717).

| helper | before | now |
| --- | --- | --- |
| `createQueryResolver`, with `QueryResolverOptions` and `QueryResolverPackage` | no public subpath | `solve-engine/resolvers` |
| `parseRightOperand` | no public subpath | `solve-engine/parser` |
| `definePhrasePattern`, with `PhraseSlot`, `PhraseCapture` and `PhraseAlternative` | no public subpath | `solve-engine/parser` |
| `boolValue`, `percentageValue` | no public subpath | `solve-engine/vm` |

`createQueryResolver` took the function it answers for only as a raw plugin index, where every other extension point names a function. It now takes `packageName` and `functionName`, the name a parselet passes to `emitPluginCall`, and computes the index the engine assigns that function at registration. A package whose resolver names a function its `pluginFunctions` does not declare is refused at registration with `PACKAGE_RESOLVER_FUNCTION_MISSING`, where the line would otherwise have waited for ever for a call that never comes; so is a resolver built for another package's name. The index form stays for the packages built on it, and giving both forms, half a name, or neither is refused when the resolver is built. A `fetchQuery` that resolves to something that is not a `Value` is now answered as a failed fetch, where it was cached as the figure.

The async data source guide opens with a complete package built on `createQueryResolver`, and its hand-written resolver compiles under `strict`, where it had a syntax error and ten type errors; both were compiled against the built package. The functions-and-operators guide says where the value factories and `parseRightOperand` come from, the recognising-phrases guide gains a section on `definePhrasePattern` with a worked example, and the package-authoring routing table points to both.

The boundary: this exports helpers that already exist; it does not redesign them. Once exported they are public surface, so the name-keyed form is settled before the export rather than after. Running the TypeScript fences under `guide/` as a whole is a separate documentation item.

## Verification

`Issue717_authoringHelpers.spec.ts` holds 11 tests: each helper imported from its public subpath, `createQueryResolver` taking the function by name and resolving to the index the engine assigns, a resolver whose function would never be called refused at registration, and adversarial fetches (one that throws synchronously, one that resolves to something that is not a value, one that never settles, and two resolvers claiming one namespace). `toBeWellFormed` is covered in the #719 spec, and the bundled-consumer contract compiles an authoring probe against the installed copy.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
