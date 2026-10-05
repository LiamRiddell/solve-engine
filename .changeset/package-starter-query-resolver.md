---
"solve-engine": patch
---

The package starter's live lookup is an async resolver made with `createQueryResolver` from `solve-engine/resolvers`, rather than a plugin function that returns a promise

The third-party starter in `examples/package-starter` (#773) built `rainfall("Oslo")` from a promise-returning plugin function with a cache of its own, because `createQueryResolver` was not public when the starter was written. It is exported from `solve-engine/resolvers` now, and the starter shows the path an author should copy: the resolver starts the fetch before the line runs, keeps the answer in the engine's own cache (so a place is fetched once, and two lines asking for it share the fetch), runs at most six fetches at once, times out a service that does not answer, and keeps a failure only for its short cooldown. The package supplies the fetch, the place check and the index the engine files `rainfall` under (`pluginFunctionIndexFor("package-starter:rainfall")`). A new `refreshEveryMs` option passes a refresh cadence through to the resolver.

| line | before | now |
| --- | --- | --- |
| `rainfall("Oslo")` | Pending, then `4.5 mm`, from the package's own cache | Pending, then `4.5 mm`, from the engine's cache |
| `rainfall("../etc")` | `STARTER_BAD_PLACE` at once | `STARTER_BAD_PLACE` once settled; the host's fetch is never called |
| `rainfall(42)` | `STARTER_BAD_PLACE` | `STARTER_BAD_PLACE` |
| `:where = "Oslo"` then `rainfall(where)` | fetched as the line ran | `STARTER_PLACE_NOT_QUOTED`: the place must be written in the line |

The boundary: `createQueryResolver` reads its query from the line as written, before it runs, so a place held in a variable is refused by name rather than fetched; a lookup whose input is known only as the line runs needs the function that fetches on a cache miss, which the async data source guide describes. The starter still imports public subpaths only, and still does not replace `examples/osrs`, the internal fixture the playground bridge imports.

The async data source guide already has a section on `createQueryResolver`, and the package authoring guide now says the starter's lookup is built on it, with a link to that section.

## Verification

`Issue773_packageStarter.spec.ts` holds 9 tests: the starter imports public subpaths only, compiles under `strict`, runs its own 12 tests against the engine's source, builds its lookup on `createQueryResolver` (one resolver, watching the plugin-call opcodes, and a plugin function that answers a wrong argument at once), and shares one fetch between two lines while each engine keeps its own answer. The starter's own tests add a place held in a variable, a service that answers NaN, a negative or Infinity, and hostile places settling to `STARTER_BAD_PLACE` with no fetch. The bundled-consumer contract (`npm run build && npm run test:consumer`) built the starter against the packed tarball and passed its tests; its one other failure was the documented-examples count, which the coordinator regenerates.

The fast suite ran across 767 suites (25,907 of 25,912 tests passed, 4 skipped); its one failure was `LlmsTxt.spec.ts`, since the pages changed, and it passes after `docs/public/llms-full.txt` was regenerated. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and the proven docs examples passed, and `executeBytecode` measured 44,322 bytes by hand, unchanged (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.

On top of main, the full suite ran 28,105 tests in 786 suites, all passing but 4 skipped once the guide manifest and one docs link followed main's async data source guide (both in this change); `npm run test:temporal` passed its 3,493 tests, and the bundled-consumer contract passed its 27 checks, including 2,092 documented examples.
