---
"solve-engine": patch
---

The first completion on a new engine no longer builds the built-in units, so the language-service case `completions_cold_first_call` is back near its merge base, and a prefix of two letters or more reads a few candidates instead of its whole first-letter group.

Completion offers the words that start with what the reader has typed, from the document's own names and from a fixed vocabulary: the packages' items, the keywords, the call words, the phrases and the built-in units. The vocabulary is gathered the first time an engine is asked for completions. The benchmark gate measured that first call (a new engine and service, then `sq`) at 1.47, 1.02, 1.39 and 2.00 times its merge base on successive runs. Bisecting the merged batches put the whole step at the change that brought call words and phrases into completions (#771): it put every candidate through a one-per-label check, a lowercased copy and a key string per candidate, and more than 1,300 of the 1,750 candidates are built-in units. Every new engine paid for them, and for a measure lookup per unit, although no engine can change them.

- The built-in units are now made once per process and shared by every engine, and only for the first letters a reader actually types: the first `s` makes the units starting with `s`, sorted once. Each engine keeps its own packages' items, keywords (a language pack's included), call words and phrases, and merges them with the shared units per first letter, ties going to the engine's own, which is where the single list put them. An engine whose package offers its own unit of the same name (`KG` from a package) still offers that one in place of the built-in, on that engine only.
- A prefix of two characters or more reads its first-letter group narrowed to its first two characters, made once and kept, so `sqrt` tests a handful of labels rather than the 78 starting with `s`.
- Listing the registered phrases builds each phrase as one string instead of copying an array of its words at every level of the phrase tree.

| local medians, interleaved fresh processes | merge base | before | now |
| --- | --- | --- | --- |
| first `getCompletions("sq")` on a new engine | 0.46 ms | 1.20 ms (2.62x) | 0.48 ms (1.05x) |
| new engine and service, then the first call | 1.68 ms | 2.80 ms (1.67x) | 1.92 ms (1.15x) |
| memory allocated by that first call | 403 KB | 1,001 KB | 459 KB |
| `completions_warm_short_prefix` (`s`) | 10.07 µs | 1.60 µs | 1.57 µs |
| `completions_warm_specific_prefix` (`sqrt`) | 0.95 µs | 1.42 µs | 0.44 µs |
| `completions_warm_no_match` | 0.46 µs | 0.39 µs | 0.38 µs |

The first three rows come from a timing script that builds a fresh engine and service and times the first call, 150 engines per process after 20 to warm up, twelve processes for each version, interleaved; the warm rows from the benchmark's own harness over twelve interleaved processes. Most of the remaining 0.25 ms on the second row is the engine's construction (1.16 ms on the merge base, 1.31 ms now), which other changes on this branch grew and this change does not touch. In the first process-wide call the units for that letter are still made and the collator behind `localeCompare` is loaded (several milliseconds, once per process, as on the merge base for any prefix with more than one match).

The boundary: nothing a reader is offered is different, in content or in order. The units a document defines and its variables are still read on every call, and a package registered after the first call is still picked up by `invalidateCache()`, as before. The shared unit items are frozen, since every engine hands out the same ones.

## Verification

`__tests__/hardening/ColdCompletionSharedUnits.spec.ts` (32 tests) proves `getCompletions` against the whole-list implementation, rebuilt in `tools/completionOracle.ts`, for the empty line, every one-character prefix, all 676 two-letter prefixes and specific prefixes (units, phrases across words, a cursor after a number), cold and then warm, on the built-in packages, with no packages, with one package registered and one unregistered, in German and French, with a package's own unit beside the built-in one, and with a document's variables and units. A package registered after the first call appears once the cache is invalidated and disappears when it is unregistered. The parts (`groupUnitSpellings`, `rankedBuiltinUnitBucket`, the narrowed two-character lists, `mergeRankedCandidates`, `PhraseTrie.getAllPhrases` against its old listing) have ordinary, boundary and hostile cases, among them prototype words, look-alike and zero-width letters, markup-shaped text, a 100,000-character prefix, a run of 5,000 words and every two-character start, with `Object.prototype` unchanged. A mutation that drops the package-unit filter, one that sends merge ties to the units and one that stops narrowing each turn some of its tests red. `CompletionBucketsSortedOnce.spec.ts` now builds its oracle's candidate list with the same tool, since the service no longer holds that list whole.

The language-service suites, the #771 completion spec, `CompletionBucketsSortedOnce.spec.ts`, the engine footprint spec (a 50-line document on a fresh engine under 786,432 bytes) and the `languageServiceBenchmarks` suite pass.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 30,114 tests in 812 suites: 30,109 passed and 5 were skipped. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:changeset`, the proven docs examples, the hardening and integration suites and the `allocationBenchmarks` suite passed.
