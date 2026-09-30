---
"solve-engine": minor
---

A keystroke sent to `applyTransaction` as delete-one-insert-one is an edit in place, and keeps the answers below the viewport

A host that reports each keystroke as a line change sends `{ startLine, deleteCount: 1, insertLines: [newText] }` to `ThreeTierEvaluator.applyTransaction`. That was handled as a structural edit although no line had moved: the line was given a new id (its compiled programs and recorded dependencies went with the old one), the checkpoint chain was renumbered, the dependency graph was cleared, and every line from the edit down was recorded as moved, so the next pass forgot the answers below the viewport (#713). `DocumentModel.editLine` makes the same edit in place.

A transaction in which every change deletes exactly as many lines as it inserts, all inside the document, is now applied line by line through `editLine`: the lines keep their ids and are only marked dirty. The result carries a new `edited` field, the ids of the lines whose text changed, and `inserted` and `removed` are empty for such a transaction, since nothing was inserted or removed.

| alternating `:v0 = 1` and `v0 * 2`, line 3 edited, then lines 1 to 40 evaluated | before | now |
| --- | --- | --- |
| 1,000 lines, through `applyTransaction` | 4.31 ms | 0.23 ms |
| 5,000 lines, through `applyTransaction` | 14.94 ms | 0.59 ms |
| 20,000 lines, through `applyTransaction` | 33.75 ms | 2.24 ms |
| 20,000 lines, through `editLine`, for comparison | 2.04 ms | 2.01 ms |
| line 1500 (`v749 * 2`, which does not read line 3) after the transaction | no answer | `= 1,500` |
| the edited line's dependent, line 4 | `= 14` | `= 14` |

Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2, load average about 10 from other work), the median of 31 keystrokes, both builds in the same few minutes.

The boundary: a transaction with any change that alters the line count (an insertion, a deletion, a paste of more or fewer lines than it replaces) takes the structural path for all of it, as before, and that stays correct. So does a change whose first line is not a whole number inside the document. An edit in place reaches the lines that read the edited one during the next pass rather than being marked on them at once, as it always has through `editLine`. This relies on `editLine` comparing the text and not only its hash (#664), so a colliding edit is taken rather than dropped. No host change is needed; a host that reads `inserted` or `removed` to follow a one-for-one replacement by id now finds the ids unchanged, in `edited`.

## Verification

`Issue713_sameCountTransactionEditsInPlace.spec.ts` holds 43 tests: the decision itself (a keystroke, a multi-line same-count paste, several changes, the first and last line, a change of nothing, a change past the end, first lines of zero, a fraction, NaN, the infinities and past 2^53, hostile shapes that are never a throw), the edited line keeping its id and line 1500 its answer, a count showing no renumbering and no graph clear, and after each transaction every line against a fresh `parseDocument`: a definition turned into prose and back, a renamed variable, positional readers, a tag total, a table whose separator is removed and restored, a hash-colliding edit, a user function, a running total, a viewport near the bottom, and the adversarial cases. Two existing tests that counted a one-for-one replacement as a removal and an insertion (`ConcurrentModification.spec.ts`) now count it as an edit, and `CacheCoherence.spec.ts` keeps its structural case with a line count that changes. `incrementalEditBenchmarks.spec.ts` times a keystroke through both paths at 1,000, 5,000 and 20,000 lines.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) passed, 15,686 of 15,690 tests in 618 suites with 4 skipped; one suite that bundles through the main checkout failed during the run while that checkout was being changed, and passed on a rerun. The type check ran through `tsc` (`typecheck:tsc`), since `tsgo` is not installed here, and `npm run lint`, `lint:comments`, `lint:docs`, `lint:sidebar`, `lint:cheatsheet` and the proven docs examples passed.
