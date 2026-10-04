---
"solve-engine": patch
---

The check rule is tried only where the word `check` stands

The normaliser tries a rule only at positions its declared shape admits, and the rule that reads a `check` line declared any identifier, although it only ever matches the word `check` at the start of a line (#767). It was tried at every word of prose. Its first slot now names the word, compared case-insensitively as the rule compares it, and `NormalizerIndexFidelity.spec` proves the declaration against the rule's behaviour over the shared corpus, which now includes check lines in three cases and `check` as an ordinary name.

| one cold `parseDocument` of 1,000 lines of ten kinds | before | now |
| --- | --- | --- |
| `conditionals:check` `match()` calls (100 matches) | 1,484 | 106 |
| `datetime:month-name-date` calls (84 matches) | 3,112 | 3,112 |
| `datetime:between-unit` calls (28 matches) | 1,528 | 1,528 |
| the pass, median of seven fresh engines | 35.7 ms | 32.9 ms |

Nothing a reader sees changes: `check = $80` then `15% of check` still give `= $80.00` and `= $12.00`, and `CHECK 2 + 2 == 4` still passes as a check line.

The boundary: each wasted call returned at its first comparison, so this is tidiness in the normaliser's dispatch rather than a fix for a slowdown; the pass time above moves within this machine's noise (a shared Linux container, Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2). The two datetime rules the issue names as optional work, `month-name-date` and `between-unit`, are left as they are. Splitting each into one rule per word order would only help a cold evaluation, since a compile-cache hit skips the normaliser, and the measurement above does not show the cost worth a medium change.

## Verification

`Issue767_checkRuleShape.spec.ts` holds 14 tests: the declared shape; the index offering the rule at `check` in any case and at no word of prose; `match()` called once per check line over a document of fifty checks and fifty prose lines, and never over prose alone; the rule itself with ordinary, boundary (not past position 0, no comparison, `check = 80`, `15% of check`) and hostile arguments (near-miss words, prototype words, an empty stream, a position past the end); the three pinned readings; the two document passes agreeing on a note mixing both readings; and the adversarial cases: prototype words as names beside `check`, look-alike, markup-shaped and oversized lines, a Cyrillic look-alike that is not the word, a typo and a failing check, the numeric edges, and CRLF with blank lines. The normaliser suites, the fidelity spec among them, passed.

The full suite (`npm run test:full`) passed, 22,905 of 22,909 tests in 705 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:dispatch-size` (`executeBytecode` at 46,468 bytecode bytes). `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
