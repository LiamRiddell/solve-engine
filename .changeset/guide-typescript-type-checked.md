---
"solve-engine": minor
---

The guides' TypeScript is type-checked under `strict`, and what it caught is fixed: `createQueryResolver` is exported from `solve-engine/resolvers`, and a worker's `parseDocument` takes `{ signal }` alone

The guides' fences that state a result were already run (#779), and the rest were read by nothing, so a fence could show a call the engine's types refuse. `GuideSnippetTypes.spec.ts` now compiles every `ts` and `typescript` fence under `guide/` and `getting-started/` under `strict`, against the engine's public entry points, in the shape `PackageGuideSnippets.spec.ts` already compiles the package-author pages. Each fence is given the public names it mentions and does not declare, and the quick start's `engine`; anything else a fence reads (a name an earlier fence or the prose defines) is declared in a manifest with its type, by page and first line, and so is a fragment's wrapper. The pass caught ten fences and two faults in the engine's own surface.

| fence | before | now |
| --- | --- | --- |
| `createQueryResolver({ ... })`, the async data source guide's recommended helper | no public entry exported it, so a consumer could not import it | `import { createQueryResolver } from "solve-engine/resolvers"`, with its option and result types |
| `await engine.parseDocument(text, { signal })` on a worker | refused by the types: `inputType` was required, though the worker sends no options for a signal alone | accepted; options that leave out `inputType` get the engine's default, markdown |
| `const oneCountEverywhere = { ..., currencyPlaces: "setting" }` | `"setting"` widened to `string`, refused by `formatValue` | typed as `FormattingSettings` |
| `service.rename(...)` then `applyTextEdits(text, result.edits)` | `edits` read from a result that may be a refusal | `if (result.ok) applyTextEdits(...)`, and the same for a line shift and a hover |
| the rates resolver sketch | untyped parameters, an undeclared cache, and `this.cache.set(/* queryKey */, rate)`, which does not parse | typed, with its cache, and the key passed through |

The formatting page's list and matrix fence imports `MatrixData` for the cast its call needs, and the live-data page's stocks fence names a source that resolves to a quote rather than an empty body. Each fence the pass does not check is listed with its reason: two sketches whose comments stand for members shown above, a return statement shown alone, a CodeMirror adapter, and three of the upgrading page's before-and-after fences, whose 1.x halves no longer compile by design (the other four compile from their `// now` line). The README says what is checked.

The boundary: the pass proves each fence type-checks as a consumer would write it, not that it runs; `GuideExamples.spec.ts` runs the fences that state a result. A given import means a fence is not held to importing every name it uses. The package-author pages are compiled by `PackageGuideSnippets.spec.ts`, and a test here fails if a docs directory with fences is checked by neither. The spec runs in the fast suite, as the package-guide spec does, in about ten seconds.

## Verification

`GuideSnippetTypes.spec.ts` (17 tests) compiles 139 fences, and holds that the manifest names only fences that exist, that few go unchecked, that every docs directory with fences is covered, unit tests of `fenceSource`'s new `function-body`, `class-member` and `from` treatments, `fenceNames`, `givenImports` and `publicExportNames` with ordinary, boundary and hostile fences (an empty fence, one that does not parse, prototype words), and that the harness reports a type error, a deep import, an undefined name and the widened literal the formatting page had. `GuideExamples.spec.ts` and `PackageGuideSnippets.spec.ts` still pass over the edited pages, and the type-check baseline fell by the two errors `WorkerHarness.spec.ts` had against the worker's old signature.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 27,327 tests in 778 suites, all passing but 4 skipped once the guide manifest and one zone assertion followed main (both in this change), and `npm run test:temporal` passed its 3,477 tests.
