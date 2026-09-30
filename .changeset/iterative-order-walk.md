---
"solve-engine": patch
---

The document's line order is walked with a loop, not a recursive generator

`DocumentModel` keeps the order of a document's lines in a balanced tree, and walks it from first line to last to rebuild its position lookups after every structural edit (an insertion, a deletion, a paste). The walk was a recursive generator, which handed each line up through one generator frame per level of the tree (#763). It is now a loop with an explicit stack: `SegmentTree.forEach`, which the rebuild calls, `toArray`, and the tree's iterator, built on the same loop. The order visited is the same.

| 20,000 lines, after 2,000 random replacements | before | now |
| --- | --- | --- |
| walking the tree with its iterator | 9.663 ms | 0.737 ms |
| walking it with `forEach` | (no such method) | 0.460 ms |
| inserting a line at line 3, then evaluating lines 1 to 40 | 29.68 ms | 19.45 ms |
| of which rebuilding the position lookups | 23.11 ms | 3.15 ms |

Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2, load average about 10 from other work), with the engine's source bundled by esbuild, the median of 21 runs, both builds in the same few minutes.

The boundary: the tree itself (its random priorities, `spliceAt`, `getRange`) is unchanged; this is the walk only. The rest of an insertion's cost is the structural edit's own work, which this does not touch. Typing inside a line no longer rebuilds the lookups at all, since a one-for-one replacement is now an edit in place (#713), which leaves insertions, deletions and pastes.

## Verification

`Issue763_iterativeOrderWalk.spec.ts` holds 16 tests. After long runs of random splices under four seeds, `forEach`, `toArray` and the iterator visit exactly the order a plain array given the same splices holds, which is also what `getRange` and `getAt` report. The boundaries (an empty tree, a cleared one, a single line, id zero and ids past 2^31, an iterator stopped early) and the adversarial cases (205,000 lines without exhausting the stack, a visitor that throws leaving the tree whole, a document of prototype words) are covered, and a count shows `buildOrderCaches` walks the tree once with `forEach` and never through the generator. `incrementalEditBenchmarks.spec.ts` times the walk and an insertion at 20,000 lines.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) passed, 15,686 of 15,690 tests in 618 suites with 4 skipped; one suite that bundles through the main checkout failed during the run while that checkout was being changed, and passed on a rerun. The type check ran through `tsc` (`typecheck:tsc`), since `tsgo` is not installed here, and `npm run lint`, `lint:comments`, `lint:docs`, `lint:sidebar`, `lint:cheatsheet` and the proven docs examples passed.
