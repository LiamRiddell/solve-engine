---
"solve-engine": patch
---

A short completion prefix no longer sorts the built-in vocabulary on every keystroke, so the language-service case `completions_warm_short_prefix` runs no slower than its merge base again.

Completion offers the words that start with what the reader has typed: the document's variables and units, and a fixed vocabulary of keywords, functions, call words, phrases and units. The benchmark gate measured the warm `s` case at 1.64 and then 1.76 times its merge base, while the cases with a longer prefix or a large variable pool were flat. Bisecting the merged batches put the whole step at the change that brought the call words, the registered phrases and eight uncategorised keywords into completions (#771): the candidates starting with `s` grew from 49 to 78. `getCompletions` sorted every match on every call, by group and then by `localeCompare`, so a one-letter prefix, the one that matches the most, paid for the larger vocabulary in comparisons.

- Each first-character bucket of the fixed vocabulary is now put in result order the first time a prefix asks for it, and kept that way until the vocabulary changes, so a keystroke reads its matches off in order. Sorting one bucket on first use, rather than all of them when the index is built, keeps the first completion as cheap as it was.
- Only the candidates that change with the document (its variables, its units and phrases matched across the words already typed) are sorted per call, and they are merged with the ordered matches. Two candidates that tie keep the order they were gathered in, which is what the stable sort over all of them did.
- The group order is read from a map rather than an object literal, so a package category named after an inherited property (`constructor`, `toString`) falls in the last group with the other unlisted categories, where it read a function off the prototype and compared as NaN.

| `language-service` case, local medians of three interleaved runs | merge base | before | now |
| --- | --- | --- | --- |
| `completions_warm_short_prefix` (`s`) | 11.19 µs | 17.42 µs (1.56x) | 2.17 µs (0.19x) |
| `completions_warm_specific_prefix` (`sqrt`) | 2.02 µs | 1.90 µs (0.94x) | 1.98 µs (0.98x) |
| `completions_warm_no_match` | 1.44 µs | 0.75 µs (0.52x) | 0.74 µs (0.51x) |
| `completions_warm_500_variables` (`var`) | 91.80 µs | 93.74 µs (1.02x) | 84.01 µs (0.92x) |

These are local medians, measured through `jest.bench.config.cjs` on a shared container, the merge base, this branch before the fix and this branch after it interleaved in each round; the gate's runner gives different absolute figures. The cold first call, which also builds the engine, varied between 3.8 ms and 9.1 ms from one run to the next on this container for all three and is not compared here.

The boundary: nothing a reader is offered is different, in content or in order, for any category the engine or a package ordinarily uses. The spec proves the results against the implementation it replaced, kept there as an oracle. The 500-variable case still sorts its variables per call, since they change with every edit; it is the same cost as before. The larger vocabulary itself is kept: no candidate is dropped to win the time back.

## Verification

`__tests__/hardening/CompletionBucketsSortedOnce.spec.ts` (24 tests) compares `getCompletions` with the implementation it replaced for the empty line, `a`, `c`, `m`, `s`, `to` and every one-character prefix, on an empty document and on one with variables and units, with 500 variables, with a cursor inside the line, across an edit and a cache invalidation, and with a package whose items tie on label (the same word in three categories, and a label with a zero-width space). A spy shows the warm `s` call makes no `localeCompare` call, and a mutation that leaves the buckets unsorted turns ten of its tests red. The parts (`completionTier`, `compareCompletionItems`, `mergeRankedCompletions`) have ordinary, boundary and hostile cases, among them a seeded property test of the merge against the stable sort over 300 random runs. The adversarial cases cover prototype words as prefixes and as package categories (with `Object.prototype` unchanged), look-alike and zero-width letters, markup-shaped text, a 100,000-character prefix and a run of 5,000 words. The language-service suites and the #771 completion spec pass, and the `languageServiceBenchmarks` suite passes.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 30,031 tests in 810 suites: 30,027 passed and 4 were skipped. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:changeset`, the proven docs examples and the hardening and integration suites passed.
