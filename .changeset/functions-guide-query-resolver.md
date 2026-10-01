---
"solve-engine": patch
---

The functions and operators guide says when a live lookup should use `createQueryResolver` rather than a promise-returning plugin function

The guide documents a plugin function that returns a promise, which is accurate, but it named `createQueryResolver` only in passing, so an author writing a live lookup (a value read from a service that can change while the document is open) was not told when the helper is the better tool. A new section, "When a live lookup wants `createQueryResolver`", sits under the promise-returning handler and says what the helper adds: a cache that goes stale after `staleTimeMs`, one fetch shared between the lines that ask the same thing and at most six at once, refetching with `refetchIntervalMs` and a failure kept only for `failureCooldownMs`, and a `signal` that fires on cancellation or at `timeoutMs`. It links to the [short path](/guide/async-data-sources/#the-short-path-createqueryresolver) of the async data source guide for the worked example.

| on the page | before | now |
| --- | --- | --- |
| when to prefer the helper | one sentence on refresh and cache | its own section: cache, share, refetch, cancel |
| the link | the async data source guide | its short path, by anchor |
| the boundary | not stated | the query must be quoted in the line; a variable or two operands keep a handler |

The boundary: the engine is unchanged, and a plugin function may still return a promise. The section adds no code fence, so the guide snippet specs are unaffected.

## Verification

`FoundBug_functionsGuidePointsToQueryResolver.spec.ts` holds 11 tests: the section sits under the promise-returning handler, names each option it describes and its boundary, and links to an anchor the async data source guide has; a package built on the short path answers a repeated query from the cache, fetches a query shared by three lines once, aborts its signal at the timeout and settles to `RAINGUIDE_QUERY_FAILED`, keeps a failure through its cooldown and fetches again after it, and answers `RAINGUIDE_NOT_PREFLIGHTED` for a place in a variable without asking the service; and the adversarial cases (prototype words and markup reach the fetch as text with `Object.prototype` unchanged, a fetch that answers NaN, a typo, two engines, and numeric and text edges as the argument).

The fast suite ran across 780 suites (26,930 of 26,934 tests passed, 4 skipped, none failed), with `docs/public/llms-full.txt` regenerated. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:sidebar` and `lint:links` passed. `npm run verify` as one command was not run.
