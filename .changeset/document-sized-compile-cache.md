---
"solve-engine": patch
---

A warm pass over a document of more than 2,000 distinct lines finds every line compiled

The compiled-program cache, its front half and the remembered parse failures now hold `performance.defaultCacheSize` entries plus the open document's line count, the line count bounded by `maxDocumentLines` (#765). They were capped at `defaultCacheSize` alone, 2,000 by default, and evicted the entry used longest ago. A document pass visits its lines in the same order every time, and such a cache smaller than the document evicts each line just before the next pass wants it, so past 2,000 distinct lines a warm pass got no hits and compiled every line again.

A warm `parseDocument` over N distinct lines of arithmetic, conversions, percentages and functions, none failing, median of seven passes, the engine's source bundled by esbuild, three runs each:

| distinct lines | before | now | programs held, before and now | engine heap while open, before and now |
| --- | --- | --- | --- | --- |
| 1,000 | 19.6 to 25.9 ms | 19.2 to 27.9 ms | 1,000 and 1,000 | 5.5 MB and 4.5 MB |
| 5,000 | 69.1 to 81.8 ms | 28.2 to 41.3 ms | 2,000 and 5,000 | 12.9 MB and 12.4 MB |
| 10,000 | 132.4 to 146.8 ms | 75.1 to 101.2 ms | 2,000 and 10,000 | 19.6 MB and 23.0 MB |

On the document-parse benchmark's 10,000 distinct lines the warm pass went from 303.6 ms to 110.3 ms. Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2, load average about 4 from other work); the 1,000-line row fits under the old cap and moves within this machine's noise.

The open document is the attached document model's while an evaluator drives the engine, and otherwise the last batch pass's, kept until the next pass or `clear()`. A pass nested inside a line (a what-if's scratch run) does not resize the caches. The `defaultCacheSize` on top is room for what is not a line of the document, a host's probe or an inline solve, without which a document of exactly the cap's size would still cycle through it. When a smaller document follows a larger one, the next insertion brings the cache down to the smaller cap. The Performance page no longer puts the old fall-off in warm throughput down to the document not fitting.

The boundary: this is the three compile caches only; the line cache and result retention are separate. The cost is a compiled program per distinct line while a document is open, 3.4 MB more at 10,000 lines than the old cap held, and `clear()` gives it back; with no document open, the cap is `defaultCacheSize` alone, as before. A scan-resistant eviction policy (2Q or SLRU) was the other option the issue named; sizing to the document was chosen because it is exact for the repeating scan and changes no eviction order below the cap.

## Verification

`Issue765_documentSizedCompileCache.spec.ts` holds 29 tests. `compiledCacheCap` is tested with no document, with a batch document, with an attached document model as it changes, bounded by `maxDocumentLines`, for an empty document, after `clear()`, and around a nested what-if pass. A second pass over 5,000 distinct lines lexes nothing; the same holds through a long-lived evaluator and for 2,500 lines that do not parse; a smaller document after a larger one brings the cache down. The adversarial cases add prototype words as the lines of a large document with `Object.prototype` untouched, a document refused for its size, the two document passes agreeing value for value past the old cap, one edit to a 3,000-line open document recompiling one line, a host's own small cap with no document, the document edges, and a cap of 1. `CompiledCacheEviction.spec.ts` and `CacheCoherence.spec.ts` pass unchanged apart from the cap test's name and the header note that said sizing the cap to the document was not done.

The full suite (`npm run test:full`) passed, 22,905 of 22,909 tests in 705 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:dispatch-size` (`executeBytecode` at 46,468 bytecode bytes). `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
