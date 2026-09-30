---
"solve-engine": patch
---

An engine built with a few packages is smaller than `createEngine()` under esbuild too

Each built-in package is now a build entry of its own, so it lands in files of its own in the published ESM build (#716). Before, every built-in package shared one chunk of about 330 KB: esbuild, which tsup builds the package with, splits code by which entry points reach it, and every package is reached by the same ones (the root entry through `createEngine`, `solve-engine/packages`, the worker). A bundler that honours `"sideEffects": false` by dropping whole files, as esbuild does, kept that chunk whole for any host that imported one package, so a slim engine saved almost nothing. Obsidian plugins build with esbuild.

The same two programs, `createEngine()` from the root entry and `new ExpressionEngine({ packages: [ARITHMETIC_PACKAGE] })` with the package from `solve-engine/packages`, bundled from the built package with `@tanstack/query-core` left external:

| bundle | before | now |
| --- | --- | --- |
| `createEngine()`, esbuild 0.28.1, minified | 908,192 bytes | 908,326 bytes |
| slim engine, esbuild 0.28.1, minified | 907,514 bytes | 576,079 bytes |
| slim engine, rollup 4.63.3, not minified | 618,438 bytes | 569,777 bytes |
| largest ESM chunk | 332,961 bytes | 111,525 bytes |

The per-package entries are a chunking device, not an import path: they are written under `dist/split/`, package.json exports none of them, and no declarations are written for them. A host imports every package from `solve-engine/packages`, as before. `npm run stats:size` now also records what the two programs above cost under esbuild, minified and compressed with brotli (`esbuildFullBrotli`, `esbuildSlimBrotli`), so `lint:size` fails when the figure goes stale, and the Performance page's bundle-size section quotes both from that data rather than calling the split open work. The `//sideEffects` note in package.json and the header of `scripts/check-tree-shaking.mjs` said `npm run size` bundles with esbuild; size-limit 14 bundles with rolldown, and both now say so.

The boundary: the shared core stays shared. The lexer, the parser, the VM and the unit table are in every engine, so a slim engine never comes near zero; shrinking the core for an arithmetic-only build was set aside as large and risky for a niche build. The published package holds more files (869 against 325 at the last recorded figure) for the extra chunks and entries; the tarball grows by about 5%. `npm run smoke:bundled` still proves that no chunk doing load-time work is reachable only through a bare import (94 of 149 chunks do work at load, all anchored by binding imports).

## Verification

`Issue716_perPackageChunks.spec.ts` holds 7 tests. `packageEntries` is tested on a scratch tree: one entry per package directory with an `index.ts`, a directory with none and a file left out, a name that would not make a plain file name left out, a directory named `__proto__` or `constructor` kept as an ordinary key with `Object.prototype` untouched, and a missing directory reported as the file system's own error; and on the real tree, where every package `builtins.ts` imports has its entry and no entry is a published subpath. End to end, the spec builds the engine from source as tsup does (esbuild, ESM, splitting) with and without the per-package entries and bundles both programs against each: with them the slim engine is under 0.8 of the full one and no chunk reaches 200 KB; without them it is over 0.95, which is the cause. `npm run build`, `npm run smoke`, `npm run smoke:bundled` and `npm run smoke:globals` passed on the new build, and `scripts/assert-publishable.mjs` found every entry point. `docs/src/data/packageSize.json` is not regenerated in this change, so `lint:size` reports it stale until `npm run stats:size` is run.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 21,148 tests in 683 suites: 21,143 passed and 4 were skipped. The one failure was in `Issue715_benchmarkCorpora.spec.ts`, whose honesty check compared two passes over `now + N days` lines a second apart; that document is now checked without the agreement, which the next case checks with those lines left out, and the new specs were rerun and pass. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measures 46,468 bytes by the `lint:dispatch-size` method, run by hand since that script's own Jest run finds no spec in a worktree.
