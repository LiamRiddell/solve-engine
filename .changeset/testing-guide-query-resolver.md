---
"solve-engine": patch
---

The testing guide's live-values example builds `tide("Dover")` with `createQueryResolver`, as the package starter and the async data source guide do

The example on [testing a package](/packages/testing-a-package/#live-values) still returned a promise from a plugin function, after the starter's `rainfall("Oslo")` and the short path of the async data source guide had moved to `createQueryResolver` from `solve-engine/resolvers`. That helper is the form a package author should copy: it starts the fetch before the line runs, keeps the answer in the engine's cache and shares it between lines, runs at most six fetches at once and times out a service that does not answer. The example now takes its fetch the starter's way, adds a failing service settled to `TIDES_QUERY_FAILED` (the code the helper gives a failure), and the page names the boundary: the port has to be written in the line in quotes, and one held in a variable answers `TIDES_NOT_PREFLIGHTED`.

| on the page | before | now |
| --- | --- | --- |
| the plugin function | `tide: async (args) => uomValue(await fetchHeight(...), "m")` | `tide: pluginFunction`, from `createQueryResolver` |
| the resolver | none | `asyncResolvers: [resolver]` |
| a failing service | described in a sentence | shown, settled with `toFailWith("TIDES_QUERY_FAILED")` |
| a port in a variable | not mentioned | `TIDES_NOT_PREFLIGHTED`, and where to go instead |

The boundary: the engine is unchanged; a plugin function may still return a promise, which the functions and operators guide documents. The example is compiled and run by `PackageGuideSnippets.spec.ts`, so a change to the helper that breaks it turns the build red.

## Verification

`FoundBug_testingGuideTidesResolver.spec.ts` holds 10 tests: the page's fence uses the helper and no promise-returning plugin function, and names the failure code and the boundary; the same package resolves a quoted port, settles a failure to `TIDES_QUERY_FAILED`, answers `TIDES_NOT_PREFLIGHTED` for a port in a variable without asking the service, and fetches a port asked on two lines once; and the adversarial cases (prototype words, markup, a path and a 500-character port reach the stub as text with `Object.prototype` unchanged, 400 calls on one line, a stub that answers NaN or never answers, a typo, and numeric and text edges as the argument). `PackageGuideSnippets.spec.ts`, `GuideSnippetTypes.spec.ts`, `GuideExamples.spec.ts` and `TsFences.spec.ts` pass with the new fence.

The fast suite ran across 776 suites (26,551 of 26,555 tests passed, 4 skipped, none failed), with `docs/public/llms-full.txt` regenerated for the changed pages. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measured 44,186 bytes by hand (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.
